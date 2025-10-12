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

dotenv.config();

/**
 * Handles the communication between Twilio and OpenAI for voice calls
 */
export class OpenAICallHandler {
    private readonly twilioStream: TwilioWsService;
    private readonly openAIService: OpenAIWsService;
    private readonly openAIEventProcessor: OpenAIEventService;
    private readonly twilioEventProcessor: TwilioEventService;
    private readonly twilioCallService: TwilioCallService;
    private readonly callState: CallState;

    constructor(ws: WebSocket, callType: CallType, twilioClient: twilio.Twilio, contextService: OpenAIContextService) {
        this.callState = new CallState(callType);

        // Initialize Twilio services
        this.twilioStream = new TwilioWsService(ws, this.callState);
        this.twilioCallService = new TwilioCallService(twilioClient);

        // Initialize OpenAI service
        const openAIConfig: OpenAIConfig = {
            apiKey: process.env.OPENAI_API_KEY || '',
            websocketUrl: process.env.OPENAI_WEBSOCKET_URL || 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview',
            voice: VOICE,
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
            (payload) => this.openAIService.sendAudio(payload),// Log the first media event
        );

        this.setupEventHandlers();
        this.initializeOpenAI();
    }

    private endCall(): void {
        if (this.callState.callSid) {
            this.twilioCallService.endCall(this.callState.callSid);
        }

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
            () => {
                setTimeout(() => this.openAIService.initializeSession(this.callState.callContext), 100);
            },
            (error) => console.error('Error in the OpenAI WebSocket:', error)
        );
    }

    private handleSpeechStartedEvent(): void {
        console.log('[Speech Interrupt] Speech started event received');
        console.log('[Speech Interrupt] State check:', {
            markQueueLength: this.callState.markQueue.length,
            responseStartTimestamp: this.callState.responseStartTimestampTwilio,
            lastAssistantItemId: this.callState.lastAssistantItemId,
            latestMediaTimestamp: this.callState.latestMediaTimestamp
        });

        if (this.callState.markQueue.length === 0) {
            console.log('[Speech Interrupt] Skipping - markQueue is empty');
            return;
        }

        if (this.callState.responseStartTimestampTwilio === null) {
            console.log('[Speech Interrupt] Skipping - responseStartTimestamp is null');
            return;
        }

        if (!this.callState.lastAssistantItemId) {
            console.log('[Speech Interrupt] Skipping - lastAssistantItemId is missing');
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

    private setupEventHandlers(): void {
        this.twilioStream.setupEventHandlers(
            async (message) => await this.twilioEventProcessor.processMessage(message),
            async () => {
                this.openAIService.close();
            }
        );
    }
}

/**
 * Manages multiple concurrent call sessions
 */
export class CallSessionManager {
    private readonly sessionManager: SessionManagerService;

    constructor(twilioClient: twilio.Twilio) {
        this.sessionManager = new SessionManagerService(twilioClient);
    }

    /**
     * Creates a new call session
     * @param ws The WebSocket connection
     * @param callType The type of call
     */
    public createSession(ws: WebSocket, callType: CallType): void {
        this.sessionManager.createSession(ws, callType);
    }
}
