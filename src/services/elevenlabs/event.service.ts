import { CallState, ConversationMessage } from '../../types.js';
import { SocketService } from '../socket.service.js';
import { CallStateService } from '../call-state.service.js';
import { pcmToUlaw, audioToBase64, base64ToAudio } from './audio.service.js';

/**
 * Service for processing ElevenLabs events and managing conversation state
 */
export class ElevenLabsEventService {
    private callState: CallState;
    private onEndCall: () => Promise<void>;
    private sendAudioToTwilio: (payload: string) => void;
    private sendMarkToTwilio: () => void;
    private onInterruption: () => void;
    private audioOutputFormat: string = 'ulaw_8000';

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
     * Set the audio output format from the agent metadata
     */
    public setAudioOutputFormat(format: string): void {
        this.audioOutputFormat = format;
        console.log('[ElevenLabs Event] Audio output format set to:', format);
    }

    /**
     * Handle audio chunk from ElevenLabs
     * Converts PCM to µ-law if agent outputs PCM format
     */
    public handleAudio(audioBase64: string): void {
        // Track response timing
        if (this.callState.responseStartTimestampTwilio === null) {
            this.callState.responseStartTimestampTwilio = this.callState.latestMediaTimestamp;
            console.log('[ElevenLabs Event] Response started at timestamp:', this.callState.responseStartTimestampTwilio);
        }

        // Convert PCM to µ-law if needed (Twilio requires µ-law 8kHz)
        if (this.audioOutputFormat === 'pcm_16000') {
            const pcmBuffer = base64ToAudio(audioBase64);
            const ulawBuffer = pcmToUlaw(pcmBuffer, 16000);
            const ulawBase64 = audioToBase64(ulawBuffer);
            this.sendAudioToTwilio(ulawBase64);
        } else {
            // Already in µ-law format, send directly
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
