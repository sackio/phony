import { WebSocket } from 'ws';

/**
 * ElevenLabs Conversational AI WebSocket service.
 *
 * Audio chain (post-Phase-1 refactor):
 *   - Outbound (Twilio → ElevenLabs): the Twilio media payload (µ-law 8kHz,
 *     base64) is passed straight through as `user_audio_chunk`. No conversion.
 *   - Inbound  (ElevenLabs → Twilio): the agent emits ulaw_8000 chunks
 *     (configured in the agent dashboard), which we forward verbatim.
 *
 * For belt-and-suspenders, we ALSO assert ulaw_8000 in the init payload via
 * `conversation_config_override.tts.output_format` and
 * `conversation_config_override.asr.user_input_audio_format`. ElevenLabs
 * confirms the negotiated format in `conversation_initiation_metadata`;
 * we log a warning if it ever drifts.
 *
 * Reliability features:
 *   - Heartbeat: schedule a client-initiated ping every 20s as an explicit
 *     liveness check (in addition to answering server pings with pongs).
 *   - Reconnect: on unexpected close codes, attempt up to 3 reconnects with
 *     exponential backoff. Sustained failure ends the call cleanly.
 *   - agent_response_complete: signaler that the agent finished its turn —
 *     used by the handler for goodbye detection (instead of regex on transcripts).
 */

export interface ElevenLabsConfig {
    apiKey: string;
    agentId: string;
    voiceId?: string;
}

export interface ElevenLabsCallbacks {
    onAudio: (audioData: string) => void;
    onUserTranscript: (text: string, isFinal: boolean) => void;
    onAgentTranscript: (text: string, isFinal: boolean) => void;
    onAgentResponseComplete: () => void;
    onInterruption: () => void;
    onError: (error: Error) => void;
    onClose: () => void;
    onReady: (negotiatedAgentOutputFormat: string) => void;
    onToolCall?: (toolName: string, toolCallId: string, parameters: Record<string, any>) => Promise<{ result: string; isError?: boolean }>;
}

const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_MAX_ATTEMPTS = 3;
const RECONNECT_INITIAL_BACKOFF_MS = 500;
/** Codes we treat as "intentional close — don't reconnect". */
const NO_RECONNECT_CODES = new Set([1000, 1001, 1005]);

export class ElevenLabsWsService {
    private webSocket: WebSocket | null = null;
    private config: ElevenLabsConfig;
    private callbacks: ElevenLabsCallbacks | null = null;
    private conversationId: string | null = null;
    private isSessionActive: boolean = false;
    private pendingSystemPrompt: string | null = null;
    private pendingFirstMessage: string | null = null;
    private pendingDynamicVars: Record<string, string> | null = null;
    private pendingVoiceId: string | null = null;
    private agentOutputFormat: string = 'ulaw_8000';
    private wsReady: boolean = false;
    private initSent: boolean = false;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private reconnectAttempts: number = 0;
    private closing: boolean = false; // explicit shutdown flag

    constructor(config: ElevenLabsConfig) {
        this.config = config;
    }

    public initialize(callbacks: ElevenLabsCallbacks): void {
        this.callbacks = callbacks;
        this.connect();
    }

    private connect(): void {
        const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${this.config.agentId}`;
        console.log(`[ElevenLabs WS] Connecting (attempt ${this.reconnectAttempts + 1}):`, wsUrl);

        this.webSocket = new WebSocket(wsUrl, {
            headers: { 'xi-api-key': this.config.apiKey },
        });

        this.webSocket.on('open', () => {
            console.log('[ElevenLabs WS] Connected');
            this.wsReady = true;
            this.reconnectAttempts = 0; // reset on successful open
            this.sendConversationInit();
            this.startHeartbeat();
        });

        this.webSocket.on('message', (data: WebSocket.Data) => this.handleMessage(data));

        this.webSocket.on('error', (error) => {
            console.error('[ElevenLabs WS] ERROR:', error);
            this.callbacks?.onError(error);
        });

        this.webSocket.on('close', (code, reason) => {
            console.log('[ElevenLabs WS] Connection closed:', code, reason.toString());
            this.stopHeartbeat();
            this.isSessionActive = false;
            this.wsReady = false;
            this.initSent = false;

            if (this.closing || NO_RECONNECT_CODES.has(code)) {
                this.callbacks?.onClose();
                return;
            }
            this.attemptReconnect();
        });
    }

    private attemptReconnect(): void {
        if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            console.error('[ElevenLabs WS] Exhausted reconnect attempts, ending call');
            this.callbacks?.onClose();
            return;
        }
        const delay = RECONNECT_INITIAL_BACKOFF_MS * 2 ** this.reconnectAttempts;
        this.reconnectAttempts++;
        console.log(`[ElevenLabs WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})`);
        setTimeout(() => {
            if (!this.closing) this.connect();
        }, delay);
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.webSocket?.readyState === WebSocket.OPEN) {
                try {
                    this.webSocket.ping();
                } catch (e) {
                    console.error('[ElevenLabs WS] Heartbeat ping failed:', e);
                }
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private handleMessage(data: WebSocket.Data): void {
        try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
                case 'conversation_initiation_metadata':
                    this.conversationId = message.conversation_initiation_metadata_event?.conversation_id;
                    this.agentOutputFormat = message.conversation_initiation_metadata_event?.agent_output_audio_format || 'ulaw_8000';
                    this.isSessionActive = true;
                    console.log('[ElevenLabs WS] Session started, conversation_id:', this.conversationId);
                    console.log('[ElevenLabs WS] Negotiated agent output format:', this.agentOutputFormat);
                    this.callbacks?.onReady(this.agentOutputFormat);

                    if (this.pendingSystemPrompt) {
                        // Edge case: prompt arrived after init was already sent (shouldn't happen
                        // in normal flow but kept as a fallback). Use contextual_update.
                        console.log('[ElevenLabs WS] Late prompt — injecting via contextual_update');
                        this.injectContext(this.pendingSystemPrompt);
                        this.pendingSystemPrompt = null;
                    }
                    break;

                case 'audio':
                    if (message.audio_event?.audio_base_64) {
                        this.callbacks?.onAudio(message.audio_event.audio_base_64);
                    } else if (message.audio?.chunk) {
                        // legacy shape — kept for safety
                        this.callbacks?.onAudio(message.audio.chunk);
                    }
                    break;

                case 'user_transcript':
                    this.callbacks?.onUserTranscript(
                        message.user_transcription_event?.user_transcript || '',
                        true,
                    );
                    break;

                case 'agent_response':
                    this.callbacks?.onAgentTranscript(
                        message.agent_response_event?.agent_response || '',
                        true,
                    );
                    break;

                case 'agent_response_complete':
                    // Fires when the agent finishes its turn. The handler uses this
                    // as a precise goodbye-detection trigger instead of regex matching.
                    this.callbacks?.onAgentResponseComplete();
                    break;

                case 'agent_response_correction':
                    // Correction to a previous agent response. Currently ignored — the
                    // transcript path doesn't track per-utterance ids. Logged for debug.
                    console.log('[ElevenLabs WS] Agent response correction:', JSON.stringify(message).slice(0, 200));
                    break;

                case 'interruption':
                    console.log('[ElevenLabs WS] Interruption detected');
                    this.callbacks?.onInterruption();
                    break;

                case 'ping':
                    this.sendPong(message.ping_event?.event_id);
                    break;

                case 'client_tool_call': {
                    const toolName = message.client_tool_call?.tool_name;
                    const toolCallId = message.client_tool_call?.tool_call_id;
                    const toolParams = message.client_tool_call?.parameters || {};
                    console.log('[ElevenLabs WS] Tool call:', toolName, 'params:', JSON.stringify(toolParams));

                    if (toolName === 'end_call') {
                        console.log('[ElevenLabs WS] Agent requested end_call');
                        this.sendToolResult(toolCallId, 'Call ended');
                        this.closing = true;
                        this.callbacks?.onClose();
                    } else if (this.callbacks?.onToolCall) {
                        this.callbacks.onToolCall(toolName, toolCallId, toolParams)
                            .then(({ result, isError }) => this.sendToolResult(toolCallId, result, isError))
                            .catch((err) => {
                                console.error('[ElevenLabs WS] Tool call error:', err);
                                this.sendToolResult(toolCallId, `Error: ${err.message}`, true);
                            });
                    } else {
                        console.log('[ElevenLabs WS] Unhandled tool call:', toolName);
                        this.sendToolResult(toolCallId, `Tool ${toolName} not implemented`, true);
                    }
                    break;
                }

                case 'vad_score':
                case 'internal_vad':
                case 'internal_tentative_agent_response':
                    // Informational — ignore.
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

    public initializeConversation(
        systemPrompt: string,
        dynamicVariables?: Record<string, string>,
        voiceId?: string,
        firstMessage?: string,
    ): void {
        if (dynamicVariables) this.pendingDynamicVars = dynamicVariables;
        if (voiceId) this.pendingVoiceId = voiceId;
        if (firstMessage) this.pendingFirstMessage = firstMessage;

        if (this.isSessionActive) {
            console.log('[ElevenLabs WS] Session active, injecting prompt via contextual_update');
            this.injectContext(systemPrompt);
        } else {
            this.pendingSystemPrompt = systemPrompt;
            if (this.wsReady && !this.initSent) {
                console.log('[ElevenLabs WS] WebSocket ready, sending init with prompt now');
                this.sendConversationInit();
            } else {
                console.log('[ElevenLabs WS] Queuing system prompt for conversation_config_override');
            }
        }
    }

    /**
     * Send conversation_initiation_client_data on WebSocket open.
     * Includes the system prompt + audio format overrides in
     * conversation_config_override for lowest latency.
     */
    private sendConversationInit(): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) return;

        const initMessage: any = {
            type: 'conversation_initiation_client_data',
            // Belt-and-suspenders: assert ulaw_8000 even if the agent default
            // is already set in the dashboard. Per the protocol, the server
            // confirms the negotiated format back in conversation_initiation_metadata.
            conversation_config_override: {
                asr: { user_input_audio_format: 'ulaw_8000' },
                tts: { output_format: 'ulaw_8000' },
            },
        };

        if (this.pendingSystemPrompt || this.pendingFirstMessage) {
            initMessage.conversation_config_override.agent = {};
            if (this.pendingSystemPrompt) {
                initMessage.conversation_config_override.agent.prompt = { prompt: this.pendingSystemPrompt };
                console.log('[ElevenLabs WS] Including system prompt in init override');
                this.pendingSystemPrompt = null;
            }
            if (this.pendingFirstMessage) {
                initMessage.conversation_config_override.agent.first_message = this.pendingFirstMessage;
                console.log('[ElevenLabs WS] Including first_message in init override:', this.pendingFirstMessage.slice(0, 80));
                this.pendingFirstMessage = null;
            }
        }

        if (this.pendingVoiceId) {
            initMessage.conversation_config_override.tts.voice_id = this.pendingVoiceId;
            console.log('[ElevenLabs WS] Including voice_id in init override:', this.pendingVoiceId);
            this.pendingVoiceId = null;
        }

        if (this.pendingDynamicVars && Object.keys(this.pendingDynamicVars).length > 0) {
            initMessage.dynamic_variables = this.pendingDynamicVars;
            this.pendingDynamicVars = null;
        }

        console.log('[ElevenLabs WS] Sending conversation init');
        this.initSent = true;
        this.webSocket.send(JSON.stringify(initMessage));
    }

    /**
     * Forward Twilio µ-law 8kHz audio straight through to ElevenLabs as
     * `user_audio_chunk`. No conversion — agent is configured for ulaw_8000.
     */
    public sendAudio(twilioBase64Audio: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) return;
        this.webSocket.send(JSON.stringify({ user_audio_chunk: twilioBase64Audio }));
    }

    public injectContext(contextText: string): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            console.error('[ElevenLabs WS] Cannot inject context — WebSocket not ready');
            return;
        }
        const msg = { type: 'contextual_update', text: contextText };
        console.log('[ElevenLabs WS] Injecting context:', contextText.substring(0, 100) + '...');
        this.webSocket.send(JSON.stringify(msg));
    }

    private sendToolResult(toolCallId: string, result: string, isError?: boolean): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) return;
        const msg = {
            type: 'client_tool_result',
            tool_call_id: toolCallId,
            result,
            is_error: isError || false,
        };
        console.log('[ElevenLabs WS] Sending tool result:', JSON.stringify(msg));
        this.webSocket.send(JSON.stringify(msg));
    }

    private sendPong(eventId?: number): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) return;
        const msg: any = { type: 'pong' };
        if (eventId !== undefined) msg.event_id = eventId;
        this.webSocket.send(JSON.stringify(msg));
    }

    public close(): void {
        this.closing = true;
        this.stopHeartbeat();
        if (this.webSocket) {
            if (this.webSocket.readyState === WebSocket.OPEN) this.webSocket.close(1000, 'client requested');
            this.webSocket = null;
        }
        this.isSessionActive = false;
    }

    public isConnected(): boolean {
        return this.webSocket !== null && this.webSocket.readyState === WebSocket.OPEN;
    }

    public isReady(): boolean {
        return this.isSessionActive && this.isConnected();
    }

    public getConversationId(): string | null {
        return this.conversationId;
    }

    public updateVoiceId(voiceId: string): void {
        this.config.voiceId = voiceId;
        console.log('[ElevenLabs WS] Voice ID updated to:', voiceId);
    }

    public getAgentOutputFormat(): string {
        return this.agentOutputFormat;
    }
}
