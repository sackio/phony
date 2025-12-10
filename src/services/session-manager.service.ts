import { WebSocket } from 'ws';
import twilio from 'twilio';
import { CallType } from '../types.js';
import { OpenAIContextService } from './openai/context.service.js';
import { OpenAICallHandler } from '../handlers/openai.handler.js';
import { CallTranscriptService } from './database/call-transcript.service.js';

/**
 * Manages multiple concurrent call sessions
 */
export class SessionManagerService {
    private readonly activeSessions: Map<string, OpenAICallHandler>;
    private readonly sessionsByCallSid: Map<string, OpenAICallHandler>;
    private readonly twilioClient: twilio.Twilio;
    private readonly contextService: OpenAIContextService;
    private readonly transcriptService: CallTranscriptService;

    /**
     * Create a new session manager
     * @param twilioClient The Twilio client
     * @param transcriptService The transcript service for saving call transcripts
     */
    constructor(twilioClient: twilio.Twilio, transcriptService: CallTranscriptService) {
        this.activeSessions = new Map();
        this.sessionsByCallSid = new Map();
        this.twilioClient = twilioClient;
        this.contextService = new OpenAIContextService();
        this.transcriptService = transcriptService;
    }

    /**
     * Creates a new call session and adds it to the active sessions
     * @param ws The WebSocket connection
     * @param callType The type of call
     */
    public createSession(ws: WebSocket, callType: CallType): void {
        const handler = new OpenAICallHandler(ws, callType, this.twilioClient, this.contextService, this.transcriptService, this);
        this.registerSessionCleanup(ws);
        this.addSession(ws, handler);
    }

    /**
     * Register cleanup for a session
     * @param ws The WebSocket connection
     */
    private registerSessionCleanup(ws: WebSocket): void {
        ws.on('close', () => {
            this.removeSession(ws);
        });
    }

    /**
     * Add a session to active sessions
     * @param ws The WebSocket connection
     * @param handler The OpenAI call handler
     */
    private addSession(ws: WebSocket, handler: OpenAICallHandler): void {
        this.activeSessions.set(this.getSessionKey(ws), handler);
    }

    /**
     * Removes a session from active sessions
     * @param ws The WebSocket connection
     */
    private removeSession(ws: WebSocket): void {
        const sessionKey = this.getSessionKey(ws);
        if (this.activeSessions.has(sessionKey)) {
            this.activeSessions.delete(sessionKey);
        }
    }

    /**
     * Generates a unique key for a session based on the WebSocket object
     * @param ws The WebSocket connection
     * @returns A unique key for the session
     */
    private getSessionKey(ws: WebSocket): string {
        return ws.url || ws.toString();
    }

    /**
     * Get the Twilio client
     * @returns The Twilio client
     */
    public getTwilioClient(): twilio.Twilio {
        return this.twilioClient;
    }

    /**
     * Get the context service
     * @returns The context service
     */
    public getContextService(): OpenAIContextService {
        return this.contextService;
    }

    /**
     * Register a session by callSid for later retrieval
     * @param callSid The call SID
     * @param handler The OpenAI call handler
     */
    public registerSessionByCallSid(callSid: string, handler: OpenAICallHandler): void {
        this.sessionsByCallSid.set(callSid, handler);
        console.log(`[Session Manager] Registered session for callSid: ${callSid}`);
    }

    /**
     * Get a session by callSid
     * @param callSid The call SID
     * @returns The OpenAI call handler or undefined
     */
    public getSessionByCallSid(callSid: string): OpenAICallHandler | undefined {
        return this.sessionsByCallSid.get(callSid);
    }

    /**
     * Inject context into an active call session
     * @param callSid The call SID
     * @param context The context to inject
     * @param conversationHistory The full conversation history
     * @returns true if successful, false if session not found
     */
    public injectContext(callSid: string, context: string, conversationHistory: any[]): boolean {
        const handler = this.sessionsByCallSid.get(callSid);
        if (!handler) {
            console.warn(`[Session Manager] No session found for callSid: ${callSid}`);
            return false;
        }

        handler.injectContext(context, conversationHistory);
        return true;
    }

    /**
     * Unregister a session by callSid
     * @param callSid The call SID
     */
    public unregisterSessionByCallSid(callSid: string): void {
        if (this.sessionsByCallSid.has(callSid)) {
            this.sessionsByCallSid.delete(callSid);
            console.log(`[Session Manager] Unregistered session for callSid: ${callSid}`);
        }
    }
}
