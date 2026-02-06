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
    private pendingSystemPrompt: string | null = null;
    private pendingDynamicVars: Record<string, string> | null = null;
    private agentOutputFormat: string = 'pcm_16000';

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
            // Send conversation_initiation_client_data immediately on open
            this.sendConversationInit();
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
                    this.conversationId = message.conversation_initiation_metadata_event?.conversation_id;
                    this.agentOutputFormat = message.conversation_initiation_metadata_event?.agent_output_audio_format || 'pcm_16000';
                    this.isSessionActive = true;
                    console.log('[ElevenLabs WS] Session started, conversation_id:', this.conversationId);
                    console.log('[ElevenLabs WS] Agent output audio format:', this.agentOutputFormat);
                    this.callbacks?.onReady();

                    // Inject pending system prompt via contextual_update after session starts
                    if (this.pendingSystemPrompt) {
                        console.log('[ElevenLabs WS] Injecting system prompt via contextual_update...');
                        this.injectContext(this.pendingSystemPrompt);
                        this.pendingSystemPrompt = null;
                    }
                    break;

                case 'audio':
                    // Audio chunk from ElevenLabs (handle both old and new formats)
                    if (message.audio_event?.audio_base_64) {
                        this.callbacks?.onAudio(message.audio_event.audio_base_64);
                    } else if (message.audio?.chunk) {
                        this.callbacks?.onAudio(message.audio.chunk);
                    }
                    break;

                case 'user_transcript':
                    // User speech transcription
                    this.callbacks?.onUserTranscript(
                        message.user_transcription_event?.user_transcript || '',
                        true
                    );
                    break;

                case 'agent_response':
                    // Agent response text
                    this.callbacks?.onAgentTranscript(
                        message.agent_response_event?.agent_response || '',
                        true
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

                case 'internal_vad':
                    // Voice Activity Detection event - ignore
                    break;

                case 'error':
                    console.error('[ElevenLabs WS] Error from server:', JSON.stringify(message));
                    this.callbacks?.onError(new Error(message.error?.message || JSON.stringify(message)));
                    break;

                default:
                    console.log('[ElevenLabs WS] Unhandled message type:', message.type, JSON.stringify(message).substring(0, 200));
            }
        } catch (error) {
            console.error('[ElevenLabs WS] Error parsing message:', error);
        }
    }

    /**
     * Set system prompt to inject after session starts via contextual_update.
     * We don't use conversation_config_override for prompt because many agents
     * have prompt overrides disabled. Instead we inject via contextual_update.
     */
    public initializeConversation(systemPrompt: string, dynamicVariables?: Record<string, string>): void {
        if (dynamicVariables) {
            this.pendingDynamicVars = dynamicVariables;
        }

        if (this.isSessionActive) {
            // Already connected - inject immediately
            console.log('[ElevenLabs WS] Session active, injecting system prompt immediately');
            this.injectContext(systemPrompt);
        } else {
            // Store for injection after session starts
            console.log('[ElevenLabs WS] Queuing system prompt for injection after session starts');
            this.pendingSystemPrompt = systemPrompt;
        }
    }

    /**
     * Send conversation_initiation_client_data on WebSocket open.
     * Minimal config to avoid rejection by agents that block overrides.
     * System prompt is injected via contextual_update after session starts.
     */
    private sendConversationInit(): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        const initMessage: any = {
            type: 'conversation_initiation_client_data',
        };

        // Add dynamic variables if provided
        if (this.pendingDynamicVars && Object.keys(this.pendingDynamicVars).length > 0) {
            initMessage.dynamic_variables = this.pendingDynamicVars;
            this.pendingDynamicVars = null;
        }

        console.log('[ElevenLabs WS] Sending conversation init');
        this.webSocket.send(JSON.stringify(initMessage));
    }

    /**
     * Send audio data to ElevenLabs
     * Converts Twilio µ-law 8kHz to PCM 16kHz (ElevenLabs expects PCM input)
     */
    public sendAudio(twilioBase64Audio: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        // Convert Twilio µ-law 8kHz to PCM 16kHz for ElevenLabs
        const pcmBase64 = convertTwilioToElevenLabs(twilioBase64Audio);

        const audioMessage = {
            user_audio_chunk: pcmBase64
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
            pongMessage.event_id = eventId;
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

    /**
     * Get the agent's output audio format (from metadata)
     */
    public getAgentOutputFormat(): string {
        return this.agentOutputFormat;
    }
}
