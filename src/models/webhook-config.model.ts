import mongoose, { Schema, Document } from 'mongoose';

/**
 * Outbound webhook configuration for phony events.
 *
 * One config = one HTTP destination that subscribes to N event types
 * (`sms.incoming`, `call.ended`, `voicemail.transcribed`, ...) with optional
 * filters. When a phony event fires, WebhookDispatcher looks up every enabled
 * config whose `eventTypes` matches the event name (literal or glob like
 * `sms.*` / `*`) AND whose `filters` all pass against the event payload, then
 * POSTs the envelope to `url`.
 *
 * Filters are AND-combined; each filter field supports comparison operators:
 *   - bare scalar  → equality:  `{ from_number: "+1617…" }`
 *   - { eq: ... }  → equality:  `{ from_number: { eq: "+1617…" } }`
 *   - { ne: ... }  → inequality `{ initiator: { ne: "proxy" } }`
 *   - { in: [...] }→ set member `{ to_number: { in: ["+1617…", "+1857…"] } }`
 *
 * `hmacSecret`, if set, signs the POST body with HMAC-SHA256 in
 * `X-Hub-Signature-256: sha256=<hex>` (GitHub format).
 */

export type FilterValue =
    | string
    | number
    | boolean
    | null
    | { eq: string | number | boolean | null }
    | { ne: string | number | boolean | null }
    | { in: Array<string | number | boolean | null> };

export interface IWebhookFilters {
    // Common event-payload paths exposed as first-class filter fields.
    conversationSid?: FilterValue;
    fromNumber?: FilterValue;
    toNumber?: FilterValue;
    externalNumber?: FilterValue;  // "human on the other end" — `from` for incoming, `to` for outgoing
    phonePair?: FilterValue;       // "<from>|<to>" — matched against payload
    initiator?: FilterValue;       // "mcp" | "proxy" | "system"
    direction?: FilterValue;       // "inbound" | "outbound"
    eventCategory?: FilterValue;   // "sms" | "call" | "voicemail" | "conversation"
}

export interface IDeliveryLogEntry {
    eventId: string;
    eventType: string;
    timestamp: Date;
    statusCode: number | null;     // null = network error / timeout
    durationMs: number;
    attempt: number;
    error?: string;
}

export interface IWebhookConfig extends Document {
    name: string;                  // unique
    label?: string;
    eventTypes: string[];          // ["sms.incoming","call.ended"] | ["sms.*"] | ["*"]
    filters: IWebhookFilters;
    url: string;
    headers?: Record<string, string>;
    hmacSecret?: string;
    enabled: boolean;
    retry: {
        maxAttempts: number;
        initialBackoffMs: number;
    };
    timeoutMs: number;
    // observability
    lastFiredAt?: Date;
    lastError?: string;
    lastEventType?: string;
    deliveryStats: {
        ok: number;
        fail: number;
        consecutiveFailures: number;
    };
    deliveryLog: IDeliveryLogEntry[]; // ring buffer, capped at MAX_LOG_ENTRIES
    createdAt: Date;
    updatedAt: Date;
}

export const WEBHOOK_LOG_CAP = 100;

const DeliveryLogEntrySchema = new Schema<IDeliveryLogEntry>({
    eventId:    { type: String, required: true },
    eventType:  { type: String, required: true },
    timestamp:  { type: Date, required: true },
    statusCode: { type: Schema.Types.Mixed, default: null },
    durationMs: { type: Number, required: true },
    attempt:    { type: Number, required: true },
    error:      { type: String },
}, { _id: false });

const WebhookConfigSchema: Schema = new Schema<IWebhookConfig>(
    {
        name:          { type: String, required: true, unique: true, index: true },
        label:         { type: String, default: '' },
        eventTypes:    { type: [String], required: true, index: true },
        filters:       { type: Schema.Types.Mixed, default: {} },
        url:           { type: String, required: true },
        headers:       { type: Schema.Types.Mixed },
        hmacSecret:    { type: String },
        enabled:       { type: Boolean, default: true },
        retry: {
            maxAttempts:      { type: Number, default: 3 },
            initialBackoffMs: { type: Number, default: 1000 },
        },
        timeoutMs:     { type: Number, default: 5000 },
        lastFiredAt:   { type: Date },
        lastError:     { type: String },
        lastEventType: { type: String },
        deliveryStats: {
            ok:                   { type: Number, default: 0 },
            fail:                 { type: Number, default: 0 },
            consecutiveFailures:  { type: Number, default: 0 },
        },
        deliveryLog:   { type: [DeliveryLogEntrySchema], default: [] },
    },
    { timestamps: true }
);

WebhookConfigSchema.index({ enabled: 1, eventTypes: 1 });

export const WebhookConfigModel = mongoose.model<IWebhookConfig>(
    'WebhookConfig',
    WebhookConfigSchema,
);
