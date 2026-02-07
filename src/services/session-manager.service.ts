import { WebSocket } from 'ws';
import twilio from 'twilio';
import { CallType } from '../types.js';
import { ContextService } from './context.service.js';
import { ElevenLabsCallHandler } from '../handlers/elevenlabs.handler.js';
import { ICallHandler } from '../handlers/call.handler.js';
import { CallTranscriptService } from './database/call-transcript.service.js';

/**
 * Options for creating a session
 */
export interface CreateSessionOptions {
    elevenLabsAgentId?: string;
    elevenLabsVoiceId?: string;
}

/**
 * Manages multiple concurrent call sessions (ElevenLabs provider)
 */
export class SessionManagerService {
    private readonly activeSessions: Map<string, ICallHandler>;
    private readonly sessionsByCallSid: Map<string, ICallHandler>;
    private readonly twilioClient: twilio.Twilio;
    private readonly contextService: ContextService;
    private readonly transcriptService: CallTranscriptService;

    constructor(twilioClient: twilio.Twilio, transcriptService: CallTranscriptService) {
        this.activeSessions = new Map();
        this.sessionsByCallSid = new Map();
        this.twilioClient = twilioClient;
        this.contextService = new ContextService();
        this.transcriptService = transcriptService;
    }

    /**
     * Creates a new ElevenLabs call session
     */
    public createSession(ws: WebSocket, callType: CallType, options?: CreateSessionOptions): void {
        console.log('[Session Manager] Creating ElevenLabs session');
        const handler = new ElevenLabsCallHandler(
            ws,
            callType,
            this.twilioClient,
            this.contextService,
            this.transcriptService,
            this,
            options?.elevenLabsAgentId,
            options?.elevenLabsVoiceId
        );

        this.registerSessionCleanup(ws);
        this.addSession(ws, handler);
    }

    private registerSessionCleanup(ws: WebSocket): void {
        ws.on('close', () => {
            this.removeSession(ws);
        });
    }

    private addSession(ws: WebSocket, handler: ICallHandler): void {
        this.activeSessions.set(this.getSessionKey(ws), handler);
    }

    private removeSession(ws: WebSocket): void {
        const sessionKey = this.getSessionKey(ws);
        if (this.activeSessions.has(sessionKey)) {
            this.activeSessions.delete(sessionKey);
        }
    }

    private getSessionKey(ws: WebSocket): string {
        return ws.url || ws.toString();
    }

    public getTwilioClient(): twilio.Twilio {
        return this.twilioClient;
    }

    public getContextService(): ContextService {
        return this.contextService;
    }

    public registerSessionByCallSid(callSid: string, handler: ICallHandler): void {
        this.sessionsByCallSid.set(callSid, handler);
        console.log(`[Session Manager] Registered session for callSid: ${callSid}`);
    }

    public getSessionByCallSid(callSid: string): ICallHandler | undefined {
        return this.sessionsByCallSid.get(callSid);
    }

    public injectContext(callSid: string, context: string, conversationHistory: any[]): boolean {
        const handler = this.sessionsByCallSid.get(callSid);
        if (!handler) {
            console.warn(`[Session Manager] No session found for callSid: ${callSid}`);
            return false;
        }

        handler.injectContext(context, conversationHistory);
        return true;
    }

    public unregisterSessionByCallSid(callSid: string): void {
        if (this.sessionsByCallSid.has(callSid)) {
            this.sessionsByCallSid.delete(callSid);
            console.log(`[Session Manager] Unregistered session for callSid: ${callSid}`);
        }
    }
}

/**
 * Public wrapper for session management (used by VoiceServer and start-all)
 */
export class CallSessionManager {
    private readonly sessionManager: SessionManagerService;

    constructor(twilioClient: twilio.Twilio, transcriptService: CallTranscriptService) {
        this.sessionManager = new SessionManagerService(twilioClient, transcriptService);
    }

    public createSession(ws: WebSocket, callType: CallType, options?: CreateSessionOptions): void {
        this.sessionManager.createSession(ws, callType, options);
    }

    public injectContext(callSid: string, context: string, conversationHistory: any[]): boolean {
        return this.sessionManager.injectContext(callSid, context, conversationHistory);
    }

    public getSessionManager(): SessionManagerService {
        return this.sessionManager;
    }
}
