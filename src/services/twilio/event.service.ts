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

    /**
     * Create a new Twilio event processor
     * @param callState The state of the call
     * @param twilioCallService The Twilio call service
     * @param contextService The context service
     * @param onForwardAudioToOpenAI Callback for forwarding audio to OpenAI
     */
    constructor(
        callState: CallState,
        twilioCallService: TwilioCallService,
        contextService: OpenAIContextService,
        onForwardAudioToOpenAI: (payload: string) => void,
    ) {
        this.callState = callState;
        this.twilioCallService = twilioCallService;
        this.contextService = contextService;
        this.onForwardAudioToOpenAI = onForwardAudioToOpenAI;
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

        this.contextService.initializeCallState(this.callState, data.start.customParameters.fromNumber, data.start.customParameters.toNumber);
        this.contextService.setupConversationContext(this.callState, data.start.customParameters.callContext);
        this.callState.callSid = data.start.callSid;
    }

    /**
     * Handle a Twilio mark event
     */
    private handleMarkEvent(): void {
        if (this.callState.markQueue.length > 0) {
            this.callState.markQueue.shift();
        }
    }
}
