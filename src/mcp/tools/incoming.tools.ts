import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, validateArgs, sanitizePhoneNumber } from '../utils.js';
import { IncomingConfigService } from '../../services/database/incoming-config.service.js';
import { TwilioCallService } from '../../services/twilio/call.service.js';

/**
 * Incoming Configuration Tools
 */

export const incomingToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_list_available_numbers',
        description: 'List all Twilio phone numbers and their configuration status',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'phony_list_incoming_configs',
        description: 'List all configured incoming call handlers',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'phony_create_incoming_config',
        description: 'Configure a phone number to handle incoming calls',
        inputSchema: {
            type: 'object',
            properties: {
                phoneNumber: {
                    type: 'string',
                    description: 'Phone number to configure in E.164 format'
                },
                name: {
                    type: 'string',
                    description: 'Friendly name for this configuration'
                },
                systemInstructions: {
                    type: 'string',
                    description: 'System instructions for incoming calls'
                },
                callInstructions: {
                    type: 'string',
                    description: 'Default call instructions for incoming calls'
                },
                voice: {
                    type: 'string',
                    description: 'OpenAI voice to use',
                    enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
                },
                enabled: {
                    type: 'boolean',
                    description: 'Whether this configuration is enabled'
                }
            },
            required: ['phoneNumber', 'name', 'systemInstructions', 'callInstructions']
        }
    },
    {
        name: 'phony_update_incoming_config',
        description: 'Update an existing incoming call configuration',
        inputSchema: {
            type: 'object',
            properties: {
                phoneNumber: {
                    type: 'string',
                    description: 'Phone number of the configuration to update'
                },
                name: {
                    type: 'string',
                    description: 'New friendly name'
                },
                systemInstructions: {
                    type: 'string',
                    description: 'New system instructions'
                },
                callInstructions: {
                    type: 'string',
                    description: 'New call instructions'
                },
                voice: {
                    type: 'string',
                    description: 'New voice',
                    enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
                },
                enabled: {
                    type: 'boolean',
                    description: 'Enable or disable configuration'
                }
            },
            required: ['phoneNumber']
        }
    },
    {
        name: 'phony_delete_incoming_config',
        description: 'Remove incoming call configuration from a phone number',
        inputSchema: {
            type: 'object',
            properties: {
                phoneNumber: {
                    type: 'string',
                    description: 'Phone number to remove configuration from'
                }
            },
            required: ['phoneNumber']
        }
    }
];

/**
 * Create tool handlers
 */
export function createIncomingToolHandlers(
    incomingConfigService: IncomingConfigService,
    twilioService: TwilioCallService
): Record<string, MCPToolHandler> {
    return {
        phony_list_available_numbers: async () => {
            try {
                const twilioNumbers = await twilioService.listPhoneNumbers();
                const configs = await incomingConfigService.getAllConfigs();

                const configMap = new Map(
                    configs.map(config => [config.phoneNumber, config])
                );

                // Filter to only include Phony-related or unconfigured numbers
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

                return createToolResponse({
                    numbers: availableNumbers,
                    total: availableNumbers.length
                });
            } catch (error: any) {
                return createToolError('Failed to list available numbers', { message: error.message });
            }
        },

        phony_list_incoming_configs: async () => {
            try {
                const configs = await incomingConfigService.getAllConfigs();

                return createToolResponse({
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
            } catch (error: any) {
                return createToolError('Failed to list configurations', { message: error.message });
            }
        },

        phony_create_incoming_config: async (args) => {
            try {
                validateArgs(args, ['phoneNumber', 'name', 'systemInstructions', 'callInstructions']);

                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);
                const voice = args.voice || 'alloy';
                const enabled = args.enabled !== false; // Default to true

                const config = await incomingConfigService.createConfig({
                    phoneNumber,
                    name: args.name,
                    systemInstructions: args.systemInstructions,
                    callInstructions: args.callInstructions,
                    voice,
                    enabled
                });

                return createToolResponse({
                    config: {
                        phoneNumber: config.phoneNumber,
                        name: config.name,
                        systemInstructions: config.systemInstructions,
                        callInstructions: config.callInstructions,
                        voice: config.voice,
                        enabled: config.enabled,
                        createdAt: config.createdAt,
                        updatedAt: config.updatedAt
                    },
                    message: `Configuration created for ${phoneNumber}`
                });
            } catch (error: any) {
                return createToolError('Failed to create configuration', { message: error.message });
            }
        },

        phony_update_incoming_config: async (args) => {
            try {
                validateArgs(args, ['phoneNumber']);

                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);

                // Build update object
                const updates: any = {};
                if (args.name !== undefined) updates.name = args.name;
                if (args.systemInstructions !== undefined) updates.systemInstructions = args.systemInstructions;
                if (args.callInstructions !== undefined) updates.callInstructions = args.callInstructions;
                if (args.voice !== undefined) updates.voice = args.voice;
                if (args.enabled !== undefined) updates.enabled = args.enabled;

                if (Object.keys(updates).length === 0) {
                    return createToolError('No fields provided to update');
                }

                const config = await incomingConfigService.updateConfig(phoneNumber, updates);

                if (!config) {
                    return createToolError(`Configuration not found for ${phoneNumber}`);
                }

                return createToolResponse({
                    config: {
                        phoneNumber: config.phoneNumber,
                        name: config.name,
                        systemInstructions: config.systemInstructions,
                        callInstructions: config.callInstructions,
                        voice: config.voice,
                        enabled: config.enabled,
                        createdAt: config.createdAt,
                        updatedAt: config.updatedAt
                    },
                    message: `Configuration updated for ${phoneNumber}`
                });
            } catch (error: any) {
                return createToolError('Failed to update configuration', { message: error.message });
            }
        },

        phony_delete_incoming_config: async (args) => {
            try {
                validateArgs(args, ['phoneNumber']);

                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);

                const success = await incomingConfigService.deleteConfig(phoneNumber);

                if (!success) {
                    return createToolError(`Configuration not found for ${phoneNumber}`);
                }

                return createToolResponse({
                    success: true,
                    message: `Configuration deleted for ${phoneNumber}`
                });
            } catch (error: any) {
                return createToolError('Failed to delete configuration', { message: error.message });
            }
        }
    };
}
