import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, validateArgs, sanitizePhoneNumber } from '../utils.js';
import { VoicemailService } from '../../services/voicemail/voicemail.service.js';
import { VoicemailStatus } from '../../models/voicemail.model.js';

/**
 * Voicemail Management Tools
 */

export const voicemailToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_list_voicemails',
        description: 'List voicemail messages with optional filtering by phone number, read status, date range, etc.',
        inputSchema: {
            type: 'object',
            properties: {
                toNumber: {
                    type: 'string',
                    description: 'Filter by recipient phone number (your Twilio number) in E.164 format'
                },
                fromNumber: {
                    type: 'string',
                    description: 'Filter by caller phone number in E.164 format'
                },
                isRead: {
                    type: 'boolean',
                    description: 'Filter by read status (true for read, false for unread)'
                },
                status: {
                    type: 'string',
                    description: 'Filter by voicemail status',
                    enum: ['recording', 'transcribing', 'completed', 'failed']
                },
                startDate: {
                    type: 'string',
                    description: 'Filter voicemails after this date (ISO format, e.g., 2024-01-15)'
                },
                endDate: {
                    type: 'string',
                    description: 'Filter voicemails before this date (ISO format, e.g., 2024-01-20)'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of voicemails to return (default: 100, max: 200)'
                }
            }
        }
    },
    {
        name: 'phony_get_voicemail',
        description: 'Get detailed information about a specific voicemail including transcription',
        inputSchema: {
            type: 'object',
            properties: {
                recordingSid: {
                    type: 'string',
                    description: 'Twilio recording SID (e.g., RE1234567890abcdef)'
                }
            },
            required: ['recordingSid']
        }
    },
    {
        name: 'phony_mark_voicemail_read',
        description: 'Mark a voicemail as read',
        inputSchema: {
            type: 'object',
            properties: {
                recordingSid: {
                    type: 'string',
                    description: 'Twilio recording SID'
                }
            },
            required: ['recordingSid']
        }
    },
    {
        name: 'phony_mark_voicemail_unread',
        description: 'Mark a voicemail as unread',
        inputSchema: {
            type: 'object',
            properties: {
                recordingSid: {
                    type: 'string',
                    description: 'Twilio recording SID'
                }
            },
            required: ['recordingSid']
        }
    },
    {
        name: 'phony_delete_voicemail',
        description: 'Delete a voicemail message',
        inputSchema: {
            type: 'object',
            properties: {
                recordingSid: {
                    type: 'string',
                    description: 'Twilio recording SID'
                }
            },
            required: ['recordingSid']
        }
    },
    {
        name: 'phony_get_unread_voicemail_count',
        description: 'Get the count of unread voicemails for a phone number',
        inputSchema: {
            type: 'object',
            properties: {
                toNumber: {
                    type: 'string',
                    description: 'Phone number to check in E.164 format'
                }
            },
            required: ['toNumber']
        }
    },
    {
        name: 'phony_search_voicemails',
        description: 'Search voicemails by transcription text',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query text to find in voicemail transcriptions'
                },
                toNumber: {
                    type: 'string',
                    description: 'Optional: filter by recipient phone number in E.164 format'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results to return (default: 50, max: 100)'
                }
            },
            required: ['query']
        }
    }
];

/**
 * Create voicemail tool handlers
 */
export function createVoicemailToolHandlers(): Record<string, MCPToolHandler> {
    const voicemailService = new VoicemailService();

    return {
        phony_list_voicemails: async (args) => {
            try {
                const options: any = {};

                if (args.toNumber) {
                    options.toNumber = sanitizePhoneNumber(args.toNumber);
                }
                if (args.fromNumber) {
                    options.fromNumber = sanitizePhoneNumber(args.fromNumber);
                }
                if (args.isRead !== undefined) {
                    options.isRead = args.isRead;
                }
                if (args.status) {
                    options.status = args.status as VoicemailStatus;
                }
                if (args.startDate) {
                    options.startDate = new Date(args.startDate);
                }
                if (args.endDate) {
                    options.endDate = new Date(args.endDate);
                }
                if (args.limit) {
                    options.limit = Math.min(args.limit, 200);
                }

                const voicemails = await voicemailService.listVoicemails(options);

                return createToolResponse({
                    voicemails: voicemails.map(vm => ({
                        recordingSid: vm.recordingSid,
                        callSid: vm.callSid,
                        fromNumber: vm.fromNumber,
                        toNumber: vm.toNumber,
                        duration: vm.duration,
                        recordingUrl: vm.recordingUrl,
                        transcription: vm.transcription,
                        status: vm.status,
                        isRead: vm.isRead,
                        createdAt: vm.createdAt
                    })),
                    count: voicemails.length
                });
            } catch (error: any) {
                return createToolError('Failed to list voicemails', { message: error.message });
            }
        },

        phony_get_voicemail: async (args) => {
            try {
                validateArgs(args, ['recordingSid']);

                const voicemail = await voicemailService.getVoicemail(args.recordingSid);

                if (!voicemail) {
                    return createToolError(`Voicemail not found: ${args.recordingSid}`);
                }

                return createToolResponse({
                    voicemail: {
                        recordingSid: voicemail.recordingSid,
                        callSid: voicemail.callSid,
                        fromNumber: voicemail.fromNumber,
                        toNumber: voicemail.toNumber,
                        duration: voicemail.duration,
                        recordingUrl: voicemail.recordingUrl,
                        transcription: voicemail.transcription,
                        transcriptionSid: voicemail.transcriptionSid,
                        status: voicemail.status,
                        isRead: voicemail.isRead,
                        errorMessage: voicemail.errorMessage,
                        createdAt: voicemail.createdAt,
                        updatedAt: voicemail.updatedAt
                    }
                });
            } catch (error: any) {
                return createToolError('Failed to get voicemail', { message: error.message });
            }
        },

        phony_mark_voicemail_read: async (args) => {
            try {
                validateArgs(args, ['recordingSid']);

                const voicemail = await voicemailService.markAsRead(args.recordingSid);

                if (!voicemail) {
                    return createToolError(`Voicemail not found: ${args.recordingSid}`);
                }

                return createToolResponse({
                    success: true,
                    message: `Voicemail ${args.recordingSid} marked as read`,
                    voicemail: {
                        recordingSid: voicemail.recordingSid,
                        isRead: voicemail.isRead
                    }
                });
            } catch (error: any) {
                return createToolError('Failed to mark voicemail as read', { message: error.message });
            }
        },

        phony_mark_voicemail_unread: async (args) => {
            try {
                validateArgs(args, ['recordingSid']);

                const voicemail = await voicemailService.markAsUnread(args.recordingSid);

                if (!voicemail) {
                    return createToolError(`Voicemail not found: ${args.recordingSid}`);
                }

                return createToolResponse({
                    success: true,
                    message: `Voicemail ${args.recordingSid} marked as unread`,
                    voicemail: {
                        recordingSid: voicemail.recordingSid,
                        isRead: voicemail.isRead
                    }
                });
            } catch (error: any) {
                return createToolError('Failed to mark voicemail as unread', { message: error.message });
            }
        },

        phony_delete_voicemail: async (args) => {
            try {
                validateArgs(args, ['recordingSid']);

                const success = await voicemailService.deleteVoicemail(args.recordingSid);

                if (!success) {
                    return createToolError(`Voicemail not found: ${args.recordingSid}`);
                }

                return createToolResponse({
                    success: true,
                    message: `Voicemail ${args.recordingSid} deleted`
                });
            } catch (error: any) {
                return createToolError('Failed to delete voicemail', { message: error.message });
            }
        },

        phony_get_unread_voicemail_count: async (args) => {
            try {
                validateArgs(args, ['toNumber']);

                const phoneNumber = sanitizePhoneNumber(args.toNumber);
                const count = await voicemailService.getUnreadCount(phoneNumber);

                return createToolResponse({
                    phoneNumber,
                    unreadCount: count
                });
            } catch (error: any) {
                return createToolError('Failed to get unread voicemail count', { message: error.message });
            }
        },

        phony_search_voicemails: async (args) => {
            try {
                validateArgs(args, ['query']);

                const options: any = {};
                if (args.toNumber) {
                    options.toNumber = sanitizePhoneNumber(args.toNumber);
                }
                if (args.limit) {
                    options.limit = Math.min(args.limit, 100);
                }

                const voicemails = await voicemailService.searchVoicemails(args.query, options);

                return createToolResponse({
                    query: args.query,
                    voicemails: voicemails.map(vm => ({
                        recordingSid: vm.recordingSid,
                        callSid: vm.callSid,
                        fromNumber: vm.fromNumber,
                        toNumber: vm.toNumber,
                        duration: vm.duration,
                        transcription: vm.transcription,
                        status: vm.status,
                        isRead: vm.isRead,
                        createdAt: vm.createdAt
                    })),
                    count: voicemails.length
                });
            } catch (error: any) {
                return createToolError('Failed to search voicemails', { message: error.message });
            }
        }
    };
}
