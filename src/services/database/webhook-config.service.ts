import {
    WebhookConfigModel,
    IWebhookConfig,
    IWebhookFilters,
    FilterValue,
    IDeliveryLogEntry,
    WEBHOOK_LOG_CAP,
} from '../../models/webhook-config.model.js';
import { MongoDBService } from './mongodb.service.js';

export interface WebhookCreateInput {
    name: string;
    eventTypes: string[];
    url: string;
    filters?: IWebhookFilters;
    headers?: Record<string, string>;
    hmacSecret?: string;
    label?: string;
    enabled?: boolean;
    retry?: { maxAttempts?: number; initialBackoffMs?: number };
    timeoutMs?: number;
}

export interface WebhookUpdateInput {
    eventTypes?: string[];
    url?: string;
    filters?: IWebhookFilters;
    headers?: Record<string, string>;
    hmacSecret?: string;
    label?: string;
    enabled?: boolean;
    retry?: { maxAttempts?: number; initialBackoffMs?: number };
    timeoutMs?: number;
}

/**
 * CRUD + lookup for outbound phony webhook configs.
 *
 * `findMatching` is the hot path called for every phony event — it issues a
 * single indexed Mongo query keyed on `eventTypes` (using a multikey index
 * with glob-expansion: queries for `sms.incoming` match configs whose
 * `eventTypes` contains `sms.incoming`, `sms.*`, or `*`), then applies
 * `filters` against the payload in-process. Filter cardinality is low so
 * in-process is cheap; fan-out per match is parallel.
 */
export class WebhookConfigService {
    private mongoService: MongoDBService;

    constructor() {
        this.mongoService = MongoDBService.getInstance();
    }

    public async createConfig(data: WebhookCreateInput): Promise<IWebhookConfig> {
        await this.mongoService.connect();
        const cfg = new WebhookConfigModel({
            name: data.name,
            eventTypes: data.eventTypes,
            url: data.url,
            filters: data.filters ?? {},
            headers: data.headers,
            hmacSecret: data.hmacSecret,
            label: data.label ?? '',
            enabled: data.enabled !== false,
            retry: {
                maxAttempts: data.retry?.maxAttempts ?? 3,
                initialBackoffMs: data.retry?.initialBackoffMs ?? 1000,
            },
            timeoutMs: data.timeoutMs ?? 5000,
            deliveryStats: { ok: 0, fail: 0, consecutiveFailures: 0 },
            deliveryLog: [],
        });
        await cfg.save();
        return cfg;
    }

    public async listConfigs(opts: { eventType?: string; enabled?: boolean } = {}): Promise<IWebhookConfig[]> {
        await this.mongoService.connect();
        const q: Record<string, unknown> = {};
        if (opts.enabled !== undefined) q.enabled = opts.enabled;
        if (opts.eventType) q.eventTypes = { $in: expandEventTypeQuery(opts.eventType) };
        return WebhookConfigModel.find(q).sort({ createdAt: -1 }).lean() as unknown as Promise<IWebhookConfig[]>;
    }

    public async getConfig(name: string): Promise<IWebhookConfig | null> {
        await this.mongoService.connect();
        return WebhookConfigModel.findOne({ name }).lean() as unknown as Promise<IWebhookConfig | null>;
    }

    public async updateConfig(name: string, updates: WebhookUpdateInput): Promise<IWebhookConfig | null> {
        await this.mongoService.connect();
        const set: Record<string, unknown> = {};
        for (const k of ['eventTypes', 'url', 'filters', 'headers', 'hmacSecret', 'label', 'enabled', 'timeoutMs'] as const) {
            if (updates[k] !== undefined) set[k] = updates[k];
        }
        if (updates.retry) {
            if (updates.retry.maxAttempts !== undefined) set['retry.maxAttempts'] = updates.retry.maxAttempts;
            if (updates.retry.initialBackoffMs !== undefined) set['retry.initialBackoffMs'] = updates.retry.initialBackoffMs;
        }
        return WebhookConfigModel.findOneAndUpdate({ name }, { $set: set }, { new: true })
            .lean() as unknown as Promise<IWebhookConfig | null>;
    }

    public async deleteConfig(name: string): Promise<boolean> {
        await this.mongoService.connect();
        const r = await WebhookConfigModel.deleteOne({ name });
        return r.deletedCount > 0;
    }

    /**
     * Find all enabled configs that match a given event.
     * `eventType` matches against `eventTypes` (literal or glob like `sms.*`/`*`).
     * `payload` is then run through each candidate's `filters`.
     */
    public async findMatching(eventType: string, payload: Record<string, unknown>): Promise<IWebhookConfig[]> {
        await this.mongoService.connect();
        const candidates = await WebhookConfigModel.find({
            enabled: true,
            eventTypes: { $in: expandEventTypeQuery(eventType) },
        }).lean() as unknown as IWebhookConfig[];
        return candidates.filter(cfg => filtersPass(cfg.filters || {}, payload));
    }

    /** Record a delivery attempt + roll the LRU log + update counters. */
    public async recordDelivery(name: string, entry: IDeliveryLogEntry, ok: boolean): Promise<void> {
        await this.mongoService.connect();
        // Single atomic update: push to log with $slice trim, bump counters.
        const update: Record<string, unknown> = {
            $set: {
                lastFiredAt: entry.timestamp,
                lastEventType: entry.eventType,
                lastError: ok ? '' : (entry.error || `HTTP ${entry.statusCode}`),
            },
            $push: {
                deliveryLog: {
                    $each: [entry],
                    $slice: -WEBHOOK_LOG_CAP, // keep newest N
                },
            },
            $inc: ok
                ? { 'deliveryStats.ok': 1, 'deliveryStats.consecutiveFailures': 0 }
                : { 'deliveryStats.fail': 1, 'deliveryStats.consecutiveFailures': 1 },
        };
        // $inc with 0 is a no-op; reset consecutiveFailures explicitly on success
        if (ok) {
            (update.$set as Record<string, unknown>)['deliveryStats.consecutiveFailures'] = 0;
            delete (update.$inc as Record<string, unknown>)['deliveryStats.consecutiveFailures'];
        }
        await WebhookConfigModel.updateOne({ name }, update);
    }

    /** Mark webhook auto-disabled after sustained failures. Returns whether it was disabled. */
    public async autoDisable(name: string, reason: string): Promise<void> {
        await this.mongoService.connect();
        await WebhookConfigModel.updateOne(
            { name },
            { $set: { enabled: false, lastError: reason } }
        );
    }

    public async recentDeliveries(name: string | undefined, limit: number): Promise<Array<{ name: string; entries: IDeliveryLogEntry[] }>> {
        await this.mongoService.connect();
        const q = name ? { name } : {};
        const configs = await WebhookConfigModel.find(q, { name: 1, deliveryLog: 1 }).lean() as unknown as Array<{ name: string; deliveryLog?: IDeliveryLogEntry[] }>;
        return configs.map(c => ({
            name: c.name,
            entries: (c.deliveryLog || []).slice(-limit).reverse(),
        }));
    }
}

/**
 * Given a literal event type (e.g. `sms.incoming`), return the set of
 * `eventTypes` values that could match it: the literal itself, the
 * category-glob (`sms.*`), and `*`.
 */
function expandEventTypeQuery(eventType: string): string[] {
    const parts = eventType.split('.');
    const out = [eventType, '*'];
    if (parts.length > 1) out.push(`${parts[0]}.*`);
    return out;
}

/** Apply config filters to a payload. All filters AND together. */
function filtersPass(filters: IWebhookFilters, payload: Record<string, unknown>): boolean {
    for (const [key, filter] of Object.entries(filters)) {
        if (filter === undefined || filter === null) continue;
        const path = filterKeyToPayloadPath(key);
        const value = getPayloadValue(payload, path);
        if (!filterMatches(filter as FilterValue, value)) return false;
    }
    return true;
}

/**
 * Map a filter field name (camelCase, e.g. `fromNumber`) to a payload path
 * (snake_case, e.g. `data.from`). We unwrap the envelope's `data` and also
 * accept top-level fields like `initiator`. The mapping is deliberately
 * explicit so filter authors have one place to look.
 */
function filterKeyToPayloadPath(key: string): string[] {
    switch (key) {
        case 'conversationSid': return ['data', 'conversation_sid'];
        case 'fromNumber':      return ['data', 'from'];
        case 'toNumber':        return ['data', 'to'];
        case 'externalNumber':  return ['__external_number']; // computed: from for incoming, to for outgoing
        case 'phonePair':       return ['__phone_pair'];      // computed
        case 'initiator':       return ['data', 'initiator'];
        case 'direction':       return ['data', 'direction'];
        case 'eventCategory':   return ['__event_category'];  // computed
        default:                return ['data', key];         // best-effort
    }
}

function getPayloadValue(payload: Record<string, unknown>, path: string[]): unknown {
    // Computed values
    if (path[0] === '__external_number') {
        // The "human on the other end of the thread" — symmetric across directions.
        // For inbound events (sms.incoming, call.incoming, voicemail.*), this is `from`.
        // For outbound events (sms.outgoing, sms.delivered, sms.failed), this is `to`.
        // Lets one filter cover both directions of a 1-on-1 thread.
        const evt = (payload as any).event;
        const data = (payload as any).data ?? {};
        if (typeof evt !== 'string') return undefined;
        if (evt.endsWith('.incoming') || evt.startsWith('voicemail.')) return data.from;
        if (evt.endsWith('.outgoing') || evt === 'sms.delivered' || evt === 'sms.failed') return data.to;
        // call.ended / call.failed have explicit `direction` — use that
        if (evt.startsWith('call.')) {
            if (data.direction === 'inbound') return data.from;
            if (data.direction === 'outbound') return data.to;
        }
        return undefined;
    }
    if (path[0] === '__phone_pair') {
        const data = (payload as any).data ?? {};
        if (typeof data.from === 'string' && typeof data.to === 'string') {
            return `${data.from}|${data.to}`;
        }
        return undefined;
    }
    if (path[0] === '__event_category') {
        const evt = (payload as any).event;
        if (typeof evt === 'string') return evt.split('.')[0];
        return undefined;
    }
    let cur: unknown = payload;
    for (const seg of path) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[seg];
    }
    return cur;
}

function filterMatches(filter: FilterValue, value: unknown): boolean {
    // Bare scalar = equality
    if (filter === null || typeof filter !== 'object') {
        return value === filter;
    }
    if ('eq' in filter) return value === filter.eq;
    if ('ne' in filter) return value !== filter.ne;
    if ('in' in filter) return Array.isArray(filter.in) && filter.in.includes(value as any);
    return false;
}
