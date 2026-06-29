import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, sanitizePhoneNumber } from '../utils.js';
import { IvrPreflightModel } from '../../models/ivr-preflight.model.js';

/**
 * IVR Preflight Registry tools — manage per-target-number dtmfPreflight
 * strings that phony_create_call auto-applies when no explicit preflight is
 * passed. Useful for barge-in-disabled IVRs (e.g. Petco) where the agent
 * can't fire DTMF in time and the right move is carrier-level sendDigits
 * with precisely-timed digits.
 */

export const ivrToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_ivr_preflight_set',
        description: 'Register (or update) the dtmfPreflight Twilio sendDigits string for a target phone number. phony_create_call will auto-apply this preflight when called against that number without an explicit dtmfPreflight. Use for barge-in-disabled IVRs that need precisely-timed carrier-level DTMF (e.g. Petco 603-555-0108: pause through Menu 1, spam 0 across Menu 2 operator window).',
        inputSchema: {
            type: 'object',
            properties: {
                phoneNumber: { type: 'string', description: 'Target phone number in E.164 format (e.g. +16035550108)' },
                preflight: { type: 'string', description: 'Twilio sendDigits string. Digits 0-9 * # A-D. `w` = 0.5s pause, `W` = 1s pause. Example: "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww0w0w0w0w0w0" (38w pause then 6×0 spaced ~700ms apart, aimed at a 19-25s IVR operator-accept window).' },
                notes: { type: 'string', description: 'Free-text rationale / IVR map description (optional)' },
                generation: { type: 'number', description: 'Optional explicit generation number; defaults to incrementing the current one.' },
            },
            required: ['phoneNumber', 'preflight']
        }
    },
    {
        name: 'phony_ivr_preflight_get',
        description: 'Get the registered dtmfPreflight for a specific phone number (if any).',
        inputSchema: {
            type: 'object',
            properties: {
                phoneNumber: { type: 'string', description: 'Target phone number in E.164 format' },
            },
            required: ['phoneNumber']
        }
    },
    {
        name: 'phony_ivr_preflight_list',
        description: 'List all registered IVR preflights (enabled + disabled).',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'phony_ivr_preflight_delete',
        description: 'Delete the registered preflight for a phone number. phony_create_call will no longer auto-apply it.',
        inputSchema: {
            type: 'object',
            properties: {
                phoneNumber: { type: 'string', description: 'Target phone number in E.164 format' },
            },
            required: ['phoneNumber']
        }
    },
    {
        name: 'phony_ivr_preflight_disable',
        description: 'Soft-disable a registered preflight (entry kept, but no longer auto-applied). Use phony_ivr_preflight_set to re-enable.',
        inputSchema: {
            type: 'object',
            properties: {
                phoneNumber: { type: 'string', description: 'Target phone number in E.164 format' },
            },
            required: ['phoneNumber']
        }
    },
];

export function createIvrToolHandlers(): Record<string, MCPToolHandler> {
    return {
        phony_ivr_preflight_set: async (args) => {
            try {
                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);
                const preflight = String(args.preflight ?? '');
                if (!preflight) return createToolError('preflight is required');
                if (!/^[0-9*#A-Dwa-d]+$/i.test(preflight)) {
                    return createToolError(`preflight contains invalid characters. Allowed: 0-9 * # A-D w W (got: "${preflight.slice(0, 80)}…")`);
                }
                const existing = await IvrPreflightModel.findOne({ phoneNumber }).lean();
                const generation = typeof args.generation === 'number' && args.generation > 0
                    ? args.generation
                    : (existing ? existing.generation + 1 : 1);
                const update: any = { preflight, generation, enabled: true };
                if (typeof args.notes === 'string') update.notes = args.notes;
                const entry = await IvrPreflightModel.findOneAndUpdate(
                    { phoneNumber },
                    update,
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                ).lean();
                return createToolResponse({
                    status: 'success',
                    message: existing ? `Updated IVR preflight for ${phoneNumber} (gen ${generation})` : `Created IVR preflight for ${phoneNumber}`,
                    data: { phoneNumber: entry?.phoneNumber, preflight: entry?.preflight, generation: entry?.generation, enabled: entry?.enabled, notes: entry?.notes ?? null },
                });
            } catch (err: any) {
                return createToolError(`Failed to set IVR preflight: ${err.message}`);
            }
        },

        phony_ivr_preflight_get: async (args) => {
            try {
                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);
                const entry = await IvrPreflightModel.findOne({ phoneNumber }).lean();
                if (!entry) return createToolResponse({ status: 'success', message: 'No registry entry', data: null });
                return createToolResponse({ status: 'success', data: entry });
            } catch (err: any) {
                return createToolError(`Failed to get IVR preflight: ${err.message}`);
            }
        },

        phony_ivr_preflight_list: async () => {
            try {
                const entries = await IvrPreflightModel.find().sort({ updatedAt: -1 }).lean();
                return createToolResponse({
                    status: 'success',
                    data: { count: entries.length, entries: entries.map(e => ({
                        phoneNumber: e.phoneNumber, preflight: e.preflight, enabled: e.enabled,
                        generation: e.generation, derivedFrom: e.derivedFrom ?? null,
                        notes: e.notes ?? null, updatedAt: e.updatedAt,
                    })) },
                });
            } catch (err: any) {
                return createToolError(`Failed to list IVR preflights: ${err.message}`);
            }
        },

        phony_ivr_preflight_delete: async (args) => {
            try {
                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);
                const res = await IvrPreflightModel.deleteOne({ phoneNumber });
                if (res.deletedCount === 0) return createToolResponse({ status: 'success', message: 'No entry to delete', data: null });
                return createToolResponse({ status: 'success', message: `Deleted IVR preflight for ${phoneNumber}` });
            } catch (err: any) {
                return createToolError(`Failed to delete IVR preflight: ${err.message}`);
            }
        },

        phony_ivr_preflight_disable: async (args) => {
            try {
                const phoneNumber = sanitizePhoneNumber(args.phoneNumber);
                const entry = await IvrPreflightModel.findOneAndUpdate(
                    { phoneNumber },
                    { enabled: false },
                    { new: true }
                ).lean();
                if (!entry) return createToolResponse({ status: 'success', message: 'No entry to disable', data: null });
                return createToolResponse({ status: 'success', message: `Disabled IVR preflight for ${phoneNumber}`, data: { phoneNumber, enabled: false } });
            } catch (err: any) {
                return createToolError(`Failed to disable IVR preflight: ${err.message}`);
            }
        },
    };
}
