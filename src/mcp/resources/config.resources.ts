import { MCPResourceDefinition, MCPResourceHandler } from '../types.js';
import { createResourceResponse, parseResourceURI, sanitizePhoneNumber } from '../utils.js';
import { IncomingConfigService } from '../../services/database/incoming-config.service.js';
import { ContextService } from '../../services/database/context.service.js';
import { TwilioCallService } from '../../services/twilio/call.service.js';

/**
 * Configuration Resource Definitions
 */

export const configResourceDefinitions: MCPResourceDefinition[] = [
    {
        uri: 'config://incoming/list',
        name: 'List incoming configurations',
        description: 'Get all configured incoming call handlers'
    },
    {
        uri: 'config://incoming/{phoneNumber}',
        name: 'Get incoming configuration',
        description: 'Get configuration for a specific phone number'
    },
    {
        uri: 'config://numbers/available',
        name: 'List available numbers',
        description: 'Get all Twilio phone numbers and their configuration status'
    },
    {
        uri: 'context://list',
        name: 'List contexts',
        description: 'Get all context templates'
    },
    {
        uri: 'context://{contextId}',
        name: 'Get context',
        description: 'Get a specific context template'
    }
];

/**
 * Create config resource handler
 */
export function createConfigResourceHandler(
    incomingConfigService: IncomingConfigService,
    contextService: ContextService,
    twilioService: TwilioCallService
): MCPResourceHandler {
    return async (uri: string) => {
        const { scheme, path } = parseResourceURI(uri);

        // Handle config://incoming/list
        if (scheme === 'config' && path === 'incoming/list') {
            const configs = await incomingConfigService.getAllConfigs();
            return createResourceResponse(uri, {
                configs: configs.map(config => ({
                    phoneNumber: config.phoneNumber,
                    name: config.name,
                    systemInstructions: config.systemInstructions,
                    callInstructions: config.callInstructions,
                    voice: config.voice,
                    enabled: config.enabled,
                    createdAt: config.createdAt,
                    updatedAt: config.updatedAt
                })),
                total: configs.length
            });
        }

        // Handle config://incoming/{phoneNumber}
        if (scheme === 'config' && path.startsWith('incoming/')) {
            const phoneNumber = sanitizePhoneNumber(path.replace('incoming/', ''));
            const config = await incomingConfigService.getConfig(phoneNumber);

            if (!config) {
                throw new Error(`Configuration not found for ${phoneNumber}`);
            }

            return createResourceResponse(uri, {
                config: {
                    phoneNumber: config.phoneNumber,
                    name: config.name,
                    systemInstructions: config.systemInstructions,
                    callInstructions: config.callInstructions,
                    voice: config.voice,
                    enabled: config.enabled,
                    createdAt: config.createdAt,
                    updatedAt: config.updatedAt
                }
            });
        }

        // Handle config://numbers/available
        if (scheme === 'config' && path === 'numbers/available') {
            const twilioNumbers = await twilioService.listPhoneNumbers();
            const configs = await incomingConfigService.getAllConfigs();

            const configMap = new Map(
                configs.map(config => [config.phoneNumber, config])
            );

            const availableNumbers = twilioNumbers
                .filter(twilioNumber => {
                    const config = configMap.get(twilioNumber.phoneNumber);
                    const hasPhonyWebhook = twilioNumber.voiceUrl?.includes('phony.pushbuild.com') || false;
                    const hasNoWebhook = !twilioNumber.hasVoiceWebhook;

                    return !!config || hasPhonyWebhook || hasNoWebhook;
                })
                .map(twilioNumber => {
                    const config = configMap.get(twilioNumber.phoneNumber);

                    return {
                        phoneNumber: twilioNumber.phoneNumber,
                        friendlyName: twilioNumber.friendlyName,
                        sid: twilioNumber.sid,
                        voiceUrl: twilioNumber.voiceUrl,
                        hasVoiceWebhook: twilioNumber.hasVoiceWebhook,
                        isConfigured: !!config,
                        config: config || null
                    };
                });

            return createResourceResponse(uri, {
                numbers: availableNumbers,
                total: availableNumbers.length
            });
        }

        // Handle context://list
        if (scheme === 'context' && path === 'list') {
            const contexts = await contextService.getAllContexts();
            return createResourceResponse(uri, {
                contexts: contexts.map(ctx => ({
                    _id: ctx._id,
                    name: ctx.name,
                    description: ctx.description,
                    systemInstructions: ctx.systemInstructions,
                    exampleCallInstructions: ctx.exampleCallInstructions,
                    contextType: ctx.contextType,
                    createdAt: ctx.createdAt,
                    updatedAt: ctx.updatedAt
                })),
                total: contexts.length
            });
        }

        // Handle context://list?type=X
        if (scheme === 'context' && path.startsWith('list?')) {
            const params = new URLSearchParams(path.split('?')[1]);
            let contexts = await contextService.getAllContexts();

            if (params.has('type')) {
                const type = params.get('type');
                contexts = contexts.filter(ctx =>
                    ctx.contextType === type || ctx.contextType === 'both'
                );
            }

            return createResourceResponse(uri, {
                contexts: contexts.map(ctx => ({
                    _id: ctx._id,
                    name: ctx.name,
                    description: ctx.description,
                    systemInstructions: ctx.systemInstructions,
                    exampleCallInstructions: ctx.exampleCallInstructions,
                    contextType: ctx.contextType,
                    createdAt: ctx.createdAt,
                    updatedAt: ctx.updatedAt
                })),
                total: contexts.length,
                filters: Object.fromEntries(params)
            });
        }

        // Handle context://{contextId}
        if (scheme === 'context') {
            const contextId = path;
            const context = await contextService.getContextById(contextId);

            if (!context) {
                throw new Error(`Context not found: ${contextId}`);
            }

            return createResourceResponse(uri, {
                context: {
                    _id: context._id,
                    name: context.name,
                    description: context.description,
                    systemInstructions: context.systemInstructions,
                    exampleCallInstructions: context.exampleCallInstructions,
                    contextType: context.contextType,
                    createdAt: context.createdAt,
                    updatedAt: context.updatedAt
                }
            });
        }

        throw new Error(`Unknown resource URI: ${uri}`);
    };
}
