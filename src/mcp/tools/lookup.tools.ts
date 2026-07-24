import twilio from 'twilio';
import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, sanitizePhoneNumber } from '../utils.js';

/**
 * Twilio Lookup v2 tools. Primary use case: pre-checking line types before
 * bulk SMS so agents don't blast landlines (2026-07-24 incident: an
 * 86-number dealer outreach was ~all landlines — every send bounced 30005
 * and failover doubled the futile traffic).
 *
 * Line types (Twilio line_type_intelligence): mobile, landline, fixedVoip,
 * nonFixedVoip, tollFree, premium, sharedCost, uan, voicemail, pager,
 * unknown. SMS-viable: mobile (always) and voip (usually).
 *
 * Cost: ~$0.008 per number per lookup (line_type_intelligence field).
 */

const MAX_BATCH = 100;

const SMS_VIABLE_TYPES = new Set(['mobile', 'fixedVoip', 'nonFixedVoip']);

async function lookupOne(
    client: twilio.Twilio,
    number: string
): Promise<{ number: string; lineType: string; carrier: string | null; smsViable: boolean; error?: string }> {
    try {
        const res = await client.lookups.v2
            .phoneNumbers(number)
            .fetch({ fields: 'line_type_intelligence' });
        const lti = (res.lineTypeIntelligence ?? {}) as Record<string, any>;
        const lineType = typeof lti.type === 'string' ? lti.type : 'unknown';
        return {
            number,
            lineType,
            carrier: typeof lti.carrier_name === 'string' ? lti.carrier_name : null,
            smsViable: SMS_VIABLE_TYPES.has(lineType),
        };
    } catch (err: any) {
        return { number, lineType: 'error', carrier: null, smsViable: false, error: err.message };
    }
}

export const lookupToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_lookup_number',
        description: 'Look up line type (mobile/landline/voip/tollFree/...) and carrier for one or more phone numbers via Twilio Lookup v2. USE THIS BEFORE ANY BULK SMS: landlines silently bounce (30005/30006) and repeated undeliverable sends hurt carrier reputation. Returns per-number {lineType, carrier, smsViable} plus a smsViable/notViable split for batches. smsViable = mobile or VoIP (VoIP usually but not always receives SMS). Cost ~$0.008 per number.',
        inputSchema: {
            type: 'object',
            properties: {
                number: { type: 'string', description: 'Single phone number in E.164 format (use this OR numbers)' },
                numbers: {
                    type: 'array',
                    items: { type: 'string' },
                    description: `Batch of E.164 numbers (max ${MAX_BATCH}). Looked up sequentially; ~1s per 10 numbers.`
                },
            }
        }
    },
];

export function createLookupToolHandlers(twilioClient: twilio.Twilio): Record<string, MCPToolHandler> {
    return {
        phony_lookup_number: async (args) => {
            try {
                const rawNumbers: string[] = args.numbers ?? (args.number ? [args.number] : []);
                if (rawNumbers.length === 0) {
                    return createToolError('Provide `number` (single) or `numbers` (batch).');
                }
                if (rawNumbers.length > MAX_BATCH) {
                    return createToolError(`Batch too large: ${rawNumbers.length} numbers (max ${MAX_BATCH}). Split into multiple calls.`);
                }
                const numbers = rawNumbers.map((n: string) => sanitizePhoneNumber(n));

                const results = [] as Awaited<ReturnType<typeof lookupOne>>[];
                for (const n of numbers) {
                    results.push(await lookupOne(twilioClient, n));
                }

                const smsViable = results.filter(r => r.smsViable).map(r => r.number);
                const notViable = results.filter(r => !r.smsViable && r.lineType !== 'error');
                const errors = results.filter(r => r.lineType === 'error');

                return createToolResponse({
                    status: 'success',
                    message: `Looked up ${results.length} number(s): ${smsViable.length} SMS-viable, ${notViable.length} not viable${errors.length ? `, ${errors.length} errored` : ''}`,
                    data: {
                        count: results.length,
                        results,
                        smsViable,
                        notViable: notViable.map(r => ({ number: r.number, lineType: r.lineType })),
                        ...(errors.length ? { errors: errors.map(r => ({ number: r.number, error: r.error })) } : {}),
                    }
                });
            } catch (err: any) {
                return createToolError(`Lookup failed: ${err.message}`);
            }
        },
    };
}
