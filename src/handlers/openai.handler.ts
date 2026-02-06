import { WebSocket } from 'ws';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { CallState, CallType, OpenAIConfig } from '../types.js';
import { VOICE } from '../config/constants.js';
import { OpenAIContextService } from '../services/openai/context.service.js';
import { OpenAIWsService } from '../services/openai/ws.service.js';
import { TwilioWsService } from '../services/twilio/ws.service.js';
import { OpenAIEventService } from '../services/openai/event.service.js';
import { TwilioEventService } from '../services/twilio/event.service.js';
import { SessionManagerService } from '../services/session-manager.service.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { CallTranscriptService } from '../services/database/call-transcript.service.js';
import { ICallHandler } from './call.handler.js';

dotenv.config();

/**
 * Handles the communication between Twilio and OpenAI for voice calls
 */
export class OpenAICallHandler implements ICallHandler {
    private readonly twilioStream: TwilioWsService;
    private readonly openAIService: OpenAIWsService;
    private readonly openAIEventProcessor: OpenAIEventService;
    private readonly twilioEventProcessor: TwilioEventService;
    private readonly twilioCallService: TwilioCallService;
    private readonly transcriptService: CallTranscriptService;
    private readonly callState: CallState;
    private readonly sessionManagerService: any;
    private callStartTime: Date;
    private openAIReady: boolean = false;
    private audioBuffer: string[] = [];
    private callContextReady: boolean = false;
    private needsInitialization: boolean = false;

    constructor(ws: WebSocket, callType: CallType, twilioClient: twilio.Twilio, contextService: OpenAIContextService, transcriptService: CallTranscriptService, sessionManagerService?: any) {
        this.callState = new CallState(callType);
        this.transcriptService = transcriptService;
        this.sessionManagerService = sessionManagerService;
        this.callStartTime = new Date();

        // Initialize Twilio services
        this.twilioStream = new TwilioWsService(ws, this.callState);
        this.twilioCallService = new TwilioCallService(twilioClient);

        // Initialize OpenAI service
        // Note: voice will be updated from callState after Twilio start event
        const openAIConfig: OpenAIConfig = {
            apiKey: process.env.OPENAI_API_KEY || '',
            websocketUrl: process.env.OPENAI_WEBSOCKET_URL || 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview',
            voice: this.callState.voice || VOICE,
            temperature: 0.6
        };
        this.openAIService = new OpenAIWsService(openAIConfig);

        // Initialize event processors
        this.openAIEventProcessor = new OpenAIEventService(
            this.callState,
            () => this.endCall(),
            (payload) => this.twilioStream.sendAudio(payload),
            () => this.twilioStream.sendMark(),
            () => this.handleSpeechStartedEvent()
        );

        this.twilioEventProcessor = new TwilioEventService(
            this.callState,
            this.twilioCallService,
            contextService,
            (payload) => this.sendAudioToOpenAI(payload), // Buffer audio until OpenAI is ready
            () => this.startSession() // Called when call context is ready
        );

        this.setupEventHandlers();
        this.initializeOpenAI();
    }

    private async endCall(): Promise<void> {
        // Prevent double-ending
        if (!this.callState.callSid) {
            return;
        }

        const callSid = this.callState.callSid;
        console.log(`[OpenAI Handler] Ending call ${callSid}`);

        // Save transcript before ending call
        const endTime = new Date();
        const duration = Math.floor((endTime.getTime() - this.callStartTime.getTime()) / 1000);

        // Update CallStateService and emit via Socket.IO
        const { CallStateService } = await import('../services/call-state.service.js');
        const { SocketService } = await import('../services/socket.service.js');
        const callStateService = CallStateService.getInstance();
        const socketService = SocketService.getInstance();

        // Get the full conversation history from CallStateService (includes system messages)
        const activeCall = callStateService.getCall(callSid);
        const fullConversationHistory = activeCall?.conversationHistory || this.callState.conversationHistory;

        await this.transcriptService.saveTranscript({
            callSid: callSid,
            conversationHistory: fullConversationHistory,
            twilioEvents: this.callState.twilioEvents,
            openaiEvents: this.callState.openaiEvents,
            endedAt: endTime,
            duration: duration,
            status: 'completed'
        });

        callStateService.updateCallStatus(callSid, 'completed');
        socketService.emitCallStatusChanged(callSid, 'completed');

        // Clean up after a delay
        setTimeout(() => {
            callStateService.removeCall(callSid);
        }, 5000);

        this.twilioCallService.endCall(callSid);

        // Unregister session from session manager
        if (this.sessionManagerService) {
            this.sessionManagerService.unregisterSessionByCallSid(callSid);
        }

        // Clear callSid to prevent double-ending
        this.callState.callSid = '';

        setTimeout(() => {
            this.closeWebSockets();
        }, 5000);
    }

    private closeWebSockets(): void {
        this.twilioStream.close();
        this.openAIService.close();
    }

    private initializeOpenAI(): void {
        this.openAIService.initialize(
            (data) => this.openAIEventProcessor.processMessage(data),
            async () => {
                // OpenAI WebSocket connected
                console.log('[OpenAI Handler] OpenAI WebSocket connected');

                // If already initialized, don't do it again
                if (this.openAIReady) {
                    console.log('[OpenAI Handler] Already initialized, skipping');
                    return;
                }

                // If initialization was attempted but OpenAI wasn't ready, retry now
                if (this.needsInitialization && this.callState.callSid) {
                    console.log('[OpenAI Handler] OpenAI connected - retrying initialization that was deferred');
                    this.doStartSession();

                    // If this was a resume scenario, restore conversation
                    if (this.callState.conversationHistory && this.callState.conversationHistory.length > 0) {
                        console.log('[OpenAI Handler] Restoring conversation after deferred initialization');
                        await this.restoreConversationHistory();
                    }
                } else {
                    console.log('[OpenAI Handler] Waiting for Twilio start event to trigger initialization');
                }
            },
            (error) => console.error('Error in the OpenAI WebSocket:', error)
        );
    }

    /**
     * Get the Twilio call SID
     */
    public getCallSid(): string {
        return this.callState.callSid;
    }

    /**
     * Initialize OpenAI session with call context
     * Called by Twilio event processor after receiving start event with instructions
     */
    public startSession(): void {
        this.startOpenAISession();
    }

    /**
     * Initialize OpenAI session with call context (internal)
     * Called by Twilio event processor after receiving start event with instructions
     */
    private startOpenAISession(): void {
        console.log('[OpenAI Handler] Call context ready');
        this.callContextReady = true;

        // Don't initialize session yet - wait for setupEventHandlers to check
        // if this is a resume scenario and restore conversation history first
        if (this.openAIService.isConnected()) {
            console.log('[OpenAI Handler] OpenAI connected, will initialize after checking for existing call');
        } else {
            console.log('[OpenAI Handler] Waiting for OpenAI WebSocket to connect');
        }
    }

    /**
     * Actually perform the session initialization
     * Called when both OpenAI is connected AND call context is ready
     */
    private doStartSession(): void {
        // Verify OpenAI is actually connected before trying to initialize
        if (!this.openAIService.isConnected()) {
            console.log('[OpenAI Handler] Cannot start session yet - OpenAI WebSocket not connected. Will retry when connected.');
            this.needsInitialization = true;
            return;
        }

        const isIncoming = this.callState.callType === CallType.INBOUND;
        console.log('[OpenAI Handler] Starting OpenAI session with context:', this.callState.callContext.substring(0, 100) + '...');
        console.log('[OpenAI Handler] Call type:', this.callState.callType, '(incoming:', isIncoming, ')');

        // Update voice and initialize session with the actual call context
        this.openAIService.updateVoice(this.callState.voice);
        this.openAIService.initializeSession(this.callState.callContext, isIncoming);

        // Mark OpenAI as ready and flush any buffered audio
        console.log('[OpenAI Handler] OpenAI session initialized, flushing', this.audioBuffer.length, 'buffered audio packets');
        this.openAIReady = true;
        this.needsInitialization = false;
        this.flushAudioBuffer();
    }

    private sendAudioToOpenAI(payload: string): void {
        if (this.openAIReady) {
            // OpenAI is ready, send immediately
            this.openAIService.sendAudio(payload);
        } else {
            // Buffer audio until OpenAI is ready
            this.audioBuffer.push(payload);
            if (this.audioBuffer.length === 1) {
                console.log('[OpenAI Handler] Buffering audio until OpenAI is ready...');
            }
        }
    }

    private flushAudioBuffer(): void {
        while (this.audioBuffer.length > 0) {
            const audioPayload = this.audioBuffer.shift();
            if (audioPayload) {
                this.openAIService.sendAudio(audioPayload);
            }
        }
    }

    private handleSpeechStartedEvent(): void {
        console.log('[Speech Interrupt] Speech started event received');
        console.log('[Speech Interrupt] State check:', {
            markQueueLength: this.callState.markQueue.length,
            responseStartTimestamp: this.callState.responseStartTimestampTwilio,
            lastAssistantItemId: this.callState.lastAssistantItemId,
            latestMediaTimestamp: this.callState.latestMediaTimestamp
        });

        // Emit interruption marker whenever user starts speaking during/after assistant response
        // This shows in the transcript even if we can't technically truncate
        if (this.callState.callSid && this.callState.lastAssistantItemId) {
            const SocketService = require('../services/socket.service.js').SocketService;
            const socketService = SocketService.getInstance();
            socketService.emitTranscriptUpdate(this.callState.callSid, {
                speaker: 'system',
                text: '(Assistant interrupted by user)',
                timestamp: new Date(),
                isPartial: false,
                isInterruption: true
            });
            console.log('[Speech Interrupt] Emitted interruption marker');
        }

        // Now check if we can actually truncate the response (stricter conditions)
        if (this.callState.markQueue.length === 0) {
            console.log('[Speech Interrupt] Skipping truncation - markQueue is empty');
            return;
        }

        if (this.callState.responseStartTimestampTwilio === null) {
            console.log('[Speech Interrupt] Skipping truncation - responseStartTimestamp is null');
            return;
        }

        if (!this.callState.lastAssistantItemId) {
            console.log('[Speech Interrupt] Skipping truncation - lastAssistantItemId is missing');
            return;
        }

        const elapsedTime = this.callState.latestMediaTimestamp - this.callState.responseStartTimestampTwilio;
        console.log('[Speech Interrupt] Truncating assistant response:', {
            itemId: this.callState.lastAssistantItemId,
            elapsedTime
        });

        this.openAIService.truncateAssistantResponse(this.callState.lastAssistantItemId, elapsedTime);
        this.twilioStream.clearStream();
        this.resetResponseState();
    }

    private resetResponseState(): void {
        this.callState.markQueue = [];
        this.callState.lastAssistantItemId = null;
        this.callState.responseStartTimestampTwilio = null;
    }

    /**
     * Inject context into the active call conversation
     * @param context The context/instructions to inject
     * @param conversationHistory The full conversation history (from CallStateService)
     */
    public injectContext(context: string, conversationHistory: any[]): void {
        console.log('[OpenAI Handler] Injecting context into call:', context.substring(0, 50) + '...');
        console.log('[OpenAI Handler] Using conversation history with', conversationHistory.length, 'messages');

        // Create a summary of the conversation
        const conversationSummary = conversationHistory
            .filter(msg => msg.role !== 'system' || !msg.content.includes('YOUR ROLE AND IDENTITY')) // Skip initial system prompt
            .map((msg, idx) => {
                const contentPreview = msg.content.substring(0, 100);
                return `${idx + 1}. ${msg.role.toUpperCase()}: ${contentPreview}${msg.content.length > 100 ? '...' : ''}`;
            })
            .join('\n');

        console.log('[OpenAI Handler] Conversation summary:\n', conversationSummary);

        // Inject the context with conversation summary into OpenAI
        this.openAIService.injectContextMessage(context, conversationSummary);
    }

    /**
     * Restore conversation history to OpenAI when resuming from hold
     */
    private async restoreConversationHistory(): Promise<void> {
        if (this.callState.conversationHistory.length === 0) {
            console.log('[OpenAI Handler] No conversation history to restore');
            return;
        }

        console.log(`[OpenAI Handler] Restoring ${this.callState.conversationHistory.length} messages to OpenAI session`);

        // Send each message to OpenAI as a conversation item
        for (const message of this.callState.conversationHistory) {
            // Skip the initial system message as it's already in the session
            if (message.role === 'system' && message.content.includes('YOUR ROLE AND IDENTITY')) {
                continue;
            }

            this.openAIService.addConversationItem(message.role, message.content);
        }

        console.log('[OpenAI Handler] Conversation history restored, triggering assistant response');

        // Trigger a response so the assistant speaks first when resuming
        // This ensures it acknowledges any context or continues naturally
        this.openAIService.triggerResponse();
    }

    private setupEventHandlers(): void {
        this.twilioStream.setupEventHandlers(
            async (message) => {
                const prevCallSid = this.callState.callSid;
                await this.twilioEventProcessor.processMessage(message);

                // If callSid was just set (from Twilio start event), handle call record
                if (!prevCallSid && this.callState.callSid) {
                    // Check if call already exists (resume from hold scenario)
                    const existingCall = await this.transcriptService.getCall(this.callState.callSid);

                    if (!existingCall) {
                        // New call - create record
                        await this.transcriptService.createCall({
                            callSid: this.callState.callSid,
                            fromNumber: this.callState.fromNumber,
                            toNumber: this.callState.toNumber,
                            callType: this.callState.callType,
                            voiceProvider: 'openai',
                            voice: this.callState.voice,
                            callContext: this.callState.callContext,
                            systemInstructions: this.callState.systemInstructions,
                            callInstructions: this.callState.callInstructions
                        });

                        // Mark call as in-progress
                        await this.transcriptService.markCallInProgress(this.callState.callSid);

                        // New call - initialize session with base context (if not already done)
                        if (!this.openAIReady) {
                            console.log('[OpenAI Handler] New call - initializing OpenAI session');
                            this.doStartSession();
                        } else {
                            console.log('[OpenAI Handler] Session already initialized');
                        }
                    } else {
                        // Resume from hold - restore conversation history and settings
                        console.log('[OpenAI Handler] Resuming existing call, restoring conversation history and voice');
                        this.callState.conversationHistory = existingCall.conversationHistory || [];

                        // Restore voice from the existing call (critical for consistency)
                        this.callState.voice = existingCall.voice;
                        console.log(`[OpenAI Handler] Restored voice: ${this.callState.voice}`);

                        // Update OpenAI service voice before restoring conversation
                        this.openAIService.updateVoice(this.callState.voice);

                        // Initialize session first with base context (if not already done)
                        if (!this.openAIReady) {
                            console.log('[OpenAI Handler] Initializing OpenAI session before restoring conversation');
                            this.doStartSession();

                            // Then restore conversation to OpenAI session
                            await this.restoreConversationHistory();
                        } else {
                            console.log('[OpenAI Handler] Session already initialized and conversation restored');
                        }
                    }

                    // Register this session with the session manager for context injection
                    if (this.sessionManagerService) {
                        this.sessionManagerService.registerSessionByCallSid(this.callState.callSid, this);
                    }
                }
            },
            async () => {
                // WebSocket closed - check if it's intentional (hold) or natural ending
                console.log('[OpenAI Handler] Twilio websocket closed');

                // Check if the call is on hold - if so, don't end it
                if (this.callState.callSid) {
                    const { CallStateService } = await import('../services/call-state.service.js');
                    const callStateService = CallStateService.getInstance();
                    const call = callStateService.getCall(this.callState.callSid);

                    if (call && call.status === 'on_hold') {
                        console.log('[OpenAI Handler] Call is on hold, not ending');
                        return;
                    }
                }

                // Otherwise, this is a natural ending - save transcript and clean up
                console.log('[OpenAI Handler] Ending call');
                await this.endCall();
            }
        );
    }
}

import { CreateSessionOptions } from '../services/session-manager.service.js';

/**
 * Manages multiple concurrent call sessions
 */
export class CallSessionManager {
    // Expose sessionManager for advanced usage (e.g., MCP routes)
    public readonly sessionManager: SessionManagerService;

    constructor(twilioClient: twilio.Twilio, transcriptService: any) {
        this.sessionManager = new SessionManagerService(twilioClient, transcriptService);
    }

    /**
     * Creates a new call session
     * @param ws The WebSocket connection
     * @param callType The type of call
     * @param options Optional session creation options (provider, agentId, voiceId)
     */
    public createSession(ws: WebSocket, callType: CallType, options?: CreateSessionOptions): void {
        this.sessionManager.createSession(ws, callType, options);
    }

    /**
     * Inject context into an active call session
     * @param callSid The call SID
     * @param context The context to inject
     * @param conversationHistory The full conversation history
     * @returns true if successful, false if session not found
     */
    public injectContext(callSid: string, context: string, conversationHistory: any[]): boolean {
        return this.sessionManager.injectContext(callSid, context, conversationHistory);
    }
}
