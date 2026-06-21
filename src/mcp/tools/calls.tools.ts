import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, validateArgs, sanitizePhoneNumber } from '../utils.js';
import { CallTranscriptService } from '../../services/database/call-transcript.service.js';
import { TwilioCallService } from '../../services/twilio/call.service.js';
import { CallStateService } from '../../services/call-state.service.js';
import { SessionManagerService } from '../../services/session-manager.service.js';
import { NativeElevenLabsService } from '../../services/elevenlabs/native.service.js';

/**
 * Singleton instance — Phase 2 native integration wrapper. Stateless; safe to share.
 */
const nativeElevenLabs = new NativeElevenLabsService();

/**
 * Call Management Tools
 */

export const callToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_create_call',
        description: 'Create an outbound phone call with an ElevenLabs AI voice assistant. Two modes: "native" (default) — ElevenLabs hosts the call end-to-end via /v1/convai/twilio/outbound-call, lowest latency, simplest. "advanced" — Phony hosts a WebSocket bridge with mid-call control (DTMF for IVR navigation, mid-call context injection). Use advanced only when you genuinely need DTMF or live context injection.',
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
                    description: 'Specific instructions for this particular call. In native mode this becomes the agent\'s first_message override (what it says when the call connects).'
                },
                mode: {
                    type: 'string',
                    enum: ['native', 'advanced'],
                    description: 'Which call architecture to use. "native" (default): ElevenLabs hosts the call end-to-end — lowest latency, simplest, no mid-call DTMF/context. "advanced": Phony WebSocket bridge — supports DTMF (IVR navigation) and mid-call context injection. Use advanced only when needed.'
                },
                contextChannel: {
                    type: 'string',
                    description: 'Optional Slack channel ID or ATC session id. Phony streams the call transcript + status updates to this channel, and any human/agent message arriving there during the call becomes a mid-call context injection ("operator note") delivered to the AI. The originating agent typically passes its own session id so it can watch and steer the call. Native mode receives this as a dynamic_variable; the agent can reference it via tools.'
                },
                dtmfPreflight: {
                    type: 'string',
                    description: 'Advanced mode ONLY. DTMF digits dialed by Twilio at the carrier level immediately after the called party answers, BEFORE the AI media stream connects. Use this for IVR menu navigation: Twilio generates real DTMF tones (much more reliable than audio injection). Format: digits 0-9 / * / # / w (half-second pause). Example: "wwww2" pauses 2s then presses 2 to navigate Weston Nurseries\' "design/install/delivery" menu option. Chain multiple options like "wwww2wwww1". Native mode ignores this.'
                },
                dtmfScript: {
                    type: 'array',
                    description: 'Advanced mode ONLY. Mid-call DTMF for sub-menus encountered AFTER the AI has been talking. For initial IVR navigation use `dtmfPreflight` instead (more reliable). Each entry fires at `at` milliseconds after the media stream connects. Note: mid-call DTMF goes via media-stream audio injection which some IVR detectors miss; prefer `dtmfPreflight` when possible. Format: [{at:3000,digits:"2"}].',
                    items: {
                        type: 'object',
                        properties: {
                            at: { type: 'number', description: 'Milliseconds after media-stream start when this DTMF fires' },
                            digits: { type: 'string', description: 'DTMF digits to send (0-9, *, #, A-D, w = 0.5s pause, W = 1s pause)' }
                        },
                        required: ['at', 'digits']
                    }
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
        name: 'phony_delete_call',
        description: 'Delete a call record from the database by its call SID',
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
        name: 'phony_delete_calls',
        description: 'Delete multiple call records from the database matching the given filters. At least one filter is required.',
        inputSchema: {
            type: 'object',
            properties: {
                callType: {
                    type: 'string',
                    description: 'Filter by call type',
                    enum: ['inbound', 'outbound']
                },
                status: {
                    type: 'string',
                    description: 'Filter by call status',
                    enum: ['initiated', 'in-progress', 'completed', 'failed']
                },
                startDate: {
                    type: 'string',
                    description: 'Delete calls started after this date (ISO format, e.g., 2024-01-15)'
                },
                endDate: {
                    type: 'string',
                    description: 'Delete calls started before this date (ISO format, e.g., 2024-01-20)'
                }
            }
        }
    },
    {
        name: 'phony_search_calls',
        description: 'Search call records by text content. Searches call context, system instructions, and conversation transcripts.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query text to find in call context, instructions, or transcripts'
                },
                callType: {
                    type: 'string',
                    description: 'Filter by call type',
                    enum: ['inbound', 'outbound']
                },
                phoneNumber: {
                    type: 'string',
                    description: 'Filter by phone number (matches either caller or recipient)'
                },
                status: {
                    type: 'string',
                    description: 'Filter by call status',
                    enum: ['initiated', 'in-progress', 'completed', 'failed']
                },
                startDate: {
                    type: 'string',
                    description: 'Filter calls after this date (ISO format, e.g., 2024-01-15)'
                },
                endDate: {
                    type: 'string',
                    description: 'Filter calls before this date (ISO format, e.g., 2024-01-20)'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of calls to return (default: 50, max: 100)'
                }
            },
            required: ['query']
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
                const mode: 'native' | 'advanced' = args.mode === 'advanced' ? 'advanced' : 'native';
                const contextChannel = args.contextChannel ? String(args.contextChannel) : undefined;

                if (mode === 'native') {
                    // Native path: ElevenLabs hosts the call end-to-end. We just POST
                    // to their outbound-call API and persist the resulting Call row;
                    // there's no WebSocket bridge to set up on our side.
                    const dynamicVariables: Record<string, string> = {
                        from_number: fromNumber,
                        to_number: toNumber,
                        source: 'phony',
                    };
                    if (contextChannel) dynamicVariables.context_channel = contextChannel;

                    const result = await nativeElevenLabs.createOutboundCall({
                        toNumber,
                        systemInstructions: args.systemInstructions,
                        firstMessage: args.callInstructions,
                        voiceId: args.elevenLabsVoiceId,
                        agentId: args.elevenLabsAgentId,
                        dynamicVariables,
                    });

                    if (!result.callSid) {
                        return createToolError('Native outbound call failed', { detail: result.message || 'no callSid returned' });
                    }

                    // Persist the Call row with conversation_id so the post-call webhook
                    // can link the transcript back. callType is "outbound" per the model.
                    const { CallModel } = await import('../../models/call.model.js');
                    await CallModel.create({
                        callSid: result.callSid,
                        fromNumber,
                        toNumber,
                        callType: 'outbound',
                        voiceProvider: 'elevenlabs',
                        voice: '',
                        elevenLabsAgentId: args.elevenLabsAgentId,
                        elevenLabsVoiceId: args.elevenLabsVoiceId,
                        elevenLabsConversationId: result.conversationId ?? undefined,
                        callMode: 'native',
                        systemInstructions: args.systemInstructions,
                        callInstructions: args.callInstructions,
                        startedAt: new Date(),
                        status: 'initiated',
                        conversationHistory: [],
                        twilioEvents: [],
                        openaiEvents: [],
                        tags: contextChannel ? [`context-channel:${contextChannel}`] : [],
                    }).catch(err => console.error('[phony_create_call/native] Failed to persist Call:', err));

                    return createToolResponse({
                        callSid: result.callSid,
                        conversationId: result.conversationId,
                        status: 'initiated',
                        mode: 'native',
                        contextChannel: contextChannel ?? null,
                        message: `Call initiated to ${toNumber} (ElevenLabs native, conv=${result.conversationId})`,
                    });
                }

                // Advanced path: our WebSocket bridge. Supports DTMF + context injection.
                // dtmfPreflight: passed to Twilio call.create as `sendDigits` — Twilio
                //   generates real DTMF at the carrier level RIGHT after answer,
                //   before the media stream. Reliable for IVR navigation.
                // dtmfScript: mid-call DTMF scheduled via setTimeout, injected as audio
                //   into the Twilio media stream. Less reliable; use only for sub-menus
                //   after the AI is talking.
                const dtmfScriptJson = Array.isArray(args.dtmfScript) && args.dtmfScript.length > 0
                    ? JSON.stringify(args.dtmfScript)
                    : undefined;
                const dtmfPreflight = typeof args.dtmfPreflight === 'string' && args.dtmfPreflight.length > 0
                    ? String(args.dtmfPreflight)
                    : undefined;

                const result = await twilioService.makeOutboundCall(
                    toNumber,
                    args.systemInstructions,
                    args.callInstructions,
                    args.elevenLabsAgentId,
                    args.elevenLabsVoiceId,
                    undefined, // fromNumber
                    dtmfScriptJson,
                    dtmfPreflight,
                );

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
                    contextChannel: contextChannel,
                    status: 'initiated',
                    startedAt: new Date(),
                    conversationHistory: []
                });

                callStateService.startDurationTimer(result.sid);

                return createToolResponse({
                    callSid: result.sid,
                    status: result.status,
                    mode: 'advanced',
                    contextChannel: contextChannel ?? null,
                    message: `Call initiated to ${toNumber} (advanced WebSocket bridge${contextChannel ? `, context channel: ${contextChannel}` : ''})`
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

        phony_delete_call: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                const success = await transcriptService.deleteCall(args.callSid);

                if (!success) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                return createToolResponse({
                    success: true,
                    message: `Call record ${args.callSid} deleted`
                });
            } catch (error: any) {
                return createToolError('Failed to delete call', { message: error.message });
            }
        },

        phony_delete_calls: async (args) => {
            try {
                const options: any = {};

                if (args.callType) options.callType = args.callType;
                if (args.status) options.status = args.status;
                if (args.startDate) options.startDate = new Date(args.startDate);
                if (args.endDate) options.endDate = new Date(args.endDate);

                const hasFilters = args.callType || args.status || args.startDate || args.endDate;
                if (!hasFilters) {
                    return createToolError('At least one filter is required to prevent accidental deletion of all call records');
                }

                const deletedCount = await transcriptService.deleteManyCalls(options);

                return createToolResponse({
                    success: true,
                    message: `Deleted ${deletedCount} call record(s)`,
                    data: { deletedCount }
                });
            } catch (error: any) {
                return createToolError('Failed to delete calls', { message: error.message });
            }
        },

        phony_search_calls: async (args) => {
            try {
                validateArgs(args, ['query']);

                const options: any = { query: args.query.trim() };

                if (args.callType) options.callType = args.callType;
                if (args.status) options.status = args.status;
                if (args.phoneNumber) options.phoneNumber = sanitizePhoneNumber(args.phoneNumber);
                if (args.startDate) options.startDate = new Date(args.startDate);
                if (args.endDate) options.endDate = new Date(args.endDate);
                if (args.limit) options.limit = Math.min(args.limit, 100);

                const calls = await transcriptService.searchCalls(options);

                return createToolResponse({
                    query: args.query,
                    calls: calls.map(call => ({
                        callSid: call.callSid,
                        fromNumber: call.fromNumber,
                        toNumber: call.toNumber,
                        callType: call.callType,
                        status: call.status,
                        callContext: call.callContext,
                        systemInstructions: call.systemInstructions,
                        startedAt: call.startedAt,
                        endedAt: call.endedAt,
                        duration: call.duration,
                        tags: call.tags
                    })),
                    count: calls.length
                });
            } catch (error: any) {
                return createToolError('Failed to search calls', { message: error.message });
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
