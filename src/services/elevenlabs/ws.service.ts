import { WebSocket } from 'ws';
import { convertTwilioToElevenLabs } from './audio.service.js';

/**
 * Configuration for ElevenLabs Conversational AI WebSocket
 */
export interface ElevenLabsConfig {
    apiKey: string;
    agentId: string;
    voiceId?: string;
}

/**
 * Callback types for ElevenLabs events
 */
export interface ElevenLabsCallbacks {
    onAudio: (audioData: string) => void;
    onUserTranscript: (text: string, isFinal: boolean) => void;
    onAgentTranscript: (text: string, isFinal: boolean) => void;
    onInterruption: () => void;
    onError: (error: Error) => void;
    onClose: () => void;
    onReady: () => void;
}

/**
 * ElevenLabs Conversational AI WebSocket Service
 * Handles real-time voice conversations with ElevenLabs AI
 */
export class ElevenLabsWsService {
    private webSocket: WebSocket | null = null;
    private config: ElevenLabsConfig;
    private callbacks: ElevenLabsCallbacks | null = null;
    private conversationId: string | null = null;
    private isSessionActive: boolean = false;

    constructor(config: ElevenLabsConfig) {
        this.config = config;
    }

    /**
     * Initialize the WebSocket connection to ElevenLabs Conversational AI
     */
    public initialize(callbacks: ElevenLabsCallbacks): void {
        this.callbacks = callbacks;

        // ElevenLabs Conversational AI WebSocket URL
        const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${this.config.agentId}`;

        console.log('[ElevenLabs WS] Connecting to:', wsUrl);

        this.webSocket = new WebSocket(wsUrl, {
            headers: {
                'xi-api-key': this.config.apiKey
            }
        });

        this.webSocket.on('open', () => {
            console.log('[ElevenLabs WS] Connected successfully');
        });

        this.webSocket.on('message', (data: WebSocket.Data) => {
            this.handleMessage(data);
        });

        this.webSocket.on('error', (error) => {
            console.error('[ElevenLabs WS] ERROR:', error);
            this.callbacks?.onError(error);
        });

        this.webSocket.on('close', (code, reason) => {
            console.log('[ElevenLabs WS] Connection closed:', code, reason.toString());
            this.isSessionActive = false;
            this.callbacks?.onClose();
        });
    }

    /**
     * Handle incoming messages from ElevenLabs
     */
    private handleMessage(data: WebSocket.Data): void {
        try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
                case 'conversation_initiation_metadata':
                    // Session established
                    this.conversationId = message.conversation_id;
                    this.isSessionActive = true;
                    console.log('[ElevenLabs WS] Session started, conversation_id:', this.conversationId);
                    this.callbacks?.onReady();
                    break;

                case 'audio':
                    // Audio chunk from ElevenLabs (already in ulaw_8000 format when requested)
                    if (message.audio && message.audio.chunk) {
                        this.callbacks?.onAudio(message.audio.chunk);
                    }
                    break;

                case 'user_transcript':
                    // User speech transcription
                    this.callbacks?.onUserTranscript(
                        message.user_transcript || '',
                        message.is_final || false
                    );
                    break;

                case 'agent_response':
                    // Agent response text
                    this.callbacks?.onAgentTranscript(
                        message.agent_response || '',
                        message.is_final || true
                    );
                    break;

                case 'interruption':
                    // User interrupted the agent
                    console.log('[ElevenLabs WS] Interruption detected');
                    this.callbacks?.onInterruption();
                    break;

                case 'ping':
                    // Respond to ping with pong
                    this.sendPong(message.ping_event?.event_id);
                    break;

                case 'error':
                    console.error('[ElevenLabs WS] Error from server:', message.error);
                    this.callbacks?.onError(new Error(message.error?.message || 'Unknown error'));
                    break;

                default:
                    console.log('[ElevenLabs WS] Unhandled message type:', message.type);
            }
        } catch (error) {
            console.error('[ElevenLabs WS] Error parsing message:', error);
        }
    }

    /**
     * Send conversation initialization with system prompt override
     */
    public initializeConversation(systemPrompt: string, dynamicVariables?: Record<string, string>): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            console.error('[ElevenLabs WS] Cannot initialize conversation - WebSocket not ready');
            return;
        }

        const initMessage: any = {
            type: 'conversation_initiation_client_data',
            conversation_config_override: {
                agent: {
                    prompt: {
                        prompt: systemPrompt
                    }
                },
                // Request ulaw_8000 output format to match Twilio's native format
                tts: {
                    output_format: 'ulaw_8000'
                }
            }
        };

        // Add dynamic variables if provided
        if (dynamicVariables && Object.keys(dynamicVariables).length > 0) {
            initMessage.dynamic_variables = dynamicVariables;
        }

        // Add voice override if specified
        if (this.config.voiceId) {
            initMessage.conversation_config_override.tts.voice_id = this.config.voiceId;
        }

        console.log('[ElevenLabs WS] Sending conversation init with prompt:', systemPrompt.substring(0, 100) + '...');
        this.webSocket.send(JSON.stringify(initMessage));
    }

    /**
     * Send audio data to ElevenLabs
     * Input should be base64-encoded µ-law from Twilio
     */
    public sendAudio(twilioBase64Audio: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        // Convert Twilio µ-law 8kHz to PCM 16kHz for ElevenLabs
        const pcmBase64 = convertTwilioToElevenLabs(twilioBase64Audio);

        const audioMessage = {
            type: 'audio',
            audio: {
                chunk: pcmBase64
            }
        };

        this.webSocket.send(JSON.stringify(audioMessage));
    }

    /**
     * Send raw PCM audio to ElevenLabs (already in correct format)
     */
    public sendRawAudio(pcmBase64Audio: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        const audioMessage = {
            type: 'audio',
            audio: {
                chunk: pcmBase64Audio
            }
        };

        this.webSocket.send(JSON.stringify(audioMessage));
    }

    /**
     * Inject context into the conversation mid-call
     */
    public injectContext(contextText: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            console.error('[ElevenLabs WS] Cannot inject context - WebSocket not ready');
            return;
        }

        const contextMessage = {
            type: 'contextual_update',
            text: contextText
        };

        console.log('[ElevenLabs WS] Injecting context:', contextText.substring(0, 100) + '...');
        this.webSocket.send(JSON.stringify(contextMessage));
    }

    /**
     * Respond to ping with pong
     */
    private sendPong(eventId?: number): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        const pongMessage: any = {
            type: 'pong'
        };

        if (eventId !== undefined) {
            pongMessage.pong_event = { event_id: eventId };
        }

        this.webSocket.send(JSON.stringify(pongMessage));
    }

    /**
     * Close the WebSocket connection
     */
    public close(): void {
        if (this.webSocket) {
            if (this.webSocket.readyState === WebSocket.OPEN) {
                this.webSocket.close();
            }
            this.webSocket = null;
        }
        this.isSessionActive = false;
    }

    /**
     * Check if the WebSocket is connected and session is active
     */
    public isConnected(): boolean {
        return this.webSocket !== null &&
               this.webSocket.readyState === WebSocket.OPEN;
    }

    /**
     * Check if the conversation session is active
     */
    public isReady(): boolean {
        return this.isSessionActive && this.isConnected();
    }

    /**
     * Get the current conversation ID
     */
    public getConversationId(): string | null {
        return this.conversationId;
    }

    /**
     * Update the voice ID for future audio generation
     */
    public updateVoiceId(voiceId: string): void {
        this.config.voiceId = voiceId;
        console.log('[ElevenLabs WS] Voice ID updated to:', voiceId);
    }
}
