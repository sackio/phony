// Service to track active calls and their state
export interface ActiveCall {
    callSid: string;
    toNumber: string;
    fromNumber: string;
    status: 'initiated' | 'in-progress' | 'active' | 'on_hold' | 'completed' | 'failed';
    twilioCallSid?: string;
    voice?: string;
    startedAt: Date;
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
        this.activeCalls.delete(callSid);
        console.log(`[CallState] Removed call: ${callSid}`);
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
            call.pendingContextRequest = {
                question,
                requestedAt: new Date(),
                requestedBy
            };
            console.log(`[CallState] Set pending context request for call ${callSid}: ${question}`);
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
}
