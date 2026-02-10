import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, validateArgs } from '../utils.js';
import { CallModel } from '../../models/call.model.js';
import { SmsModel } from '../../models/sms.model.js';
import { VoicemailModel } from '../../models/voicemail.model.js';

const RECORD_TYPES = ['call', 'sms', 'voicemail'] as const;
type RecordType = typeof RECORD_TYPES[number];

function getModelAndIdField(recordType: RecordType) {
    switch (recordType) {
        case 'call':
            return { model: CallModel, idField: 'callSid' };
        case 'sms':
            return { model: SmsModel, idField: 'messageSid' };
        case 'voicemail':
            return { model: VoicemailModel, idField: 'recordingSid' };
    }
}

export const tagsToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_add_tags',
        description: 'Add tags to a call, SMS, or voicemail record. Tags are normalized to lowercase. Duplicates are ignored.',
        inputSchema: {
            type: 'object',
            properties: {
                recordType: {
                    type: 'string',
                    description: 'Type of record to tag',
                    enum: ['call', 'sms', 'voicemail']
                },
                recordId: {
                    type: 'string',
                    description: 'Record identifier (callSid for calls, messageSid for SMS, recordingSid for voicemails)'
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags to add (e.g., ["important", "follow-up"])'
                }
            },
            required: ['recordType', 'recordId', 'tags']
        }
    },
    {
        name: 'phony_remove_tags',
        description: 'Remove tags from a call, SMS, or voicemail record',
        inputSchema: {
            type: 'object',
            properties: {
                recordType: {
                    type: 'string',
                    description: 'Type of record',
                    enum: ['call', 'sms', 'voicemail']
                },
                recordId: {
                    type: 'string',
                    description: 'Record identifier (callSid for calls, messageSid for SMS, recordingSid for voicemails)'
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags to remove'
                }
            },
            required: ['recordType', 'recordId', 'tags']
        }
    },
    {
        name: 'phony_search_by_tags',
        description: 'Find calls, SMS messages, and/or voicemails by tags. Can search across all record types or a specific type.',
        inputSchema: {
            type: 'object',
            properties: {
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags to search for'
                },
                recordType: {
                    type: 'string',
                    description: 'Optional: limit search to a specific record type. If omitted, searches all types.',
                    enum: ['call', 'sms', 'voicemail']
                },
                matchAll: {
                    type: 'boolean',
                    description: 'If true, records must have ALL specified tags (AND). If false (default), records with ANY tag match (OR).'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of records to return per type (default: 50)'
                }
            },
            required: ['tags']
        }
    }
];

export function createTagsToolHandlers(): Record<string, MCPToolHandler> {
    return {
        phony_add_tags: async (args) => {
            try {
                validateArgs(args, ['recordType', 'recordId', 'tags']);

                const recordType = args.recordType as RecordType;
                if (!RECORD_TYPES.includes(recordType)) {
                    return createToolError(`Invalid record type: ${recordType}. Must be one of: ${RECORD_TYPES.join(', ')}`);
                }

                const tags: string[] = args.tags;
                if (!Array.isArray(tags) || tags.length === 0) {
                    return createToolError('Tags must be a non-empty array of strings');
                }

                const normalizedTags = tags.map(t => String(t).toLowerCase().trim()).filter(Boolean);
                const { model, idField } = getModelAndIdField(recordType);

                const result = await model.updateOne(
                    { [idField]: args.recordId },
                    { $addToSet: { tags: { $each: normalizedTags } } }
                );

                if (result.matchedCount === 0) {
                    return createToolError(`${recordType} record not found: ${args.recordId}`);
                }

                return createToolResponse({
                    success: true,
                    message: `Added ${normalizedTags.length} tag(s) to ${recordType} ${args.recordId}`,
                    tags: normalizedTags
                });
            } catch (error: any) {
                return createToolError('Failed to add tags', { message: error.message });
            }
        },

        phony_remove_tags: async (args) => {
            try {
                validateArgs(args, ['recordType', 'recordId', 'tags']);

                const recordType = args.recordType as RecordType;
                if (!RECORD_TYPES.includes(recordType)) {
                    return createToolError(`Invalid record type: ${recordType}. Must be one of: ${RECORD_TYPES.join(', ')}`);
                }

                const tags: string[] = args.tags;
                if (!Array.isArray(tags) || tags.length === 0) {
                    return createToolError('Tags must be a non-empty array of strings');
                }

                const normalizedTags = tags.map(t => String(t).toLowerCase().trim()).filter(Boolean);
                const { model, idField } = getModelAndIdField(recordType);

                const result = await model.updateOne(
                    { [idField]: args.recordId },
                    { $pull: { tags: { $in: normalizedTags } } as any }
                );

                if (result.matchedCount === 0) {
                    return createToolError(`${recordType} record not found: ${args.recordId}`);
                }

                return createToolResponse({
                    success: true,
                    message: `Removed ${normalizedTags.length} tag(s) from ${recordType} ${args.recordId}`,
                    tags: normalizedTags
                });
            } catch (error: any) {
                return createToolError('Failed to remove tags', { message: error.message });
            }
        },

        phony_search_by_tags: async (args) => {
            try {
                validateArgs(args, ['tags']);

                const tags: string[] = args.tags;
                if (!Array.isArray(tags) || tags.length === 0) {
                    return createToolError('Tags must be a non-empty array of strings');
                }

                const normalizedTags = tags.map(t => String(t).toLowerCase().trim()).filter(Boolean);
                const matchAll = args.matchAll === true;
                const limit = Math.min(args.limit || 50, 200);

                const tagFilter = matchAll
                    ? { tags: { $all: normalizedTags } }
                    : { tags: { $in: normalizedTags } };

                const typesToSearch: RecordType[] = args.recordType
                    ? [args.recordType as RecordType]
                    : [...RECORD_TYPES];

                const results: any = {};

                for (const type of typesToSearch) {
                    const { model } = getModelAndIdField(type);
                    const records = await model.find(tagFilter)
                        .sort({ createdAt: -1 })
                        .limit(limit);

                    if (type === 'call') {
                        results.calls = records.map((r: any) => ({
                            callSid: r.callSid,
                            fromNumber: r.fromNumber,
                            toNumber: r.toNumber,
                            callType: r.callType,
                            status: r.status,
                            startedAt: r.startedAt,
                            duration: r.duration,
                            tags: r.tags
                        }));
                    } else if (type === 'sms') {
                        results.messages = records.map((r: any) => ({
                            messageSid: r.messageSid,
                            fromNumber: r.fromNumber,
                            toNumber: r.toNumber,
                            direction: r.direction,
                            body: r.body,
                            status: r.status,
                            createdAt: r.createdAt,
                            tags: r.tags
                        }));
                    } else if (type === 'voicemail') {
                        results.voicemails = records.map((r: any) => ({
                            recordingSid: r.recordingSid,
                            callSid: r.callSid,
                            fromNumber: r.fromNumber,
                            toNumber: r.toNumber,
                            duration: r.duration,
                            transcription: r.transcription,
                            status: r.status,
                            isRead: r.isRead,
                            createdAt: r.createdAt,
                            tags: r.tags
                        }));
                    }
                }

                const totalCount = (results.calls?.length || 0) + (results.messages?.length || 0) + (results.voicemails?.length || 0);

                return createToolResponse({
                    tags: normalizedTags,
                    matchAll,
                    totalCount,
                    ...results
                });
            } catch (error: any) {
                return createToolError('Failed to search by tags', { message: error.message });
            }
        }
    };
}
