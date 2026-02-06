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
        description: 'Configure a phone number to handle incoming calls. Supports three modes: AI conversation (default), message-only (play message and hang up), or voicemail (record and transcribe messages). AI conversation mode supports OpenAI or ElevenLabs voice providers.',
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
                    description: 'System instructions for incoming calls (required for AI conversation mode)'
                },
                callInstructions: {
                    type: 'string',
                    description: 'Default call instructions for incoming calls'
                },
                voiceProvider: {
                    type: 'string',
                    description: 'Voice provider to use: openai (default) or elevenlabs',
                    enum: ['openai', 'elevenlabs']
                },
                voice: {
                    type: 'string',
                    description: 'Voice to use for TTS (OpenAI voices)',
                    enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'sage']
                },
                elevenLabsAgentId: {
                    type: 'string',
                    description: 'ElevenLabs agent ID (uses default if not specified, only for elevenlabs provider)'
                },
                elevenLabsVoiceId: {
                    type: 'string',
                    description: 'ElevenLabs voice ID (uses agent default if not specified, only for elevenlabs provider)'
                },
                enabled: {
                    type: 'boolean',
                    description: 'Whether this configuration is enabled'
                },
                messageOnly: {
                    type: 'boolean',
                    description: 'If true, play hangupMessage and hang up (no AI conversation)'
                },
                hangupMessage: {
                    type: 'string',
                    description: 'Message to play when messageOnly is true'
                },
                voicemailEnabled: {
                    type: 'boolean',
                    description: 'If true, record voicemail with transcription instead of AI conversation'
                },
                voicemailGreeting: {
                    type: 'string',
                    description: 'Custom greeting message for voicemail (TTS text)'
                },
                voicemailMaxLength: {
                    type: 'number',
                    description: 'Maximum voicemail recording length in seconds (default: 120)'
                }
            },
            required: ['phoneNumber', 'name']
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
                voiceProvider: {
                    type: 'string',
                    description: 'Voice provider: openai or elevenlabs',
                    enum: ['openai', 'elevenlabs']
                },
                voice: {
                    type: 'string',
                    description: 'New voice (OpenAI voices)',
                    enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'sage']
                },
                elevenLabsAgentId: {
                    type: 'string',
                    description: 'ElevenLabs agent ID'
                },
                elevenLabsVoiceId: {
                    type: 'string',
                    description: 'ElevenLabs voice ID'
                },
                enabled: {
                    type: 'boolean',
                    description: 'Enable or disable configuration'
                },
                messageOnly: {
                    type: 'boolean',
                    description: 'If true, play hangupMessage and hang up (no AI conversation)'
                },
                hangupMessage: {
                    type: 'string',
                    description: 'Message to play when messageOnly is true'
                },
                voicemailEnabled: {
                    type: 'boolean',
                    description: 'If true, record voicemail with transcription instead of AI conversation'
                },
                voicemailGreeting: {
                    type: 'string',
                    description: 'Custom greeting message for voicemail (TTS text)'
                },
                voicemailMaxLength: {
                    type: 'number',
                    description: 'Maximum voicemail recording length in seconds (default: 120)'
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
                        voiceProvider: config.voiceProvider || 'openai',
                        voice: config.voice,
                        elevenLabsAgentId: config.elevenLabsAgentId,
                        elevenLabsVoiceId: config.elevenLabsVoiceId,
                        enabled: config.enabled,
                        messageOnly: config.messageOnly,
                        hangupMessage: config.hangupMessage,
                        voicemailEnabled: config.voicemailEnabled,
                        voicemailGreeting: config.voicemailGreeting,
                        voicemailMaxLength: config.voicemailMaxLength,
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
                validateArgs(args, ['phoneNumber', 'name']);

                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);
                const voiceProvider = args.voiceProvider || 'openai';
                const voice = args.voice || 'sage';
                const enabled = args.enabled !== false; // Default to true
                const messageOnly = args.messageOnly || false;
                const voicemailEnabled = args.voicemailEnabled || false;

                // Validate based on mode
                if (!messageOnly && !voicemailEnabled && !args.systemInstructions) {
                    return createToolError('systemInstructions is required for AI conversation mode');
                }
                if (messageOnly && !args.hangupMessage) {
                    return createToolError('hangupMessage is required when messageOnly is true');
                }

                const config = await incomingConfigService.createConfig({
                    phoneNumber,
                    name: args.name,
                    systemInstructions: args.systemInstructions || '',
                    callInstructions: args.callInstructions || '',
                    voiceProvider,
                    voice,
                    elevenLabsAgentId: args.elevenLabsAgentId,
                    elevenLabsVoiceId: args.elevenLabsVoiceId,
                    enabled,
                    messageOnly,
                    hangupMessage: args.hangupMessage,
                    voicemailEnabled,
                    voicemailGreeting: args.voicemailGreeting,
                    voicemailMaxLength: args.voicemailMaxLength || 120
                });

                return createToolResponse({
                    config: {
                        phoneNumber: config.phoneNumber,
                        name: config.name,
                        systemInstructions: config.systemInstructions,
                        callInstructions: config.callInstructions,
                        voiceProvider: config.voiceProvider,
                        voice: config.voice,
                        elevenLabsAgentId: config.elevenLabsAgentId,
                        elevenLabsVoiceId: config.elevenLabsVoiceId,
                        enabled: config.enabled,
                        messageOnly: config.messageOnly,
                        hangupMessage: config.hangupMessage,
                        voicemailEnabled: config.voicemailEnabled,
                        voicemailGreeting: config.voicemailGreeting,
                        voicemailMaxLength: config.voicemailMaxLength,
                        createdAt: config.createdAt,
                        updatedAt: config.updatedAt
                    },
                    message: `Configuration created for ${phoneNumber} with ${voiceProvider} provider`
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
                if (args.voiceProvider !== undefined) updates.voiceProvider = args.voiceProvider;
                if (args.voice !== undefined) updates.voice = args.voice;
                if (args.elevenLabsAgentId !== undefined) updates.elevenLabsAgentId = args.elevenLabsAgentId;
                if (args.elevenLabsVoiceId !== undefined) updates.elevenLabsVoiceId = args.elevenLabsVoiceId;
                if (args.enabled !== undefined) updates.enabled = args.enabled;
                if (args.messageOnly !== undefined) updates.messageOnly = args.messageOnly;
                if (args.hangupMessage !== undefined) updates.hangupMessage = args.hangupMessage;
                if (args.voicemailEnabled !== undefined) updates.voicemailEnabled = args.voicemailEnabled;
                if (args.voicemailGreeting !== undefined) updates.voicemailGreeting = args.voicemailGreeting;
                if (args.voicemailMaxLength !== undefined) updates.voicemailMaxLength = args.voicemailMaxLength;

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
                        voiceProvider: config.voiceProvider,
                        voice: config.voice,
                        elevenLabsAgentId: config.elevenLabsAgentId,
                        elevenLabsVoiceId: config.elevenLabsVoiceId,
                        enabled: config.enabled,
                        messageOnly: config.messageOnly,
                        hangupMessage: config.hangupMessage,
                        voicemailEnabled: config.voicemailEnabled,
                        voicemailGreeting: config.voicemailGreeting,
                        voicemailMaxLength: config.voicemailMaxLength,
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
