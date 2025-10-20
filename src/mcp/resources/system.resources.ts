import { MCPResourceDefinition, MCPResourceHandler } from '../types.js';
import { createResourceResponse, parseResourceURI } from '../utils.js';
import { CallTranscriptService } from '../../services/database/call-transcript.service.js';
import { IncomingConfigService } from '../../services/database/incoming-config.service.js';
import { ContextService } from '../../services/database/context.service.js';
import { CallStateService } from '../../services/call-state.service.js';
import { MongoDBService } from '../../services/database/mongodb.service.js';

/**
 * System Resource Definitions
 */

export const systemResourceDefinitions: MCPResourceDefinition[] = [
    {
        uri: 'system://status',
        name: 'System status',
        description: 'Get system health and status information'
    },
    {
        uri: 'system://stats',
        name: 'System statistics',
        description: 'Get detailed system statistics'
    }
];

/**
 * Create system resource handler
 */
export function createSystemResourceHandler(
    transcriptService: CallTranscriptService,
    incomingConfigService: IncomingConfigService,
    contextService: ContextService
): MCPResourceHandler {
    return async (uri: string) => {
        const { path } = parseResourceURI(uri);

        // Handle system://status
        if (path === 'status') {
            const mongoService = MongoDBService.getInstance();
            const callStateService = CallStateService.getInstance();

            return createResourceResponse(uri, {
                status: 'operational',
                timestamp: new Date().toISOString(),
                components: {
                    mongodb: {
                        connected: mongoService.getIsConnected(),
                        status: mongoService.getIsConnected() ? 'healthy' : 'disconnected'
                    },
                    activeCalls: {
                        count: callStateService.getAllCalls().length,
                        status: 'healthy'
                    }
                }
            });
        }

        // Handle system://stats
        if (path === 'stats') {
            const callStateService = CallStateService.getInstance();
            const activeCalls = callStateService.getAllCalls();

            // Get call statistics
            const allCalls = await transcriptService.getRecentCalls(1000);

            const statusCounts: Record<string, number> = {};
            allCalls.forEach(call => {
                statusCounts[call.status] = (statusCounts[call.status] || 0) + 1;
            });

            const typeCounts: Record<string, number> = {};
            allCalls.forEach(call => {
                typeCounts[call.callType] = (typeCounts[call.callType] || 0) + 1;
            });

            // Get configuration statistics
            const configs = await incomingConfigService.getAllConfigs();
            const enabledConfigs = configs.filter(c => c.enabled).length;

            // Get context statistics
            const contexts = await contextService.getAllContexts();
            const contextsByType: Record<string, number> = {};
            contexts.forEach(ctx => {
                contextsByType[ctx.contextType] = (contextsByType[ctx.contextType] || 0) + 1;
            });

            return createResourceResponse(uri, {
                timestamp: new Date().toISOString(),
                calls: {
                    active: activeCalls.length,
                    total: allCalls.length,
                    byStatus: statusCounts,
                    byType: typeCounts
                },
                configuration: {
                    incomingConfigs: {
                        total: configs.length,
                        enabled: enabledConfigs,
                        disabled: configs.length - enabledConfigs
                    },
                    contexts: {
                        total: contexts.length,
                        byType: contextsByType
                    }
                },
                database: {
                    mongodb: {
                        connected: MongoDBService.getInstance().getIsConnected()
                    }
                }
            });
        }

        throw new Error(`Unknown system resource: ${path}`);
    };
}
