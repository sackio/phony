import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, validateArgs } from '../utils.js';
import { WebhookConfigService } from '../../services/database/webhook-config.service.js';
import { WebhookDispatcher } from '../../services/webhook-dispatcher.service.js';

/**
 * Phony webhook config tools — manage outbound HTTP routes that fire when a
 * phony event matches a configured `(eventTypes, filters)` rule. Used to
 * bridge phony events into other systems (ATC, home-assistant, n8n, ...).
 *
 * eventTypes:
 *   Array of event names. Supports glob `sms.*`, `call.*`, `*`. See
 *   `phony_webhook_list_event_types` for the live catalog.
 *
 * filters:
 *   Object whose keys map to payload fields. Values are either bare scalars
 *   (= eq) or `{eq: X}` / `{ne: X}` / `{in: [...]}`. All filters AND together.
 *   Supported filter fields: conversationSid, fromNumber, toNumber, phonePair,
 *   initiator, direction, eventCategory.
 */

export const EVENT_CATALOG: Array<{
    event: string;
    description: string;
    fields: Record<string, string>;
}> = [
    {
        event: 'sms.incoming',
        description: 'An SMS arrived (1-on-1 or group MMS).',
        fields: {
            message_sid: 'Twilio Message SID',
            conversation_sid: 'group Conversation SID (CH…) or null for 1-on-1',
            conversation_label: 'group slug (e.g. "0101-grp") or null',
            from: 'E.164 sender',
            from_label: 'display name if known, else null',
            to: 'E.164 Twilio number',
            body: 'message text',
            media_urls: 'array of public media URLs',
            num_segments: '(1-on-1 only) Twilio segment count',
        },
    },
    {
        event: 'sms.outgoing',
        description: 'Phony sent an SMS (1-on-1) or posted into a group Conversation (fires on the Twilio echo of the post; conversation_sid set, to = "group:<slug>").',
        fields: {
            message_sid: 'Twilio Message SID (SM…) or Conversations Message SID (IM…) for group posts',
            conversation_sid: 'group Conversation SID (CH…) or null for 1-on-1',
            conversation_label: 'group slug or null',
            from: 'E.164 sender (a Phony number)',
            to: 'E.164 recipient, or "group:<slug>" / CH-SID for group posts',
            body: 'message text',
            media_urls: 'array of public media URLs',
            direction: '"outbound"',
            initiator: '"mcp" (user-facing) | "proxy" (notification/system reply)',
            twilio_status: 'Twilio status at send time (queued/sent/etc)',
        },
    },
    {
        event: 'sms.delivered',
        description: 'Twilio confirmed an outbound SMS was delivered. The envelope `reply` hint is conversation-aware: group-tagged messages get a phony_send_group_sms hint; 1-on-1 hints disclose when the recipient is also in an active group.',
        fields: {
            message_sid: 'Twilio Message SID',
            from: 'E.164 sender or null',
            to: 'E.164 recipient or null',
            conversation_sid: 'group Conversation SID (CH…) or null for 1-on-1',
            conversation_label: 'group slug or null',
            delivered_at: 'ISO-8601 delivery timestamp',
        },
    },
    {
        event: 'sms.failed',
        description: 'Twilio reported an outbound SMS as failed or undelivered. The envelope `reply` hint is conversation-aware (see sms.delivered).',
        fields: {
            message_sid: 'Twilio Message SID',
            from: 'E.164 sender or null',
            to: 'E.164 recipient or null',
            conversation_sid: 'group Conversation SID (CH…) or null for 1-on-1',
            conversation_label: 'group slug or null',
            error_code: 'Twilio error code or null',
            error_message: 'Twilio error message or null',
            twilio_status: 'final status (failed|undelivered)',
        },
    },
    {
        event: 'call.incoming',
        description: 'An inbound call arrived at /call/incoming.',
        fields: {
            call_sid: 'Twilio Call SID',
            from: 'E.164 caller',
            to: 'E.164 Twilio number',
            direction: '"inbound"',
        },
    },
    {
        event: 'call.ended',
        description: 'A call completed normally.',
        fields: {
            call_sid: 'Twilio Call SID',
            from: 'E.164 or null',
            to: 'E.164 or null',
            direction: '"inbound" | "outbound"',
            duration_sec: 'call duration in seconds',
            ended_at: 'ISO-8601 end timestamp',
            recording_url: 'recording URL or null',
        },
    },
    {
        event: 'call.transcript',
        description: 'LIVE-CALL DIGEST. Fires every 30 seconds for the whole duration of a call, carrying whatever was said since the previous digest. ⛔ It fires EVEN WHEN NOTHING WAS SAID — a digest with line_count 0 is the heartbeat that tells you the call is still up and the push path is alive. Do not treat an empty digest as an error or as evidence the call is dead. The final digest carries reason "call-ended" and is guaranteed to include the last window, which is usually where the outcome is.',
        fields: {
            call_sid: 'Twilio Call SID',
            seq: 'monotonic per-call counter — a gap means a delivery was lost, not that the call went quiet',
            reason: '"interval" (routine 30s tick) | "call-ended" (final flush)',
            elapsed_seconds: 'seconds since the call started',
            from: 'E.164 or null',
            to: 'E.164 or null',
            line_count: 'number of transcript lines in this digest, may be 0',
            lines: 'array of { role: "user"|"assistant", content, at }',
            note: 'present only on an empty digest, explaining that it is a heartbeat',
        },
    },
    {
        event: 'call.awaiting_input',
        description: 'The AI on a live call needs something it does not have and is WAITING. The far end is listening to silence while this is unanswered, so it is unthrottled and should be treated as urgent. Answer with phony_inject_context.',
        fields: {
            call_sid: 'Twilio Call SID',
            seq: 'monotonic per-call counter',
            elapsed_seconds: 'seconds since the call started',
            question: 'what the agent needs to know',
            requested_by: '"agent" | "system"',
            from: 'E.164 or null',
            to: 'E.164 or null',
            status: 'current call status',
        },
    },
    {
        event: 'call.failed',
        description: 'A call ended in a non-completed terminal state (busy/no-answer/canceled/failed).',
        fields: {
            call_sid: 'Twilio Call SID',
            from: 'E.164 or null',
            to: 'E.164 or null',
            direction: '"inbound" | "outbound"',
            reason: 'Twilio call status (busy|no-answer|canceled|failed)',
            error_message: 'Twilio error message or null',
        },
    },
    {
        event: 'voicemail.received',
        description: 'A voicemail recording was completed (transcription still pending).',
        fields: {
            recording_sid: 'Twilio Recording SID',
            call_sid: 'parent Twilio Call SID',
            from: 'E.164 caller',
            to: 'E.164 Twilio number',
            duration_sec: 'recording duration',
            recording_url: 'recording URL',
            transcription_status: '"pending"',
        },
    },
    {
        event: 'voicemail.transcribed',
        description: 'A voicemail transcription completed.',
        fields: {
            recording_sid: 'Twilio Recording SID',
            call_sid: 'parent Twilio Call SID',
            from: 'E.164 caller or null',
            to: 'E.164 Twilio number or null',
            transcription: 'transcribed text',
            duration_sec: 'recording duration',
        },
    },
    {
        event: 'voicemail.read',
        description: 'A voicemail was marked read via phony_mark_voicemail_read.',
        fields: {
            recording_sid: 'Twilio Recording SID',
            read_at: 'ISO-8601 read timestamp',
        },
    },
    {
        event: 'conversation.created',
        description: 'A group Conversation was created (autocreated by Twilio or explicitly via phony_create_group_conversation).',
        fields: {
            conversation_sid: 'Twilio Conversation SID (CH…)',
            slug: 'group slug (e.g. "0101-grp")',
            friendly_name: 'internal friendly name or null',
            twilio_number: 'E.164 Twilio number hosting the group',
            external_participants: 'array of external E.164 participants',
        },
    },
    {
        event: 'conversation.participant_added',
        description: 'A new external participant joined a group Conversation.',
        fields: {
            conversation_sid: 'Twilio Conversation SID',
            slug: 'group slug',
            address: 'E.164 of the new participant',
        },
    },
    {
        event: 'conversation.participant_removed',
        description: 'An external participant left a group Conversation.',
        fields: {
            conversation_sid: 'Twilio Conversation SID',
            slug: 'group slug or null',
            address: 'E.164 of the departing participant',
        },
    },
    {
        event: 'conversation.removed',
        description: 'A group Conversation was deleted on Twilio.',
        fields: {
            conversation_sid: 'Twilio Conversation SID',
            slug: 'group slug or null',
        },
    },
    {
        event: 'webhook.auto_disabled',
        description: 'A webhook config was auto-disabled after 5 consecutive delivery failures. Subscribe to this to catch silently-dead webhooks (e.g. unsigned configs 401ing at the ATC broker) instead of discovering them weeks later.',
        fields: {
            name: 'webhook config name',
            label: 'human-readable label or null',
            url: 'target URL',
            consecutive_failures: 'failure count that triggered the disable',
            last_error: 'error from the final failed attempt (e.g. "HTTP 401 Unauthorized")',
            last_event_type: 'event type of the delivery that tipped it over',
            hmac_set: 'whether the config had an hmacSecret (false + 401 = the unsigned-webhook failure shape)',
        },
    },
    {
        event: 'sms.proxy_routed',
        description: 'A proxy target (Ben/Laura) replied to Phony and Phony forwarded the message. Fires for both 1-on-1 routing (code or slug→contact) and group routing (slug→group). Use this to track manual replies from the human operator.',
        fields: {
            from_proxy: 'E.164 of the proxy target who replied',
            twilio_number: 'E.164 Twilio number that received the proxy reply',
            parsed_kind: '"code" | "slug"',
            body: 'the routed message body (sans slug/code prefix)',
            routed_via: '"1on1" | "group"',
            routed_to_number: 'E.164 of the external recipient (1on1) or null',
            routed_to_conversation_sid: 'CH-SID (group) or null',
            routed_to_slug: 'group slug (group) or null',
            delivered_message_sid: 'Twilio Message SID of the forwarded message (SM/IM)',
        },
    },
    {
        event: 'sms.needs_routing',
        description: 'A proxy target (Ben/Laura) texted Phony without a recognized reply format (no {slug}:, no 1234:, no "label ..."). Fires so the phony Claude session can pick a target agent from the ATC board and relay the message. The old "Reply formats:" auto-help SMS is suppressed when this event has a live subscriber. Note: `from` and `to` are provided (mirroring sms.incoming) so the standard `fromNumber` / `toNumber` filters work; `from_proxy` / `twilio_number` are aliases retained for semantic clarity.',
        fields: {
            message_sid: 'Twilio Message SID of the inbound',
            from: 'E.164 of the proxy target who sent the message (alias: from_proxy)',
            to: 'E.164 Twilio number that received the message (alias: twilio_number)',
            from_proxy: 'alias of `from` for semantic clarity',
            twilio_number: 'alias of `to` for semantic clarity',
            body: 'raw message body',
            media_urls: 'array of public media URLs (may be empty)',
            num_media: 'attachment count',
            received_at: 'ISO-8601 timestamp',
        },
    },
];

export const webhookToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_webhook_create',
        description: 'Create an outbound webhook for phony events. Fires HTTP POST to `url` when an event matches `eventTypes` AND `filters`. Events are POSTed as a stable envelope: `{event, event_id, occurred_at, source, data, reply?}`. If `hmacSecret` is set, body is signed with HMAC-SHA256 in `X-Hub-Signature-256`. See `phony_webhook_list_event_types` for the event catalog.',
        inputSchema: {
            type: 'object',
            properties: {
                name:       { type: 'string', description: 'Unique identifier for this webhook config' },
                eventTypes: { type: 'array', items: { type: 'string' }, description: 'Event names to subscribe to. Supports glob ("sms.*", "*"). E.g. ["sms.incoming","call.ended"].' },
                url:        { type: 'string', description: 'HTTP endpoint to POST event envelopes to' },
                filters:    { type: 'object', description: 'Optional payload filters. Keys: conversationSid, fromNumber, toNumber, externalNumber, phonePair, initiator, direction, eventCategory. `externalNumber` is the symmetric "human on the other end" (maps to `from` for inbound events, `to` for outbound) — use this to cover both directions of a 1-on-1 thread with a single filter. Values are bare scalars (eq) or {eq|ne|in}. All filters AND together.' },
                headers:    { type: 'object', description: 'Optional extra HTTP headers (merged AFTER defaults)' },
                hmacSecret: { type: 'string', description: 'Optional HMAC-SHA256 secret. If set, signs the POST body in X-Hub-Signature-256: sha256=<hex>' },
                label:      { type: 'string', description: 'Human-readable description (optional)' },
                enabled:    { type: 'boolean', description: 'Whether this webhook is active (default true)' },
                retry:      { type: 'object', description: 'Optional retry config: {maxAttempts (default 3), initialBackoffMs (default 1000)}' },
                timeoutMs:  { type: 'number', description: 'Per-request timeout in milliseconds (default 5000)' },
            },
            required: ['name', 'eventTypes', 'url'],
        },
    },
    {
        name: 'phony_webhook_list',
        description: 'List all configured phony webhook routes. Optionally filter by eventType or enabled state.',
        inputSchema: {
            type: 'object',
            properties: {
                eventType: { type: 'string', description: 'Filter to webhooks subscribed to this event (or a glob covering it)' },
                enabled:   { type: 'boolean', description: 'Filter by enabled state' },
            },
        },
    },
    {
        name: 'phony_webhook_get',
        description: 'Get full details of a single webhook config by name.',
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Name of the webhook' } },
            required: ['name'],
        },
    },
    {
        name: 'phony_webhook_update',
        description: 'Update fields on an existing webhook config.',
        inputSchema: {
            type: 'object',
            properties: {
                name:       { type: 'string' },
                eventTypes: { type: 'array', items: { type: 'string' } },
                url:        { type: 'string' },
                filters:    { type: 'object' },
                headers:    { type: 'object' },
                hmacSecret: { type: 'string' },
                label:      { type: 'string' },
                enabled:    { type: 'boolean' },
                retry:      { type: 'object' },
                timeoutMs:  { type: 'number' },
            },
            required: ['name'],
        },
    },
    {
        name: 'phony_webhook_delete',
        description: 'Delete a webhook config by name.',
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
        },
    },
    {
        name: 'phony_webhook_test',
        description: 'Fire a synthetic event through the real dispatcher path against the named webhook config. Verifies HMAC, headers, and retry path end-to-end. If `sampleEvent` is omitted, uses the webhook\'s first eventType with all required fields filled with `test-*` sentinels.',
        inputSchema: {
            type: 'object',
            properties: {
                name:        { type: 'string', description: 'Webhook config name to test' },
                sampleEvent: { type: 'object', description: 'Optional override: {event, data}. If omitted, generated from the catalog.' },
            },
            required: ['name'],
        },
    },
    {
        name: 'phony_webhook_list_event_types',
        description: 'Return the live catalog of every phony event type and its payload shape. Use this to discover what you can subscribe to and what fields each event carries.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'phony_webhook_recent_deliveries',
        description: 'Return the most recent delivery attempts (status_code, duration, error) for a webhook config — or all configs if `name` is omitted. Powers operator debugging without log access.',
        inputSchema: {
            type: 'object',
            properties: {
                name:  { type: 'string', description: 'Webhook config name (optional)' },
                limit: { type: 'number', description: 'Max entries to return per config (default 20, max 100)' },
            },
        },
    },
];

/**
 * Computed health summary. `consecutiveFailures` only trips if something
 * tried: a born-dead webhook on a quiet channel is byte-identical to a
 * healthy webhook on a quiet channel, and an auto-disabled one reports no
 * errors at all ("a webhook that stopped trying reports no errors").
 */
function health(cfg: any): string {
    const stats = cfg.deliveryStats || { ok: 0, fail: 0, consecutiveFailures: 0 };
    // Cause outranks consequence: "auto_disabled" is equally true of a config
    // that worked for months and then broke, so a disabled-but-unsigned config
    // reports the informative state and lets `enabled: false` carry the rest.
    const cause = !cfg.hmacSecret && isAtcBrokerUrl(cfg.url) ? 'cannot_deliver_unsigned' : null;
    if (!cfg.enabled) {
        const auto = typeof cfg.lastError === 'string' && cfg.lastError.includes('auto-disabled');
        if (cause) return `${cause} (${auto ? 'auto_disabled' : 'disabled'})`;
        return auto ? 'auto_disabled' : 'disabled';
    }
    if (cause) return cause;
    if (stats.consecutiveFailures > 0) return 'failing';
    if (stats.ok === 0 && stats.fail > 0) return 'never_delivered';
    if (stats.ok === 0 && stats.fail === 0) return 'never_fired';
    return 'ok';
}

function shape(cfg: any): Record<string, unknown> {
    return {
        name: cfg.name,
        health: health(cfg),
        label: cfg.label || '',
        eventTypes: cfg.eventTypes,
        filters: cfg.filters || {},
        url: cfg.url,
        headers: cfg.headers || null,
        hmacSecret: cfg.hmacSecret ? '***set***' : null,
        enabled: cfg.enabled,
        retry: cfg.retry,
        timeoutMs: cfg.timeoutMs,
        lastFiredAt: cfg.lastFiredAt ?? null,
        lastError: cfg.lastError ?? null,
        lastEventType: cfg.lastEventType ?? null,
        deliveryStats: cfg.deliveryStats || { ok: 0, fail: 0, consecutiveFailures: 0 },
        createdAt: cfg.createdAt,
        updatedAt: cfg.updatedAt,
    };
}

/**
 * The ATC broker rejects UNSIGNED deliveries with 401 — an hmac-less webhook
 * pointed at it is byte-identical to a healthy one from the caller's side
 * (enabled, no error) yet can never deliver, and auto-disables after 5
 * consecutive failures. Refuse to create that configuration outright; for
 * other receivers (which may not require signing) warn loudly instead.
 */
function isAtcBrokerUrl(url: string): boolean {
    return /\/webhook\/phony\//.test(url);
}

function unsignedWarning(url: string): string | null {
    if (isAtcBrokerUrl(url)) return null; // handled as a hard error at create time
    return 'hmacSecret is NOT set. If this receiver requires signed payloads, every delivery will be rejected while the config continues to look healthy (enabled, no error at create time), and after 5 consecutive failures it will be auto-disabled. Verify end-to-end with phony_webhook_test.';
}
function buildSamplePayload(eventType: string): { event: string; data: Record<string, unknown> } {
    const entry = EVENT_CATALOG.find(e => e.event === eventType);
    if (!entry) {
        return { event: eventType, data: { sample: true, note: `Unknown event type "${eventType}" — sending minimal stub` } };
    }
    const data: Record<string, unknown> = {};
    for (const [field, doc] of Object.entries(entry.fields)) {
        if (doc.startsWith('array')) data[field] = [];
        else if (doc.includes('duration') || doc.includes('seconds')) data[field] = 0;
        else if (doc.includes('ISO-8601')) data[field] = new Date().toISOString();
        else if (doc.startsWith('"')) data[field] = doc.split('"')[1]; // literal from doc
        else data[field] = `test-${field}`;
    }
    return { event: eventType, data };
}

export function createWebhookToolHandlers(
    service: WebhookConfigService,
    dispatcher: WebhookDispatcher,
): Record<string, MCPToolHandler> {
    return {
        phony_webhook_create: async (args) => {
            try {
                validateArgs(args, ['name', 'eventTypes', 'url']);
                if (!Array.isArray(args.eventTypes) || args.eventTypes.length === 0) {
                    return createToolError('eventTypes must be a non-empty array of strings');
                }
                if (!args.hmacSecret && isAtcBrokerUrl(String(args.url))) {
                    return createToolError(
                        'Refusing to create an UNSIGNED webhook pointed at the ATC broker: the broker rejects unsigned deliveries with 401, so this config would look healthy but never deliver a single event. Pass hmacSecret with your session\'s HMAC secret (DM the `atc` session if you don\'t have yours), then verify end-to-end with phony_webhook_test.'
                    );
                }
                const cfg = await service.createConfig({
                    name: String(args.name),
                    eventTypes: args.eventTypes.map(String),
                    url: String(args.url),
                    filters: args.filters || {},
                    headers: args.headers || undefined,
                    hmacSecret: args.hmacSecret ? String(args.hmacSecret) : undefined,
                    label: args.label ? String(args.label) : undefined,
                    enabled: args.enabled !== false,
                    retry: args.retry,
                    timeoutMs: args.timeoutMs,
                });
                const warning = cfg.hmacSecret ? null : unsignedWarning(cfg.url);
                return createToolResponse({
                    config: shape(cfg),
                    ...(warning ? { warning } : {}),
                    message: `Webhook '${cfg.name}' created${warning ? `. WARNING: ${warning}` : ''}`,
                });
            } catch (e: any) {
                return createToolError('Failed to create webhook', { message: e.message });
            }
        },

        phony_webhook_list: async (args) => {
            try {
                const configs = await service.listConfigs({
                    eventType: args.eventType ? String(args.eventType) : undefined,
                    enabled: typeof args.enabled === 'boolean' ? args.enabled : undefined,
                });
                return createToolResponse({ configs: configs.map(shape), total: configs.length });
            } catch (e: any) {
                return createToolError('Failed to list webhooks', { message: e.message });
            }
        },

        phony_webhook_get: async (args) => {
            try {
                validateArgs(args, ['name']);
                const cfg = await service.getConfig(String(args.name));
                if (!cfg) return createToolError(`Webhook '${args.name}' not found`);
                return createToolResponse({ config: shape(cfg) });
            } catch (e: any) {
                return createToolError('Failed to get webhook', { message: e.message });
            }
        },

        phony_webhook_update: async (args) => {
            try {
                validateArgs(args, ['name']);
                const updates: Record<string, unknown> = {};
                for (const k of ['eventTypes', 'url', 'filters', 'headers', 'hmacSecret', 'label', 'enabled', 'retry', 'timeoutMs'] as const) {
                    if (args[k] !== undefined) updates[k] = args[k];
                }
                const updated = await service.updateConfig(String(args.name), updates as any);
                if (!updated) return createToolError(`Webhook '${args.name}' not found`);
                const updWarning = !updated.hmacSecret
                    ? (isAtcBrokerUrl(updated.url)
                        ? 'This webhook targets the ATC broker but has NO hmacSecret — the broker rejects unsigned deliveries with 401, so it cannot deliver anything and will auto-disable after 5 consecutive failures. Set hmacSecret to your session\'s HMAC secret.'
                        : unsignedWarning(updated.url))
                    : null;
                return createToolResponse({
                    config: shape(updated),
                    ...(updWarning ? { warning: updWarning } : {}),
                    message: `Webhook '${args.name}' updated${updWarning ? `. WARNING: ${updWarning}` : ''}`,
                });
            } catch (e: any) {
                return createToolError('Failed to update webhook', { message: e.message });
            }
        },

        phony_webhook_delete: async (args) => {
            try {
                validateArgs(args, ['name']);
                const ok = await service.deleteConfig(String(args.name));
                if (!ok) return createToolError(`Webhook '${args.name}' not found`);
                return createToolResponse({ message: `Webhook '${args.name}' deleted` });
            } catch (e: any) {
                return createToolError('Failed to delete webhook', { message: e.message });
            }
        },

        phony_webhook_test: async (args) => {
            try {
                validateArgs(args, ['name']);
                const cfg = await service.getConfig(String(args.name));
                if (!cfg) return createToolError(`Webhook '${args.name}' not found`);
                let sample: { event: string; data: Record<string, unknown> };
                if (args.sampleEvent && typeof args.sampleEvent === 'object') {
                    sample = {
                        event: String((args.sampleEvent as any).event || cfg.eventTypes[0] || 'sms.incoming'),
                        data: (args.sampleEvent as any).data || {},
                    };
                } else {
                    const eventType = cfg.eventTypes[0] || 'sms.incoming';
                    const expanded = eventType.includes('*')
                        ? (EVENT_CATALOG.find(e => e.event.startsWith(eventType.split('.')[0]))?.event ?? 'sms.incoming')
                        : eventType;
                    sample = buildSamplePayload(expanded);
                }
                const result = await dispatcher.test(sample.event, sample.data, cfg.name);
                return createToolResponse({ ...result, sample });
            } catch (e: any) {
                return createToolError('Failed to test webhook', { message: e.message });
            }
        },

        phony_webhook_list_event_types: async () => {
            try {
                return createToolResponse({ events: EVENT_CATALOG, total: EVENT_CATALOG.length });
            } catch (e: any) {
                return createToolError('Failed to list event types', { message: e.message });
            }
        },

        phony_webhook_recent_deliveries: async (args) => {
            try {
                const limit = Math.min(Math.max(parseInt(String(args.limit ?? 20)) || 20, 1), 100);
                const entries = await service.recentDeliveries(args.name ? String(args.name) : undefined, limit);
                return createToolResponse({ deliveries: entries, total: entries.reduce((acc, e) => acc + e.entries.length, 0) });
            } catch (e: any) {
                return createToolError('Failed to get recent deliveries', { message: e.message });
            }
        },
    };
}
