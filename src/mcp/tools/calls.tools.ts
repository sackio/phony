import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, validateArgs, sanitizePhoneNumber } from '../utils.js';
import { CallTranscriptService } from '../../services/database/call-transcript.service.js';
import { TwilioCallService } from '../../services/twilio/call.service.js';
import { CallStateService } from '../../services/call-state.service.js';
import { SessionManagerService } from '../../services/session-manager.service.js';

/**
 * Call Management Tools
 */

export const callToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_create_call',
        description: 'Create an outbound phone call with ElevenLabs AI voice assistant. The AI agent can navigate IVR menus and press phone buttons automatically using its built-in send_dtmf tool - just include instructions like "press 1 for English" or "navigate the phone menu" in the systemInstructions.',
        inputSchema: {
            type: 'object',
            properties: {
                toNumber: {
                    type: 'string',
                    description: 'Phone number to call in E.164 format (e.g., +12125551234)'
                },
                systemInstructions: {
                    type: 'string',
                    description: 'Base system instructions defining the AI assistant role and behavior'
                },
                callInstructions: {
                    type: 'string',
                    description: 'Specific instructions for this particular call'
                },
                elevenLabsAgentId: {
                    type: 'string',
                    description: 'ElevenLabs agent ID (uses default if not specified)'
                },
                elevenLabsVoiceId: {
                    type: 'string',
                    description: 'ElevenLabs voice ID. Choose natural, conversational voices - avoid dramatic/performative ones. RECOMMENDED Natural Female: Sarah (EXAVITQu4vr4xnSDxMaL, professional), Alice (Xb7hH8MSUJpSbSDYk0k2, professional), Rachel (21m00Tcm4TlvDq8ikWAM, warm narrative), Nicole (piTKgcLEGmPE4e6mEKli, natural). RECOMMENDED Natural Male: Chris (iP95p4xoKVk53GoZ742B, conversational), Charlie (IKne3meq5aSn9XLyUdCD, conversational), Dave (CYw3kZ02Hs0563khs1Fj, casual), Daniel (onwK4e9ZLuTAKqWW03F9, professional), James (ZQe5CZNOzWyzPSCn5a3c, authoritative). Other options - Female: Matilda (XrExE9yKIg1WjnnlVkGX), Lily (pFZP5JQG7iQjIQuC4Bku), Grace (oWAxZDx7w5VEj9dCyTzz), Freya (jsCqWAovK2LkecY7zXl4). Male: Brian (nPczCjzI2devNBz1zQrb), Bill (pqHfZKP75CvOlQylNhV4), Adam (pNInz6obpgDQGcFmaJgB), Drew (29vD33N1CtxCmqQRPOHJ). AVOID dramatic voices: Charlotte, Arnold, Callum, Clyde, Fin, Gigi, Glinda, Harry, Jessie, Mimi, Patrick.'
                }
            },
            required: ['toNumber', 'systemInstructions', 'callInstructions']
        }
    },
    {
        name: 'phony_list_calls',
        description: 'List call history with optional filtering',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Maximum number of calls to return (default: 50)'
                },
                status: {
                    type: 'string',
                    description: 'Filter by status',
                    enum: ['initiated', 'in-progress', 'completed', 'failed', 'on_hold', 'active']
                },
                callType: {
                    type: 'string',
                    description: 'Filter by call type',
                    enum: ['inbound', 'outbound']
                }
            }
        }
    },
    {
        name: 'phony_get_call',
        description: 'Get detailed information about a specific call including transcript and events',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID (e.g., CA1234567890abcdef)'
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_hold_call',
        description: 'Put an active call on hold',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_resume_call',
        description: 'Resume a call that is on hold',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_hangup_call',
        description: 'End an active call',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_inject_context',
        description: 'Inject additional instructions/context into an active call',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                },
                context: {
                    type: 'string',
                    description: 'Instructions or context to inject into the conversation'
                }
            },
            required: ['callSid', 'context']
        }
    },
    {
        name: 'phony_request_operator_context',
        description: 'Put the call on hold and request additional context from the human operator. The call will remain on hold until the operator provides the requested information.',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                },
                question: {
                    type: 'string',
                    description: 'The question or request for the operator. Be specific about what information you need. Example: "What is the customer\'s account balance?" or "Does the customer have any pending orders?"'
                }
            },
            required: ['callSid', 'question']
        }
    },
    {
        name: 'phony_send_dtmf',
        description: 'Send DTMF (phone keypad) tones to an active call. Useful for navigating IVR menus, entering codes, or pressing phone buttons.',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                },
                digits: {
                    type: 'string',
                    description: 'DTMF digits to send. Can include: 0-9, *, #, A-D. Use \'w\' for 0.5s pause, \'W\' for 1s pause. Example: "1", "123#", "1w2w3", "*9#"'
                }
            },
            required: ['callSid', 'digits']
        }
    },
    {
        name: 'phony_get_call_transcript',
        description: 'Get the conversation transcript for a call',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_emergency_shutdown',
        description: 'EMERGENCY: Terminate ALL active calls immediately. Use this as a safety measure if calls are running uncontrolled or consuming excessive credits.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    }
];

/**
 * Create tool handlers
 */
export function createCallToolHandlers(
    transcriptService: CallTranscriptService,
    twilioService: TwilioCallService,
    sessionManager: SessionManagerService
): Record<string, MCPToolHandler> {
    return {
        phony_create_call: async (args) => {
            try {
                validateArgs(args, ['toNumber', 'systemInstructions', 'callInstructions']);

                const toNumber = sanitizePhoneNumber(args.toNumber);
                const fromNumber = process.env.TWILIO_NUMBER || '';

                // Create call via Twilio (ElevenLabs provider)
                const result = await twilioService.makeOutboundCall(
                    toNumber,
                    args.systemInstructions,
                    args.callInstructions,
                    args.elevenLabsAgentId,
                    args.elevenLabsVoiceId
                );

                // Register in CallStateService so mid-call tools (hold, inject, DTMF) work
                const callStateService = CallStateService.getInstance();
                callStateService.addCall(result.sid, {
                    callSid: result.sid,
                    twilioCallSid: result.sid,
                    toNumber: toNumber,
                    fromNumber: fromNumber,
                    callType: 'outgoing',
                    voiceProvider: 'elevenlabs',
                    elevenLabsAgentId: args.elevenLabsAgentId,
                    elevenLabsVoiceId: args.elevenLabsVoiceId,
                    status: 'initiated',
                    startedAt: new Date(),
                    conversationHistory: []
                });

                // Start auto-hangup safety timer
                callStateService.startDurationTimer(result.sid);

                return createToolResponse({
                    callSid: result.sid,
                    status: result.status,
                    provider: 'elevenlabs',
                    message: `Call initiated to ${toNumber} using ElevenLabs voice provider`
                });
            } catch (error: any) {
                return createToolError('Failed to create call', { message: error.message });
            }
        },

        phony_list_calls: async (args) => {
            try {
                const limit = args.limit || 50;
                let calls = await transcriptService.getRecentCalls(limit);

                // Apply filters
                if (args.status) {
                    calls = calls.filter(call => call.status === args.status);
                }
                if (args.callType) {
                    calls = calls.filter(call => call.callType === args.callType);
                }

                return createToolResponse({
                    calls: calls.map(call => ({
                        callSid: call.callSid,
                        fromNumber: call.fromNumber,
                        toNumber: call.toNumber,
                        callType: call.callType,
                        status: call.status,
                        startedAt: call.startedAt,
                        endedAt: call.endedAt,
                        duration: call.duration
                    })),
                    total: calls.length
                });
            } catch (error: any) {
                return createToolError('Failed to list calls', { message: error.message });
            }
        },

        phony_get_call: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                const call = await transcriptService.getCall(args.callSid);
                if (!call) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                return createToolResponse({
                    call: {
                        _id: call._id,
                        callSid: call.callSid,
                        fromNumber: call.fromNumber,
                        toNumber: call.toNumber,
                        callType: call.callType,
                        status: call.status,
                        conversationHistory: call.conversationHistory,
                        twilioEvents: call.twilioEvents,
                        systemInstructions: call.systemInstructions,
                        callInstructions: call.callInstructions,
                        startedAt: call.startedAt,
                        endedAt: call.endedAt,
                        duration: call.duration,
                        errorMessage: call.errorMessage
                    }
                });
            } catch (error: any) {
                return createToolError('Failed to get call', { message: error.message });
            }
        },

        phony_hold_call: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                // Get call state to retrieve the voice parameter
                const callStateService = CallStateService.getInstance();
                const callState = callStateService.getCall(args.callSid);

                if (!callState) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                await twilioService.holdCall(args.callSid);

                // Update call state
                callStateService.updateCallStatus(args.callSid, 'on_hold');

                return createToolResponse({
                    success: true,
                    status: 'on_hold',
                    message: `Call ${args.callSid} is now on hold`
                });
            } catch (error: any) {
                return createToolError('Failed to hold call', { message: error.message });
            }
        },

        phony_resume_call: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                await twilioService.resumeCall(args.callSid);

                // Update call state
                const callStateService = CallStateService.getInstance();
                callStateService.updateCallStatus(args.callSid, 'in-progress');

                return createToolResponse({
                    success: true,
                    status: 'in-progress',
                    message: `Call ${args.callSid} has been resumed`
                });
            } catch (error: any) {
                return createToolError('Failed to resume call', { message: error.message });
            }
        },

        phony_hangup_call: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                await twilioService.endCall(args.callSid);

                return createToolResponse({
                    success: true,
                    message: `Call ${args.callSid} has been ended`
                });
            } catch (error: any) {
                return createToolError('Failed to hangup call', { message: error.message });
            }
        },

        phony_inject_context: async (args) => {
            try {
                validateArgs(args, ['callSid', 'context']);

                // Get conversation history from CallStateService
                const callStateService = CallStateService.getInstance();
                const call = callStateService.getCall(args.callSid);

                if (!call) {
                    return createToolError(`Call not found or not active: ${args.callSid}`);
                }

                const conversationHistory = call.conversationHistory || [];

                // Inject context via session manager
                const success = sessionManager.injectContext(
                    args.callSid,
                    args.context,
                    conversationHistory
                );

                if (!success) {
                    return createToolError(`Failed to inject context - call session not found: ${args.callSid}`);
                }

                return createToolResponse({
                    success: true,
                    message: `Context injected into call ${args.callSid}`
                });
            } catch (error: any) {
                return createToolError('Failed to inject context', { message: error.message });
            }
        },

        phony_request_operator_context: async (args) => {
            try {
                validateArgs(args, ['callSid', 'question']);

                const callStateService = CallStateService.getInstance();
                const call = callStateService.getCall(args.callSid);

                if (!call) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                // Put the call on hold first
                await twilioService.holdCall(args.callSid);

                // Update call status to on_hold
                callStateService.updateCallStatus(args.callSid, 'on_hold');

                // Store the pending context request
                callStateService.setPendingContextRequest(args.callSid, args.question, 'agent');

                // Emit context request via Socket.IO to notify the frontend
                const SocketService = await import('../../services/socket.service.js').then(m => m.SocketService);
                const socketService = SocketService.getInstance();
                socketService.emitContextRequest(args.callSid, args.question, 'agent');

                return createToolResponse({
                    success: true,
                    status: 'on_hold',
                    message: `Call ${args.callSid} is on hold. Waiting for operator to provide: ${args.question}`,
                    question: args.question
                });
            } catch (error: any) {
                return createToolError('Failed to request operator context', { message: error.message });
            }
        },

        phony_send_dtmf: async (args) => {
            try {
                validateArgs(args, ['callSid', 'digits']);

                // Validate DTMF digits
                const validDTMF = /^[0-9*#A-DwW ]+$/;
                if (!validDTMF.test(args.digits)) {
                    return createToolError('Invalid DTMF digits. Allowed: 0-9, *, #, A-D, w (0.5s pause), W (1s pause)');
                }

                // Get call from CallStateService
                const callStateService = CallStateService.getInstance();
                const call = callStateService.getCall(args.callSid);

                if (!call || !call.twilioCallSid) {
                    return createToolError(`Call not found or not active: ${args.callSid}`);
                }

                // Send DTMF tones via Twilio
                await twilioService.sendDTMF(call.twilioCallSid, args.digits);

                return createToolResponse({
                    success: true,
                    message: `DTMF tones "${args.digits}" sent to call ${args.callSid}`
                });
            } catch (error: any) {
                return createToolError('Failed to send DTMF tones', { message: error.message });
            }
        },

        phony_get_call_transcript: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                const call = await transcriptService.getCall(args.callSid);
                if (!call) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                return createToolResponse({
                    callSid: call.callSid,
                    status: call.status,
                    messages: call.conversationHistory || [],
                    messageCount: call.conversationHistory?.length || 0
                });
            } catch (error: any) {
                return createToolError('Failed to get transcript', { message: error.message });
            }
        },

        phony_emergency_shutdown: async () => {
            try {
                const PUBLIC_URL = process.env.PUBLIC_URL || '';
                const DYNAMIC_API_SECRET = await import('../../config/constants.js').then(m => m.DYNAMIC_API_SECRET);

                // Call the emergency shutdown endpoint
                const response = await fetch(`${PUBLIC_URL}/api/emergency-shutdown?apiSecret=${DYNAMIC_API_SECRET}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    return createToolError('Emergency shutdown failed', {
                        status: response.status,
                        statusText: response.statusText
                    });
                }

                const result = await response.json();

                return createToolResponse({
                    success: true,
                    message: `Emergency shutdown completed successfully`,
                    terminatedCount: result.terminatedCount,
                    failedCount: result.failedCount,
                    terminatedCalls: result.terminatedCalls,
                    failedCalls: result.failedCalls
                });
            } catch (error: any) {
                return createToolError('Failed to execute emergency shutdown', { message: error.message });
            }
        }
    };
}
