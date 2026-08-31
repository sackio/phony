import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, sanitizePhoneNumber } from '../utils.js';
import { TwilioSmsService } from '../../services/twilio/sms.service.js';
import { TwilioConversationsService } from '../../services/twilio/conversations.service.js';
import { SmsStorageService } from '../../services/sms/storage.service.js';
import { ConversationService } from '../../services/sms/conversation.service.js';
import { TempMediaService, signMediaUrl, signMediaUrls } from '../../services/temp-media.service.js';
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
                },
                mediaFiles: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            filename: { type: 'string', description: 'File name with extension (e.g., "photo.jpg")' },
                            mimeType: { type: 'string', description: 'MIME type (e.g., "image/jpeg")' },
                            data: { type: 'string', description: 'Base64-encoded file content (use this OR path)' },
                            path: { type: 'string', description: 'Absolute path to a file readable by the server (under /mnt/db/ or /tmp/). Preferred over data when the file is on a shared disk — avoids blowing up caller context with base64.' }
                        },
                        required: ['filename', 'mimeType']
                    },
                    description: 'Optional array of files to attach. Supply either "data" (base64) or "path" (absolute path on /mnt/db/ or /tmp/) per item. The server hosts them temporarily for Twilio to fetch. Max 10 files.'
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
        description: 'Create a true group MMS conversation via the Twilio Conversations API. The Twilio number (Phony) joins as a projectedAddress system participant; each external phone number joins as a native SMS participant. Messages posted into the resulting Conversation fan out to all externals as a single native group MMS thread on their phones (US/CA long-code only, 3–10 participants). Returns the Conversation SID and its allocated short slug (e.g. "0101-grp") which proxy targets use to reply via `{slug}: msg`. For 1:1 SMS use phony_send_sms instead.',
        inputSchema: {
            type: 'object',
            properties: {
                participants: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'External phone numbers to include in the group (E.164). Do NOT include the Twilio/Phony number — it is added automatically as the projected address. Minimum 2 externals to activate group-MMS mode (3 total participants including Phony).'
                },
                fromNumber: {
                    type: 'string',
                    description: 'The Twilio number that will host the group (defaults to TWILIO_NUMBER). This becomes the projectedAddress participant — externals see this number as the group sender.'
                },
                friendlyName: {
                    type: 'string',
                    description: 'Optional human-readable label for the Conversation (visible in Twilio Console, not on participant phones).'
                },
                initialMessage: {
                    type: 'string',
                    description: 'Optional first message to post into the Conversation immediately after creation. Twilio fans this out to all externals as native group MMS.'
                }
            },
            required: ['participants']
        }
    },
    {
        name: 'phony_list_conversations',
        description: 'List conversations this Phony instance is tracking. Returns a unified view of both group MMS Conversations (stored with a Twilio CH-SID and slug) and 1-on-1 internal conversation pairings. Groups include participant list, slug, and last activity timestamp.',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    enum: ['all', 'group', 'one-on-one'],
                    description: 'Filter by conversation type (default: all)'
                },
                phoneNumber: {
                    type: 'string',
                    description: 'Optional E.164 phone number — if provided, filters to conversations involving this number (either as a participant in a group or as one side of a 1-on-1).'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of conversations to return (default: 50)'
                }
            }
        }
    },
    {
        name: 'phony_get_conversation_details',
        description: 'Get full details for a specific conversation. Accepts a Twilio Conversation SID (CH…) for group conversations, a group slug (with or without braces, e.g. "{0101-grp}" or "0101-grp"), or the internal 1-on-1 conversationId (conv_…). Returns participants, friendlyName, slug, message count, and last activity.',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation reference — CH-SID, group slug, or conv_… ID'
                }
            },
            required: ['conversationId']
        }
    },
    {
        name: 'phony_get_conversation_messages',
        description: 'Get all messages in a conversation, in chronological order. Accepts the same reference formats as phony_get_conversation_details (CH-SID, slug, or conv_…). For group conversations this pulls every inbound from any external participant plus every outbound Phony posted into the thread.',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation reference — CH-SID, group slug, or conv_… ID'
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
        description: 'Add an external phone number to a group Conversation. The new participant immediately joins the native group MMS thread — Twilio notifies them on next message. Updates the group\'s stored participant list and slug metadata.',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation reference — CH-SID or group slug (e.g. "{0101-grp}" or "0101-grp")'
                },
                phoneNumber: {
                    type: 'string',
                    description: 'E.164 phone number to add (do NOT include the Phony/Twilio number)'
                }
            },
            required: ['conversationId', 'phoneNumber']
        }
    },
    {
        name: 'phony_remove_participant',
        description: 'Remove an external phone number from a group Conversation. They will no longer receive group messages; the other externals see them leave via their native Messages app. Updates the group\'s stored participant list.',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation reference — CH-SID or group slug'
                },
                phoneNumber: {
                    type: 'string',
                    description: 'E.164 phone number to remove'
                }
            },
            required: ['conversationId', 'phoneNumber']
        }
    },
    {
        name: 'phony_update_group_name',
        description: 'Update a group Conversation\'s friendlyName in Twilio. This is an internal label (visible in Twilio Console and the Phony UI); participant phones do NOT see the name because native Messages groups have no shared name field.',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation reference — CH-SID or group slug'
                },
                name: {
                    type: 'string',
                    description: 'New friendlyName'
                }
            },
            required: ['conversationId', 'name']
        }
    },
    {
        name: 'phony_delete_message',
        description: 'Delete a single SMS message from the database by its message SID',
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
        name: 'phony_delete_messages',
        description: 'Delete multiple SMS messages from the database matching the given filters. At least one filter is required.',
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
                    description: 'Filter by sender phone number in E.164 format'
                },
                toNumber: {
                    type: 'string',
                    description: 'Filter by recipient phone number in E.164 format'
                },
                status: {
                    type: 'string',
                    description: 'Filter by message status',
                    enum: ['queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'received']
                },
                startDate: {
                    type: 'string',
                    description: 'Delete messages after this date (ISO format, e.g., 2024-01-15)'
                },
                endDate: {
                    type: 'string',
                    description: 'Delete messages before this date (ISO format, e.g., 2024-01-20)'
                }
            }
        }
    },
    {
        name: 'phony_send_group_sms',
        description: 'Post a message into a group Conversation. Twilio fans this out as native group MMS to every external participant as a single thread on their phones (authored by Phony\'s number). The message does NOT go to Phony\'s internal proxy targets (Ben/Laura) if they are already in the group — they see it natively. 1-on-1 SMS should use phony_send_sms instead.',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Conversation reference — CH-SID or group slug (e.g. "{0101-grp}" or "0101-grp")'
                },
                body: {
                    type: 'string',
                    description: 'Message body (max 1600 chars). May be empty if sending media only.'
                },
                mediaUrls: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional publicly accessible URLs for media (images, PDFs). Max 10. Each max 5MB. Twilio fetches them for the MMS.'
                }
            },
            required: ['conversationId']
        }
    }
];

export function createSmsToolHandlers(): Record<string, MCPToolHandler> {
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const conversationsService = new TwilioConversationsService(twilioClient);
    const smsService = new TwilioSmsService(twilioClient, conversationsService);
    const storageService = new SmsStorageService();
    const conversationService = new ConversationService();
    const tempMediaService = new TempMediaService();

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
                console.log('[MCP SMS] phony_send_sms called with args:', JSON.stringify(args));
                const toNumber = sanitizePhoneNumber(args.toNumber || args.to);
                const body = args.body || args.message || '';
                const fromNumber = (args.fromNumber || args.from) ? sanitizePhoneNumber(args.fromNumber || args.from) : undefined;
                const mediaUrls = args.mediaUrls ? [...(args.mediaUrls as string[])] : [];
                const mediaFiles = args.mediaFiles as Array<{ filename: string; mimeType: string; data?: string; path?: string }> | undefined;

                if (!toNumber) {
                    return createToolError('Invalid recipient phone number');
                }

                // Convert mediaFiles (either data or path) to hosted URLs
                if (mediaFiles && Array.isArray(mediaFiles) && mediaFiles.length > 0) {
                    for (const file of mediaFiles) {
                        if (!file.filename || !file.mimeType) {
                            return createToolError('Each mediaFile must have filename and mimeType');
                        }
                        if (!file.data && !file.path) {
                            return createToolError(`mediaFile "${file.filename}" must have either "data" (base64) or "path" (absolute filesystem path)`);
                        }
                        try {
                            const url = file.path
                                ? tempMediaService.savePathFile(file.filename, file.mimeType, file.path)
                                : tempMediaService.saveBase64File(file.filename, file.mimeType, file.data!);
                            mediaUrls.push(url);
                        } catch (err: any) {
                            return createToolError(`Failed to process media file "${file.filename}": ${err.message}`);
                        }
                    }
                }

                // Require either body or media
                const hasBody = body && typeof body === 'string' && body.trim().length > 0;
                const hasMedia = mediaUrls.length > 0;

                if (!hasBody && !hasMedia) {
                    return createToolError('Either message body, media URLs, or media files are required');
                }

                // Validate media URLs if provided
                if (hasMedia) {
                    for (const url of mediaUrls) {
                        if (typeof url !== 'string' || !url.startsWith('http')) {
                            return createToolError(`Invalid media URL: ${url}. URLs must be publicly accessible HTTP/HTTPS URLs.`);
                        }
                    }
                    if (mediaUrls.length > 10) {
                        return createToolError('Maximum 10 media URLs/files allowed per message');
                    }
                }

                const finalMediaUrls = hasMedia ? mediaUrls : undefined;
                const result = await smsService.sendSms(toNumber, body, fromNumber, finalMediaUrls);

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
                        mediaUrls: finalMediaUrls,
                        mediaCount: finalMediaUrls?.length || 0,
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
                        // Re-signed on the way out: the token stored with the row
                        // has almost certainly expired by now.
                        mediaUrls: signMediaUrls(message.mediaUrls),
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
                const participants: string[] = (args.participants || [])
                    .map((p: string) => sanitizePhoneNumber(p))
                    .filter(Boolean);
                const fromNumber = sanitizePhoneNumber(args.fromNumber) || process.env.TWILIO_NUMBER;
                const friendlyName = args.friendlyName || args.name;
                const initialMessage = args.initialMessage;

                if (!fromNumber) {
                    return createToolError('fromNumber is required (or set TWILIO_NUMBER)');
                }
                // Drop the Twilio number if a caller accidentally included it
                const externals = participants.filter(p => p !== fromNumber);
                if (externals.length < 2) {
                    return createToolError('Group conversation needs at least 2 external participants (3 total with Phony).');
                }
                if (externals.length > 9) {
                    return createToolError('Group MMS supports at most 10 total participants (9 externals + Phony).');
                }

                const convSid = await conversationsService.createGroupConversation(fromNumber, externals, {
                    friendlyName,
                });
                const { slug } = await smsService.registerGroup(convSid, fromNumber, externals, friendlyName);

                let initialMessageSid: string | undefined;
                if (initialMessage && initialMessage.trim()) {
                    const postedSids = await conversationsService.postMessage(convSid, initialMessage.trim());
                    initialMessageSid = postedSids[0];
                    await smsService.persistOutboundGroupMessages(convSid, postedSids, initialMessage.trim());
                    // Outbound proxy echo so Ben/Laura see the kickoff message
                    // even when they aren't in the group themselves.
                    smsService.notifyOutboundGroupMessage(convSid, initialMessage.trim())
                        .catch(err => console.error('[MCP SMS] Outbound group echo (initial) failed:', err));
                }

                return createToolResponse({
                    status: 'success',
                    message: `Created group Conversation {${slug}} with ${externals.length} external participants`,
                    data: {
                        conversationSid: convSid,
                        slug,
                        fromNumber,
                        externalParticipants: externals,
                        friendlyName,
                        initialMessageSid,
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error creating group conversation:', error);
                return createToolError(`Failed to create group conversation: ${error.message}`);
            }
        },

        phony_list_conversations: async (args: any) => {
            try {
                const type = (args.type || 'all') as 'all' | 'group' | 'one-on-one';
                const filterNumber = args.phoneNumber ? sanitizePhoneNumber(args.phoneNumber) : null;
                const limit = args.limit || 50;

                const { GroupConversationModel } = await import('../../models/group-conversation.model.js');

                const result: any[] = [];

                if (type === 'all' || type === 'group') {
                    const groupFilter: any = {};
                    if (filterNumber) {
                        groupFilter.$or = [
                            { twilioNumber: filterNumber },
                            { externalParticipants: filterNumber },
                        ];
                    }
                    const groups = await GroupConversationModel.find(groupFilter)
                        .sort({ lastActivityAt: -1, updatedAt: -1 })
                        .limit(limit)
                        .lean();
                    for (const g of groups) {
                        result.push({
                            type: 'group',
                            conversationSid: g.conversationSid,
                            slug: g.slug,
                            friendlyName: g.friendlyName ?? null,
                            twilioNumber: g.twilioNumber,
                            externalParticipants: g.externalParticipants,
                            lastActivityAt: g.lastActivityAt ?? null,
                            createdAt: g.createdAt,
                        });
                    }
                }

                if (type === 'all' || type === 'one-on-one') {
                    if (filterNumber) {
                        const convs = await conversationService.listConversations(filterNumber, limit);
                        for (const c of convs) {
                            if (c.type === 'group') continue; // groups handled above via GroupConversationModel
                            result.push({
                                type: '1-on-1',
                                conversationId: c.conversationId,
                                participants: c.participants,
                                name: c.name,
                                messageCount: c.messageCount,
                                lastMessageAt: c.lastMessageAt,
                                createdAt: c.createdAt,
                            });
                        }
                    }
                }

                return createToolResponse({
                    status: 'success',
                    message: `Found ${result.length} conversation(s)`,
                    data: { count: result.length, conversations: result.slice(0, limit) },
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error listing conversations:', error);
                return createToolError(`Failed to list conversations: ${error.message}`);
            }
        },

        phony_get_conversation_details: async (args: any) => {
            try {
                const ref = args.conversationId;
                if (!ref) return createToolError('Conversation reference is required');

                const { GroupConversationModel } = await import('../../models/group-conversation.model.js');

                // Try group first: CH-SID or slug
                const groupSid = TwilioSmsService.resolveGroupSid(ref) || (ref.startsWith('CH') ? ref : undefined);
                if (groupSid) {
                    const group = await GroupConversationModel.findOne({ conversationSid: groupSid }).lean();
                    if (group) {
                        // Live participant refresh from Twilio so stale members are caught
                        let liveExternals: string[] = group.externalParticipants;
                        try {
                            liveExternals = await conversationsService.getExternalAddresses(groupSid);
                        } catch { /* ignore — use cached */ }
                        const { SmsModel } = await import('../../models/sms.model.js');
                        const msgCount = await SmsModel.countDocuments({ conversationId: groupSid });
                        return createToolResponse({
                            status: 'success',
                            message: `Group {${group.slug}}`,
                            data: {
                                type: 'group',
                                conversationSid: group.conversationSid,
                                slug: group.slug,
                                friendlyName: group.friendlyName ?? null,
                                twilioNumber: group.twilioNumber,
                                externalParticipants: liveExternals,
                                messageCount: msgCount,
                                lastActivityAt: group.lastActivityAt ?? null,
                                createdAt: group.createdAt,
                                updatedAt: group.updatedAt,
                            }
                        });
                    }
                }

                // Fall through to 1-on-1 internal conversation
                const conv = await conversationService.getConversation(ref);
                if (!conv) return createToolError(`Conversation not found: ${ref}`);
                return createToolResponse({
                    status: 'success',
                    message: '1-on-1 conversation',
                    data: {
                        type: '1-on-1',
                        conversationId: conv.conversationId,
                        participants: conv.participants,
                        name: conv.name,
                        createdBy: conv.createdBy,
                        messageCount: conv.messageCount,
                        lastMessageAt: conv.lastMessageAt,
                        createdAt: conv.createdAt,
                        updatedAt: conv.updatedAt,
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error getting conversation details:', error);
                return createToolError(`Failed to get conversation details: ${error.message}`);
            }
        },

        phony_get_conversation_messages: async (args: any) => {
            try {
                const ref = args.conversationId;
                const limit = args.limit || 100;
                if (!ref) return createToolError('Conversation reference is required');

                // Resolve: group slug/SID -> CH-SID queries SmsModel.conversationId
                const groupSid = TwilioSmsService.resolveGroupSid(ref) || (ref.startsWith('CH') ? ref : undefined);
                if (groupSid) {
                    const { SmsModel } = await import('../../models/sms.model.js');
                    const rows = await SmsModel.find({ conversationId: groupSid })
                        .sort({ createdAt: 1 })
                        .limit(limit)
                        .lean();
                    return createToolResponse({
                        status: 'success',
                        message: `Found ${rows.length} messages in group ${groupSid}`,
                        data: {
                            type: 'group',
                            conversationSid: groupSid,
                            messageCount: rows.length,
                            messages: rows.map(m => ({
                                messageSid: m.messageSid,
                                fromNumber: m.fromNumber,
                                toNumber: m.toNumber,
                                direction: m.direction,
                                body: m.body,
                                status: m.status,
                                createdAt: m.createdAt,
                                numMedia: m.numMedia,
                                mediaUrls: signMediaUrls(m.mediaUrls),
                            }))
                        }
                    });
                }

                // 1-on-1 fallback
                const messages = await conversationService.getConversationMessages(ref, limit);
                return createToolResponse({
                    status: 'success',
                    message: `Found ${messages.length} messages in 1-on-1 ${ref}`,
                    data: {
                        type: '1-on-1',
                        conversationId: ref,
                        messageCount: messages.length,
                        messages: messages.map(m => ({
                            messageSid: m.messageSid,
                            fromNumber: m.fromNumber,
                            toNumber: m.toNumber,
                            direction: m.direction,
                            body: m.body,
                            status: m.status,
                            createdAt: m.createdAt,
                            numMedia: m.numMedia,
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
                const ref = args.conversationId;
                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);
                if (!ref || !phoneNumber) return createToolError('conversationId and phoneNumber are required');

                const groupSid = TwilioSmsService.resolveGroupSid(ref) || (ref.startsWith('CH') ? ref : undefined);
                if (!groupSid) return createToolError(`Group not found: ${ref}. Use a CH-SID or slug.`);

                const { GroupConversationModel } = await import('../../models/group-conversation.model.js');
                const group = await GroupConversationModel.findOne({ conversationSid: groupSid });
                if (!group) return createToolError(`Group record missing for ${groupSid}`);
                if (group.externalParticipants.length >= 9) {
                    return createToolError('Group MMS max 10 total participants reached (9 externals + Phony).');
                }

                await conversationsService.addExternalParticipant(groupSid, phoneNumber);
                if (!group.externalParticipants.includes(phoneNumber)) {
                    group.externalParticipants.push(phoneNumber);
                    group.lastActivityAt = new Date();
                    await group.save();
                }

                return createToolResponse({
                    status: 'success',
                    message: `Added ${phoneNumber} to {${group.slug}}`,
                    data: {
                        conversationSid: groupSid,
                        slug: group.slug,
                        externalParticipants: group.externalParticipants,
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error adding participant:', error);
                return createToolError(`Failed to add participant: ${error.message}`);
            }
        },

        phony_remove_participant: async (args: any) => {
            try {
                const ref = args.conversationId;
                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);
                if (!ref || !phoneNumber) return createToolError('conversationId and phoneNumber are required');

                const groupSid = TwilioSmsService.resolveGroupSid(ref) || (ref.startsWith('CH') ? ref : undefined);
                if (!groupSid) return createToolError(`Group not found: ${ref}`);

                const removed = await conversationsService.removeExternalParticipant(groupSid, phoneNumber);
                if (!removed) return createToolError(`${phoneNumber} is not a participant of ${groupSid}`);

                const { GroupConversationModel } = await import('../../models/group-conversation.model.js');
                const group = await GroupConversationModel.findOne({ conversationSid: groupSid });
                if (group) {
                    group.externalParticipants = group.externalParticipants.filter(p => p !== phoneNumber);
                    group.lastActivityAt = new Date();
                    await group.save();
                }

                return createToolResponse({
                    status: 'success',
                    message: `Removed ${phoneNumber} from {${group?.slug ?? groupSid}}`,
                    data: {
                        conversationSid: groupSid,
                        slug: group?.slug,
                        externalParticipants: group?.externalParticipants ?? [],
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error removing participant:', error);
                return createToolError(`Failed to remove participant: ${error.message}`);
            }
        },

        phony_update_group_name: async (args: any) => {
            try {
                const ref = args.conversationId;
                const name = args.name;
                if (!ref || !name) return createToolError('conversationId and name are required');

                const groupSid = TwilioSmsService.resolveGroupSid(ref) || (ref.startsWith('CH') ? ref : undefined);
                if (!groupSid) return createToolError(`Group not found: ${ref}`);

                await conversationsService.updateFriendlyName(groupSid, name);
                const { GroupConversationModel } = await import('../../models/group-conversation.model.js');
                const group = await GroupConversationModel.findOneAndUpdate(
                    { conversationSid: groupSid },
                    { $set: { friendlyName: name } },
                    { new: true }
                );

                return createToolResponse({
                    status: 'success',
                    message: `Renamed {${group?.slug ?? groupSid}} → "${name}"`,
                    data: { conversationSid: groupSid, slug: group?.slug, friendlyName: name }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error updating group name:', error);
                return createToolError(`Failed to update group name: ${error.message}`);
            }
        },

        phony_delete_message: async (args: any) => {
            try {
                const messageSid = args.messageSid;

                if (!messageSid) {
                    return createToolError('Message SID is required');
                }

                const success = await storageService.deleteSms(messageSid);

                if (!success) {
                    return createToolError(`Message not found: ${messageSid}`);
                }

                return createToolResponse({
                    status: 'success',
                    message: `Message ${messageSid} deleted`
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error deleting message:', error);
                return createToolError(`Failed to delete message: ${error.message}`);
            }
        },

        phony_delete_messages: async (args: any) => {
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

                const hasFilters = args.direction || args.fromNumber || args.toNumber || args.status || args.startDate || args.endDate;
                if (!hasFilters) {
                    return createToolError('At least one filter is required to prevent accidental deletion of all messages');
                }

                const deletedCount = await storageService.deleteManySms(options);

                return createToolResponse({
                    status: 'success',
                    message: `Deleted ${deletedCount} message(s)`,
                    data: { deletedCount }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error deleting messages:', error);
                return createToolError(`Failed to delete messages: ${error.message}`);
            }
        },

        phony_send_group_sms: async (args: any) => {
            try {
                const ref = args.conversationId;
                const body = (args.body || '').toString();
                const mediaUrls: string[] | undefined = Array.isArray(args.mediaUrls) ? args.mediaUrls : undefined;
                if (!ref) return createToolError('conversationId is required');

                const hasBody = body.trim().length > 0;
                const hasMedia = !!(mediaUrls && mediaUrls.length > 0);
                if (!hasBody && !hasMedia) return createToolError('Either body or mediaUrls is required');
                if (hasMedia && mediaUrls!.length > 10) return createToolError('Max 10 media URLs per message');
                if (body.length > 1600) return createToolError(`body too long (${body.length} chars, max 1600)`);

                const groupSid = TwilioSmsService.resolveGroupSid(ref) || (ref.startsWith('CH') ? ref : undefined);
                if (!groupSid) return createToolError(`Group not found: ${ref}. Use a CH-SID or slug.`);

                // Upload media (if any) as Twilio Media resources scoped to the
                // Conversation, then post one message referencing them. Twilio
                // fans out as group MMS. MCS Media uploads are addressed by
                // the Conversation's Chat Service SID — "default" is NOT a
                // valid value (Twilio returns 4000 "Invalid URI parameter:
                // ServiceSid"); we must look up the real IS-prefixed SID.
                const mediaSids: string[] = [];
                if (hasMedia) {
                    let chatServiceSid: string;
                    try {
                        chatServiceSid = await conversationsService.getChatServiceSid(groupSid);
                    } catch (err: any) {
                        return createToolError(`Could not resolve chatServiceSid for ${groupSid}: ${err.message}`);
                    }
                    for (const url of mediaUrls!) {
                        try {
                            // Sign if it is one of ours — a stored URL's token is
                            // long expired, and this fetch would 403 against our
                            // own media gate. Third-party URLs pass through.
                            const res = await fetch(signMediaUrl(url), { redirect: 'follow' });
                            if (!res.ok) throw new Error(`Fetch ${url}: HTTP ${res.status}`);
                            const contentType = res.headers.get('content-type') || 'application/octet-stream';
                            const buf = Buffer.from(await res.arrayBuffer());
                            const form = new FormData();
                            const blob = new Blob([buf], { type: contentType });
                            form.append('Media', blob);
                            const mediaRes = await fetch(
                                `https://mcs.us1.twilio.com/v1/Services/${chatServiceSid}/Media`,
                                {
                                    method: 'POST',
                                    headers: {
                                        Authorization: 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
                                    },
                                    body: form,
                                }
                            );
                            if (!mediaRes.ok) throw new Error(`Media upload HTTP ${mediaRes.status}: ${await mediaRes.text()}`);
                            const payload: any = await mediaRes.json();
                            if (payload.sid) mediaSids.push(payload.sid);
                        } catch (err: any) {
                            console.error(`[MCP SMS] Media upload failed for ${url}:`, err);
                            return createToolError(`Media upload failed for ${url}: ${err.message}`);
                        }
                    }
                }

                const postedSids = await conversationsService.postMessage(groupSid, body.trim(), mediaSids.length ? mediaSids : undefined);
                const messageSid = postedSids[0];
                const slug = TwilioSmsService.getGroupSlug(groupSid);

                // Record what we just sent. The onMessageAdded webhook does NOT
                // fire for REST-created messages, so without this the group
                // thread in SmsModel has inbound only and a read-back check
                // reports a successful send as missing.
                await smsService.persistOutboundGroupMessages(
                    groupSid,
                    postedSids,
                    body.trim(),
                    mediaUrls && mediaUrls.length ? mediaUrls : [],
                );

                // Fire-and-forget proxy echo so Ben/Laura (who aren't members
                // of vendor groups) can see what we just sent on their phones.
                // Mirrors the inbound `notifyGroupMessage` pattern.
                smsService.notifyOutboundGroupMessage(
                    groupSid,
                    body.trim(),
                    mediaUrls && mediaUrls.length ? mediaUrls : undefined,
                ).catch(err => console.error('[MCP SMS] Outbound group echo failed:', err));

                return createToolResponse({
                    status: 'success',
                    message: `Posted to group {${slug ?? groupSid}}`,
                    data: {
                        conversationSid: groupSid,
                        slug,
                        messageSid,
                        mediaCount: mediaSids.length,
                    }
                });
            } catch (error: any) {
                console.error('[MCP SMS] Error posting to group:', error);
                return createToolError(`Failed to post to group: ${error.message}`);
            }
        }
    };
}
