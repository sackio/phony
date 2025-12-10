import { MCPPromptDefinition, MCPPromptHandler, MCPPromptExecuteResponse } from '../types.js';

/**
 * Workflow Prompts
 * Guided multi-step interactions for common tasks
 */

export const promptDefinitions: MCPPromptDefinition[] = [
    {
        name: 'make_call',
        description: 'Guide user through creating an outbound call with context selection',
        arguments: [
            {
                name: 'toNumber',
                description: 'Phone number to call',
                required: true
            }
        ]
    },
    {
        name: 'setup_incoming_number',
        description: 'Guide user through configuring a phone number for incoming calls',
        arguments: [
            {
                name: 'phoneNumber',
                description: 'Phone number to configure',
                required: false
            }
        ]
    },
    {
        name: 'monitor_call',
        description: 'Monitor an active call with real-time transcript and controls',
        arguments: [
            {
                name: 'callSid',
                description: 'Call SID to monitor',
                required: true
            }
        ]
    }
];

/**
 * Prompt Handlers
 * Note: These are simplified implementations
 * In a full implementation, these would provide interactive workflows
 */

export const promptHandlers: Record<string, MCPPromptHandler> = {
    make_call: async (args): Promise<MCPPromptExecuteResponse> => {
        const toNumber = args.toNumber || '';

        return {
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `I want to make a call to ${toNumber}`
                    }
                },
                {
                    role: 'assistant',
                    content: {
                        type: 'text',
                        text: `To make a call, use the phony_create_call tool with:
- toNumber: ${toNumber}
- systemInstructions: Define the AI assistant's role and behavior
- callInstructions: Specific instructions for this call
- voice: Choose from alloy, echo, fable, onyx, nova, or shimmer

You can also use phony_list_contexts to find pre-configured contexts to use.

Example:
phony_create_call({
  toNumber: "${toNumber}",
  systemInstructions: "You are a helpful assistant...",
  callInstructions: "Call to discuss project status",
  voice: "alloy"
})`
                    }
                }
            ]
        };
    },

    setup_incoming_number: async (args): Promise<MCPPromptExecuteResponse> => {
        const phoneNumber = args.phoneNumber || '[phone number]';

        return {
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `I want to configure incoming calls${phoneNumber !== '[phone number]' ? ` for ${phoneNumber}` : ''}`
                    }
                },
                {
                    role: 'assistant',
                    content: {
                        type: 'text',
                        text: `To configure incoming calls:

1. First, list available numbers:
   phony_list_available_numbers()

2. Create a context template (optional):
   phony_create_context({
     name: "Customer Support",
     systemInstructions: "You are a helpful customer support agent...",
     contextType: "incoming"
   })

3. Configure the phone number:
   phony_create_incoming_config({
     phoneNumber: "${phoneNumber}",
     name: "Customer Support Line",
     systemInstructions: "You are a helpful agent...",
     callInstructions: "Handle customer inquiries professionally",
     voice: "alloy",
     enabled: true
   })

The phone number will now answer incoming calls with the configured AI assistant.`
                    }
                }
            ]
        };
    },

    monitor_call: async (args): Promise<MCPPromptExecuteResponse> => {
        const callSid = args.callSid || '[call SID]';

        return {
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `I want to monitor call ${callSid}`
                    }
                },
                {
                    role: 'assistant',
                    content: {
                        type: 'text',
                        text: `To monitor an active call:

1. Get call details and transcript:
   phony_get_call({ callSid: "${callSid}" })

2. Get real-time transcript:
   phony_get_call_transcript({ callSid: "${callSid}" })

3. Control the call:
   - Put on hold: phony_hold_call({ callSid: "${callSid}" })
   - Resume: phony_resume_call({ callSid: "${callSid}" })
   - End call: phony_hangup_call({ callSid: "${callSid}" })

4. Inject additional instructions mid-call:
   phony_inject_context({
     callSid: "${callSid}",
     context: "New instructions or information for the AI"
   })

5. View debug logs:
   phony_get_call_events({ callSid: "${callSid}", eventType: "all" })

You can also use the resource URI call://${callSid}/transcript for live updates.`
                    }
                }
            ]
        };
    }
};

/**
 * Get prompt definition by name
 */
export function getPromptDefinition(name: string): MCPPromptDefinition | undefined {
    return promptDefinitions.find(p => p.name === name);
}

/**
 * Get prompt handler by name
 */
export function getPromptHandler(name: string): MCPPromptHandler | undefined {
    return promptHandlers[name];
}
