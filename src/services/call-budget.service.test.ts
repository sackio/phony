import { describe, it, expect, beforeEach } from 'vitest';
import { CallBudgetService, priceSeconds, usdPerMinute } from './call-budget.service.js';
import { CALL_BUDGET_USD } from '../config/constants.js';

/**
 * The money gate. Duration was only ever a proxy for this.
 *
 * ⛔ The property under test is the same one the duration gates have: it FAILS
 * CLOSED. An untracked call is refused, not waved through — "I cannot bound this
 * call's spend" must never render as "this call is affordable", which is the
 * laundered-success shape behind every other bug in this codebase.
 */

const CALL = 'CAbudget0000000000000000000000000';

function fresh() {
    (CallBudgetService as any).instance = undefined;
    return CallBudgetService.getInstance();
}

describe('call pricing', () => {
    it('prices a minute at the blended rate and scales linearly', () => {
        expect(priceSeconds(60)).toBeCloseTo(usdPerMinute(), 6);
        expect(priceSeconds(120)).toBeCloseTo(usdPerMinute() * 2, 6);
    });

    it('never returns a negative price', () => {
        expect(priceSeconds(-500)).toBe(0);
    });
});

describe('CallBudgetService gate', () => {
    let svc: CallBudgetService;
    beforeEach(() => { svc = fresh(); });

    it('allows an extension that fits inside the ceiling', () => {
        svc.start(CALL);
        const v = svc.canAfford(CALL, 60, 120);
        expect(v.affordable).toBe(true);
        expect(v.remainingUsd).toBeGreaterThan(0);
    });

    it('REFUSES an untracked call rather than assuming it is affordable', () => {
        // No start() — the guard has no idea what this call has spent.
        const v = svc.canAfford('CAunknown', 60, 120);
        expect(v.affordable).toBe(false);
        expect(v.reason).toMatch(/not being tracked|Refusing/i);
    });

    it('REFUSES once the projected spend crosses the ceiling', () => {
        svc.start(CALL);
        // Enough seconds to blow any sane ceiling at the configured rate.
        const secondsToBust = Math.ceil((CALL_BUDGET_USD / usdPerMinute()) * 60) + 600;
        const v = svc.canAfford(CALL, secondsToBust, 300);
        expect(v.affordable).toBe(false);
        expect(v.reason).toMatch(/ceiling/i);
        expect(v.projectedUsd!).toBeGreaterThan(CALL_BUDGET_USD);
    });

    it('reports remaining budget as zero rather than negative when overspent', () => {
        svc.start(CALL);
        const secondsToBust = Math.ceil((CALL_BUDGET_USD / usdPerMinute()) * 60) + 600;
        const v = svc.canAfford(CALL, secondsToBust, 60);
        expect(v.remainingUsd).toBe(0);
    });

    it('books the actual cost on finish and stops tracking', () => {
        svc.start(CALL);
        expect(svc.isTracking(CALL)).toBe(true);
        const cost = svc.finish(CALL, 600);
        expect(cost).toBeCloseTo(priceSeconds(600), 6);
        expect(svc.isTracking(CALL)).toBe(false);
    });

    it('finish on an unknown call is a no-op, not a throw', () => {
        expect(() => svc.finish('CAnope', 100)).not.toThrow();
        expect(svc.finish('CAnope', 100)).toBe(0);
    });

    it('start is idempotent — a double start does not reset the meter', () => {
        svc.start(CALL);
        svc.start(CALL);
        expect(svc.isTracking(CALL)).toBe(true);
        expect(() => svc.finish(CALL, 60)).not.toThrow();
    });

    it('the ceiling binds INSIDE the absolute duration cap, or it is decorative', () => {
        // If a call could run to the hard 3600s ceiling without ever crossing the
        // budget, this gate would never fire and would be pure ceremony.
        const costAtAbsoluteMax = priceSeconds(3600);
        expect(costAtAbsoluteMax).toBeGreaterThan(CALL_BUDGET_USD);
    });

    it('does NOT bind during an ordinary call, or it would interrupt real work', () => {
        // The default outbound allowance is 1200s. Firing there would make every
        // normal call fail for the wrong reason.
        expect(priceSeconds(1200)).toBeLessThan(CALL_BUDGET_USD);
    });
});
