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
    nextFlushAt: number;
    toNumber?: string;
    fromNumber?: string;
    /**
     * Claimed synchronously by the first `end()` to arrive. The state itself
     * cannot be removed yet — the final flush still needs it — so this is what
     * makes a second concurrent `end()` a no-op. See the note on `end()`.
     */
    ending?: boolean;
}

/**
 * Cadence is adaptive, because the two things a digest does have opposite
 * requirements. Carrying conversation wants to be fast — a call moves in
 * seconds and a thirty-second window can bury an entire exchange. Proving the
 * pipe is alive wants to be slow, because doing it often is pure noise.
 *
 * So: once a line is spoken the digest goes out within CONTENT_DEBOUNCE_MS,
 * and when nobody is speaking the heartbeat falls back to HEARTBEAT_MS. A busy
 * call produces at most ~12 messages a minute; a silent one produces 2.
 */
const CONTENT_DEBOUNCE_MS = 5_000;
const HEARTBEAT_MS = 30_000;

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
            nextFlushAt: 0,
            toNumber: meta?.toNumber,
            fromNumber: meta?.fromNumber,
        };
        this.calls.set(callSid, state);
        this.schedule(callSid, HEARTBEAT_MS);
        console.log(`[CallPush] Tracking ${callSid} — ${CONTENT_DEBOUNCE_MS / 1000}s after speech, ${HEARTBEAT_MS / 1000}s heartbeat`);
    }

    /**
     * Arm the next digest. Only ever brings the flush FORWARD — a pending
     * content flush must not be pushed back by a later heartbeat scheduling.
     *
     * ⛔ THE GUARD BELOW IS ONLY SOUND IF A FIRED TIMER CLEARS ITSELF. `timer`
     * stays truthy after setTimeout fires (Node does not null the handle), and
     * `nextFlushAt` is then a timestamp in the PAST, so `nextFlushAt <= dueAt`
     * is true for every subsequent call — the guard reads "a flush is already
     * due sooner than that" about a flush that already happened, returns, and
     * arms nothing. The stream then goes permanently silent after seq 1.
     *
     * That is not hypothetical. On the A. Duie Pyle call (CA3923f8…, 2026-08-27)
     * seq 1 went out at 9s and the next event was the call-ended flush at 97s:
     * sixteen transcript lines, the whole substantive conversation, delivered
     * only after the call was over. The controlling agent could not have
     * intervened, and the failure was indistinguishable from a quiet line —
     * which is the exact ambiguity this service exists to remove.
     */
    private schedule(callSid: string, delayMs: number): void {
        const state = this.calls.get(callSid);
        if (!state) return;

        const dueAt = Date.now() + delayMs;
        if (state.timer && state.nextFlushAt <= dueAt) return;

        if (state.timer) clearTimeout(state.timer);
        state.nextFlushAt = dueAt;
        state.timer = setTimeout(() => {
            // Release the slot BEFORE flushing, so this timer can never be
            // mistaken for one that is still pending. Anything scheduled during
            // the await below then arms for real.
            const fired = this.calls.get(callSid);
            if (fired) {
                fired.timer = undefined;
                fired.nextFlushAt = 0;
            }
            this.flush(callSid, 'interval')
                .catch(err => console.error(`[CallPush] digest failed for ${callSid}:`, err))
                // Re-arm only after the flush resolves, so a slow dispatch cannot
                // stack digests on top of each other. If a line arrived mid-flush
                // it has already armed a sooner content flush, and the guard above
                // correctly keeps that one.
                .finally(() => this.schedule(callSid, HEARTBEAT_MS));
        }, delayMs);
        // Do not hold the process open on account of a call timer.
        state.timer.unref?.();
    }

    /** Record a transcript line and bring the next digest forward. */
    public recordLine(callSid: string, role: string, content: string): void {
        const state = this.calls.get(callSid);
        if (!state || !content) return;
        state.pending.push({ role, content, at: new Date().toISOString() });
        this.schedule(callSid, CONTENT_DEBOUNCE_MS);
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

        // Log EVERY digest, including the empty heartbeats. Without this the only
        // CallPush entries were "Tracking" and "Stopped tracking", so when the
        // stream died after seq 1 on the Pyle call the 88-second hole left no
        // trace in `docker logs` at all — the log looked exactly like a healthy
        // short call. A cadence bug is only diagnosable if the cadence is visible.
        console.log(`[CallPush] digest ${callSid} seq=${seq} reason=${reason} lines=${lines.length}`);

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
            // ⛔ The note must agree with `reason`. An empty digest means two
            // completely different things depending on why it fired, and this
            // used to key on line_count alone — so a `call-ended` digest went
            // out saying "The call is still up", telling a reader the opposite
            // of what had just happened. Observed on CA266b57f2 seq 17.
            note: lines.length > 0
                ? undefined
                : reason === 'call-ended'
                    ? 'The call ended with nothing said since the previous digest. Not an error — everything spoken is in the digests before this one.'
                    : 'No new transcript lines in this window. The call is still up — this digest is the heartbeat, not an error.',
        }, {
            reply: {
                kind: 'call',
                tool: 'phony_inject_context',
                args: { callSid },
                description:
                    `Live call ${callSid}. To speak into it, phony_inject_context. To end it, phony_hangup_call. ` +
                    `Digests arrive ~${CONTENT_DEBOUNCE_MS / 1000}s after anything is said, and every ${HEARTBEAT_MS / 1000}s while the line is quiet — an empty one is the heartbeat, not an error.`,
            },
        }).catch(err => console.error(`[CallPush] digest dispatch failed for ${callSid}:`, err));
    }

    /**
     * Final flush + stop. Idempotent: a call can be ended by the operator, by
     * the far end, or by the duration cap, and more than one of those can fire.
     *
     * ⛔ IDEMPOTENT MEANS CONCURRENTLY, NOT JUST SEQUENTIALLY. Guarding on
     * `this.calls.get()` alone is a check-then-act race: the map entry is not
     * removed until after `await this.flush()` below, so a second caller
     * arriving inside that await window sees the state still present and
     * proceeds too. Both callers then flush AND both emit `call.stream_complete`.
     *
     * Measured 2026-09-02 on CA9de1d2ee…: call-state.service.ts (`local-teardown`)
     * and voice.server.ts's /call/status handler (`twilio_status`) landed 11ms
     * apart. The stream emitted seq 18 and 19 as duplicate call-ended digests,
     * then seq 20 and 21 as two terminators — one claiming `final_seq: 20,
     * duration_sec: 146`, the other `final_seq: 21, duration_sec: 138`.
     *
     * That is worse than a plain duplicate. This event's entire contract is
     * "seq ran 1..N, and a gap in that range means a delivery was LOST" — so two
     * terminators disagreeing about N tell a subscriber that checks the range to
     * go looking for a dropped message that never existed.
     *
     * ⇒ The claim below must be SYNCHRONOUS: set before the first await, or the
     * window simply moves. The state cannot be deleted here instead, because the
     * final flush still needs `pending` (rule 2 at the top of this file).
     */
    public async end(callSid: string, summary?: Record<string, unknown>): Promise<void> {
        const state = this.calls.get(callSid);
        if (!state) return;
        if (state.ending) return;
        state.ending = true;

        // clearTimeout, not clearInterval — the cadence became an adaptive
        // self-rescheduling timeout. Leaving the old call here would have left
        // the timer armed and the digest firing on a finished call.
        if (state.timer) clearTimeout(state.timer);
        state.timer = undefined;

        // Flush BEFORE removing the state, or the tail is lost — which is
        // usually the part that says how the call actually turned out.
        await this.flush(callSid, 'call-ended');

        const seq = ++state.seq;
        const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
        this.calls.delete(callSid);

        // ⛔ NOT `call.ended` — voice.server.ts already emits that from the Twilio
        // status handler, and emitting a second one under the same name shipped a
        // real duplicate on 2026-08-27: two events for one call, different shapes,
        // with no way for a subscriber to tell which was authoritative. This marks
        // the end of the PUSH STREAM, which is a different fact from the call
        // ending — it also fires when the stream is torn down locally without a
        // Twilio callback, and it is the only event carrying the seq range.
        await this.dispatcher.dispatch('call.stream_complete', {
            call_sid: callSid,
            seq,
            elapsed_seconds: elapsed,
            to: state.toNumber ?? null,
            from: state.fromNumber ?? null,
            final_seq: seq,
            // `duration_sec`, not `duration_seconds` — matching the name the rest
            // of the call events already use. Mine rendered as "?s" until it did.
            duration_sec: elapsed,
            note: `Push stream complete for ${callSid}. No further events will arrive for this call; seq ran 1..${seq}. A gap in that range means a delivery was lost, not that the call was quiet.`,
            ...summary,
        }).catch(err => console.error(`[CallPush] call.stream_complete dispatch failed for ${callSid}:`, err));

        console.log(`[CallPush] Stopped tracking ${callSid} after ${elapsed}s, ${seq} events`);
    }

    /** Is this call currently being pushed? Used to avoid double-starting. */
    public isTracking(callSid: string): boolean {
        return this.calls.has(callSid);
    }
}
