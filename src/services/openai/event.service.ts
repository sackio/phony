import { WebSocket } from 'ws';
import { CallState } from '../../types.js';
import { LOG_EVENT_TYPES, SHOW_TIMING_MATH } from '../../config/constants.js';
import { checkForGoodbye } from '../../utils/call-utils.js';

/**
 * Service for processing OpenAI events
 */
export class OpenAIEventService {
    private readonly callState: CallState;
    private readonly onEndCall: () => void;
    private readonly onSendAudioToTwilio: (payload: string) => void;
    private readonly onSendMark: () => void;
    private readonly onTruncateResponse: () => void;

    /**
     * Create a new OpenAI event processor
     * @param callState The state of the call
     * @param onEndCall Callback for ending the call
     * @param onSendAudioToTwilio Callback for sending audio to Twilio
     * @param onSendMark Callback for sending mark to Twilio
     * @param onTruncateResponse Callback for truncating the response
     */
    constructor(
        callState: CallState,
        onEndCall: () => void,
        onSendAudioToTwilio: (payload: string) => void,
        onSendMark: () => void,
        onTruncateResponse: () => void
    ) {
        this.callState = callState;
        this.onEndCall = onEndCall;
        this.onSendAudioToTwilio = onSendAudioToTwilio;
        this.onSendMark = onSendMark;
        this.onTruncateResponse = onTruncateResponse;
    }

    /**
     * Process an OpenAI message
     * @param data The message data
     */
    public processMessage(data: WebSocket.Data): void {
        try {
            const response = JSON.parse(data.toString());

            if (LOG_EVENT_TYPES.includes(response.type)) {
                console.log(`[OpenAI Event] ${response.type}`, response);
            }

            this.processEvent(response);
        } catch (error) {
            console.error('Error processing OpenAI message:', error, 'Raw message:', data);
        }
    }

    /**
     * Process an OpenAI event
     * @param response The event data
     */
    private processEvent(response: any): void {
        switch (response.type) {
        case 'conversation.item.input_audio_transcription.completed':
            this.handleTranscriptionCompleted(response.transcript);
            break;
        case 'response.audio_transcript.done':
            this.handleAudioTranscriptDone(response.transcript);
            break;
        case 'response.audio.delta':
            if (response.delta) {
                this.handleAudioDelta(response);
            }
            break;
        case 'input_audio_buffer.speech_started':
            console.log('[OpenAI Event] Speech started detected - triggering truncation');
            this.onTruncateResponse();
            break;
        }
    }

    /**
     * Handle a transcription completed event
     * @param transcription The transcription text
     */
    private handleTranscriptionCompleted(transcription: string): void {
        if (!transcription) {
            return;
        }

        this.callState.conversationHistory.push({
            role: 'user',
            content: transcription
        });

        if (checkForGoodbye(transcription)) {
            this.onEndCall();
        }
    }

    /**
     * Handle an audio transcript done event
     * @param transcript The transcript text
     */
    private handleAudioTranscriptDone(transcript: string): void {
        if (!transcript) {
            return;
        }

        this.callState.conversationHistory.push({
            role: 'assistant',
            content: transcript
        });
    }

    /**
     * Handle an audio delta event
     * @param response The event data
     */
    private handleAudioDelta(response: any): void {
        this.onSendAudioToTwilio(response.delta);

        // Send a mark after audio to track playback position for interruptions
        this.onSendMark();

        if (!this.callState.responseStartTimestampTwilio) {
            this.callState.responseStartTimestampTwilio = this.callState.latestMediaTimestamp;
            if (SHOW_TIMING_MATH) {
                console.log(`[Audio Delta] Setting start timestamp for new response: ${this.callState.responseStartTimestampTwilio}ms`);
            }
        }

        if (response.item_id) {
            this.callState.lastAssistantItemId = response.item_id;
        }
    }
}
