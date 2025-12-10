import { WebSocket } from 'ws';
import { CallState } from '../../types.js';
import { LOG_EVENT_TYPES, SHOW_TIMING_MATH } from '../../config/constants.js';
import { checkForGoodbye } from '../../utils/call-utils.js';
import { SocketService } from '../socket.service.js';

/**
 * Service for processing OpenAI events
 */
export class OpenAIEventService {
    private readonly callState: CallState;
    private readonly onEndCall: () => void;
    private readonly onSendAudioToTwilio: (payload: string) => void;
    private readonly onSendMark: () => void;
    private readonly onTruncateResponse: () => void;
    private readonly socketService: SocketService;
    private itemIdToMessageIndex: Map<string, number> = new Map();

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
        this.socketService = SocketService.getInstance();
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
        // Log all OpenAI events for debugging (skip audio deltas to avoid spam)
        if (response.type !== 'response.audio.delta') {
            this.callState.logOpenAIEvent(response.type, response);
        }

        switch (response.type) {
        case 'conversation.item.input_audio_transcription.completed':
            this.handleTranscriptionCompleted(response.transcript);
            break;
        case 'response.audio_transcript.done':
            this.handleAudioTranscriptDone(response);
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
        case 'conversation.item.truncated':
            this.handleItemTruncated(response);
            break;
        case 'response.function_call_arguments.done':
            this.handleFunctionCall(response);
            break;
        case 'session.created':
        case 'session.updated':
        case 'conversation.created':
        case 'conversation.item.created':
        case 'response.created':
        case 'response.done':
        case 'response.output_item.done':
        case 'rate_limits.updated':
            // Log but don't handle explicitly
            break;
        case 'error':
            console.error('[OpenAI Error]', response);
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

        const message = {
            role: 'user' as const,
            content: transcription
        };

        this.callState.conversationHistory.push(message);

        // Emit transcript update via Socket.IO
        if (this.callState.callSid) {
            this.socketService.emitTranscriptUpdate(this.callState.callSid, {
                speaker: 'user',
                text: transcription,
                timestamp: new Date(),
                isPartial: false
            });

            // Also update the CallStateService
            const CallStateService = require('../call-state.service.js').CallStateService;
            const callStateService = CallStateService.getInstance();
            callStateService.addTranscript(this.callState.callSid, {
                role: message.role,
                content: message.content
            });
        }

        // Only auto-hangup on very explicit user requests to end the call
        // This prevents false positives from casual use of "bye" or "goodbye" in conversation
        const explicitHangupPhrases = [
            'hang up now',
            'end the call now',
            'disconnect now',
            'terminate the call'
        ];
        const shouldHangup = explicitHangupPhrases.some(phrase =>
            transcription.toLowerCase().includes(phrase)
        );

        if (shouldHangup) {
            console.log('[Call Handler] User explicitly requested call termination:', transcription);
            this.onEndCall();
        }
        // Otherwise, rely on AI's judgment to naturally conclude based on its instructions
    }

    /**
     * Handle an audio transcript done event
     * @param response The full event response with transcript and item_id
     */
    private handleAudioTranscriptDone(response: any): void {
        const transcript = response.transcript;
        if (!transcript) {
            return;
        }

        const message = {
            role: 'assistant' as const,
            content: transcript,
            truncated: false,
            truncatedAt: undefined
        };

        this.callState.conversationHistory.push(message);

        // Store mapping from item_id to message index
        const messageIndex = this.callState.conversationHistory.length - 1;
        if (response.item_id) {
            this.itemIdToMessageIndex.set(response.item_id, messageIndex);
            console.log(`[OpenAI Event] Mapped item ${response.item_id} to message index ${messageIndex}`);
        }

        // Emit transcript update via Socket.IO
        if (this.callState.callSid) {
            this.socketService.emitTranscriptUpdate(this.callState.callSid, {
                speaker: 'assistant',
                text: transcript,
                timestamp: new Date(),
                isPartial: false
            });

            // Also update the CallStateService
            const CallStateService = require('../call-state.service.js').CallStateService;
            const callStateService = CallStateService.getInstance();
            callStateService.addTranscript(this.callState.callSid, {
                role: message.role,
                content: message.content
            });
        }
    }

    /**
     * Handle an item truncated event (when assistant is interrupted)
     * @param response The truncation event data
     */
    private handleItemTruncated(response: any): void {
        const itemId = response.item_id;
        const audioEndMs = response.audio_end_ms;

        console.log(`[OpenAI Event] Item ${itemId} truncated at ${audioEndMs}ms`);

        // Find the message in conversation history
        const messageIndex = this.itemIdToMessageIndex.get(itemId);
        if (messageIndex !== undefined && messageIndex < this.callState.conversationHistory.length) {
            const message = this.callState.conversationHistory[messageIndex];

            // Mark the message as truncated
            message.truncated = true;
            message.truncatedAt = audioEndMs;

            console.log(`[OpenAI Event] Marked message at index ${messageIndex} as truncated: "${message.content}"`);

            // Emit update via Socket.IO to refresh the UI
            // Use the original message timestamp so frontend can identify and update the correct transcript
            if (this.callState.callSid) {
                this.socketService.emitTranscriptUpdate(this.callState.callSid, {
                    speaker: 'assistant',
                    text: message.content,
                    timestamp: message.timestamp,
                    isPartial: false,
                    truncated: true,
                    truncatedAt: audioEndMs
                });

                // Also update CallStateService
                const CallStateService = require('../call-state.service.js').CallStateService;
                const callStateService = CallStateService.getInstance();
                const activeCall = callStateService.getCall(this.callState.callSid);
                if (activeCall && activeCall.conversationHistory[messageIndex]) {
                    activeCall.conversationHistory[messageIndex].truncated = true;
                    activeCall.conversationHistory[messageIndex].truncatedAt = audioEndMs;
                }
            }
        } else {
            console.warn(`[OpenAI Event] Could not find message for truncated item ${itemId}`);
        }
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

    /**
     * Handle a function call from the AI agent
     * @param response The function call event data
     */
    private async handleFunctionCall(response: any): Promise<void> {
        const functionName = response.name;
        const callId = response.call_id;

        console.log(`[OpenAI Function Call] ${functionName} called with ID: ${callId}`);

        try {
            const args = JSON.parse(response.arguments);

            if (functionName === 'send_dtmf') {
                const digits = args.digits;
                console.log(`[OpenAI Function Call] AI agent sending DTMF: ${digits}`);

                // Call the backend API to send DTMF tones
                if (this.callState.callSid) {
                    const fetch = (await import('node-fetch')).default;
                    const response = await fetch(`http://localhost:3004/api/calls/${this.callState.callSid}/dtmf`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ digits })
                    });

                    if (!response.ok) {
                        const error = await response.json();
                        console.error('[OpenAI Function Call] Failed to send DTMF:', error);
                        // Return error result to OpenAI
                        return;
                    }

                    console.log(`[OpenAI Function Call] DTMF sent successfully: ${digits}`);

                    // Add to conversation history
                    const message = {
                        role: 'system' as const,
                        content: `AI assistant sent DTMF tones: ${digits}`
                    };
                    this.callState.conversationHistory.push(message);
                }
            }
        } catch (error) {
            console.error('[OpenAI Function Call] Error processing function call:', error);
        }
    }
}
