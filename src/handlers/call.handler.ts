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
}
