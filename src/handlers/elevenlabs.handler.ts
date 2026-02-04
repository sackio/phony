import { WebSocket } from 'ws';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { CallState, CallType, ElevenLabsConfig } from '../types.js';
import { ELEVENLABS_API_KEY, ELEVENLABS_DEFAULT_AGENT_ID } from '../config/constants.js';
import { ElevenLabsWsService } from '../services/elevenlabs/ws.service.js';
import { ElevenLabsEventService } from '../services/elevenlabs/event.service.js';
import { TwilioWsService } from '../services/twilio/ws.service.js';
import { TwilioEventService } from '../services/twilio/event.service.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { CallTranscriptService } from '../services/database/call-transcript.service.js';
import { OpenAIContextService } from '../services/openai/context.service.js';
import { ICallHandler } from './call.handler.js';

dotenv.config();

/**
 * Handles the communication between Twilio and ElevenLabs for voice calls
 * Mirrors the OpenAICallHandler structure for consistency
 */
export class ElevenLabsCallHandler implements ICallHandler {
    private readonly twilioStream: TwilioWsService;
    private readonly elevenLabsService: ElevenLabsWsService;
    private readonly elevenLabsEventProcessor: ElevenLabsEventService;
    private readonly twilioEventProcessor: TwilioEventService;
    private readonly twilioCallService: TwilioCallService;
    private readonly transcriptService: CallTranscriptService;
    private readonly callState: CallState;
    private readonly sessionManagerService: any;
    private callStartTime: Date;
    private elevenLabsReady: boolean = false;
    private audioBuffer: string[] = [];
    private callContextReady: boolean = false;
    private needsInitialization: boolean = false;

    constructor(
        ws: WebSocket,
        callType: CallType,
        twilioClient: twilio.Twilio,
        contextService: OpenAIContextService,
        transcriptService: CallTranscriptService,
        sessionManagerService?: any,
        agentId?: string,
        voiceId?: string
    ) {
        this.callState = new CallState(callType);
        this.callState.voiceProvider = 'elevenlabs';
        this.callState.elevenLabsAgentId = agentId || ELEVENLABS_DEFAULT_AGENT_ID;
        this.callState.elevenLabsVoiceId = voiceId;
        this.transcriptService = transcriptService;
        this.sessionManagerService = sessionManagerService;
        this.callStartTime = new Date();

        // Initialize Twilio services
        this.twilioStream = new TwilioWsService(ws, this.callState);
        this.twilioCallService = new TwilioCallService(twilioClient);

        // Initialize ElevenLabs service
        const elevenLabsConfig: ElevenLabsConfig = {
            apiKey: ELEVENLABS_API_KEY,
            agentId: this.callState.elevenLabsAgentId || ELEVENLABS_DEFAULT_AGENT_ID,
            voiceId: this.callState.elevenLabsVoiceId
        };
        this.elevenLabsService = new ElevenLabsWsService(elevenLabsConfig);

        // Initialize ElevenLabs event processor
        this.elevenLabsEventProcessor = new ElevenLabsEventService(
            this.callState,
            () => this.endCall(),
            (payload) => this.twilioStream.sendAudio(payload),
            () => this.twilioStream.sendMark(),
            () => this.handleInterruption()
        );

        // Initialize Twilio event processor
        this.twilioEventProcessor = new TwilioEventService(
            this.callState,
            this.twilioCallService,
            contextService,
            (payload) => this.sendAudioToElevenLabs(payload),
            () => this.startSession()
        );

        this.setupEventHandlers();
        this.initializeElevenLabs();
    }

    public async endCall(): Promise<void> {
        // Prevent double-ending
        if (!this.callState.callSid) {
            return;
        }

        const callSid = this.callState.callSid;
        console.log(`[ElevenLabs Handler] Ending call ${callSid}`);

        // Save transcript before ending call
        const endTime = new Date();
        const duration = Math.floor((endTime.getTime() - this.callStartTime.getTime()) / 1000);

        // Update CallStateService and emit via Socket.IO
        const { CallStateService } = await import('../services/call-state.service.js');
        const { SocketService } = await import('../services/socket.service.js');
        const callStateService = CallStateService.getInstance();
        const socketService = SocketService.getInstance();

        // Get the full conversation history from CallStateService
        const activeCall = callStateService.getCall(callSid);
        const fullConversationHistory = activeCall?.conversationHistory || this.callState.conversationHistory;

        await this.transcriptService.saveTranscript({
            callSid: callSid,
            conversationHistory: fullConversationHistory,
            twilioEvents: this.callState.twilioEvents,
            openaiEvents: this.callState.openaiEvents, // Reused for ElevenLabs events
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
        this.elevenLabsService.close();
    }

    private initializeElevenLabs(): void {
        this.elevenLabsService.initialize({
            onAudio: (audioData) => {
                this.elevenLabsEventProcessor.handleAudio(audioData);
            },
            onUserTranscript: (text, isFinal) => {
                this.elevenLabsEventProcessor.handleUserTranscript(text, isFinal);
            },
            onAgentTranscript: (text, isFinal) => {
                this.elevenLabsEventProcessor.handleAgentTranscript(text, isFinal);
            },
            onInterruption: () => {
                this.elevenLabsEventProcessor.handleInterruption();
            },
            onError: (error) => {
                this.elevenLabsEventProcessor.handleError(error);
            },
            onClose: () => {
                this.elevenLabsEventProcessor.handleClose();
            },
            onReady: async () => {
                console.log('[ElevenLabs Handler] ElevenLabs WebSocket ready');

                // If already initialized, don't do it again
                if (this.elevenLabsReady) {
                    console.log('[ElevenLabs Handler] Already initialized, skipping');
                    return;
                }

                // If initialization was attempted but ElevenLabs wasn't ready, retry now
                if (this.needsInitialization && this.callState.callSid) {
                    console.log('[ElevenLabs Handler] ElevenLabs connected - retrying initialization that was deferred');
                    this.doStartSession();

                    // If this was a resume scenario, restore conversation
                    if (this.callState.conversationHistory && this.callState.conversationHistory.length > 0) {
                        console.log('[ElevenLabs Handler] Restoring conversation after deferred initialization');
                        // Note: ElevenLabs handles conversation differently - context can be injected
                    }
                } else {
                    console.log('[ElevenLabs Handler] Waiting for Twilio start event to trigger initialization');
                }
            }
        });
    }

    /**
     * Initialize ElevenLabs session with call context
     * Called by Twilio event processor after receiving start event with instructions
     */
    public startSession(): void {
        console.log('[ElevenLabs Handler] Call context ready');
        this.callContextReady = true;

        if (this.elevenLabsService.isConnected()) {
            console.log('[ElevenLabs Handler] ElevenLabs connected, will initialize');
        } else {
            console.log('[ElevenLabs Handler] Waiting for ElevenLabs WebSocket to connect');
        }
    }

    /**
     * Actually perform the session initialization
     */
    private doStartSession(): void {
        // Verify ElevenLabs is actually connected before trying to initialize
        if (!this.elevenLabsService.isConnected()) {
            console.log('[ElevenLabs Handler] Cannot start session yet - ElevenLabs WebSocket not connected. Will retry when connected.');
            this.needsInitialization = true;
            return;
        }

        const isIncoming = this.callState.callType === CallType.INBOUND;
        console.log('[ElevenLabs Handler] Starting ElevenLabs session with context:', this.callState.callContext.substring(0, 100) + '...');
        console.log('[ElevenLabs Handler] Call type:', this.callState.callType, '(incoming:', isIncoming, ')');

        // Initialize conversation with the system prompt as override
        this.elevenLabsService.initializeConversation(this.callState.callContext, {
            call_type: isIncoming ? 'incoming' : 'outgoing',
            from_number: this.callState.fromNumber,
            to_number: this.callState.toNumber
        });

        // Mark ElevenLabs as ready and flush any buffered audio
        console.log('[ElevenLabs Handler] ElevenLabs session initialized, flushing', this.audioBuffer.length, 'buffered audio packets');
        this.elevenLabsReady = true;
        this.needsInitialization = false;
        this.flushAudioBuffer();
    }

    private sendAudioToElevenLabs(payload: string): void {
        if (this.elevenLabsReady) {
            // ElevenLabs is ready, send immediately
            this.elevenLabsService.sendAudio(payload);
        } else {
            // Buffer audio until ElevenLabs is ready
            this.audioBuffer.push(payload);
            if (this.audioBuffer.length === 1) {
                console.log('[ElevenLabs Handler] Buffering audio until ElevenLabs is ready...');
            }
        }
    }

    private flushAudioBuffer(): void {
        while (this.audioBuffer.length > 0) {
            const audioPayload = this.audioBuffer.shift();
            if (audioPayload) {
                this.elevenLabsService.sendAudio(audioPayload);
            }
        }
    }

    private handleInterruption(): void {
        console.log('[ElevenLabs Handler] Handling interruption');
        // Clear Twilio stream to stop playing audio
        this.twilioStream.clearStream();
        // Reset response state
        this.callState.markQueue = [];
        this.callState.lastAssistantItemId = null;
        this.callState.responseStartTimestampTwilio = null;
    }

    /**
     * Inject context into the active call conversation
     * @param context The context/instructions to inject
     * @param conversationHistory The full conversation history
     */
    public injectContext(context: string, conversationHistory: any[]): void {
        console.log('[ElevenLabs Handler] Injecting context into call:', context.substring(0, 50) + '...');

        // Create a summary of the conversation
        const conversationSummary = conversationHistory
            .filter(msg => msg.role !== 'system')
            .map((msg, idx) => {
                const contentPreview = msg.content.substring(0, 100);
                return `${idx + 1}. ${msg.role.toUpperCase()}: ${contentPreview}${msg.content.length > 100 ? '...' : ''}`;
            })
            .join('\n');

        console.log('[ElevenLabs Handler] Conversation summary:\n', conversationSummary);

        // Use ElevenLabs contextual_update to inject context
        const fullContext = conversationSummary
            ? `OPERATOR INSTRUCTION:\n${context}\n\nCONVERSATION SUMMARY:\n${conversationSummary}`
            : `OPERATOR INSTRUCTION:\n${context}`;

        this.elevenLabsService.injectContext(fullContext);
    }

    public getCallSid(): string {
        return this.callState.callSid;
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
                            voice: this.callState.voice,
                            voiceProvider: 'elevenlabs',
                            elevenLabsAgentId: this.callState.elevenLabsAgentId,
                            elevenLabsVoiceId: this.callState.elevenLabsVoiceId,
                            callContext: this.callState.callContext,
                            systemInstructions: this.callState.systemInstructions,
                            callInstructions: this.callState.callInstructions
                        });

                        // Mark call as in-progress
                        await this.transcriptService.markCallInProgress(this.callState.callSid);

                        // New call - initialize session with base context
                        if (!this.elevenLabsReady) {
                            console.log('[ElevenLabs Handler] New call - initializing ElevenLabs session');
                            this.doStartSession();
                        } else {
                            console.log('[ElevenLabs Handler] Session already initialized');
                        }
                    } else {
                        // Resume from hold - restore conversation history
                        console.log('[ElevenLabs Handler] Resuming existing call, restoring conversation history');
                        this.callState.conversationHistory = existingCall.conversationHistory || [];

                        // Initialize session first with base context
                        if (!this.elevenLabsReady) {
                            console.log('[ElevenLabs Handler] Initializing ElevenLabs session before restoring conversation');
                            this.doStartSession();

                            // Inject conversation context
                            if (this.callState.conversationHistory.length > 0) {
                                this.injectContext('Resuming call from hold. Continue the conversation naturally.', this.callState.conversationHistory);
                            }
                        }
                    }

                    // Register this session with the session manager
                    if (this.sessionManagerService) {
                        this.sessionManagerService.registerSessionByCallSid(this.callState.callSid, this);
                    }
                }
            },
            async () => {
                // WebSocket closed - check if it's intentional (hold) or natural ending
                console.log('[ElevenLabs Handler] Twilio websocket closed');

                // Check if the call is on hold
                if (this.callState.callSid) {
                    const { CallStateService } = await import('../services/call-state.service.js');
                    const callStateService = CallStateService.getInstance();
                    const call = callStateService.getCall(this.callState.callSid);

                    if (call && call.status === 'on_hold') {
                        console.log('[ElevenLabs Handler] Call is on hold, not ending');
                        return;
                    }
                }

                // Otherwise, this is a natural ending
                console.log('[ElevenLabs Handler] Ending call');
                await this.endCall();
            }
        );
    }
}
