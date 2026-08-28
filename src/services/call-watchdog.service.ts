import { CallStateService } from './call-state.service.js';
import { TwilioCallService } from './twilio/call.service.js';
import {
    ABSOLUTE_MAX_CALL_DURATION,
    MAX_INCOMING_CALL_DURATION,
    MAX_OUTGOING_CALL_DURATION,
} from '../config/constants.js';

/**
 * Periodic reconciliation between what Twilio says is on the phone and what we
 * think is. Kills anything that has outlived its allowance; forgets anything we
 * are still tracking that has already hung up.
 *
 * ⛔ WHY A POLL AND NOT JUST THE PER-CALL TIMER. The duration cap is a
 * `setTimeout` living in this process. It dies with the process. A container
 * restart — and there were five on 2026-08-28 alone — silently removes the cap
 * from every call that was up at the time, leaving a leg with NO ceiling at all
 * and nothing left to notice. The in-process timer is the fast path; this is
 * the one that survives.
 *
 * ⛔ AND NOT JUST THE STATUS WEBHOOK. Teardown also rides on Twilio's
 * `/call/status` callback, which is a network round-trip that can be delayed,
 * misconfigured, or lost. When it failed to arrive on 2026-08-27 the push
 * stream went on insisting a hung-up call was live.
 *
 * ⭐ TWILIO IS THE AUTHORITY, in both directions. Its `startTime` survives our
 * restarts, so age is computed from a clock we cannot lose; its status list is
 * what is actually billing. Our own state is the claim being checked.
 *
 * ⚠️ Deliberately conservative about KILLING and liberal about FORGETTING. A
 * wrongly-killed call drops a real conversation with a real person; wrongly
 * forgetting one only loses bookkeeping that the next pass rebuilds. So the
 * kill path demands an allowance genuinely exceeded, and the forget path only
 * needs Twilio to say the call is gone.
 */

/** How often to reconcile. One Twilio list call per pass. */
const WATCHDOG_INTERVAL_MS = 60_000;

/**
 * Slack on top of an allowance before killing. Covers clock skew between us and
 * Twilio and the lag between the in-process timer firing and teardown landing —
 * we want the timer to win the race in the normal case, and this to fire only
 * when the timer is genuinely gone.
 */
const KILL_GRACE_SEC = 45;

/**
 * A tracked call must be at least this old before its absence from Twilio's
 * live list counts as evidence it ended. A call in setup may not be listed yet,
 * and reaping it would tear down state for a call about to connect.
 */
const REAP_MIN_AGE_SEC = 90;

export class CallWatchdogService {
    private static instance: CallWatchdogService | null = null;
    private handle: ReturnType<typeof setInterval> | null = null;
    private running = false;
    private sweeping = false;

    public static getInstance(): CallWatchdogService {
        if (!CallWatchdogService.instance) CallWatchdogService.instance = new CallWatchdogService();
        return CallWatchdogService.instance;
    }

    public start(): void {
        if (this.running) return;
        this.running = true;
        console.log(
            `[CallWatchdog] Starting — every ${WATCHDOG_INTERVAL_MS / 1000}s. ` +
            `Ceilings: outgoing ${MAX_OUTGOING_CALL_DURATION}s, incoming ${MAX_INCOMING_CALL_DURATION}s, ` +
            `absolute ${ABSOLUTE_MAX_CALL_DURATION}s (+${KILL_GRACE_SEC}s grace).`
        );
        this.sweep().catch(e => console.error('[CallWatchdog] initial sweep failed:', e));
        this.handle = setInterval(
            () => this.sweep().catch(e => console.error('[CallWatchdog] sweep failed:', e)),
            WATCHDOG_INTERVAL_MS
        );
    }

    public stop(): void {
        if (this.handle) clearInterval(this.handle);
        this.handle = null;
        this.running = false;
        console.log('[CallWatchdog] Stopped');
    }

    /**
     * One reconciliation pass.
     *
     * ⚠️ If Twilio cannot be reached this returns having done NOTHING, and says
     * so. It must never look like a pass that ran and found everything healthy
     * — that is the shape of every other bug in this codebase.
     */
    public async sweep(): Promise<{ live: number; killed: number; reaped: number; failed: boolean }> {
        if (this.sweeping) return { live: 0, killed: 0, reaped: 0, failed: false };
        this.sweeping = true;

        try {
            const twilio = TwilioCallService.getInstance();
            const state = CallStateService.getInstance();

            let liveCalls: Array<{ sid: string; startedAt: Date; to: string; from: string }>;
            try {
                liveCalls = await twilio.listLiveCalls();
            } catch (err) {
                console.error(
                    '[CallWatchdog] ⛔ Could not reach Twilio — THIS PASS CHECKED NOTHING. ' +
                    'A runaway call would not have been caught:', err
                );
                return { live: 0, killed: 0, reaped: 0, failed: true };
            }

            const now = Date.now();
            let killed = 0;

            for (const call of liveCalls) {
                const ageSec = (now - call.startedAt.getTime()) / 1000;
                const tracked = state.getCall(call.sid);

                // An untracked live call is the restart case: we lost the timer
                // but the leg is still up and billing. Fall back to the default
                // ceiling for its direction rather than letting it run free.
                const allowance = tracked?.grantedDurationSec
                    ?? (tracked?.callType === 'incoming' ? MAX_INCOMING_CALL_DURATION : MAX_OUTGOING_CALL_DURATION);
                const ceiling = Math.min(allowance, ABSOLUTE_MAX_CALL_DURATION);

                if (ageSec <= ceiling + KILL_GRACE_SEC) continue;

                console.error(
                    `[CallWatchdog] ⛔ KILLING ${call.sid} (${call.from} → ${call.to}) — ` +
                    `${Math.round(ageSec)}s old against a ${ceiling}s ceiling` +
                    `${tracked ? '' : ', NOT TRACKED (in-process timer was lost, most likely a restart)'}`
                );
                try {
                    await twilio.endCall(call.sid);
                    killed++;
                } catch (err) {
                    console.error(`[CallWatchdog] ⛔ FAILED to kill ${call.sid} — it is STILL BILLING:`, err);
                }
                state.removeCall(call.sid);
            }

            // Other direction: state we hold for calls Twilio no longer lists.
            // These are the phantoms — timers armed, budget metering, expiry
            // warnings firing, for a call that is already over.
            const liveSids = new Set(liveCalls.map(c => c.sid));
            let reaped = 0;
            for (const tracked of state.getAllCalls()) {
                const sid = tracked.twilioCallSid || tracked.callSid;
                if (liveSids.has(sid)) continue;
                const ageSec = (now - new Date(tracked.startedAt).getTime()) / 1000;
                if (ageSec < REAP_MIN_AGE_SEC) continue; // may still be connecting

                console.warn(
                    `[CallWatchdog] Reaping ${tracked.callSid} — Twilio does not list it as live ` +
                    `(${Math.round(ageSec)}s since start). Clearing timers and booking spend.`
                );
                state.removeCall(tracked.callSid);
                reaped++;
            }

            console.log(
                `[CallWatchdog] Pass complete: ${liveCalls.length} live on Twilio, ` +
                `${state.getAllCalls().length} tracked here, ${killed} killed, ${reaped} reaped`
            );
            return { live: liveCalls.length, killed, reaped, failed: false };
        } finally {
            this.sweeping = false;
        }
    }
}
