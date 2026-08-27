import { WebSocket } from 'ws';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { CallState, CallType, ElevenLabsConfig } from '../types.js';
import { ELEVENLABS_API_KEY, ELEVENLABS_DEFAULT_AGENT_ID, MAX_OUTGOING_CALL_DURATION, MAX_INCOMING_CALL_DURATION, GOODBYE_PHRASES } from '../config/constants.js';
import { ElevenLabsWsService } from '../services/elevenlabs/ws.service.js';
import { ElevenLabsEventService } from '../services/elevenlabs/event.service.js';
import { TwilioWsService } from '../services/twilio/ws.service.js';
import { TwilioEventService } from '../services/twilio/event.service.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { CallTranscriptService } from '../services/database/call-transcript.service.js';
import { ContextService } from '../services/context.service.js';

/**
 * The opening utterance from a block of call instructions: everything up to the
 * first blank line. Returns undefined for empty input so the caller can omit
 * `first_message` entirely rather than sending an empty string.
 */
function firstParagraph(text?: string | null): string | undefined {
    if (!text) return undefined;
    const opening = text.split(/\n\s*\n/)[0]?.trim();
    return opening ? opening : undefined;
}
import { ICallHandler } from './call.handler.js';

dotenv.config();

/**
 * Handles the communication between Twilio and ElevenLabs for voice calls
 * Handles the communication between Twilio and ElevenLabs for voice calls
 */
export class ElevenLabsCallHandler implements ICallHandler {
    private readonly twilioStream: TwilioWsService;
    private readonly elevenLabsService: ElevenLabsWsService;
    private readonly elevenLabsEventProcessor: ElevenLabsEventService;
    private readonly twilioEventProcessor: TwilioEventService;
    private readonly twilioCallService: TwilioCallService;
    private readonly transcriptService: CallTranscriptService;
    private readonly callState: CallState;
    private readonly sessionManagerService: any;
    private callStartTime: Date;
    private elevenLabsReady: boolean = false;
    private audioBuffer: string[] = [];
    private callContextReady: boolean = false;
    private needsInitialization: boolean = false;
    private maxDurationTimer: NodeJS.Timeout | null = null;
    private callEnding: boolean = false;
    private sessionInitialized: boolean = false;

    constructor(
        ws: WebSocket,
        callType: CallType,
        twilioClient: twilio.Twilio,
        contextService: ContextService,
        transcriptService: CallTranscriptService,
        sessionManagerService?: any,
        agentId?: string,
        voiceId?: string
    ) {
        this.callState = new CallState(callType);
        this.callState.voiceProvider = 'elevenlabs';
        this.callState.elevenLabsAgentId = agentId || ELEVENLABS_DEFAULT_AGENT_ID;
        this.callState.elevenLabsVoiceId = voiceId;
        this.transcriptService = transcriptService;
        this.sessionManagerService = sessionManagerService;
        this.callStartTime = new Date();

        // Initialize Twilio services
        this.twilioStream = new TwilioWsService(ws, this.callState);
        this.twilioCallService = new TwilioCallService(twilioClient);

        // Initialize ElevenLabs service
        const elevenLabsConfig: ElevenLabsConfig = {
            apiKey: ELEVENLABS_API_KEY,
            agentId: this.callState.elevenLabsAgentId || ELEVENLABS_DEFAULT_AGENT_ID,
            voiceId: this.callState.elevenLabsVoiceId
        };
        this.elevenLabsService = new ElevenLabsWsService(elevenLabsConfig);

        // Initialize ElevenLabs event processor
        this.elevenLabsEventProcessor = new ElevenLabsEventService(
            this.callState,
            () => this.endCall(),
            (payload) => this.twilioStream.sendAudio(payload),
            () => this.twilioStream.sendMark(),
            () => this.handleInterruption()
        );

        // Initialize Twilio event processor
        this.twilioEventProcessor = new TwilioEventService(
            this.callState,
            this.twilioCallService,
            contextService,
            (payload) => this.sendAudioToElevenLabs(payload),
            () => this.startSession(),
            (digits) => this.injectDtmfNow(digits),
            (note) => this.injectAgentContext(note),
        );

        this.setupEventHandlers();
        // Don't connect to ElevenLabs yet - wait until we have the system prompt
        // This allows us to include the prompt in the init message for lower latency
    }

    public async endCall(): Promise<void> {
        // Prevent double-ending
        if (!this.callState.callSid || this.callEnding) {
            return;
        }
        this.callEnding = true;
        this.clearTimers();

        const callSid = this.callState.callSid;
        console.log(`[ElevenLabs Handler] Ending call ${callSid}`);

        // Save transcript before ending call
        const endTime = new Date();
        const duration = Math.floor((endTime.getTime() - this.callStartTime.getTime()) / 1000);

        // Update CallStateService and emit via Socket.IO
        const { CallStateService } = await import('../services/call-state.service.js');
        const { SocketService } = await import('../services/socket.service.js');
        const callStateService = CallStateService.getInstance();
        const socketService = SocketService.getInstance();

        // Get the full conversation history from CallStateService
        const activeCall = callStateService.getCall(callSid);
        const fullConversationHistory = activeCall?.conversationHistory || this.callState.conversationHistory;

        await this.transcriptService.saveTranscript({
            callSid: callSid,
            conversationHistory: fullConversationHistory,
            twilioEvents: this.callState.twilioEvents,
            openaiEvents: [], // legacy field, retained for schema compat; always empty post-Phase-3
            endedAt: endTime,
            duration: duration,
            status: 'completed'
        });

        callStateService.updateCallStatus(callSid, 'completed');
        socketService.emitCallStatusChanged(callSid, 'completed');

        // Clean up after a delay
        setTimeout(() => {
            callStateService.removeCall(callSid);
        }, 5000);

        this.twilioCallService.endCall(callSid);

        // Unregister session from session manager
        if (this.sessionManagerService) {
            this.sessionManagerService.unregisterSessionByCallSid(callSid);
        }

        // Clear callSid to prevent double-ending
        this.callState.callSid = '';

        setTimeout(() => {
            this.closeWebSockets();
        }, 5000);
    }

    private closeWebSockets(): void {
        this.twilioStream.close();
        this.elevenLabsService.close();
    }

    private initializeElevenLabs(): void {
        this.elevenLabsService.initialize({
            onAudio: (audioData) => {
                this.elevenLabsEventProcessor.handleAudio(audioData);
            },
            onUserTranscript: (text, isFinal) => {
                this.elevenLabsEventProcessor.handleUserTranscript(text, isFinal);
                if (isFinal) this.recordTurnTranscript(text, 'user');
            },
            onAgentTranscript: (text, isFinal) => {
                this.elevenLabsEventProcessor.handleAgentTranscript(text, isFinal);
                if (isFinal) this.recordTurnTranscript(text, 'agent');
            },
            onAgentResponseComplete: () => {
                // The agent finished its turn. If the last agent transcript matched
                // a goodbye phrase, end the call after the audio finishes playing.
                this.maybeEndOnGoodbye();
            },
            onInterruption: () => {
                this.elevenLabsEventProcessor.handleInterruption();
            },
            onError: (error) => {
                this.elevenLabsEventProcessor.handleError(error);
            },
            onClose: () => {
                this.elevenLabsEventProcessor.handleClose();
            },
            onToolCall: async (toolName, toolCallId, parameters) => {
                console.log(`[ElevenLabs Handler] Tool call: ${toolName}`, parameters);
                // Accept either `send_dtmf` (our client tool name) OR
                // `play_keypad_touch_tone` (ElevenLabs's system-tool name that
                // agents configured on the EL dashboard expect). In advanced
                // mode neither path goes through ElevenLabs's Twilio
                // integration, so we must generate DTMF audio ourselves.
                if (toolName === 'send_dtmf' || toolName === 'play_keypad_touch_tone') {
                    // Some agent configs surface the parameter as `digit`,
                    // others as `digits`. Accept both.
                    const digits = parameters.digits ?? parameters.digit;
                    if (!digits) return { result: 'No digits provided', isError: true };
                    try {
                        const { generateDtmfSequence, TWILIO_FRAME_MS } =
                            await import('../services/elevenlabs/audio.service.js');
                        const chunks = generateDtmfSequence(String(digits));
                        console.log(`[ElevenLabs Handler] Pacing ${chunks.length} DTMF chunks at ${TWILIO_FRAME_MS}ms for "${digits}" (via ${toolName})`);
                        await this.sendDtmfPaced(chunks, TWILIO_FRAME_MS);
                        console.log(`[ElevenLabs Handler] DTMF complete: ${digits}`);
                        return { result: `Successfully sent DTMF tones: ${digits}` };
                    } catch (error: any) {
                        console.error(`[ElevenLabs Handler] DTMF error:`, error);
                        return { result: `Failed to send DTMF: ${error.message}`, isError: true };
                    }
                }
                if (toolName === 'ask_operator') {
                    const question = String(parameters.question ?? '').trim();
                    if (!question) return { result: 'No question provided', isError: true };
                    const callSid = this.callState.callSid;
                    if (!callSid) return { result: 'No active call to ask about', isError: true };
                    try {
                        // Setting this fires call.awaiting_input to the controlling
                        // session immediately (see call-state.service.ts). The answer
                        // comes back through phony_inject_context, which reaches the
                        // agent as a contextual update on the live socket.
                        const { CallStateService } = await import('../services/call-state.service.js');
                        CallStateService.getInstance().setPendingContextRequest(callSid, question, 'agent');
                        console.log(`[ElevenLabs Handler] ask_operator on ${callSid}: ${question}`);
                        return {
                            // ⛔ WORDING IS THE FIX HERE. The first version said
                            // "keep the line warm", and the agent read that as
                            // licence to fill the silence — it invented a weather
                            // report ("sunny, 72 degrees"; it was 79 and not
                            // raining) and, on another question, deflected twice
                            // with "I don't have access to that" while the answer
                            // was already on its way. Both are worse than waiting.
                            // So: say what it must NOT do, and say that silence is
                            // the correct behaviour rather than a problem to solve.
                            result:
                                'Sent. Now WAIT. Do not answer the question — you do not have the answer yet. ' +
                                'Do not guess, estimate, or invent any part of it. Do not say you lack access to it. ' +
                                'Do not ask the question again. Say nothing further about it at all until a note arrives. ' +
                                'Silence on the line while you wait is normal and expected: do not ask if they are still ' +
                                'there, do not suggest the call is over, do not hang up. If they speak, respond to what ' +
                                'they say. If a note never arrives, say you will follow up after the call — never fill ' +
                                'the gap with an answer of your own.',
                        };
                    } catch (error: any) {
                        console.error('[ElevenLabs Handler] ask_operator error:', error);
                        // ⛔ Report the failure to the agent rather than returning a
                        // bland success. If it believes the question was sent when it
                        // was not, it will wait for an answer that can never arrive
                        // and the other party hears dead air.
                        return { result: `Could not reach the operator: ${error.message}. Do not wait for an answer.`, isError: true };
                    }
                }
                return { result: `Unknown tool: ${toolName}`, isError: true };
            },
            onReady: async (negotiatedAgentOutputFormat) => {
                console.log('[ElevenLabs Handler] ElevenLabs session ready');

                // Verify the negotiated format matches our pass-through expectation
                this.elevenLabsEventProcessor.verifyAudioFormat(negotiatedAgentOutputFormat);

                if (this.elevenLabsReady) {
                    console.log('[ElevenLabs Handler] Already initialized, skipping');
                    return;
                }

                if (this.needsInitialization) {
                    this.onElevenLabsSessionReady();
                    if (this.callState.conversationHistory && this.callState.conversationHistory.length > 0) {
                        console.log('[ElevenLabs Handler] Restoring conversation after initialization');
                    }
                }
            }
        });
    }

    /**
     * Send a sequence of DTMF audio chunks to Twilio, paced at `frameMs`
     * milliseconds per chunk to match Twilio's media frame cadence.
     * Prevents buffer overrun by spreading the chunks over wall-clock time
     * instead of dumping them as fast as possible.
     */
    private async sendDtmfPaced(chunks: string[], frameMs: number): Promise<void> {
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        for (const chunk of chunks) {
            this.twilioStream.sendAudio(chunk);
            await sleep(frameMs);
        }
    }

    /**
     * Inject DTMF tones into the active Twilio media stream. Used by the
     * scripted-DTMF IVR navigation path (Phase 3.2) — fires from a scheduled
     * setTimeout in TwilioEventService, independent of any agent turn.
     */
    public async injectDtmfNow(digits: string): Promise<void> {
        try {
            const { generateDtmfSequence, TWILIO_FRAME_MS } =
                await import('../services/elevenlabs/audio.service.js');
            const chunks = generateDtmfSequence(digits);
            console.log(`[ElevenLabs Handler] Scripted DTMF: "${digits}" → ${chunks.length} chunks at ${TWILIO_FRAME_MS}ms`);
            await this.sendDtmfPaced(chunks, TWILIO_FRAME_MS);
        } catch (err) {
            console.error('[ElevenLabs Handler] injectDtmfNow failed:', err);
        }
    }

    /**
     * Drop a contextual_update into the live ElevenLabs conversation. Used to
     * tell the agent about side-channel events (e.g. operator pressed a key
     * via scripted DTMF) so its LLM has accurate state.
     */
    public injectAgentContext(note: string): void {
        if (!this.elevenLabsService.isReady()) return;
        this.elevenLabsService.injectContext(note);
    }

    /**
     * Track the latest transcript per role so `agent_response_complete` can
     * decide whether the agent just said goodbye.
     */
    private lastUserText: string = '';
    private lastAgentText: string = '';
    private recordTurnTranscript(text: string, role: 'user' | 'agent'): void {
        if (role === 'user') this.lastUserText = text;
        else this.lastAgentText = text;
        // Also detect user goodbye immediately — the agent's response_complete
        // may not fire if the user hung up after saying goodbye.
        if (role === 'user' && this.isGoodbye(text)) {
            console.log(`[ElevenLabs Handler] User goodbye detected: "${text}"`);
            setTimeout(() => this.endCall(), 2000);
        }
    }

    /**
     * Called on `agent_response_complete` — the agent just finished its turn.
     * If the last thing it said matched a goodbye phrase, end the call after
     * a short delay (so the audio gets a chance to flush to Twilio).
     */
    private maybeEndOnGoodbye(): void {
        if (this.isGoodbye(this.lastAgentText)) {
            console.log(`[ElevenLabs Handler] Agent goodbye detected: "${this.lastAgentText}"`);
            setTimeout(() => this.endCall(), 2000);
        }
    }

    private isGoodbye(text: string): boolean {
        const lower = (text || '').toLowerCase();
        return GOODBYE_PHRASES.some(phrase => lower.includes(phrase));
    }

    /**
     * Initialize ElevenLabs session with call context
     * Called by Twilio event processor after receiving start event with instructions
     */
    public startSession(): void {
        console.log('[ElevenLabs Handler] Call context ready');
        this.callContextReady = true;

        if (this.elevenLabsService.isConnected()) {
            console.log('[ElevenLabs Handler] ElevenLabs connected, will initialize');
        } else {
            console.log('[ElevenLabs Handler] Waiting for ElevenLabs WebSocket to connect');
        }
    }

    /**
     * Actually perform the session initialization.
     * Connects to ElevenLabs with the system prompt ready so it can be
     * included in the conversation_config_override for lowest latency.
     */
    private doStartSession(): void {
        const isIncoming = this.callState.callType === CallType.INBOUND;
        console.log('[ElevenLabs Handler] Starting ElevenLabs session with context:', this.callState.callContext.substring(0, 100) + '...');
        console.log('[ElevenLabs Handler] Call type:', this.callState.callType, '(incoming:', isIncoming, ')');

        // Queue the system prompt + first message on the ElevenLabs service BEFORE connecting
        // so they will be included in conversation_config_override on init. The
        // first_message tells the agent what to say when the call connects —
        // without it, the agent waits indefinitely for the human to speak first,
        // which is fatal on IVR phone trees (no natural turn-end signal).
        this.elevenLabsService.initializeConversation(
            this.callState.callContext,
            {
                call_type: isIncoming ? 'incoming' : 'outgoing',
                from_number: this.callState.fromNumber,
                to_number: this.callState.toNumber
            },
            this.callState.elevenLabsVoiceId,
            // ⛔ ONLY THE OPENING PARAGRAPH. `first_message` is spoken verbatim,
            // and callInstructions typically continues with directions meant for
            // the agent, not the person answering. Passing the whole block also
            // recorded every word of it as an `assistant` transcript line, so the
            // controlling agent saw instructions rendered as things the AI had
            // said out loud — measured on the 2026-08-27 test call. The full text
            // still reaches the agent: context.service.ts already appends it to
            // the system prompt under "SPECIFIC INSTRUCTIONS FOR THIS CALL".
            firstParagraph(this.callState.callInstructions),
        );

        if (!this.elevenLabsService.isConnected()) {
            // Connect now - the prompt will be sent with the init message
            console.log('[ElevenLabs Handler] Connecting to ElevenLabs with prompt ready');
            this.needsInitialization = true;
            this.initializeElevenLabs();
            return;
        }

        // Already connected (shouldn't happen in normal flow)
        this.onElevenLabsSessionReady();
    }

    /**
     * Called when ElevenLabs session is ready (after connection + init)
     */
    private onElevenLabsSessionReady(): void {
        // Mark ElevenLabs as ready and flush any buffered audio
        console.log('[ElevenLabs Handler] ElevenLabs session ready, flushing', this.audioBuffer.length, 'buffered audio packets');
        this.elevenLabsReady = true;
        this.needsInitialization = false;
        this.flushAudioBuffer();

        // Start safety timer to prevent zombie calls
        this.startMaxDurationTimer();

        // Persist the ElevenLabs conversation_id on the Call row for outbound
        // calls so the post-call webhook can link the transcript back to the
        // right row. Best-effort, non-blocking.
        const conversationId = this.elevenLabsService.getConversationId();
        const callSid = this.callState.callSid;
        if (conversationId && callSid) {
            (async () => {
                try {
                    const { CallModel } = await import('../models/call.model.js');
                    await CallModel.updateOne(
                        { callSid },
                        { $set: { elevenLabsConversationId: conversationId, callMode: 'advanced' } },
                    );
                    console.log(`[ElevenLabs Handler] Linked call ${callSid} → conv ${conversationId}`);
                } catch (e) {
                    console.error('[ElevenLabs Handler] Failed to link call → conv:', e);
                }
            })();
        }
    }

    private sendAudioToElevenLabs(payload: string): void {
        if (this.elevenLabsReady) {
            // ElevenLabs is ready, send immediately
            this.elevenLabsService.sendAudio(payload);
        } else {
            // Buffer audio until ElevenLabs is ready
            this.audioBuffer.push(payload);
            if (this.audioBuffer.length === 1) {
                console.log('[ElevenLabs Handler] Buffering audio until ElevenLabs is ready...');
            }
        }
    }

    private flushAudioBuffer(): void {
        while (this.audioBuffer.length > 0) {
            const audioPayload = this.audioBuffer.shift();
            if (audioPayload) {
                this.elevenLabsService.sendAudio(audioPayload);
            }
        }
    }

    private handleInterruption(): void {
        console.log('[ElevenLabs Handler] Handling interruption');
        // Clear Twilio stream to stop playing audio
        this.twilioStream.clearStream();
        // Reset response state
        this.callState.markQueue = [];
        this.callState.lastAssistantItemId = null;
        this.callState.responseStartTimestampTwilio = null;
    }

    /**
     * Start max duration safety timer to prevent zombie calls
     */
    private startMaxDurationTimer(): void {
        const maxDuration = this.callState.callType === CallType.INBOUND
            ? MAX_INCOMING_CALL_DURATION
            : MAX_OUTGOING_CALL_DURATION;

        console.log(`[ElevenLabs Handler] Max call duration timer set: ${maxDuration}s`);
        this.maxDurationTimer = setTimeout(() => {
            console.log(`[ElevenLabs Handler] Max call duration (${maxDuration}s) reached - ending call`);
            this.endCall();
        }, maxDuration * 1000);
    }

    private clearTimers(): void {
        if (this.maxDurationTimer) {
            clearTimeout(this.maxDurationTimer);
            this.maxDurationTimer = null;
        }
    }

    /**
     * Inject context into the active call conversation
     * @param context The context/instructions to inject
     * @param conversationHistory The full conversation history
     */
    public injectContext(context: string, conversationHistory: any[]): void {
        console.log('[ElevenLabs Handler] Injecting context into call:', context.substring(0, 50) + '...');

        // Create a summary of the conversation
        const conversationSummary = conversationHistory
            .filter(msg => msg.role !== 'system')
            .map((msg, idx) => {
                const contentPreview = msg.content.substring(0, 100);
                return `${idx + 1}. ${msg.role.toUpperCase()}: ${contentPreview}${msg.content.length > 100 ? '...' : ''}`;
            })
            .join('\n');

        console.log('[ElevenLabs Handler] Conversation summary:\n', conversationSummary);

        // Use ElevenLabs contextual_update to inject context.
        //
        // ⛔ The framing matters as much as the content. Labelled only
        // "OPERATOR INSTRUCTION", the agent read notes out to the person on the
        // phone verbatim — announcing that "my request reached the operator
        // within a second" and, later, "the operator looked it up for me".
        // Whoever we called should never hear about operators, tools or round
        // trips; they asked a question and want an answer. Measured on the
        // 2026-08-27 test calls.
        //
        // It also re-delivered older notes on subsequent turns, apologising for
        // the same mistake three times until Ben told it to stop — hence the
        // instruction to use a note once and then let it go.
        const PRIVATE_NOTE_RULES = [
            'PRIVATE NOTE — the person on the call CANNOT see this and must never hear it read out.',
            'Use the information naturally, in your own words, as part of the conversation.',
            'Do NOT quote this note, do NOT mention an operator, a system, a tool, a lookup or a delay, and do NOT explain how you came by the information.',
            'Use it ONCE. Do not repeat it on later turns, and do not re-apologise for something you have already addressed.',
        ].join(' ');

        const fullContext = conversationSummary
            ? `${PRIVATE_NOTE_RULES}\n\n${context}\n\nCONVERSATION SUMMARY:\n${conversationSummary}`
            : `${PRIVATE_NOTE_RULES}\n\n${context}`;

        this.elevenLabsService.injectContext(fullContext);
    }

    public getCallSid(): string {
        return this.callState.callSid;
    }

    private setupEventHandlers(): void {
        this.twilioStream.setupEventHandlers(
            async (message) => {
                const prevCallSid = this.callState.callSid;
                await this.twilioEventProcessor.processMessage(message);

                // If callSid was just set (from Twilio start event), handle call record
                // Guard against double-initialization (e.g., if processMessage triggers twice)
                if (!prevCallSid && this.callState.callSid && !this.sessionInitialized) {
                    this.sessionInitialized = true;

                    // Check if call already exists (resume from hold scenario)
                    const existingCall = await this.transcriptService.getCall(this.callState.callSid);

                    if (!existingCall) {
                        // New call - create record
                        await this.transcriptService.createCall({
                            callSid: this.callState.callSid,
                            fromNumber: this.callState.fromNumber,
                            toNumber: this.callState.toNumber,
                            callType: this.callState.callType,
                            voiceProvider: 'elevenlabs',
                            elevenLabsAgentId: this.callState.elevenLabsAgentId,
                            elevenLabsVoiceId: this.callState.elevenLabsVoiceId,
                            callContext: this.callState.callContext,
                            systemInstructions: this.callState.systemInstructions,
                            callInstructions: this.callState.callInstructions
                        });

                        // Mark call as in-progress
                        await this.transcriptService.markCallInProgress(this.callState.callSid);

                        // New call - initialize session with base context
                        if (!this.elevenLabsReady) {
                            console.log('[ElevenLabs Handler] New call - initializing ElevenLabs session');
                            this.doStartSession();
                        } else {
                            console.log('[ElevenLabs Handler] Session already initialized');
                        }
                    } else {
                        // Resume from hold - restore conversation history
                        console.log('[ElevenLabs Handler] Resuming existing call, restoring conversation history');
                        this.callState.conversationHistory = existingCall.conversationHistory || [];

                        // Initialize session first with base context
                        if (!this.elevenLabsReady) {
                            console.log('[ElevenLabs Handler] Initializing ElevenLabs session before restoring conversation');
                            this.doStartSession();

                            // Inject conversation context
                            if (this.callState.conversationHistory.length > 0) {
                                this.injectContext('Resuming call from hold. Continue the conversation naturally.', this.callState.conversationHistory);
                            }
                        }
                    }

                    // Register this session with the session manager
                    if (this.sessionManagerService) {
                        this.sessionManagerService.registerSessionByCallSid(this.callState.callSid, this);
                    }
                }
            },
            async () => {
                // WebSocket closed - check if it's intentional (hold) or natural ending
                console.log('[ElevenLabs Handler] Twilio websocket closed');

                // Check if the call is on hold
                if (this.callState.callSid) {
                    const { CallStateService } = await import('../services/call-state.service.js');
                    const callStateService = CallStateService.getInstance();
                    const call = callStateService.getCall(this.callState.callSid);

                    if (call && call.status === 'on_hold') {
                        console.log('[ElevenLabs Handler] Call is on hold, not ending');
                        return;
                    }
                }

                // Otherwise, this is a natural ending
                console.log('[ElevenLabs Handler] Ending call');
                await this.endCall();
            }
        );
    }
}
