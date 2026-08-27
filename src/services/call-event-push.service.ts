import { WebhookDispatcher } from './webhook-dispatcher.service.js';

/**
 * Pushes what is happening on a LIVE call to whichever agent session is
 * controlling it, so that agent does not have to poll.
 *
 * Background: until 2026-08-27 the only way to see inside a running call was to
 * poll `phony_get_call_transcript`, which read the database — and a call's
 * transcript is not written there until the call ends. So a healthy call in
 * progress looked exactly like a dead one, and a caller hung up on a live
 * conversation because of it. Reads now merge live state, but polling is still
 * the wrong shape: the agent has to guess when to look.
 *
 * Two delivery rules here are load-bearing, and both exist because silence is
 * ambiguous:
 *
 *   1. ⛔ A digest is sent even when it carries NO new lines. An empty digest is
 *      the heartbeat — it is the only thing that distinguishes "nobody has
 *      spoken for 30 seconds" from "the push path is broken". Suppressing empty
 *      digests to save traffic re-creates the exact defect this feature exists
 *      to remove.
 *   2. ⛔ The final window is ALWAYS flushed when the call ends. The obvious way
 *      to write a throttle drops whatever accumulated since the last tick, and
 *      on a phone call that tail is usually the outcome — the confirmation
 *      number, the "yes we'll hold it", the reason it failed.
 *
 * Every event also carries a monotonic per-call `seq`, so a receiver can see a
 * gap rather than silently receiving an incomplete picture.
 */

export interface CallTranscriptLine {
    role: string;
    content: string;
    at: string;
}

interface LiveCallPushState {
    seq: number;
    startedAt: number;
    pending: CallTranscriptLine[];
    timer?: NodeJS.Timeout;
    toNumber?: string;
    fromNumber?: string;
}

/** How often a live call reports in. Also the heartbeat interval. */
const DIGEST_INTERVAL_MS = 30_000;

export class CallEventPushService {
    private static instance: CallEventPushService;
    private calls: Map<string, LiveCallPushState> = new Map();
    private dispatcher: WebhookDispatcher;

    private constructor(dispatcher: WebhookDispatcher) {
        this.dispatcher = dispatcher;
    }

    public static getInstance(dispatcher?: WebhookDispatcher): CallEventPushService {
        if (!CallEventPushService.instance) {
            CallEventPushService.instance = new CallEventPushService(dispatcher ?? new WebhookDispatcher());
        }
        return CallEventPushService.instance;
    }

    /**
     * Begin pushing for a call. Safe to call twice — a duplicate start would
     * otherwise leave an orphaned timer running for the life of the process.
     */
    public start(callSid: string, meta?: { toNumber?: string; fromNumber?: string }): void {
        if (this.calls.has(callSid)) return;

        const state: LiveCallPushState = {
            seq: 0,
            startedAt: Date.now(),
            pending: [],
            toNumber: meta?.toNumber,
            fromNumber: meta?.fromNumber,
        };
        state.timer = setInterval(() => {
            this.flush(callSid, 'interval').catch(err =>
                console.error(`[CallPush] digest failed for ${callSid}:`, err)
            );
        }, DIGEST_INTERVAL_MS);
        // Do not hold the process open on account of a call timer.
        state.timer.unref?.();

        this.calls.set(callSid, state);
        console.log(`[CallPush] Tracking ${callSid} — digest every ${DIGEST_INTERVAL_MS / 1000}s`);
    }

    /** Record a transcript line for the next digest. */
    public recordLine(callSid: string, role: string, content: string): void {
        const state = this.calls.get(callSid);
        if (!state || !content) return;
        state.pending.push({ role, content, at: new Date().toISOString() });
    }

    /**
     * Emit an event immediately, bypassing the digest throttle. For things the
     * controlling agent may need to act on within seconds.
     */
    public async emitNow(
        callSid: string,
        event: string,
        data: Record<string, unknown>
    ): Promise<void> {
        const state = this.calls.get(callSid);
        const seq = state ? ++state.seq : 0;
        await this.dispatcher.dispatch(event, {
            call_sid: callSid,
            seq,
            elapsed_seconds: state ? Math.round((Date.now() - state.startedAt) / 1000) : null,
            ...data,
        }, {
            reply: {
                kind: 'call',
                tool: 'phony_inject_context',
                args: { callSid },
                description:
                    `This is a LIVE call. To speak into it, call phony_inject_context with callSid="${callSid}". ` +
                    `To read everything said so far, phony_get_call_transcript. To end it, phony_hangup_call.`,
            },
        }).catch(err => console.error(`[CallPush] ${event} dispatch failed for ${callSid}:`, err));
    }

    /**
     * Send the accumulated lines. `reason` distinguishes a routine tick from the
     * final flush so a receiver can tell the stream ended deliberately.
     */
    private async flush(callSid: string, reason: 'interval' | 'call-ended'): Promise<void> {
        const state = this.calls.get(callSid);
        if (!state) return;

        const lines = state.pending;
        state.pending = [];
        const seq = ++state.seq;

        // ⛔ No early return on an empty `lines`. See rule 1 at the top of this
        // file: the empty digest IS the signal.
        //
        // ⛔⛔ `seq` and `elapsed_seconds` BELOW ARE LOAD-BEARING, NOT DECORATION.
        // ATC dedups on sha256(target | priority | subject | CONTENT) over a
        // 600-second window (confirmed by the atc seat, 2026-08-27). Two
        // consecutive zero-line digests are identical in every other field, so
        // these two varying values are the only reason the second one is not
        // silently swallowed. Strip them to "tidy up" the payload and the
        // heartbeat goes quiet for ten minutes at a stretch — and a suppressed
        // heartbeat is indistinguishable from a dead pipe, which is precisely
        // what this digest exists to rule out.
        await this.dispatcher.dispatch('call.transcript', {
            call_sid: callSid,
            seq,
            reason,
            elapsed_seconds: Math.round((Date.now() - state.startedAt) / 1000),
            to: state.toNumber ?? null,
            from: state.fromNumber ?? null,
            line_count: lines.length,
            lines,
            note: lines.length === 0
                ? 'No new transcript lines in this window. The call is still up — this digest is the heartbeat, not an error.'
                : undefined,
        }, {
            reply: {
                kind: 'call',
                tool: 'phony_inject_context',
                args: { callSid },
                description:
                    `Live call ${callSid}. To speak into it, phony_inject_context. To end it, phony_hangup_call. ` +
                    `Digests arrive every ${DIGEST_INTERVAL_MS / 1000}s while the call is up, including when nothing was said.`,
            },
        }).catch(err => console.error(`[CallPush] digest dispatch failed for ${callSid}:`, err));
    }

    /**
     * Final flush + stop. Idempotent: a call can be ended by the operator, by
     * the far end, or by the duration cap, and more than one of those can fire.
     */
    public async end(callSid: string, summary?: Record<string, unknown>): Promise<void> {
        const state = this.calls.get(callSid);
        if (!state) return;

        if (state.timer) clearInterval(state.timer);

        // Flush BEFORE removing the state, or the tail is lost — which is
        // usually the part that says how the call actually turned out.
        await this.flush(callSid, 'call-ended');

        const seq = ++state.seq;
        const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
        this.calls.delete(callSid);

        await this.dispatcher.dispatch('call.ended', {
            call_sid: callSid,
            seq,
            elapsed_seconds: elapsed,
            to: state.toNumber ?? null,
            from: state.fromNumber ?? null,
            final_seq: seq,
            note: `Stream complete for ${callSid}. No further events will arrive for this call; seq ran 1..${seq}. A gap in that range means a delivery was lost, not that the call was quiet.`,
            ...summary,
        }).catch(err => console.error(`[CallPush] call.ended dispatch failed for ${callSid}:`, err));

        console.log(`[CallPush] Stopped tracking ${callSid} after ${elapsed}s, ${seq} events`);
    }

    /** Is this call currently being pushed? Used to avoid double-starting. */
    public isTracking(callSid: string): boolean {
        return this.calls.has(callSid);
    }
}
