import { createHmac, randomUUID } from 'node:crypto';
import { WebhookConfigService } from './database/webhook-config.service.js';
import { IWebhookConfig, IDeliveryLogEntry } from '../models/webhook-config.model.js';

/**
 * Dispatches phony events to user-configured webhooks.
 *
 * Hot path called from every event-emitter site (SMS handlers, call status
 * callbacks, voicemail callbacks, Conversations webhook). The dispatcher:
 *   1. Looks up matching WebhookConfig entries via WebhookConfigService.
 *   2. Builds a stable envelope: { event, event_id, occurred_at, source, data, reply? }.
 *   3. POSTs in parallel with per-config timeout. If `hmacSecret` is set,
 *      signs the body with HMAC-SHA256 in `X-Hub-Signature-256` (GitHub format).
 *   4. Retries transient failures (5xx, 408, 429, timeout, network) with
 *      exponential backoff up to retry.maxAttempts.
 *   5. Records each attempt to the per-config delivery log (LRU 100 entries).
 *   6. Auto-disables a webhook after 5 consecutive failures.
 *   7. Dedups against in-process event_id seen-set (1h TTL) — protects from
 *      double-fires (e.g. Conversations webhook + reconciler racing).
 *
 * Failures are isolated per-webhook — one slow URL doesn't block others, and
 * never blocks the event-emitter (callers should fire-and-forget with .catch).
 */

export interface WebhookEnvelope<TData = Record<string, unknown>> {
    event: string;                  // e.g. "sms.incoming"
    event_id: string;               // uuid v4 — receivers MUST dedup on this
    occurred_at: string;            // ISO-8601
    source: 'phony';
    data: TData;
    reply?: {
        kind: string;
        tool: string;
        args: Record<string, string>;
        description: string;
    };
}

const AUTO_DISABLE_THRESHOLD = 5;
const DEDUP_TTL_MS = 60 * 60 * 1000; // 1 hour

export class WebhookDispatcher {
    private configService: WebhookConfigService;
    private seenEventIds: Map<string, number> = new Map(); // event_id → expiresAt epoch ms

    constructor() {
        this.configService = new WebhookConfigService();
    }

    /**
     * Build envelope, look up matching configs, fan-out HTTP POSTs.
     * Returns when all configured webhooks have either responded or exhausted retries.
     */
    public async dispatch(
        event: string,
        data: Record<string, unknown>,
        opts?: { reply?: WebhookEnvelope['reply']; eventId?: string }
    ): Promise<void> {
        const envelope: WebhookEnvelope = {
            event,
            event_id: opts?.eventId ?? randomUUID(),
            occurred_at: new Date().toISOString(),
            source: 'phony',
            data,
            reply: opts?.reply,
        };

        if (this.isDuplicate(envelope.event_id)) {
            console.log(`[WebhookDispatcher] Skipping duplicate event_id=${envelope.event_id} event=${event}`);
            return;
        }

        const matches = await this.configService.findMatching(event, envelope as unknown as Record<string, unknown>);
        if (matches.length === 0) return;

        await Promise.all(matches.map(cfg => this.fireWithRetry(cfg, envelope)));
    }

    /**
     * True if any enabled webhook subscribes to this event and its filters
     * pass against the given payload. Lets emitters conditionally suppress
     * a legacy fallback path when a live subscriber is handling the event.
     */
    public async hasSubscriber(event: string, payload: Record<string, unknown>): Promise<boolean> {
        // findMatching evaluates filters against the ENVELOPE shape (data.from
        // etc.), so wrap the raw payload the same way dispatch() will.
        const matches = await this.configService.findMatching(event, { event, data: payload });
        return matches.length > 0;
    }

    /**
     * Fire a synthetic event through the real dispatcher path. Used by
     * `phony_webhook_test` for end-to-end verification of HMAC, headers, retry.
     * Returns the final delivery outcome of the FIRST matching attempt
     * (so the operator sees what the receiver saw).
     */
    public async test(eventType: string, sampleData: Record<string, unknown>, configName: string): Promise<{
        url: string;
        status_code: number | null;
        response_body: string;
        duration_ms: number;
        attempts: number;
        hmac_sent: boolean;
        error?: string;
    }> {
        const cfg = await this.configService.getConfig(configName);
        if (!cfg) throw new Error(`Webhook config '${configName}' not found`);
        const envelope: WebhookEnvelope = {
            event: eventType,
            event_id: randomUUID(),
            occurred_at: new Date().toISOString(),
            source: 'phony',
            data: sampleData,
        };
        return this.fireWithRetryDetailed(cfg, envelope);
    }

    // --- internals ---

    private isDuplicate(eventId: string): boolean {
        this.pruneSeen();
        if (this.seenEventIds.has(eventId)) return true;
        this.seenEventIds.set(eventId, Date.now() + DEDUP_TTL_MS);
        return false;
    }

    private pruneSeen(): void {
        if (this.seenEventIds.size < 1000) return; // amortized cleanup
        const now = Date.now();
        for (const [k, exp] of this.seenEventIds) {
            if (exp < now) this.seenEventIds.delete(k);
        }
    }

    private async fireWithRetry(cfg: IWebhookConfig, envelope: WebhookEnvelope): Promise<void> {
        await this.fireWithRetryDetailed(cfg, envelope);
    }

    private async fireWithRetryDetailed(cfg: IWebhookConfig, envelope: WebhookEnvelope): Promise<{
        url: string;
        status_code: number | null;
        response_body: string;
        duration_ms: number;
        attempts: number;
        hmac_sent: boolean;
        error?: string;
    }> {
        const maxAttempts = cfg.retry?.maxAttempts ?? 3;
        const initialBackoff = cfg.retry?.initialBackoffMs ?? 1000;
        let lastResult: { statusCode: number | null; responseBody: string; durationMs: number; error?: string } = {
            statusCode: null, responseBody: '', durationMs: 0,
        };

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            lastResult = await this.fireOnce(cfg, envelope, attempt);
            const ok = lastResult.statusCode !== null && lastResult.statusCode >= 200 && lastResult.statusCode < 300;
            const entry: IDeliveryLogEntry = {
                eventId: envelope.event_id,
                eventType: envelope.event,
                timestamp: new Date(),
                statusCode: lastResult.statusCode,
                durationMs: lastResult.durationMs,
                attempt,
                error: ok ? undefined : (lastResult.error || `HTTP ${lastResult.statusCode}`),
            };
            await this.configService.recordDelivery(cfg.name, entry, ok).catch(err =>
                console.error(`[WebhookDispatcher] recordDelivery failed for ${cfg.name}:`, err)
            );

            if (ok) {
                return { url: cfg.url, status_code: lastResult.statusCode, response_body: lastResult.responseBody, duration_ms: lastResult.durationMs, attempts: attempt, hmac_sent: !!cfg.hmacSecret };
            }

            const retriable = isRetriable(lastResult.statusCode, lastResult.error);
            if (!retriable || attempt === maxAttempts) break;

            const backoff = Math.min(initialBackoff * 2 ** (attempt - 1), 30000);
            await sleep(backoff);
        }

        // All attempts failed. Check for auto-disable.
        const fresh = await this.configService.getConfig(cfg.name);
        if (fresh && fresh.deliveryStats.consecutiveFailures >= AUTO_DISABLE_THRESHOLD) {
            await this.configService.autoDisable(
                cfg.name,
                `auto-disabled after ${fresh.deliveryStats.consecutiveFailures} consecutive failures`
            );
            console.error(`[WebhookDispatcher] AUTO-DISABLED ${cfg.name} after ${fresh.deliveryStats.consecutiveFailures} consecutive failures`);
            // Meta-event: without this, an auto-disable is a console line plus
            // a DB flag nobody watches — a dead webhook sat unnoticed for three
            // weeks once. Recursion is bounded: the disabled config no longer
            // matches, and a failing meta-subscriber just disables itself.
            this.dispatch('webhook.auto_disabled', {
                name: cfg.name,
                label: cfg.label ?? null,
                url: cfg.url,
                consecutive_failures: fresh.deliveryStats.consecutiveFailures,
                last_error: lastResult.error ?? `HTTP ${lastResult.statusCode}`,
                last_event_type: envelope.event,
                hmac_set: !!cfg.hmacSecret,
            }).catch(e => console.error('[WebhookDispatcher] webhook.auto_disabled dispatch error:', e));
        }

        return {
            url: cfg.url,
            status_code: lastResult.statusCode,
            response_body: lastResult.responseBody,
            duration_ms: lastResult.durationMs,
            attempts: maxAttempts,
            hmac_sent: !!cfg.hmacSecret,
            error: lastResult.error,
        };
    }

    private async fireOnce(cfg: IWebhookConfig, envelope: WebhookEnvelope, attempt: number): Promise<{
        statusCode: number | null;
        responseBody: string;
        durationMs: number;
        error?: string;
    }> {
        const body = JSON.stringify(envelope);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'phony-webhook/2',
            'X-Phony-Event': envelope.event,
            'X-Phony-Event-Id': envelope.event_id,
            'X-Phony-Delivery-Attempt': String(attempt),
        };
        if (cfg.hmacSecret) {
            const sig = createHmac('sha256', cfg.hmacSecret).update(body).digest('hex');
            headers['X-Hub-Signature-256'] = `sha256=${sig}`;
        }
        // Custom headers merge AFTER defaults — operator may override User-Agent
        // but not X-Phony-* (defaults set those last only if not in cfg.headers).
        if (cfg.headers) {
            for (const [k, v] of Object.entries(cfg.headers)) headers[k] = v;
        }

        const timeoutMs = cfg.timeoutMs ?? 5000;
        const t0 = Date.now();
        try {
            const res = await fetch(cfg.url, {
                method: 'POST', headers, body,
                signal: AbortSignal.timeout(timeoutMs),
            });
            const durationMs = Date.now() - t0;
            const text = await res.text().catch(() => '');
            const truncated = text.length > 500 ? text.slice(0, 500) + '...' : text;
            if (!res.ok) {
                console.error(`[WebhookDispatcher] ${cfg.name} attempt ${attempt} → ${cfg.url}: HTTP ${res.status}`);
                return { statusCode: res.status, responseBody: truncated, durationMs, error: `HTTP ${res.status} ${res.statusText}` };
            }
            console.log(`[WebhookDispatcher] ${cfg.name} attempt ${attempt} → ${cfg.url}: ${res.status} (${durationMs}ms)`);
            return { statusCode: res.status, responseBody: truncated, durationMs };
        } catch (e: any) {
            const durationMs = Date.now() - t0;
            const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
            const msg = isTimeout ? `timeout >${timeoutMs}ms` : (e?.message ?? String(e));
            console.error(`[WebhookDispatcher] ${cfg.name} attempt ${attempt} → ${cfg.url}: ${msg}`);
            return { statusCode: null, responseBody: '', durationMs, error: msg };
        }
    }
}

function isRetriable(status: number | null, _error?: string): boolean {
    // Network/timeout failures: retry
    if (status === null) return true;
    // 5xx, 408, 429: retry
    if (status >= 500 && status < 600) return true;
    if (status === 408 || status === 429) return true;
    // Other 4xx: permanent, don't retry
    return false;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
