// state.ts - Shared state variables
export enum CallType {
    OUTBOUND = 'OUTBOUND',
}

export enum SmsDirection {
    INBOUND = 'inbound',
    OUTBOUND = 'outbound',
}

export enum SmsStatus {
    QUEUED = 'queued',
    SENDING = 'sending',
    SENT = 'sent',
    DELIVERED = 'delivered',
    UNDELIVERED = 'undelivered',
    FAILED = 'failed',
    RECEIVED = 'received',
}

export interface ConversationMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    name?: string;
}

export interface TwilioEventLog {
    type: string;
    timestamp: Date;
    data: any;
}

export interface OpenAIEventLog {
    type: string;
    timestamp: Date;
    data: any;
}

export class CallState {
    // Call identification
    streamSid = '';
    callSid = '';

    // Call type and direction
    callType: CallType = CallType.OUTBOUND;

    // Phone numbers
    fromNumber = '';
    toNumber = '';

    // Call context and conversation
    callContext = '';
    initialMessage = '';
    conversationHistory: ConversationMessage[] = [];
    voice = 'sage'; // Default voice
    systemInstructions = '';
    callInstructions = '';

    // Event logging for debugging
    twilioEvents: TwilioEventLog[] = [];
    openaiEvents: OpenAIEventLog[] = [];

    // Speech state
    speaking = false;

    // Timing and processing state
    llmStart = 0;
    firstByte = true;
    sendFirstSentenceInputTime: number | null = null;

    // Media processing state
    latestMediaTimestamp = 0;
    responseStartTimestampTwilio: number | null = null;
    lastAssistantItemId: string | null = null;
    markQueue: string[] = [];
    hasSeenMedia = false;

    constructor(callType: CallType = CallType.OUTBOUND) {
        this.callType = callType;
    }

    // Helper methods for logging
    logTwilioEvent(type: string, data: any): void {
        this.twilioEvents.push({
            type,
            timestamp: new Date(),
            data: JSON.parse(JSON.stringify(data)) // Deep clone to avoid reference issues
        });
    }

    logOpenAIEvent(type: string, data: any): void {
        this.openaiEvents.push({
            type,
            timestamp: new Date(),
            data: JSON.parse(JSON.stringify(data)) // Deep clone to avoid reference issues
        });
    }

    // Helper method for adding messages to conversation history
    addToConversation(message: ConversationMessage): void {
        this.conversationHistory.push(message);
    }
}

/**
 * Configuration for the OpenAI WebSocket connection
 */
export interface OpenAIConfig {
    apiKey: string;
    websocketUrl: string;
    voice: string;
    temperature: number;
}

/**
 * Configuration for Twilio client
 */
export interface TwilioConfig {
    accountSid: string;
    authToken: string;
    recordCalls: boolean;
}
