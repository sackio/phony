import { WebSocket } from 'ws';
import { OpenAIConfig } from '../../types.js';
import { SHOW_TIMING_MATH } from '../../config/constants.js';

/**
 * Service for handling OpenAI API interactions
 */
export class OpenAIWsService {
    private webSocket: WebSocket | null = null;
    private config: OpenAIConfig;

    /**
     * Create a new OpenAI service
     * @param config Configuration for the OpenAI API
     */
    constructor(config: OpenAIConfig) {
        this.config = config;
    }

    /**
     * Update the voice setting
     * @param voice The new voice to use
     */
    public updateVoice(voice: string): void {
        this.config.voice = voice;
        console.log('[OpenAI WS] Voice updated to:', voice);
    }

    /**
     * Initialize the WebSocket connection to OpenAI
     * @param onMessage Callback for handling messages from OpenAI
     * @param onOpen Callback for when the connection is opened
     * @param onError Callback for handling errors
     */
    public initialize(
        onMessage: (data: WebSocket.Data) => void,
        onOpen: () => void,
        onError: (error: Error) => void
    ): void {
        this.webSocket = new WebSocket(this.config.websocketUrl, {
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                'OpenAI-Beta': 'realtime=v1'
            }
        });

        this.webSocket.on('open', () => {
            console.log('[OpenAI WS] Connected successfully');
            onOpen();
        });
        this.webSocket.on('message', onMessage);
        this.webSocket.on('error', (error) => {
            console.error('[OpenAI WS] ERROR:', error);
            onError(error);
        });
        this.webSocket.on('close', (code, reason) => {
            console.log('[OpenAI WS] Connection closed:', code, reason.toString());
        });
    }

    /**
     * Initialize the session with OpenAI
     * @param callContext The context for the call
     */
    public initializeSession(callContext: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            console.error('[OpenAI WS] Cannot initialize session - WebSocket not ready. State:', this.webSocket?.readyState);
            return;
        }

        const sessionUpdate = {
            type: 'session.update',
            session: {
                turn_detection: { type: 'server_vad' },
                input_audio_format: 'g711_ulaw',
                output_audio_format: 'g711_ulaw',
                voice: this.config.voice,
                instructions: callContext,
                modalities: ['text', 'audio'],
                temperature: this.config.temperature,
                'input_audio_transcription': {
                    'model': 'whisper-1'
                },
            }
        };

        console.log('[OpenAI WS] Initializing session with context:', callContext.substring(0, 100) + '...');
        this.webSocket.send(JSON.stringify(sessionUpdate));
    }

    /**
     * Close the WebSocket connection
     */
    public close(): void {
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            this.webSocket.close();
        }
    }

    /**
     * Forward audio data to OpenAI
     * @param audioPayload The audio payload to forward
     */
    public sendAudio(audioPayload: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            console.error('[OpenAI Audio] Cannot send audio - WebSocket not ready. State:', this.webSocket?.readyState);
            return;
        }

        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: audioPayload
        };

        // Reduced logging - audio sending is very frequent
        // Only log errors, not every audio packet

        this.webSocket.send(JSON.stringify(audioAppend));
    }

    /**
     * Truncate the assistant's response
     * @param itemId The ID of the assistant's response
     * @param elapsedTime The time elapsed since the response started
     */
    public truncateAssistantResponse(itemId: string, elapsedTime: number): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        const truncateEvent = {
            type: 'conversation.item.truncate',
            item_id: itemId,
            content_index: 0,
            audio_end_ms: elapsedTime
        };

        if (SHOW_TIMING_MATH) {
            console.error('Sending truncation event:', JSON.stringify(truncateEvent));
        }

        this.webSocket.send(JSON.stringify(truncateEvent));
    }

    /**
     * Check if the WebSocket is connected
     */
    public isConnected(): boolean {
        return this.webSocket !== null && this.webSocket.readyState === WebSocket.OPEN;
    }

    /**
     * Add a conversation item to the OpenAI session
     * @param role The role (user, assistant, or system)
     * @param content The content of the message
     */
    public addConversationItem(role: string, content: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            console.error('[OpenAI WS] Cannot add conversation item - WebSocket not ready. State:', this.webSocket?.readyState);
            return;
        }

        const conversationItem = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: role,
                content: [
                    {
                        type: 'input_text',
                        text: content
                    }
                ]
            }
        };

        this.webSocket.send(JSON.stringify(conversationItem));
    }

    /**
     * Inject context into the conversation as a system message
     * @param context The context to inject
     * @param conversationSummary Optional summary of the conversation so far
     */
    public injectContextMessage(context: string, conversationSummary?: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            console.error('[OpenAI WS] Cannot inject context - WebSocket not ready. State:', this.webSocket?.readyState);
            return;
        }

        const fullContext = conversationSummary
            ? `OPERATOR INSTRUCTION:\n${context}\n\nCONVERSATION SUMMARY:\n${conversationSummary}`
            : `OPERATOR INSTRUCTION:\n${context}`;

        console.log('[OpenAI WS] Full context being sent to OpenAI:\n', fullContext);

        const conversationItem = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'system',
                content: [
                    {
                        type: 'input_text',
                        text: fullContext
                    }
                ]
            }
        };

        console.log('[OpenAI WS] Sending conversation.item.create with system message');
        this.webSocket.send(JSON.stringify(conversationItem));

        // Trigger a response from the assistant
        const responseCreate = {
            type: 'response.create'
        };
        console.log('[OpenAI WS] Sending response.create to trigger AI response');
        this.webSocket.send(JSON.stringify(responseCreate));
    }

    /**
     * Trigger a response from the assistant
     * Useful when resuming a call or after restoring conversation history
     */
    public triggerResponse(): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            console.error('[OpenAI WS] Cannot trigger response - WebSocket not ready. State:', this.webSocket?.readyState);
            return;
        }

        const responseCreate = {
            type: 'response.create'
        };
        console.log('[OpenAI WS] Triggering assistant response');
        this.webSocket.send(JSON.stringify(responseCreate));
    }
}
