import { CallState } from '../../types.js';
import { OpenAIContextService } from '../openai/context.service.js';
import { RECORD_CALLS, SHOW_TIMING_MATH } from '../../config/constants.js';
import { TwilioCallService } from './call.service.js';

/**
 * Service for processing Twilio events
 */
export class TwilioEventService {
    private readonly callState: CallState;
    private readonly twilioCallService: TwilioCallService;
    private readonly contextService: OpenAIContextService;
    private readonly onForwardAudioToOpenAI: (payload: string) => void;
    private readonly onContextReady?: () => void;

    /**
     * Create a new Twilio event processor
     * @param callState The state of the call
     * @param twilioCallService The Twilio call service
     * @param contextService The context service
     * @param onForwardAudioToOpenAI Callback for forwarding audio to OpenAI
     * @param onContextReady Callback when call context is ready (after start event)
     */
    constructor(
        callState: CallState,
        twilioCallService: TwilioCallService,
        contextService: OpenAIContextService,
        onForwardAudioToOpenAI: (payload: string) => void,
        onContextReady?: () => void
    ) {
        this.callState = callState;
        this.twilioCallService = twilioCallService;
        this.contextService = contextService;
        this.onForwardAudioToOpenAI = onForwardAudioToOpenAI;
        this.onContextReady = onContextReady;
    }

    /**
     * Process a Twilio message
     * @param message The message data
     */
    public async processMessage(message: Buffer | string): Promise<void> {
        try {
            const data = JSON.parse(message.toString());
            await this.processEvent(data);
        } catch (error) {
            console.error('Error parsing message:', error, 'Message:', message);
        }
    }

    /**
     * Process a Twilio event
     * @param data The event data
     */
    private async processEvent(data: any): Promise<void> {
        // Log all Twilio events for debugging
        this.callState.logTwilioEvent(data.event || 'unknown', data);

        switch (data.event) {
        case 'media':
            await this.handleMediaEvent(data);
            break;
        case 'start':
            await this.handleStartEvent(data);
            break;
        case 'mark':
            this.handleMarkEvent();
            break;
        case 'dtmf':
            await this.handleDTMFEvent(data);
            break;
        case 'stop':
            console.log('[Twilio] Call stopped');
            break;
        default:
            console.error('Received non-media event:', data.event);
            break;
        }
    }

    /**
     * Handle a Twilio media event
     * @param data The event data
     */
    private async handleMediaEvent(data: any): Promise<void> {
        this.callState.latestMediaTimestamp = data.media.timestamp;
        // Reduced logging - only log every 50th packet to avoid spam
        if (SHOW_TIMING_MATH && data.media.timestamp % 1000 === 0) {
            console.log(`[Twilio Media] Received audio, timestamp: ${this.callState.latestMediaTimestamp}ms`);
        }

        await this.handleFirstMediaEventIfNeeded();
        this.onForwardAudioToOpenAI(data.media.payload);
    }

    /**
     * Handle the first media event if it hasn't been handled yet
     */
    private async handleFirstMediaEventIfNeeded(): Promise<void> {
        if (this.callState.hasSeenMedia) {
            return;
        }

        this.callState.hasSeenMedia = true;

        if (RECORD_CALLS && this.callState.callSid) {
            await this.startCallRecording();
        }
    }

    /**
     * Start recording the call
     */
    private async startCallRecording(): Promise<void> {
        await this.twilioCallService.startRecording(this.callState.callSid);
    }

    /**
     * Handle a Twilio start event
     * @param data The event data
     */
    private async handleStartEvent(data: any): Promise<void> {
        this.callState.streamSid = data.start.streamSid;
        this.callState.responseStartTimestampTwilio = null;
        this.callState.latestMediaTimestamp = 0;

        // Extract voice from custom parameters if provided
        const voice = data.start.customParameters.voice || 'sage';
        this.callState.voice = voice;

        console.log('[Twilio Start] Initializing call with voice:', voice);

        this.contextService.initializeCallState(this.callState, data.start.customParameters.fromNumber, data.start.customParameters.toNumber);

        // Use systemInstructions and callInstructions if provided (new context system)
        const systemInstructions = data.start.customParameters.systemInstructions;
        const callInstructions = data.start.customParameters.callInstructions || '';

        if (systemInstructions) {
            console.log('[Twilio Start] Using custom context with systemInstructions and callInstructions');
            this.contextService.setupCallContext(this.callState, systemInstructions, callInstructions);
        } else {
            // Fallback for old format (will be removed once UI is updated)
            console.error('[Twilio Start] WARNING: Old format detected. Using callContext parameter.');
            const legacyContext = data.start.customParameters.callContext || 'Have a natural conversation.';
            this.contextService.setupCallContext(this.callState, legacyContext, 'Hello!');
        }

        this.callState.callSid = data.start.callSid;

        // For incoming calls, add to CallStateService and start duration timer
        if (this.callState.callType === 'INBOUND') {
            const { CallStateService } = await import('../call-state.service.js');
            const callStateService = CallStateService.getInstance();

            callStateService.addCall(this.callState.callSid, {
                callSid: this.callState.callSid,
                twilioCallSid: this.callState.callSid,
                toNumber: data.start.customParameters.toNumber,
                fromNumber: data.start.customParameters.fromNumber,
                callType: 'incoming',
                voice: this.callState.voice,
                status: 'in-progress',
                startedAt: new Date(),
                conversationHistory: []
            });

            // Production Safety Control: Start auto-hangup timer for incoming call
            callStateService.startDurationTimer(this.callState.callSid);
        }

        // Notify that call context is ready (triggers OpenAI session initialization)
        if (this.onContextReady) {
            console.log('[Twilio Start] Call context ready, triggering OpenAI session initialization');
            this.onContextReady();
        }
    }

    /**
     * Handle a Twilio mark event
     */
    private handleMarkEvent(): void {
        if (this.callState.markQueue.length > 0) {
            this.callState.markQueue.shift();
        }
    }

    /**
     * Handle a DTMF event from Twilio Media Streams
     * @param data The event data containing DTMF digit
     */
    private async handleDTMFEvent(data: any): Promise<void> {
        const digit = data.dtmf?.digit;

        if (!digit) {
            console.error('[Twilio DTMF] Received DTMF event without digit');
            return;
        }

        console.log(`[Twilio DTMF] Detected keypress: ${digit}`);

        // Add DTMF detection to conversation history
        const dtmfMessage = {
            role: 'system' as const,
            content: `User pressed keypad button: ${digit}`,
            timestamp: new Date()
        };

        this.callState.addToConversation(dtmfMessage);

        // Emit via Socket.IO for real-time UI updates
        try {
            const { SocketService } = await import('../socket.service.js');
            const { CallStateService } = await import('../call-state.service.js');
            const socketService = SocketService.getInstance();
            const callStateService = CallStateService.getInstance();

            if (this.callState.callSid) {
                // Emit transcript update
                socketService.emitTranscriptUpdate(this.callState.callSid, {
                    speaker: 'system' as const,
                    text: `🔢 Keypress detected: ${digit}`,
                    timestamp: dtmfMessage.timestamp,
                    isPartial: false,
                    isInterruption: false
                });

                // Add to CallStateService for persistence
                callStateService.addTranscript(this.callState.callSid, dtmfMessage);
            }
        } catch (error) {
            console.error('[Twilio DTMF] Error emitting DTMF event:', error);
        }
    }
}
