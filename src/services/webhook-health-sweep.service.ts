import { WebhookConfigModel, IWebhookConfig } from '../models/webhook-config.model.js';
import { MongoDBService } from './database/mongodb.service.js';

/**
 * Periodic webhook-config health sweep.
 *
 * `consecutiveFailures` only trips if something tried: a config created broken
 * (unsigned, or pointed at a route that doesn't exist) on a quiet channel sits
 * at ok:0/fail:0 forever — indistinguishable from a healthy quiet channel. And
 * an auto-disabled config stops trying, so it reports no errors at all. Five
 * such configs were found by hand on 2026-07-31, one of which had already
 * dropped a real message (Laura's United-claim authorization); this sweep is
 * the mechanism so the next batch is found by machinery, not luck.
 *
 * Reports are delivered by POSTing directly to the ATC broker's /messages
 * endpoint — deliberately NOT through the webhook dispatcher, so the detector
 * shares no failure mode with the thing it watches. The broker enriches at
 * delivery time (e.g. route-existence for each target, which only it knows).
 */

interface SweepFinding {
    name: string;
    bucket: string;
    label: string;
    url: string;
    ok: number;
    fail: number;
    ageDays: number;
    lastError: string | null;
}

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const INITIAL_DELAY_MS = 2 * 60 * 1000;         // let the server settle first
const BORN_SILENT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export class WebhookHealthSweepService {
    private static instance: WebhookHealthSweepService | null = null;
    private timer: NodeJS.Timeout | null = null;
    private readonly intervalMs: number;
    private readonly brokerUrl: string;
    // bucket-transition memory so a stable finding alerts once per process
    // lifetime, not once per sweep (restart repeats are acceptable).
    private reported: Map<string, string> = new Map();

    private constructor() {
        this.intervalMs = parseInt(process.env.WEBHOOK_HEALTH_SWEEP_INTERVAL_MS ?? '') || DEFAULT_INTERVAL_MS;
        this.brokerUrl = (process.env.ATC_BROKER_URL ?? 'http://host.docker.internal:3030').replace(/\/$/, '');
    }

    public static getInstance(): WebhookHealthSweepService {
        if (!this.instance) this.instance = new WebhookHealthSweepService();
        return this.instance;
    }

    public start(): void {
        if (this.intervalMs <= 0) {
            console.log('[WebhookHealthSweep] disabled (WEBHOOK_HEALTH_SWEEP_INTERVAL_MS <= 0)');
            return;
        }
        if (this.timer) return;
        setTimeout(() => this.sweep().catch(e => console.error('[WebhookHealthSweep] initial sweep error:', e)), INITIAL_DELAY_MS);
        this.timer = setInterval(
            () => this.sweep().catch(e => console.error('[WebhookHealthSweep] sweep error:', e)),
            this.intervalMs,
        );
        this.timer.unref?.();
        console.log(`[WebhookHealthSweep] started (every ${Math.round(this.intervalMs / 60000)} min → ${this.brokerUrl}/messages)`);
    }

    public stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    /** Buckets that page. auto_disabled and born_silent ride along in reports
     *  but never trigger one: the disable moment is owned by the real-time
     *  webhook.auto_disabled meta-event (a sweep re-flagging it later would
     *  page about considered decisions), and born_silent alone is
     *  indistinguishable from a healthy quiet channel. */
    private static readonly ACTIONABLE = new Set(['cannot_deliver_unsigned', 'no_broker_route', 'failing', 'never_delivered']);

    private bucketFor(cfg: IWebhookConfig, now: number, routeTargets: Set<string> | null): string | null {
        const stats = cfg.deliveryStats ?? { ok: 0, fail: 0, consecutiveFailures: 0 };
        const brokerTarget = cfg.url.match(/\/webhook\/phony\/([^/?#]+)/)?.[1] ?? null;
        const unsigned = !cfg.hmacSecret && brokerTarget !== null;
        if (!cfg.enabled) {
            const auto = typeof cfg.lastError === 'string' && cfg.lastError.includes('auto-disabled');
            // Deliberately-disabled configs are a considered decision, not a fault.
            return auto ? 'auto_disabled' : null;
        }
        if (unsigned) return 'cannot_deliver_unsigned';
        // Signed but pointed at a route the broker doesn't know: 404s before
        // HMAC is ever evaluated — same silent symptom, different layer. A
        // set-membership test in code, not an enrichment by a standing session.
        if (brokerTarget && routeTargets && !routeTargets.has(brokerTarget)) return 'no_broker_route';
        if (stats.consecutiveFailures > 0) return 'failing';
        if (stats.ok === 0 && stats.fail > 0) return 'never_delivered';
        const createdAt = cfg.createdAt ? new Date(cfg.createdAt).getTime() : now;
        if (stats.ok === 0 && stats.fail === 0 && now - createdAt > BORN_SILENT_MIN_AGE_MS) {
            return 'born_silent';
        }
        return null;
    }

    /** Broker's registered route targets, or null if unreachable (skip the
     *  route check rather than false-page on a broker blip). */
    private async fetchRouteTargets(): Promise<Set<string> | null> {
        try {
            const res = await fetch(`${this.brokerUrl}/phony/routes`, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) return null;
            const body = await res.json() as { targets?: unknown };
            return Array.isArray(body.targets) ? new Set(body.targets.map(String)) : null;
        } catch {
            return null;
        }
    }

    public async sweep(): Promise<void> {
        if (!MongoDBService.getInstance().getIsConnected()) return;
        const now = Date.now();
        const configs = await WebhookConfigModel.find({}).lean<IWebhookConfig[]>();
        const routeTargets = await this.fetchRouteTargets();

        const findings: SweepFinding[] = [];
        for (const cfg of configs) {
            const bucket = this.bucketFor(cfg as IWebhookConfig, now, routeTargets);
            if (!bucket) { this.reported.delete(cfg.name); continue; }
            if (this.reported.get(cfg.name) === bucket) continue; // already alerted in this state
            const stats = cfg.deliveryStats ?? { ok: 0, fail: 0 };
            findings.push({
                name: cfg.name,
                bucket,
                label: cfg.label ?? '',
                url: cfg.url,
                ok: stats.ok ?? 0,
                fail: stats.fail ?? 0,
                ageDays: cfg.createdAt ? Math.round((now - new Date(cfg.createdAt).getTime()) / 86400000) : 0,
                lastError: (cfg.lastError as string | undefined) ?? null,
            });
        }

        const actionable = findings.filter(f => WebhookHealthSweepService.ACTIONABLE.has(f.bucket));
        if (actionable.length === 0) {
            // A clean sweep must be distinguishable from a sweep that never ran
            // — silence reading as health is the exact failure shape this
            // service exists to catch.
            console.log(`[WebhookHealthSweep] clean: ${configs.length} configs checked, 0 actionable${findings.length ? ` (${findings.length} non-paging: ${findings.map(f => `${f.name}[${f.bucket}]`).join(', ')})` : ''}${routeTargets ? '' : ' — route check SKIPPED (broker unreachable)'}`);
            return;
        }

        const lines = findings.map(f =>
            `- **${f.name}** [${f.bucket}] ok:${f.ok}/fail:${f.fail}, age ${f.ageDays}d, target ${f.url}${f.lastError ? `, lastError: ${f.lastError}` : ''}${f.label ? ` — ${f.label}` : ''}`
        );
        const content =
            `Webhook health sweep found ${actionable.length} actionable config(s) (${findings.length} total flagged):\n` +
            lines.join('\n') +
            `\n\nPaging buckets: cannot_deliver_unsigned = enabled but unsigned at the ATC broker (401 every attempt); ` +
            `no_broker_route = signed but the broker has no route for the target (404 before HMAC is evaluated); ` +
            `failing = current consecutive failures; never_delivered = tried and failed every time. ` +
            `Riders (never page alone): auto_disabled = gave up after 5 straight failures (real-time alerting owned by the webhook.auto_disabled event); ` +
            `born_silent = ok:0/fail:0 for >24h with a live route — quiet or dead, verify with phony_webhook_test if in doubt. ` +
            `Route check ${routeTargets ? 'ACTIVE' : 'SKIPPED (broker /phony/routes unreachable this pass)'}. ` +
            `Each name re-alerts only when its bucket changes (or the server restarts) — so a burst of ` +
            `identical alerts with unchanged counts means deploys, not flapping.` +
            // ⛔ This sends from `phony-server`, which is NOT an ATC subscriber.
            // A reply addressed to it returned `sent:0, drop_reason:"no_resolution"`
            // — a silent drop that reads like an ordinary result (atc, 2026-08-28).
            // `phony` is now also subscribed to a ZONE of that name so replies do
            // land, but say the seat outright rather than relying on that.
            `\n\n⇒ Reply to \`phony\` (this alert sends from \`phony-server\`, which is not a subscriber id).`;

        try {
            const res = await fetch(`${this.brokerUrl}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: ['phony', 'atc'],
                    from: 'phony-server',
                    subject: `webhook health sweep: ${actionable.length} actionable finding(s)`,
                    priority: 'warning',
                    content,
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) {
                console.error(`[WebhookHealthSweep] broker POST failed: HTTP ${res.status}`);
                return; // don't mark reported — retry next sweep
            }
            for (const f of findings) this.reported.set(f.name, f.bucket);
            console.log(`[WebhookHealthSweep] reported ${actionable.length} actionable / ${findings.length} flagged config(s) to ATC`);
        } catch (e: any) {
            console.error('[WebhookHealthSweep] broker POST error:', e?.message ?? e);
        }
    }
}
