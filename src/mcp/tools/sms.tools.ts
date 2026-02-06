import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, sanitizePhoneNumber } from '../utils.js';
import { TwilioSmsService } from '../../services/twilio/sms.service.js';
import { SmsStorageService } from '../../services/sms/storage.service.js';
import { ConversationService } from '../../services/sms/conversation.service.js';
import twilio from 'twilio';
import { SmsDirection, SmsStatus } from '../../types.js';

/**
 * SMS Management Tools
 */

export const smsToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_list_numbers',
        description: 'List all available Twilio phone numbers in the account',
        inputSchema: {
            type: 'object',
            properties: {
                includeCapabilities: {
                    type: 'boolean',
                    description: 'Include SMS/Voice/MMS capabilities for each number (default: false)'
                }
            }
        }
    },
    {
        name: 'phony_search_messages',
        description: 'Search SMS messages by text content using full-text search',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query text to find in message body'
                },
                direction: {
                    type: 'string',
                    description: 'Filter by message direction',
                    enum: ['inbound', 'outbound']
                },
                phoneNumber: {
                    type: 'string',
                    description: 'Filter by phone number (matches either sender or recipient)'
                },
                startDate: {
                    type: 'string',
                    description: 'Filter messages after this date (ISO format, e.g., 2024-01-15)'
                },
                endDate: {
                    type: 'string',
                    description: 'Filter messages before this date (ISO format, e.g., 2024-01-20)'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of messages to return (default: 100)'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'phony_send_sms',
        description: 'Send an SMS/MMS message to a phone number. Supports text and media (images, files, etc.)',
        inputSchema: {
            type: 'object',
            properties: {
                toNumber: {
                    type: 'string',
                    description: 'Recipient phone number in E.164 format (e.g., +12125551234)'
                },
                body: {
                    type: 'string',
                    description: 'The text message to send (max 1600 characters). Can be empty if sending media only.'
                },
                fromNumber: {
                    type: 'string',
                    description: 'Optional sender phone number (defaults to TWILIO_NUMBER)'
                },
                mediaUrls: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional array of publicly accessible URLs for media files (images, PDFs, etc.). Max 10 URLs. Supported formats: jpg, gif, png, pdf, and more. URLs must be publicly accessible.'
                }
            },
            required: ['toNumber']
        }
    },
    {
        name: 'phony_list_messages',
        description: 'List SMS message history with optional filtering',
        inputSchema: {
            type: 'object',
            properties: {
                direction: {
                    type: 'string',
                    description: 'Filter by message direction',
                    enum: ['inbound', 'outbound']
                },
                fromNumber: {
                    type: 'string',
                    description: 'Filter by sender phone number'
                },
                toNumber: {
                    type: 'string',
                    description: 'Filter by recipient phone number'
                },
                status: {
                    type: 'string',
                    description: 'Filter by message status',
                    enum: ['queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'received']
                },
                startDate: {
                    type: 'string',
                    description: 'Filter messages after this date (ISO format, e.g., 2024-01-15)'
                },
                endDate: {
                    type: 'string',
                    description: 'Filter messages before this date (ISO format, e.g., 2024-01-20)'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of messages to return (default: 100, max: 200)'
                }
            }
        }
    },
    {
        name: 'phony_get_message',
        description: 'Get detailed information about a specific SMS message',
        inputSchema: {
            type: 'object',
            properties: {
                messageSid: {
                    type: 'string',
                    description: 'Twilio message SID (e.g., SM1234567890abcdef)'
                }
            },
            required: ['messageSid']
        }
    },
    {
        name: 'phony_get_conversation',
        description: 'Get all SMS messages between two phone numbers (conversation history)',
        inputSchema: {
            type: 'object',
            properties: {
                phoneNumber1: {
                    type: 'string',
                    description: 'First phone number in E.164 format'
                },
                phoneNumber2: {
                    type: 'string',
                    description: 'Second phone number in E.164 format'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of messages to return (default: 100)'
                }
            },
            required: ['phoneNumber1', 'phoneNumber2']
        }
    },
    {
        name: 'phony_create_group_conversation',
        description: 'Create a new group SMS conversation with multiple participants',
        inputSchema: {
            type: 'object',
            properties: {
                participants: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of participant phone numbers in E.164 format (minimum 3 for a group)'
                },
                createdBy: {
                    type: 'string',
                    description: 'Phone number of the creator in E.164 format'
                },
                name: {
                    type: 'string',
                    description: 'Optional name for the group conversation'
                }
            },
            required: ['participants', 'createdBy']
        }
    },
    {
        name: 'phony_list_conversations',
        description: 'List all conversations for a phone number',
        inputSchema: {
            type: 'object',
            properties: {
                phoneNumber: {
                    type: 'string',
                    description: 'Phone number in E.164 format'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of conversations to return (default: 50)'
                }
            },
            required: ['phoneNumber']
        }
    },
    {
        name: 'phony_get_conversation_details',
        description: 'Get detailed information about a specific conversation',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation ID'
                }
            },
            required: ['conversationId']
        }
    },
    {
        name: 'phony_get_conversation_messages',
        description: 'Get all messages in a conversation by conversation ID',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation ID'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of messages to return (default: 100)'
                }
            },
            required: ['conversationId']
        }
    },
    {
        name: 'phony_add_participant',
        description: 'Add a participant to a group conversation',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation ID'
                },
                phoneNumber: {
                    type: 'string',
                    description: 'Phone number to add in E.164 format'
                }
            },
            required: ['conversationId', 'phoneNumber']
        }
    },
    {
        name: 'phony_remove_participant',
        description: 'Remove a participant from a group conversation',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation ID'
                },
                phoneNumber: {
                    type: 'string',
                    description: 'Phone number to remove in E.164 format'
                }
            },
            required: ['conversationId', 'phoneNumber']
        }
    },
    {
        name: 'phony_update_group_name',
        description: 'Update the name of a group conversation',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation ID'
                },
                name: {
                    type: 'string',
                    description: 'New group name'
                }
            },
            required: ['conversationId', 'name']
        }
    },
    {
        name: 'phony_send_group_sms',
        description: 'Send an SMS/MMS message to all participants in a group conversation',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation ID'
                },
                body: {
                    type: 'string',
                    description: 'The text message to send (max 1600 characters). Can be empty if sending media only.'
                },
                fromNumber: {
                    type: 'string',
                    description: 'Sender phone number in E.164 format'
                },
                mediaUrls: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional array of publicly accessible URLs for media files (images, PDFs, etc.). Max 10 URLs.'
                }
            },
            required: ['conversationId', 'fromNumber']
        }
    }
];

export function createSmsToolHandlers(): Record<string, MCPToolHandler> {
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const smsService = new TwilioSmsService(twilioClient);
    const storageService = new SmsStorageService();
    const conversationService = new ConversationService();

    return {
        phony_list_numbers: async (args: any) => {
            try {
                const includeCapabilities = args.includeCapabilities || false;

                const phoneNumbers = await twilioClient.incomingPhoneNumbers.list();

                const numbers = phoneNumbers.map(number => {
                    const result: any = {
                        phoneNumber: number.phoneNumber,
                        friendlyName: number.friendlyName,
                        sid: number.sid
                    };

                    if (includeCapabilities) {
                        result.capabilities = {
                            sms: number.capabilities?.sms || false,
                            voice: number.capabilities?.voice || false,
                            mms: number.capabilities?.mms || false
                        };
                    }

                    return result;
                });

                return createToolResponse({
                    status: 'success',
                    message: `Found ${numbers.length} phone number(s)`,
                    data: {
                        count: numbers.length,
                        numbers
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error listing phone numbers:', error);
                return createToolError(`Failed to list phone numbers: ${error.message}`);
            }
        },

        phony_search_messages: async (args: any) => {
            try {
                const query = args.query;

                if (!query || typeof query !== 'string' || query.trim().length === 0) {
                    return createToolError('Search query is required');
                }

                const options: any = { query: query.trim() };

                if (args.direction) {
                    options.direction = args.direction as SmsDirection;
                }

                if (args.phoneNumber) {
                    options.phoneNumber = sanitizePhoneNumber(args.phoneNumber);
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

                const messages = await storageService.searchSms(options);

                return createToolResponse({
                    status: 'success',
                    message: `Found ${messages.length} message(s) matching "${query}"`,
                    data: {
                        query,
                        count: messages.length,
                        messages: messages.map(msg => ({
                            messageSid: msg.messageSid,
                            fromNumber: msg.fromNumber,
                            toNumber: msg.toNumber,
                            direction: msg.direction,
                            body: msg.body,
                            status: msg.status,
                            createdAt: msg.createdAt,
                            numMedia: msg.numMedia
                        }))
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error searching messages:', error);
                return createToolError(`Failed to search messages: ${error.message}`);
            }
        },

        phony_send_sms: async (args: any) => {
            try {
                const toNumber = sanitizePhoneNumber(args.toNumber);
                const body = args.body || '';
                const fromNumber = args.fromNumber ? sanitizePhoneNumber(args.fromNumber) : undefined;
                const mediaUrls = args.mediaUrls as string[] | undefined;

                if (!toNumber) {
                    return createToolError('Invalid recipient phone number');
                }

                // Require either body or media
                const hasBody = body && typeof body === 'string' && body.trim().length > 0;
                const hasMedia = mediaUrls && Array.isArray(mediaUrls) && mediaUrls.length > 0;

                if (!hasBody && !hasMedia) {
                    return createToolError('Either message body or media URLs are required');
                }

                // Validate media URLs if provided
                if (hasMedia) {
                    for (const url of mediaUrls) {
                        if (typeof url !== 'string' || !url.startsWith('http')) {
                            return createToolError(`Invalid media URL: ${url}. URLs must be publicly accessible HTTP/HTTPS URLs.`);
                        }
                    }
                    if (mediaUrls.length > 10) {
                        return createToolError('Maximum 10 media URLs allowed per message');
                    }
                }

                const result = await smsService.sendSms(toNumber, body, fromNumber, mediaUrls);

                const messageType = hasMedia ? (hasBody ? 'MMS' : 'MMS (media only)') : 'SMS';

                return createToolResponse({
                    status: 'success',
                    message: `${messageType} sent successfully to ${toNumber}`,
                    data: {
                        messageSid: result.messageSid,
                        status: result.status,
                        toNumber: toNumber,
                        fromNumber: fromNumber || process.env.TWILIO_NUMBER,
                        body: body.trim(),
                        mediaUrls: mediaUrls,
                        mediaCount: mediaUrls?.length || 0,
                        sentAt: new Date().toISOString()
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error sending SMS:', error);
                return createToolError(`Failed to send SMS: ${error.message}`);
            }
        },

        phony_list_messages: async (args: any) => {
            try {
                const options: any = {};

                if (args.direction) {
                    options.direction = args.direction as SmsDirection;
                }

                if (args.fromNumber) {
                    options.fromNumber = sanitizePhoneNumber(args.fromNumber);
                }

                if (args.toNumber) {
                    options.toNumber = sanitizePhoneNumber(args.toNumber);
                }

                if (args.status) {
                    options.status = args.status as SmsStatus;
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

                const messages = await storageService.listSms(options);

                return createToolResponse({
                    status: 'success',
                    message: `Found ${messages.length} message(s)`,
                    data: {
                        count: messages.length,
                        messages: messages.map(msg => ({
                            messageSid: msg.messageSid,
                            fromNumber: msg.fromNumber,
                            toNumber: msg.toNumber,
                            direction: msg.direction,
                            body: msg.body,
                            status: msg.status,
                            createdAt: msg.createdAt,
                            numMedia: msg.numMedia
                        }))
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error listing messages:', error);
                return createToolError(`Failed to list messages: ${error.message}`);
            }
        },

        phony_get_message: async (args: any) => {
            try {
                const messageSid = args.messageSid;

                if (!messageSid) {
                    return createToolError('Message SID is required');
                }

                const message = await storageService.getSms(messageSid);

                if (!message) {
                    return createToolError(`Message not found: ${messageSid}`);
                }

                return createToolResponse({
                    status: 'success',
                    message: 'Message retrieved successfully',
                    data: {
                        messageSid: message.messageSid,
                        fromNumber: message.fromNumber,
                        toNumber: message.toNumber,
                        direction: message.direction,
                        body: message.body,
                        status: message.status,
                        twilioStatus: message.twilioStatus,
                        errorMessage: message.errorMessage,
                        errorCode: message.errorCode,
                        numMedia: message.numMedia,
                        mediaUrls: message.mediaUrls,
                        createdAt: message.createdAt,
                        updatedAt: message.updatedAt
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error getting message:', error);
                return createToolError(`Failed to get message: ${error.message}`);
            }
        },

        phony_get_conversation: async (args: any) => {
            try {
                const phoneNumber1 = sanitizePhoneNumber(args.phoneNumber1);
                const phoneNumber2 = sanitizePhoneNumber(args.phoneNumber2);
                const limit = args.limit || 100;

                if (!phoneNumber1 || !phoneNumber2) {
                    return createToolError('Both phone numbers are required');
                }

                const messages = await storageService.getConversation(phoneNumber1, phoneNumber2, limit);

                return createToolResponse({
                    status: 'success',
                    message: `Found ${messages.length} message(s) in conversation`,
                    data: {
                        phoneNumber1,
                        phoneNumber2,
                        messageCount: messages.length,
                        conversation: messages.map(msg => ({
                            messageSid: msg.messageSid,
                            fromNumber: msg.fromNumber,
                            toNumber: msg.toNumber,
                            direction: msg.direction,
                            body: msg.body,
                            status: msg.status,
                            createdAt: msg.createdAt,
                            numMedia: msg.numMedia
                        }))
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error getting conversation:', error);
                return createToolError(`Failed to get conversation: ${error.message}`);
            }
        },

        phony_create_group_conversation: async (args: any) => {
            try {
                const participants = args.participants.map((p: string) => sanitizePhoneNumber(p)).filter(Boolean);
                const createdBy = sanitizePhoneNumber(args.createdBy);
                const name = args.name;

                if (participants.length < 2) {
                    return createToolError('Group conversation must have at least 2 participants');
                }

                if (!createdBy) {
                    return createToolError('Creator phone number is required');
                }

                const conversation = await conversationService.createConversation({
                    participants,
                    createdBy,
                    name
                });

                if (!conversation) {
                    return createToolError('Failed to create group conversation');
                }

                return createToolResponse({
                    status: 'success',
                    message: `Created ${conversation.type} conversation with ${conversation.participants.length} participants`,
                    data: {
                        conversationId: conversation.conversationId,
                        type: conversation.type,
                        participants: conversation.participants,
                        name: conversation.name,
                        createdBy: conversation.createdBy,
                        createdAt: conversation.createdAt
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error creating group conversation:', error);
                return createToolError(`Failed to create group conversation: ${error.message}`);
            }
        },

        phony_list_conversations: async (args: any) => {
            try {
                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);
                const limit = args.limit || 50;

                if (!phoneNumber) {
                    return createToolError('Phone number is required');
                }

                const conversations = await conversationService.listConversations(phoneNumber, limit);

                return createToolResponse({
                    status: 'success',
                    message: `Found ${conversations.length} conversation(s)`,
                    data: {
                        count: conversations.length,
                        conversations: conversations.map(conv => ({
                            conversationId: conv.conversationId,
                            type: conv.type,
                            participants: conv.participants,
                            name: conv.name,
                            messageCount: conv.messageCount,
                            lastMessageAt: conv.lastMessageAt,
                            createdAt: conv.createdAt
                        }))
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error listing conversations:', error);
                return createToolError(`Failed to list conversations: ${error.message}`);
            }
        },

        phony_get_conversation_details: async (args: any) => {
            try {
                const conversationId = args.conversationId;

                if (!conversationId) {
                    return createToolError('Conversation ID is required');
                }

                const conversation = await conversationService.getConversation(conversationId);

                if (!conversation) {
                    return createToolError(`Conversation not found: ${conversationId}`);
                }

                return createToolResponse({
                    status: 'success',
                    message: 'Conversation retrieved successfully',
                    data: {
                        conversationId: conversation.conversationId,
                        type: conversation.type,
                        participants: conversation.participants,
                        name: conversation.name,
                        createdBy: conversation.createdBy,
                        messageCount: conversation.messageCount,
                        lastMessageAt: conversation.lastMessageAt,
                        createdAt: conversation.createdAt,
                        updatedAt: conversation.updatedAt
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error getting conversation details:', error);
                return createToolError(`Failed to get conversation details: ${error.message}`);
            }
        },

        phony_get_conversation_messages: async (args: any) => {
            try {
                const conversationId = args.conversationId;
                const limit = args.limit || 100;

                if (!conversationId) {
                    return createToolError('Conversation ID is required');
                }

                const messages = await conversationService.getConversationMessages(conversationId, limit);

                return createToolResponse({
                    status: 'success',
                    message: `Found ${messages.length} message(s) in conversation`,
                    data: {
                        conversationId,
                        messageCount: messages.length,
                        messages: messages.map(msg => ({
                            messageSid: msg.messageSid,
                            fromNumber: msg.fromNumber,
                            toNumber: msg.toNumber,
                            direction: msg.direction,
                            body: msg.body,
                            status: msg.status,
                            createdAt: msg.createdAt,
                            numMedia: msg.numMedia
                        }))
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error getting conversation messages:', error);
                return createToolError(`Failed to get conversation messages: ${error.message}`);
            }
        },

        phony_add_participant: async (args: any) => {
            try {
                const conversationId = args.conversationId;
                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);

                if (!conversationId) {
                    return createToolError('Conversation ID is required');
                }

                if (!phoneNumber) {
                    return createToolError('Phone number is required');
                }

                const conversation = await conversationService.addParticipant(conversationId, phoneNumber);

                if (!conversation) {
                    return createToolError('Failed to add participant to conversation');
                }

                return createToolResponse({
                    status: 'success',
                    message: `Added ${phoneNumber} to conversation`,
                    data: {
                        conversationId: conversation.conversationId,
                        participants: conversation.participants,
                        participantCount: conversation.participants.length
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error adding participant:', error);
                return createToolError(`Failed to add participant: ${error.message}`);
            }
        },

        phony_remove_participant: async (args: any) => {
            try {
                const conversationId = args.conversationId;
                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);

                if (!conversationId) {
                    return createToolError('Conversation ID is required');
                }

                if (!phoneNumber) {
                    return createToolError('Phone number is required');
                }

                const conversation = await conversationService.removeParticipant(conversationId, phoneNumber);

                if (!conversation) {
                    return createToolError('Failed to remove participant from conversation');
                }

                return createToolResponse({
                    status: 'success',
                    message: `Removed ${phoneNumber} from conversation`,
                    data: {
                        conversationId: conversation.conversationId,
                        participants: conversation.participants,
                        participantCount: conversation.participants.length
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error removing participant:', error);
                return createToolError(`Failed to remove participant: ${error.message}`);
            }
        },

        phony_update_group_name: async (args: any) => {
            try {
                const conversationId = args.conversationId;
                const name = args.name;

                if (!conversationId) {
                    return createToolError('Conversation ID is required');
                }

                if (!name) {
                    return createToolError('Group name is required');
                }

                const conversation = await conversationService.updateConversationName(conversationId, name);

                if (!conversation) {
                    return createToolError('Failed to update group name');
                }

                return createToolResponse({
                    status: 'success',
                    message: `Updated group name to "${name}"`,
                    data: {
                        conversationId: conversation.conversationId,
                        name: conversation.name
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error updating group name:', error);
                return createToolError(`Failed to update group name: ${error.message}`);
            }
        },

        phony_send_group_sms: async (args: any) => {
            try {
                const conversationId = args.conversationId;
                const body = args.body || '';
                const fromNumber = sanitizePhoneNumber(args.fromNumber);
                const mediaUrls = args.mediaUrls as string[] | undefined;

                if (!conversationId) {
                    return createToolError('Conversation ID is required');
                }

                if (!fromNumber) {
                    return createToolError('Sender phone number is required');
                }

                // Require either body or media
                const hasBody = body && typeof body === 'string' && body.trim().length > 0;
                const hasMedia = mediaUrls && Array.isArray(mediaUrls) && mediaUrls.length > 0;

                if (!hasBody && !hasMedia) {
                    return createToolError('Either message body or media URLs are required');
                }

                // Validate media URLs if provided
                if (hasMedia && mediaUrls.length > 10) {
                    return createToolError('Maximum 10 media URLs allowed per message');
                }

                // Get conversation details
                const conversation = await conversationService.getConversation(conversationId);

                if (!conversation) {
                    return createToolError(`Conversation not found: ${conversationId}`);
                }

                // Send SMS/MMS to all participants except sender
                const recipients = conversation.participants.filter(p => p !== fromNumber);
                const results = [];

                for (const recipient of recipients) {
                    try {
                        const result = await smsService.sendSms(recipient, body, fromNumber, mediaUrls);
                        results.push({
                            toNumber: recipient,
                            messageSid: result.messageSid,
                            status: 'sent'
                        });
                    } catch (error: any) {
                        console.error(`[MCP SMS] Error sending to ${recipient}:`, error);
                        results.push({
                            toNumber: recipient,
                            error: error.message,
                            status: 'failed'
                        });
                    }
                }

                const successCount = results.filter(r => r.status === 'sent').length;
                const failCount = results.filter(r => r.status === 'failed').length;
                const messageType = hasMedia ? 'MMS' : 'SMS';

                return createToolResponse({
                    status: 'success',
                    message: `Sent group ${messageType} to ${successCount}/${recipients.length} recipients`,
                    data: {
                        conversationId,
                        recipientCount: recipients.length,
                        successCount,
                        failCount,
                        mediaCount: mediaUrls?.length || 0,
                        results
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error sending group SMS:', error);
                return createToolError(`Failed to send group SMS: ${error.message}`);
            }
        }
    };
}
