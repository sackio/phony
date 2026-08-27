import { CallState, ConversationMessage } from '../../types.js';
import { SocketService } from '../socket.service.js';
import { CallStateService } from '../call-state.service.js';
import { CallEventPushService } from '../call-event-push.service.js';

/**
 * Service for processing ElevenLabs events and managing conversation state.
 *
 * Audio chain (post-Phase-1 with adaptive fallback):
 *   - INBOUND (Twilio → ElevenLabs): always pass-through (Twilio µ-law payload
 *     is forwarded verbatim as user_audio_chunk). ElevenLabs accepts ulaw_8000
 *     input per the Phase 0 dashboard config.
 *   - OUTBOUND (ElevenLabs → Twilio): adaptive — if the negotiated agent output
 *     format is `ulaw_8000` we pass through. If it's `pcm_16000` (which we
 *     observed at runtime despite asking for ulaw_8000 in the init override),
 *     we convert PCM 16kHz → µ-law 8kHz before forwarding to Twilio.
 *     The conversion adds ~5-10ms per chunk on this hardware — still well under
 *     the original 40ms+ from the pre-Phase-1 double-conversion path.
 */
export class ElevenLabsEventService {
    private callState: CallState;
    private onEndCall: () => Promise<void>;
    private sendAudioToTwilio: (payload: string) => void;
    private sendMarkToTwilio: () => void;
    private onInterruption: () => void;
    private agentOutputFormat: string = 'ulaw_8000';

    constructor(
        callState: CallState,
        onEndCall: () => Promise<void>,
        sendAudioToTwilio: (payload: string) => void,
        sendMarkToTwilio: () => void,
        onInterruption: () => void
    ) {
        this.callState = callState;
        this.onEndCall = onEndCall;
        this.sendAudioToTwilio = sendAudioToTwilio;
        this.sendMarkToTwilio = sendMarkToTwilio;
        this.onInterruption = onInterruption;
    }

    /**
     * Record the agent's negotiated output format. Used to decide whether
     * outbound audio needs PCM → µ-law conversion before reaching Twilio.
     */
    public verifyAudioFormat(format: string): void {
        this.agentOutputFormat = format || 'ulaw_8000';
        if (this.agentOutputFormat !== 'ulaw_8000') {
            console.log(
                `[ElevenLabs Event] Agent output is "${this.agentOutputFormat}" — enabling adaptive PCM→µ-law conversion on the outbound path.`
            );
        }
    }

    /**
     * Forward an audio chunk from ElevenLabs to Twilio.
     * Pass-through when both ends agree on ulaw_8000; convert PCM 16kHz → µ-law
     * 8kHz when the agent insists on pcm_16000 (typical with the current
     * ElevenLabs Flash 2.5 default).
     */
    public handleAudio(audioBase64: string): void {
        if (this.callState.responseStartTimestampTwilio === null) {
            this.callState.responseStartTimestampTwilio = this.callState.latestMediaTimestamp;
            console.log('[ElevenLabs Event] Response started at timestamp:', this.callState.responseStartTimestampTwilio);
        }

        if (this.agentOutputFormat === 'pcm_16000') {
            const pcm = Buffer.from(audioBase64, 'base64');
            const ulaw = pcm16kToUlaw8k(pcm);
            this.sendAudioToTwilio(ulaw.toString('base64'));
        } else {
            // ulaw_8000 (pass-through) or unknown format — best-effort forward
            this.sendAudioToTwilio(audioBase64);
        }
    }

    /**
     * Handle user transcript from ElevenLabs
     */
    public handleUserTranscript(text: string, isFinal: boolean): void {
        if (!text.trim()) return;

        console.log(`[ElevenLabs Event] User transcript (${isFinal ? 'final' : 'partial'}):`, text);

        // Emit transcript update via Socket.IO
        const socketService = SocketService.getInstance();
        if (this.callState.callSid) {
            socketService.emitTranscriptUpdate(this.callState.callSid, {
                speaker: 'user',
                text: text,
                timestamp: new Date(),
                isPartial: !isFinal
            });
        }

        // Only add final transcripts to conversation history
        if (isFinal) {
            const message: ConversationMessage = {
                role: 'user',
                content: text
            };
            this.callState.addToConversation(message);

            // Also update CallStateService
            const callStateService = CallStateService.getInstance();
            if (this.callState.callSid) {
                callStateService.addTranscript(this.callState.callSid, {
                    role: 'user',
                    content: text,
                    timestamp: new Date()
                });
                // Queue for the next digest to the controlling agent session.
                // Finals only — partials would triple the volume and change
                // under the reader.
                CallEventPushService.getInstance()
                    .recordLine(this.callState.callSid, 'user', text);
            }
        }
    }

    /**
     * Handle agent response from ElevenLabs
     */
    public handleAgentTranscript(text: string, isFinal: boolean): void {
        if (!text.trim()) return;

        console.log(`[ElevenLabs Event] Agent response (${isFinal ? 'final' : 'partial'}):`, text);

        // Mark assistant as speaking
        this.callState.speaking = true;

        // Emit transcript update via Socket.IO
        const socketService = SocketService.getInstance();
        if (this.callState.callSid) {
            socketService.emitTranscriptUpdate(this.callState.callSid, {
                speaker: 'assistant',
                text: text,
                timestamp: new Date(),
                isPartial: !isFinal
            });
        }

        // Add to conversation history (for final transcripts)
        if (isFinal) {
            const message: ConversationMessage = {
                role: 'assistant',
                content: text
            };
            this.callState.addToConversation(message);

            // Also update CallStateService
            const callStateService = CallStateService.getInstance();
            if (this.callState.callSid) {
                callStateService.addTranscript(this.callState.callSid, {
                    role: 'assistant',
                    content: text,
                    timestamp: new Date()
                });
                CallEventPushService.getInstance()
                    .recordLine(this.callState.callSid, 'assistant', text);
            }

            // Reset speaking state
            this.callState.speaking = false;

            // Send mark to track audio playback
            this.sendMarkToTwilio();
        }
    }

    /**
     * Handle interruption from ElevenLabs
     */
    public handleInterruption(): void {
        console.log('[ElevenLabs Event] Interruption detected');

        // Reset response state
        this.callState.responseStartTimestampTwilio = null;
        this.callState.speaking = false;
        this.callState.markQueue = [];

        // Emit interruption marker via Socket.IO
        const socketService = SocketService.getInstance();
        if (this.callState.callSid) {
            socketService.emitTranscriptUpdate(this.callState.callSid, {
                speaker: 'system',
                text: '(Assistant interrupted by user)',
                timestamp: new Date(),
                isPartial: false,
                isInterruption: true
            });
        }

        // Notify handler to clear Twilio stream
        this.onInterruption();
    }

    /**
     * Handle session ready event
     */
    public handleSessionReady(): void {
        console.log('[ElevenLabs Event] Session ready');

        // Update call status
        const callStateService = CallStateService.getInstance();
        if (this.callState.callSid) {
            callStateService.updateCallStatus(this.callState.callSid, 'active');

            const socketService = SocketService.getInstance();
            socketService.emitCallStatusChanged(this.callState.callSid, 'active');
        }
    }

    /**
     * Handle error from ElevenLabs
     */
    public handleError(error: Error): void {
        console.error('[ElevenLabs Event] Error:', error.message);

        // Emit error via Socket.IO
        const socketService = SocketService.getInstance();
        if (this.callState.callSid) {
            socketService.emitTranscriptUpdate(this.callState.callSid, {
                speaker: 'system',
                text: `Error: ${error.message}`,
                timestamp: new Date(),
                isPartial: false
            });
        }
    }

    /**
     * Handle connection close from ElevenLabs
     */
    public handleClose(): void {
        console.log('[ElevenLabs Event] Connection closed');

        // End the call
        this.onEndCall();
    }

    /**
     * Log an ElevenLabs event (for debugging)
     */
    public logEvent(type: string, data: any): void {
        this.callState.logTwilioEvent(type, data);
    }
}

/**
 * Convert PCM 16-bit linear 16kHz audio → µ-law 8kHz, both mono.
 * Downsample by dropping every other sample, then µ-law encode each int16.
 * Used only when the ElevenLabs agent outputs `pcm_16000` despite our request
 * for `ulaw_8000`.
 */
function pcm16kToUlaw8k(pcm: Buffer): Buffer {
    const inSamples = Math.floor(pcm.length / 2);
    const outSamples = Math.floor(inSamples / 2);
    const out = Buffer.alloc(outSamples);
    for (let i = 0; i < outSamples; i++) {
        const sample = pcm.readInt16LE(i * 4);
        out[i] = linearToUlaw(sample);
    }
    return out;
}

function linearToUlaw(sample: number): number {
    const BIAS = 0x84;
    const CLIP = 32635;
    const sign = sample < 0 ? 0x80 : 0;
    if (sample < 0) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;
    let exponent = 7;
    let mask = 0x4000;
    while ((sample & mask) === 0 && exponent > 0) {
        exponent--;
        mask >>= 1;
    }
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    return ~(sign | (exponent << 4) | mantissa) & 0xff;
}
