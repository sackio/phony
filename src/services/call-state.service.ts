import {
    ABSOLUTE_MAX_CALL_DURATION,
    CALL_EXPIRY_WARNING_MS,
    CALL_EXTENSION_MAX_MINUTES,
    CALL_LIVENESS_WINDOW_MS,
    MAX_CALL_EXTENSIONS,
    MAX_CONCURRENT_CALLS,
    MAX_CONCURRENT_INCOMING_CALLS,
    MAX_CONCURRENT_OUTGOING_CALLS,
    MAX_INCOMING_CALL_DURATION,
    MAX_OUTGOING_CALL_DURATION,
} from '../config/constants.js';

/** Outcome of an extension attempt. `granted` false always carries a reason. */
export interface ExtensionResult {
    granted: boolean;
    reason?: string;
    newDurationSec?: number;
    remainingSec?: number;
    extensionsUsed?: number;
    extensionsRemaining?: number;
}

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
    expiryWarningTimer?: NodeJS.Timeout;  // Fires CALL_EXPIRY_WARNING_MS before the hangup
    grantedDurationSec?: number;  // Current allowance, grows as extensions are granted
    extensionCount?: number;      // How many extensions this call has already used
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
        call.grantedDurationSec = maxDuration;
        call.extensionCount = 0;
        this.armTimers(callSid, maxDuration);
    }

    /**
     * (Re)arm both the auto-hangup and the warning that precedes it, measured
     * from the call's start so an extension cannot accidentally reset the clock.
     */
    private armTimers(callSid: string, grantedSec: number): void {
        const call = this.activeCalls.get(callSid);
        if (!call) return;

        if (call.maxDurationTimer) clearTimeout(call.maxDurationTimer);
        if (call.expiryWarningTimer) clearTimeout(call.expiryWarningTimer);

        const elapsedMs = Date.now() - call.startedAt.getTime();
        const remainingMs = grantedSec * 1000 - elapsedMs;

        if (remainingMs <= 0) {
            console.log(`[CallState] ⚠️  ${callSid} already past its ${grantedSec}s allowance — terminating now`);
            void this.terminate(callSid, grantedSec);
            return;
        }

        // ⛔ Warn BEFORE killing. Until this existed the cap fired as a bare
        // Twilio endCall: mid-sentence, no warning to either party, and nothing
        // told to the agent controlling the call. Being able to extend is only
        // half the feature — knowing you are about to lose the line is the half
        // that makes it usable.
        const warnInMs = remainingMs - CALL_EXPIRY_WARNING_MS;
        if (warnInMs > 0) {
            call.expiryWarningTimer = setTimeout(() => {
                void this.warnExpiring(callSid, grantedSec);
            }, warnInMs);
            call.expiryWarningTimer.unref?.();
        }

        call.maxDurationTimer = setTimeout(() => {
            void this.terminate(callSid, grantedSec);
        }, remainingMs);
        call.maxDurationTimer.unref?.();

        console.log(`[CallState] ${callSid}: allowance ${grantedSec}s, hangup in ${Math.round(remainingMs / 1000)}s, warning in ${Math.round(Math.max(warnInMs, 0) / 1000)}s`);
    }

    private async warnExpiring(callSid: string, grantedSec: number): Promise<void> {
        const call = this.activeCalls.get(callSid);
        if (!call) return;

        const remainingSec = Math.max(0, Math.round(grantedSec - (Date.now() - call.startedAt.getTime()) / 1000));
        const used = call.extensionCount ?? 0;
        console.log(`[CallState] ⏳ ${callSid} expiring in ${remainingSec}s (extensions used ${used}/${MAX_CALL_EXTENSIONS})`);

        try {
            const { CallEventPushService } = await import('./call-event-push.service.js');
            await CallEventPushService.getInstance().emitNow(callSid, 'call.expiring_soon', {
                remaining_seconds: remainingSec,
                granted_duration_sec: grantedSec,
                extensions_used: used,
                extensions_remaining: Math.max(0, MAX_CALL_EXTENSIONS - used),
                to: call.toNumber,
                from: call.fromNumber,
                note: `This call will be hung up by Twilio in ~${remainingSec}s. To keep it, call phony_extend_call — it is granted only if the call has proven it is still alive (someone spoke in the last ${Math.round(CALL_LIVENESS_WINDOW_MS / 1000)}s). Doing nothing lets it end.`,
            });
        } catch (err) {
            console.error(`[CallState] expiring_soon push failed for ${callSid}:`, err);
        }
    }

    private async terminate(callSid: string, grantedSec: number): Promise<void> {
        const call = this.activeCalls.get(callSid);
        if (!call) return;

        console.log(`[CallState] ⚠️  Max duration reached for ${call.callType} call ${callSid} (${grantedSec}s) - auto-terminating`);

        try {
            // Import TwilioCallService dynamically to avoid circular dependency.
            // ⛔ RESOLVING THE SERVICE MUST BE INSIDE THIS try. It used to sit
            // above it and threw "getInstance is not a function", which is an
            // unhandled rejection on a timer callback: the cap fired, nothing
            // was logged, and the call ran on. A failure to hang up is the one
            // outcome here that must never be silent.
            const { TwilioCallService } = await import('./twilio/call.service.js');
            const twilioService = TwilioCallService.getInstance();

            const sid = call.twilioCallSid ?? callSid;
            await twilioService.endCall(sid);
            console.log(`[CallState] ✓ Auto-terminated call ${callSid} (Twilio SID: ${sid})`);
        } catch (error: any) {
            console.error(`[CallState] ⛔ FAILED TO AUTO-TERMINATE ${callSid} — the call may still be running and billing:`, error?.message ?? error);
        }
    }

    /**
     * Push the auto-hangup back — but only for a call that has PROVEN it is
     * still alive.
     *
     * ⛔ AN EXTENSION IS NEVER GRANTED BECAUSE IT WAS REQUESTED. The failure
     * this guards against is the phantom call: a leg that is technically up
     * while nothing is happening on it — the far end gone, dead air, or the
     * warm-transfer case where our audio rendered fine and the human heard
     * silence. A caller asking to extend one of those is asking in good faith
     * and is wrong, so the burden of proof sits on the call, not the asker.
     *
     * ⛔ EVERY GATE FAILS CLOSED, including "Twilio did not answer". A refusal
     * costs one hung-up call; a wrongly-granted extension bills until something
     * else notices.
     */
    public async extendCall(callSid: string, minutes: number): Promise<ExtensionResult> {
        const call = this.activeCalls.get(callSid);
        if (!call) {
            return { granted: false, reason: `Call not found or no longer active: ${callSid}` };
        }

        const refuse = (reason: string): ExtensionResult => {
            // ⭐ Log every refusal. A refusal is not noise — it is usually the
            // first hard evidence that something upstream is wedged, and it is
            // the only place a phantom call announces itself.
            console.log(`[CallState] ⛔ Extension REFUSED for ${callSid}: ${reason}`);
            return { granted: false, reason, extensionsUsed: call.extensionCount ?? 0 };
        };

        if (!Number.isFinite(minutes) || minutes <= 0) {
            return refuse(`minutes must be a positive number, got ${minutes}`);
        }
        if (minutes > CALL_EXTENSION_MAX_MINUTES) {
            return refuse(`Single extension capped at ${CALL_EXTENSION_MAX_MINUTES} min, asked for ${minutes}. Ask again later rather than buying a long window on one moment's evidence.`);
        }

        // Gate 4 — how many bumps this call has had.
        const used = call.extensionCount ?? 0;
        if (used >= MAX_CALL_EXTENSIONS) {
            return refuse(`Already extended ${used} times (max ${MAX_CALL_EXTENSIONS}).`);
        }

        // Gate 3 — the ceiling nothing crosses.
        const granted = call.grantedDurationSec
            ?? (call.callType === 'outgoing' ? MAX_OUTGOING_CALL_DURATION : MAX_INCOMING_CALL_DURATION);
        const proposed = granted + minutes * 60;
        if (proposed > ABSOLUTE_MAX_CALL_DURATION) {
            return refuse(`Would reach ${proposed}s, past the hard ceiling of ${ABSOLUTE_MAX_CALL_DURATION}s. This call cannot be extended further.`);
        }

        // Gate 1 — the one that actually catches a phantom.
        const lastSpokeAt = call.conversationHistory.length > 0
            ? call.conversationHistory[call.conversationHistory.length - 1].timestamp.getTime()
            : call.startedAt.getTime();
        const silentForMs = Date.now() - lastSpokeAt;
        if (silentForMs > CALL_LIVENESS_WINDOW_MS) {
            return refuse(`Nothing has been said for ${Math.round(silentForMs / 1000)}s (limit ${Math.round(CALL_LIVENESS_WINDOW_MS / 1000)}s). This call cannot demonstrate it is still alive, so it will be allowed to end.`);
        }

        // Gate 2 — Twilio's own view. Weaker than gate 1 and deliberately last:
        // it is a network round-trip, and it was satisfied throughout the
        // warm-transfer failure while the human heard nothing.
        const { TwilioCallService } = await import('./twilio/call.service.js');
        const twilioSid = call.twilioCallSid ?? callSid;
        const twilioStatus = await TwilioCallService.getInstance().getCallStatus(twilioSid);
        if (twilioStatus === null) {
            return refuse(`Could not confirm with Twilio that ${twilioSid} is still up. Refusing rather than assuming.`);
        }
        if (twilioStatus !== 'in-progress') {
            return refuse(`Twilio reports status "${twilioStatus}", not in-progress.`);
        }

        call.grantedDurationSec = proposed;
        call.extensionCount = used + 1;
        this.armTimers(callSid, proposed);

        const remainingSec = Math.max(0, Math.round(proposed - (Date.now() - call.startedAt.getTime()) / 1000));
        console.log(`[CallState] ✓ Extension GRANTED for ${callSid}: +${minutes} min → ${proposed}s allowance, ${remainingSec}s left (${call.extensionCount}/${MAX_CALL_EXTENSIONS})`);

        return {
            granted: true,
            newDurationSec: proposed,
            remainingSec,
            extensionsUsed: call.extensionCount,
            extensionsRemaining: Math.max(0, MAX_CALL_EXTENSIONS - call.extensionCount),
        };
    }

    public clearDurationTimer(callSid: string): void {
        const call = this.activeCalls.get(callSid);
        if (!call) return;

        if (call.maxDurationTimer) {
            clearTimeout(call.maxDurationTimer);
            call.maxDurationTimer = undefined;
        }
        // ⛔ Clear the warning too. Missing this leaves a timer that fires
        // "expiring soon" at an agent about a call that ended minutes ago.
        if (call.expiryWarningTimer) {
            clearTimeout(call.expiryWarningTimer);
            call.expiryWarningTimer = undefined;
        }
        console.log(`[CallState] Cleared duration timers for call ${callSid}`);
    }
}
