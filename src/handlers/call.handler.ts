/**
 * Common interface for call handlers.
 * The ElevenLabs handler is the only implementation post-Phase-3 cleanup.
 * Kept abstract so a future second provider (or the native bridge) can plug in
 * via the same shape — but as of now there is no second concrete implementation.
 */
export interface ICallHandler {
    /**
     * Inject context into the active call conversation
     * @param context The context/instructions to inject
     * @param conversationHistory The full conversation history
     */
    injectContext(context: string, conversationHistory: any[]): void;

    /**
     * End the call and clean up resources
     */
    endCall(): Promise<void>;

    /**
     * Get the Twilio call SID
     */
    getCallSid(): string;

    /**
     * Start the voice provider session
     * Called after Twilio start event provides call context
     */
    startSession(): void;

    /**
     * Write DTMF tones into the live Twilio media stream as in-band audio.
     *
     * ⛔ This is the ONLY safe way to send DTMF on a call that has a media
     * stream. The Twilio REST alternative (`calls.update({twiml})`) redirects
     * the call off the stream and is destructive — see TwilioService.sendDTMF.
     *
     * ⚠️ Resolving does NOT mean the far end registered the tones. It means we
     * wrote audio into the stream; whether a given IVR decodes it is not
     * observable from here.
     */
    injectDtmfNow(digits: string): Promise<void>;
}
