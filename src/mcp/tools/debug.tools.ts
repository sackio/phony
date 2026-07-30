import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, validateArgs } from '../utils.js';
import { CallTranscriptService } from '../../services/database/call-transcript.service.js';
import { IncomingConfigService } from '../../services/database/incoming-config.service.js';
import { ContextService } from '../../services/database/context.service.js';
import { CallStateService } from '../../services/call-state.service.js';
import { MongoDBService } from '../../services/database/mongodb.service.js';

/**
 * Debug & Monitoring Tools
 */

export const debugToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_get_call_events',
        description: 'Get detailed Twilio event logs from a call for debugging',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                },
                eventType: {
                    type: 'string',
                    description: 'Filter by event source',
                    enum: ['twilio', 'all']
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_get_call_instructions',
        description: 'Get the system and call instructions that were used for a specific call',
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
        name: 'phony_get_system_status',
        description: 'Get system health and statistics',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    }
];

/**
 * Create tool handlers
 */
export function createDebugToolHandlers(
    transcriptService: CallTranscriptService,
    incomingConfigService: IncomingConfigService,
    contextService: ContextService
): Record<string, MCPToolHandler> {
    return {
        phony_get_call_events: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                const call = await transcriptService.getCall(args.callSid);
                if (!call) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                const eventType = args.eventType || 'all';

                const result: any = {
                    callSid: call.callSid,
                    status: call.status
                };

                if (eventType === 'twilio' || eventType === 'all') {
                    result.twilioEvents = call.twilioEvents || [];
                    result.twilioEventCount = (call.twilioEvents || []).length;
                }

                // Add event type summary
                if (eventType === 'all') {
                    const twilioTypes = new Map<string, number>();
                    (call.twilioEvents || []).forEach(event => {
                        twilioTypes.set(event.type, (twilioTypes.get(event.type) || 0) + 1);
                    });

                    result.eventSummary = {
                        twilioEventTypes: Object.fromEntries(twilioTypes)
                    };
                }

                return createToolResponse(result);
            } catch (error: any) {
                return createToolError('Failed to get call events', { message: error.message });
            }
        },

        phony_get_call_instructions: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                const call = await transcriptService.getCall(args.callSid);
                if (!call) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                return createToolResponse({
                    callSid: call.callSid,
                    callType: call.callType,
                    systemInstructions: call.systemInstructions || null,
                    callInstructions: call.callInstructions || null,
                    callContext: call.callContext || null,
                    voice: call.voice
                });
            } catch (error: any) {
                return createToolError('Failed to get call instructions', { message: error.message });
            }
        },

        phony_get_system_status: async () => {
            try {
                // Get active calls from CallStateService
                const callStateService = CallStateService.getInstance();
                const activeCalls = callStateService.getAllCalls();

                // Count-by-status/type via aggregation — never hydrate call docs
                // here (embedded twilioEvents made the old 1000-doc fetch take
                // tens of minutes)
                const callCounts = await transcriptService.getCallCounts();

                // Get configured numbers
                const configs = await incomingConfigService.getAllConfigs();

                // Get saved contexts
                const contexts = await contextService.getAllContexts();

                // Get MongoDB connection status
                const mongoService = MongoDBService.getInstance();
                const mongoConnected = mongoService.getIsConnected();

                return createToolResponse({
                    system: {
                        mongodbConnected: mongoConnected,
                        timestamp: new Date().toISOString()
                    },
                    calls: {
                        active: activeCalls.length,
                        total: callCounts.total,
                        byStatus: callCounts.byStatus,
                        byType: callCounts.byType
                    },
                    configuration: {
                        configuredNumbers: configs.length,
                        savedContexts: contexts.length
                    }
                });
            } catch (error: any) {
                return createToolError('Failed to get system status', { message: error.message });
            }
        }
    };
}
