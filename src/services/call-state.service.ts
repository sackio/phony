import { MAX_CONCURRENT_CALLS, MAX_CONCURRENT_INCOMING_CALLS, MAX_CONCURRENT_OUTGOING_CALLS, MAX_INCOMING_CALL_DURATION, MAX_OUTGOING_CALL_DURATION } from '../config/constants.js';

// Service to track active calls and their state
export interface ActiveCall {
    callSid: string;
    toNumber: string;
    fromNumber: string;
    callType: 'incoming' | 'outgoing';  // Track if this is incoming or outgoing
    status: 'initiated' | 'in-progress' | 'active' | 'on_hold' | 'completed' | 'failed';
    twilioCallSid?: string;
    voiceProvider?: string;  // Voice provider (elevenlabs)
    elevenLabsAgentId?: string;  // ElevenLabs agent ID
    elevenLabsVoiceId?: string;  // ElevenLabs voice ID
    contextChannel?: string;     // Slack channel ID or ATC session id for transcript stream + mid-call injection
    startedAt: Date;
    maxDurationTimer?: NodeJS.Timeout;  // Auto-hangup timer
    conversationHistory: Array<{ role: string; content: string; timestamp: Date }>;
    pendingContextRequest?: {
        question: string;
        requestedAt: Date;
        requestedBy: 'agent' | 'system';
    };
}

export class CallStateService {
    private static instance: CallStateService;
    private activeCalls: Map<string, ActiveCall> = new Map();

    private constructor() {}

    public static getInstance(): CallStateService {
        if (!CallStateService.instance) {
            CallStateService.instance = new CallStateService();
        }
        return CallStateService.instance;
    }

    public addCall(callSid: string, call: ActiveCall): void {
        this.activeCalls.set(callSid, call);
        console.log(`[CallState] Added call: ${callSid}`);
    }

    public getCall(callSid: string): ActiveCall | undefined {
        return this.activeCalls.get(callSid);
    }

    public updateCallStatus(callSid: string, status: ActiveCall['status']): void {
        const call = this.activeCalls.get(callSid);
        if (call) {
            call.status = status;
            console.log(`[CallState] Updated call ${callSid} status to: ${status}`);
        }
    }

    public updateTwilioCallSid(callSid: string, twilioCallSid: string): void {
        const call = this.activeCalls.get(callSid);
        if (call) {
            call.twilioCallSid = twilioCallSid;
            console.log(`[CallState] Updated Twilio SID for call ${callSid}: ${twilioCallSid}`);
        }
    }

    public removeCall(callSid: string): void {
        // Production Safety Control: Clear duration timer before removing call
        this.clearDurationTimer(callSid);
        this.activeCalls.delete(callSid);
        console.log(`[CallState] Removed call: ${callSid}`);

        // Belt and braces on top of the /call/status webhook. Twilio's callback
        // is authoritative (it carries the real duration) but it is a NETWORK
        // round-trip that can be delayed, misconfigured or lost — and when it
        // failed to arrive on 2026-08-27 the push stream's heartbeat went on
        // insisting a hung-up call was live. This local signal cannot be lost:
        // the process that removes the call also terminates the stream. `end()`
        // is idempotent, so whichever arrives second is a no-op.
        import('./call-event-push.service.js')
            .then(({ CallEventPushService }) =>
                CallEventPushService.getInstance().end(callSid, { ended_via: 'local-teardown' })
            )
            .catch(err => console.error(`[CallState] push end failed for ${callSid}:`, err));
    }

    public getAllCalls(): ActiveCall[] {
        return Array.from(this.activeCalls.values());
    }

    public addTranscript(callSid: string, entry: { role: string; content: string }): void {
        const call = this.activeCalls.get(callSid);
        if (call) {
            call.conversationHistory.push({
                ...entry,
                timestamp: new Date()
            });
        }
    }

    public setPendingContextRequest(callSid: string, question: string, requestedBy: 'agent' | 'system'): void {
        const call = this.activeCalls.get(callSid);
        if (call) {
            // ⛔ Do not re-notify for a question already in flight. On the
            // 2026-08-27 test call the agent sent the SAME calendar question four
            // times while the answer was being fetched, which is noise for the
            // controlling session and reads as though nothing is happening. The
            // pending request stands until it is answered.
            const pending = call.pendingContextRequest;
            if (pending && pending.question.trim().toLowerCase() === question.trim().toLowerCase()) {
                console.log(`[CallState] Duplicate context request for ${callSid} — already pending, not re-notifying: ${question}`);
                return;
            }
            call.pendingContextRequest = {
                question,
                requestedAt: new Date(),
                requestedBy
            };
            console.log(`[CallState] Set pending context request for call ${callSid}: ${question}`);

            // The agent on the call is now BLOCKED waiting for an answer. Until
            // this was pushed, nothing told the controlling session — it had to
            // happen to be polling at the right moment. Unthrottled on purpose:
            // a held call burns real time and the far end is listening to silence.
            // Imported lazily to keep this leaf service free of a cycle back
            // through the dispatcher.
            import('./call-event-push.service.js')
                .then(({ CallEventPushService }) =>
                    CallEventPushService.getInstance().emitNow(callSid, 'call.awaiting_input', {
                        question,
                        requested_by: requestedBy,
                        to: call.toNumber,
                        from: call.fromNumber,
                        status: call.status,
                    })
                )
                .catch(err => console.error(`[CallState] awaiting_input push failed for ${callSid}:`, err));
        }
    }

    public clearPendingContextRequest(callSid: string): void {
        const call = this.activeCalls.get(callSid);
        if (call) {
            call.pendingContextRequest = undefined;
            console.log(`[CallState] Cleared pending context request for call ${callSid}`);
        }
    }

    public hasPendingContextRequest(callSid: string): boolean {
        const call = this.activeCalls.get(callSid);
        return !!(call && call.pendingContextRequest);
    }

    // Production Safety Controls - Concurrent Call Limits

    public getActiveCallCount(): number {
        return this.activeCalls.size;
    }

    public getOutgoingCallCount(): number {
        return Array.from(this.activeCalls.values()).filter(call => call.callType === 'outgoing').length;
    }

    public getIncomingCallCount(): number {
        return Array.from(this.activeCalls.values()).filter(call => call.callType === 'incoming').length;
    }

    public canAcceptOutgoingCall(): boolean {
        const totalCalls = this.getActiveCallCount();
        const outgoingCalls = this.getOutgoingCallCount();

        if (totalCalls >= MAX_CONCURRENT_CALLS) {
            console.log(`[CallState] Cannot accept outgoing call: total limit reached (${totalCalls}/${MAX_CONCURRENT_CALLS})`);
            return false;
        }

        if (outgoingCalls >= MAX_CONCURRENT_OUTGOING_CALLS) {
            console.log(`[CallState] Cannot accept outgoing call: outgoing limit reached (${outgoingCalls}/${MAX_CONCURRENT_OUTGOING_CALLS})`);
            return false;
        }

        return true;
    }

    public canAcceptIncomingCall(): boolean {
        const totalCalls = this.getActiveCallCount();
        const incomingCalls = this.getIncomingCallCount();

        if (totalCalls >= MAX_CONCURRENT_CALLS) {
            console.log(`[CallState] Cannot accept incoming call: total limit reached (${totalCalls}/${MAX_CONCURRENT_CALLS})`);
            return false;
        }

        if (incomingCalls >= MAX_CONCURRENT_INCOMING_CALLS) {
            console.log(`[CallState] Cannot accept incoming call: incoming limit reached (${incomingCalls}/${MAX_CONCURRENT_INCOMING_CALLS})`);
            return false;
        }

        return true;
    }

    // Production Safety Controls - Duration Limits

    public startDurationTimer(callSid: string): void {
        const call = this.activeCalls.get(callSid);
        if (!call) {
            console.log(`[CallState] Cannot start duration timer: call not found ${callSid}`);
            return;
        }

        const maxDuration = call.callType === 'outgoing' ? MAX_OUTGOING_CALL_DURATION : MAX_INCOMING_CALL_DURATION;
        const maxDurationMs = maxDuration * 1000;

        console.log(`[CallState] Starting ${call.callType} call duration timer for ${callSid}: ${maxDuration} seconds`);

        call.maxDurationTimer = setTimeout(async () => {
            console.log(`[CallState] ⚠️  Max duration reached for ${call.callType} call ${callSid} (${maxDuration}s) - auto-terminating`);

            // Import TwilioCallService dynamically to avoid circular dependency
            const { TwilioCallService } = await import('./twilio/call.service.js');
            const twilioService = TwilioCallService.getInstance();

            try {
                if (call.twilioCallSid) {
                    await twilioService.endCall(call.twilioCallSid);
                    console.log(`[CallState] ✓ Auto-terminated call ${callSid} (Twilio SID: ${call.twilioCallSid})`);
                }
            } catch (error: any) {
                console.error(`[CallState] Failed to auto-terminate call ${callSid}:`, error.message);
            }
        }, maxDurationMs);
    }

    public clearDurationTimer(callSid: string): void {
        const call = this.activeCalls.get(callSid);
        if (call && call.maxDurationTimer) {
            clearTimeout(call.maxDurationTimer);
            call.maxDurationTimer = undefined;
            console.log(`[CallState] Cleared duration timer for call ${callSid}`);
        }
    }
}
