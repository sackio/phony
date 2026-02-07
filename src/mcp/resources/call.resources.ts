import { MCPResourceDefinition, MCPResourceHandler } from '../types.js';
import { createResourceResponse, parseResourceURI } from '../utils.js';
import { CallTranscriptService } from '../../services/database/call-transcript.service.js';

/**
 * Call Resource Definitions
 */

export const callResourceDefinitions: MCPResourceDefinition[] = [
    {
        uri: 'call://list',
        name: 'List all calls',
        description: 'Get all call records with basic information'
    },
    {
        uri: 'call://{callSid}',
        name: 'Get call details',
        description: 'Get complete call information including transcript and events'
    },
    {
        uri: 'call://{callSid}/transcript',
        name: 'Get call transcript',
        description: 'Get conversation messages from a call'
    },
    {
        uri: 'call://{callSid}/events',
        name: 'Get all call events',
        description: 'Get Twilio events from a call'
    },
    {
        uri: 'call://{callSid}/events/twilio',
        name: 'Get Twilio events',
        description: 'Get Twilio WebSocket events from a call'
    },
    {
        uri: 'call://{callSid}/instructions',
        name: 'Get call instructions',
        description: 'Get system and call-specific instructions used for a call'
    }
];

/**
 * Create call resource handler
 */
export function createCallResourceHandler(
    transcriptService: CallTranscriptService
): MCPResourceHandler {
    return async (uri: string) => {
        const { path } = parseResourceURI(uri);

        // Handle call://list
        if (path === 'list') {
            const calls = await transcriptService.getRecentCalls(50);
            return createResourceResponse(uri, {
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
        }

        // Handle call://list?status=X or call://list?type=X
        if (path.startsWith('list?')) {
            const params = new URLSearchParams(path.split('?')[1]);
            let calls = await transcriptService.getRecentCalls(50);

            if (params.has('status')) {
                calls = calls.filter(call => call.status === params.get('status'));
            }
            if (params.has('type')) {
                calls = calls.filter(call => call.callType === params.get('type'));
            }

            return createResourceResponse(uri, {
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
                total: calls.length,
                filters: Object.fromEntries(params)
            });
        }

        // Parse call SID and sub-resource
        const parts = path.split('/');
        const callSid = parts[0];
        const subResource = parts.slice(1).join('/');

        // Get the call
        const call = await transcriptService.getCall(callSid);
        if (!call) {
            throw new Error(`Call not found: ${callSid}`);
        }

        // Handle call://{callSid}
        if (!subResource) {
            return createResourceResponse(uri, {
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
        }

        // Handle call://{callSid}/transcript
        if (subResource === 'transcript') {
            return createResourceResponse(uri, {
                callSid: call.callSid,
                status: call.status,
                messages: call.conversationHistory || [],
                messageCount: call.conversationHistory?.length || 0
            });
        }

        // Handle call://{callSid}/events
        if (subResource === 'events') {
            return createResourceResponse(uri, {
                callSid: call.callSid,
                twilioEvents: call.twilioEvents || [],
                eventCount: (call.twilioEvents || []).length
            });
        }

        // Handle call://{callSid}/events/twilio
        if (subResource === 'events/twilio') {
            return createResourceResponse(uri, {
                callSid: call.callSid,
                twilioEvents: call.twilioEvents || [],
                eventCount: (call.twilioEvents || []).length
            });
        }

        // Handle call://{callSid}/instructions
        if (subResource === 'instructions') {
            return createResourceResponse(uri, {
                callSid: call.callSid,
                systemInstructions: call.systemInstructions || null,
                callInstructions: call.callInstructions || null,
                callContext: call.callContext || null
            });
        }

        throw new Error(`Unknown call resource: ${subResource}`);
    };
}
