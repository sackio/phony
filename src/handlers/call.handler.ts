/**
 * Common interface for call handlers (OpenAI and ElevenLabs)
 * This allows the session manager to work with any voice provider
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
