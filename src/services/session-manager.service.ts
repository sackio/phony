import { WebSocket } from 'ws';
import twilio from 'twilio';
import { CallType, VoiceProvider } from '../types.js';
import { OpenAIContextService } from './openai/context.service.js';
import { OpenAICallHandler } from '../handlers/openai.handler.js';
import { ElevenLabsCallHandler } from '../handlers/elevenlabs.handler.js';
import { ICallHandler } from '../handlers/call.handler.js';
import { CallTranscriptService } from './database/call-transcript.service.js';
import { DEFAULT_VOICE_PROVIDER } from '../config/constants.js';

/**
 * Options for creating a session
 */
export interface CreateSessionOptions {
    provider?: VoiceProvider;
    elevenLabsAgentId?: string;
    elevenLabsVoiceId?: string;
}

/**
 * Manages multiple concurrent call sessions
 */
export class SessionManagerService {
    private readonly activeSessions: Map<string, ICallHandler>;
    private readonly sessionsByCallSid: Map<string, ICallHandler>;
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
     * @param options Optional session creation options (provider, agentId, voiceId)
     */
    public createSession(ws: WebSocket, callType: CallType, options?: CreateSessionOptions): void {
        const provider = options?.provider || DEFAULT_VOICE_PROVIDER;

        let handler: ICallHandler;

        if (provider === 'elevenlabs') {
            console.log('[Session Manager] Creating ElevenLabs session');
            handler = new ElevenLabsCallHandler(
                ws,
                callType,
                this.twilioClient,
                this.contextService,
                this.transcriptService,
                this,
                options?.elevenLabsAgentId,
                options?.elevenLabsVoiceId
            );
        } else {
            console.log('[Session Manager] Creating OpenAI session');
            handler = new OpenAICallHandler(
                ws,
                callType,
                this.twilioClient,
                this.contextService,
                this.transcriptService,
                this
            );
        }

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
     * @param handler The call handler (OpenAI or ElevenLabs)
     */
    private addSession(ws: WebSocket, handler: ICallHandler): void {
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
     * @param handler The call handler (OpenAI or ElevenLabs)
     */
    public registerSessionByCallSid(callSid: string, handler: ICallHandler): void {
        this.sessionsByCallSid.set(callSid, handler);
        console.log(`[Session Manager] Registered session for callSid: ${callSid}`);
    }

    /**
     * Get a session by callSid
     * @param callSid The call SID
     * @returns The call handler or undefined
     */
    public getSessionByCallSid(callSid: string): ICallHandler | undefined {
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
