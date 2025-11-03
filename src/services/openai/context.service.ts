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

        // For incoming calls, add instruction for proper greeting behavior
        if (callState.callType === 'inbound') {
            fullSystemInstructions += '\n\n=== INCOMING CALL GREETING PROTOCOL ===\nThis is an INCOMING call - someone is calling YOU.\n\nWhen the call connects:\n1. Greet the caller with a SHORT, simple greeting (e.g., "Hello, how can I help you?" or "Hi, thanks for calling.")\n2. STOP talking after your brief greeting\n3. WAIT and LISTEN for the caller to respond\n4. Let the caller explain why they called\n5. Only after hearing their response, engage in the conversation\n\nIMPORTANT: Keep your initial greeting to ONE short sentence. Do not launch into explanations or additional information. Just greet and wait.';
            console.log('[Context Service] Added incoming call behavior: brief greeting then wait');
        }

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
