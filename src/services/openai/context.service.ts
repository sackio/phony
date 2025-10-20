import { CallState, ConversationMessage } from '../../types.js';

export class OpenAIContextService {

    public initializeCallState(callState: CallState, fromNumber: string, toNumber: string): void {
        callState.fromNumber = fromNumber;
        callState.toNumber = toNumber;
    }

    /**
     * Setup call context with custom system instructions and optional call-specific instructions
     * @param callState The call state
     * @param systemInstructions The base system instructions defining role and behavior
     * @param callInstructions Optional call-specific context/instructions (for outgoing calls)
     */
    public setupCallContext(callState: CallState, systemInstructions: string, callInstructions: string): void {
        // Store the original instructions for database logging
        callState.systemInstructions = systemInstructions;
        callState.callInstructions = callInstructions;

        // Build the full system prompt
        let fullSystemInstructions = systemInstructions;

        // For outgoing calls with specific instructions, append them to system context
        if (callInstructions && callInstructions.trim()) {
            fullSystemInstructions += '\n\n=== SPECIFIC INSTRUCTIONS FOR THIS CALL ===\n' + callInstructions;
            console.log('[Context Service] Added call-specific instructions');
        }

        callState.callContext = fullSystemInstructions;
        callState.initialMessage = ''; // AI will decide what to say based on instructions

        const systemMessage: ConversationMessage = {
            role: 'system',
            content: fullSystemInstructions
        };

        callState.conversationHistory = [systemMessage];

        console.log('[Context Service] Call context initialized');
        console.log('[Context Service] System instructions length:', systemInstructions.length);
        if (callInstructions) {
            console.log('[Context Service] Call instructions length:', callInstructions.length);
        }
    }

}
