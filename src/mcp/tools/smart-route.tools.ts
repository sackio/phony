import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, sanitizePhoneNumber } from '../utils.js';
import { SmartRouteThreadModel } from '../../models/smart-route-thread.model.js';

/**
 * Smart-router thread state tools. The phony Claude session uses these to
 * remember which agent session an inbound Ben/Laura SMS was last routed to,
 * so follow-up messages stick with the same agent (unless the human names
 * a different agent or the topic shifts). All state is per (fromNumber,
 * twilioNumber) with a TTL — Mongo sweeps expired rows automatically.
 */

const DEFAULT_TTL_MINUTES = 30;
const MAX_RECENT_MESSAGES = 10;

function computeExpiry(minutesFromNow: number): Date {
    return new Date(Date.now() + minutesFromNow * 60 * 1000);
}

export const smartRouteToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_smart_route_get',
        description: 'Get the active smart-route thread for a proxy-target sender (Ben/Laura). Returns null if no active thread. Used by the phony session to decide whether to reuse the last-routed agent or pick a new one when a fresh sms.needs_routing event arrives.',
        inputSchema: {
            type: 'object',
            properties: {
                fromNumber: { type: 'string', description: 'Human sender E.164 (e.g. +13015550101)' },
                twilioNumber: { type: 'string', description: 'Phony Twilio number the human texted (optional; if omitted returns any active thread for fromNumber across all twilio numbers, most-recently-updated first).' },
            },
            required: ['fromNumber']
        }
    },
    {
        name: 'phony_smart_route_set',
        description: 'Upsert the active smart-route thread for a proxy-target sender. Sets targetSession, resets expiresAt, optionally records topic + appends latest inbound body to recentMessages (trimmed to last 10). Call after each routing decision.',
        inputSchema: {
            type: 'object',
            properties: {
                fromNumber: { type: 'string', description: 'Human sender E.164' },
                twilioNumber: { type: 'string', description: 'Phony Twilio number the human texted' },
                targetSession: { type: 'string', description: 'ATC session id the message was routed to (e.g. "hvac", "assistant")' },
                topic: { type: 'string', description: 'Optional one-line topic summary. Used later to detect drift.' },
                appendMessage: { type: 'string', description: 'Optional latest inbound body to append to recentMessages ring.' },
                ttlMinutes: { type: 'number', description: `TTL from now (default ${DEFAULT_TTL_MINUTES})` },
            },
            required: ['fromNumber', 'twilioNumber', 'targetSession']
        }
    },
    {
        name: 'phony_smart_route_list',
        description: 'List all active smart-route threads (i.e. all Ben/Laura threads currently routed to an agent). Sorted by most-recently-updated first. Useful when an agent DMs the phony session back with a reply — phony looks up which fromNumber to SMS the reply to.',
        inputSchema: {
            type: 'object',
            properties: {
                targetSession: { type: 'string', description: 'Optional filter: only threads currently pointed at this agent session.' },
            }
        }
    },
    {
        name: 'phony_smart_route_clear',
        description: 'Delete the active smart-route thread for a proxy-target sender. Use when a conversation is explicitly closed, or when the routed agent tells phony "I\'m done" and you want the next inbound to re-route fresh.',
        inputSchema: {
            type: 'object',
            properties: {
                fromNumber: { type: 'string', description: 'Human sender E.164' },
                twilioNumber: { type: 'string', description: 'Phony Twilio number (optional; if omitted, clears all threads for fromNumber).' },
            },
            required: ['fromNumber']
        }
    },
];

export function createSmartRouteToolHandlers(): Record<string, MCPToolHandler> {
    return {
        phony_smart_route_get: async (args) => {
            try {
                const fromNumber = sanitizePhoneNumber(args.fromNumber);
                const query: any = { fromNumber };
                if (args.twilioNumber) query.twilioNumber = sanitizePhoneNumber(args.twilioNumber);
                const entry = await SmartRouteThreadModel.findOne(query).sort({ updatedAt: -1 }).lean();
                if (!entry) return createToolResponse({ status: 'success', message: 'No active thread', data: null });
                return createToolResponse({
                    status: 'success',
                    data: {
                        fromNumber: entry.fromNumber,
                        twilioNumber: entry.twilioNumber,
                        targetSession: entry.targetSession,
                        topic: entry.topic ?? null,
                        recentMessages: entry.recentMessages ?? [],
                        expiresAt: entry.expiresAt,
                        updatedAt: entry.updatedAt,
                    }
                });
            } catch (err: any) {
                return createToolError(`Failed to get smart-route thread: ${err.message}`);
            }
        },

        phony_smart_route_set: async (args) => {
            try {
                const fromNumber = sanitizePhoneNumber(args.fromNumber);
                const twilioNumber = sanitizePhoneNumber(args.twilioNumber);
                const targetSession = String(args.targetSession ?? '').trim();
                if (!targetSession) return createToolError('targetSession is required');
                const ttlMinutes = typeof args.ttlMinutes === 'number' && args.ttlMinutes > 0
                    ? args.ttlMinutes
                    : DEFAULT_TTL_MINUTES;
                const expiresAt = computeExpiry(ttlMinutes);

                const existing = await SmartRouteThreadModel.findOne({ fromNumber, twilioNumber }).lean();
                const recentMessages = (existing?.recentMessages ?? []).slice(-MAX_RECENT_MESSAGES + 1);
                if (typeof args.appendMessage === 'string' && args.appendMessage.length > 0) {
                    recentMessages.push({ ts: new Date(), body: args.appendMessage.slice(0, 500) });
                }

                const update: any = { fromNumber, twilioNumber, targetSession, expiresAt, recentMessages };
                if (typeof args.topic === 'string') update.topic = args.topic;

                const entry = await SmartRouteThreadModel.findOneAndUpdate(
                    { fromNumber, twilioNumber },
                    update,
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                ).lean();

                return createToolResponse({
                    status: 'success',
                    message: existing
                        ? (existing.targetSession === targetSession ? `Refreshed thread ${fromNumber} → ${targetSession}` : `Reassigned thread ${fromNumber}: ${existing.targetSession} → ${targetSession}`)
                        : `Opened thread ${fromNumber} → ${targetSession}`,
                    data: {
                        fromNumber: entry?.fromNumber,
                        twilioNumber: entry?.twilioNumber,
                        targetSession: entry?.targetSession,
                        topic: entry?.topic ?? null,
                        expiresAt: entry?.expiresAt,
                        previousTargetSession: existing?.targetSession ?? null,
                    }
                });
            } catch (err: any) {
                return createToolError(`Failed to set smart-route thread: ${err.message}`);
            }
        },

        phony_smart_route_list: async (args) => {
            try {
                const query: any = {};
                if (args.targetSession) query.targetSession = String(args.targetSession);
                const entries = await SmartRouteThreadModel.find(query).sort({ updatedAt: -1 }).lean();
                return createToolResponse({
                    status: 'success',
                    data: {
                        count: entries.length,
                        threads: entries.map(e => ({
                            fromNumber: e.fromNumber,
                            twilioNumber: e.twilioNumber,
                            targetSession: e.targetSession,
                            topic: e.topic ?? null,
                            lastMessage: e.recentMessages?.length ? e.recentMessages[e.recentMessages.length - 1] : null,
                            expiresAt: e.expiresAt,
                            updatedAt: e.updatedAt,
                        })),
                    }
                });
            } catch (err: any) {
                return createToolError(`Failed to list smart-route threads: ${err.message}`);
            }
        },

        phony_smart_route_clear: async (args) => {
            try {
                const fromNumber = sanitizePhoneNumber(args.fromNumber);
                const query: any = { fromNumber };
                if (args.twilioNumber) query.twilioNumber = sanitizePhoneNumber(args.twilioNumber);
                const res = await SmartRouteThreadModel.deleteMany(query);
                return createToolResponse({
                    status: 'success',
                    message: `Cleared ${res.deletedCount} thread(s)`,
                    data: { deletedCount: res.deletedCount }
                });
            } catch (err: any) {
                return createToolError(`Failed to clear smart-route thread: ${err.message}`);
            }
        },
    };
}
