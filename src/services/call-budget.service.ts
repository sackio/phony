import {
    CALL_BUDGET_USD,
    CALL_COST_TELEPHONY_USD_PER_MIN,
    CALL_COST_VOICE_AI_USD_PER_MIN,
} from '../config/constants.js';

/**
 * A per-call USD ceiling, sitting under the duration ceiling.
 *
 * Duration was only ever a PROXY for the thing that actually matters. A call
 * capped at 20 minutes is a call capped at roughly two dollars — but the
 * exchange rate moves with the voice provider, the model, and the destination,
 * so the minute-based ceiling silently means something different every time any
 * of those change. This meters the real quantity.
 *
 * ⛔ THIS IS A SECOND GATE, NOT A REPLACEMENT. The duration cap stays: it is the
 * one that fires when a call is wedged and producing no billable turns at all,
 * where spend stops accruing and a dollar ceiling would never trip. The two
 * catch different failures — a phantom call is cheap and endless; a busy call is
 * expensive and bounded — and today only the first was covered.
 *
 * ⛔ DELIBERATELY DEPENDENCY-FREE, and that was a reversal. This was first built
 * on `floe-guard`, which advertises "zero dependencies" — true of its
 * `dependencies` field, and misleading in effect: it declares a NON-OPTIONAL
 * peer dependency on the Vercel AI SDK, so installing it pulled in `ai`,
 * `@ai-sdk/*`, `undici`, `@opentelemetry/api` and more, and dragged zod from
 * 3.24.2 to 3.25.76 — zod being what this service's MCP layer validates with.
 * That is a real risk to a production telephony service, taken on to gain one
 * method that appends to an array, since the pricing, the comparison and the
 * ceiling are all computed here anyway. Measured and backed out 2026-08-27.
 *
 * ⇒ If you are tempted to re-add it, or any library, for the reserve/settle
 * concurrency handling: check `peerDependencies`, not just `dependencies`, and
 * diff the lockfile before believing any claim about dependency count.
 */

interface CallBudgetState {
    /** Booked spend for this call, in USD. In-flight time is priced on demand. */
    spentUsd: number;
}

/** What the gate decided, and enough detail to say why in a refusal. */
export interface AffordabilityVerdict {
    affordable: boolean;
    reason?: string;
    spentUsd: number;
    remainingUsd: number;
    projectedUsd?: number;
}

/** Blended USD per minute of call: the carrier leg plus the voice-AI leg. */
export function usdPerMinute(): number {
    return CALL_COST_TELEPHONY_USD_PER_MIN + CALL_COST_VOICE_AI_USD_PER_MIN;
}

/** USD for a call of `seconds`, at the configured blended rate. */
export function priceSeconds(seconds: number): number {
    return (Math.max(0, seconds) / 60) * usdPerMinute();
}

export class CallBudgetService {
    private static instance: CallBudgetService;
    private calls: Map<string, CallBudgetState> = new Map();

    public static getInstance(): CallBudgetService {
        if (!CallBudgetService.instance) {
            CallBudgetService.instance = new CallBudgetService();
        }
        return CallBudgetService.instance;
    }

    /** Begin metering a call. Idempotent — a second start is ignored. */
    public start(callSid: string): void {
        if (this.calls.has(callSid)) return;
        this.calls.set(callSid, { spentUsd: 0 });
        console.log(`[CallBudget] Metering ${callSid} — ceiling $${CALL_BUDGET_USD.toFixed(2)} at $${usdPerMinute().toFixed(4)}/min`);
    }

    /**
     * Would running `additionalSeconds` more cross this call's ceiling?
     *
     * ⛔ FAILS CLOSED. An untracked call, or anything unexpected from the guard,
     * returns not-affordable. The alternative — treating "I don't know" as "yes"
     * — is the laundered-success pattern that every other bug here has taken.
     */
    public canAfford(callSid: string, elapsedSeconds: number, additionalSeconds: number): AffordabilityVerdict {
        const state = this.calls.get(callSid);
        if (!state) {
            return {
                affordable: false,
                reason: `No budget is being tracked for ${callSid}, so its spend cannot be bounded. Refusing rather than assuming.`,
                spentUsd: 0,
                remainingUsd: 0,
            };
        }

        try {
            // Spend so far is time already burned; the guard's ledger only gains
            // entries when a call ENDS, so price the in-flight leg here.
            const soFar = priceSeconds(elapsedSeconds);
            const projected = soFar + priceSeconds(additionalSeconds);

            if (projected > CALL_BUDGET_USD) {
                return {
                    affordable: false,
                    reason: `Would reach about $${projected.toFixed(2)} against a $${CALL_BUDGET_USD.toFixed(2)} ceiling for this call (roughly $${soFar.toFixed(2)} spent over ${Math.round(elapsedSeconds)}s).`,
                    spentUsd: soFar,
                    remainingUsd: Math.max(0, CALL_BUDGET_USD - soFar),
                    projectedUsd: projected,
                };
            }

            return {
                affordable: true,
                spentUsd: soFar,
                remainingUsd: Math.max(0, CALL_BUDGET_USD - soFar),
                projectedUsd: projected,
            };
        } catch (err: any) {
            return {
                affordable: false,
                reason: `Budget check failed for ${callSid} (${err?.message ?? err}). Refusing rather than assuming.`,
                spentUsd: 0,
                remainingUsd: 0,
            };
        }
    }

    /**
     * Record what a finished call actually cost and stop tracking it.
     *
     * ⚠️ Never throws. A metering failure must not be able to take down call
     * teardown — the accounting is the least important thing happening at that
     * moment. It logs loudly instead, because a silent accounting gap is how you
     * end up trusting a number that was never written.
     */
    public finish(callSid: string, actualSeconds: number): number {
        const state = this.calls.get(callSid);
        if (!state) return 0;

        let cost = 0;
        try {
            cost = priceSeconds(actualSeconds);
            state.spentUsd += cost;
            console.log(`[CallBudget] ${callSid} cost $${cost.toFixed(4)} for ${Math.round(actualSeconds)}s (ceiling $${CALL_BUDGET_USD.toFixed(2)})`);
        } catch (err: any) {
            console.error(`[CallBudget] ⛔ Failed to record spend for ${callSid} — accounting for this call is MISSING, not zero:`, err?.message ?? err);
        } finally {
            this.calls.delete(callSid);
        }
        return cost;
    }

    /** Current spend on a live call, priced from elapsed time. */
    public spendSoFar(callSid: string, elapsedSeconds: number): number {
        return this.calls.has(callSid) ? priceSeconds(elapsedSeconds) : 0;
    }

    public isTracking(callSid: string): boolean {
        return this.calls.has(callSid);
    }
}
