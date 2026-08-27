import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Cover for the call-extension gates.
 *
 * The hazard these exist to stop is the PHANTOM CALL — a leg that is
 * technically up while nothing is happening on it: the far end gone, dead air,
 * or the 2026-08-27 warm-transfer failure where our audio rendered perfectly
 * and the human heard silence. An extension granted on request alone would let
 * one of those bill indefinitely.
 *
 * So the property under test is not "extending works". It is that every gate
 * FAILS CLOSED — including the one where Twilio does not answer at all.
 */

const mockGetCallStatus = vi.fn();
const mockEndCall = vi.fn();

vi.mock('./twilio/call.service.js', () => ({
    TwilioCallService: {
        getInstance: () => ({
            getCallStatus: mockGetCallStatus,
            endCall: mockEndCall,
        }),
    },
}));

const CALL = 'CAext000000000000000000000000000';

async function freshService() {
    const mod = await import('./call-state.service.js');
    (mod.CallStateService as any).instance = undefined;
    return mod.CallStateService.getInstance();
}

/** A call that spoke `spokeSecondsAgo` ago and started `startedSecondsAgo` ago. */
function makeCall(spokeSecondsAgo = 0, startedSecondsAgo = 60) {
    return {
        callSid: CALL,
        toNumber: '+18005550115',
        fromNumber: '+18575550111',
        callType: 'outgoing' as const,
        status: 'in-progress' as const,
        twilioCallSid: CALL,
        startedAt: new Date(Date.now() - startedSecondsAgo * 1000),
        conversationHistory: [
            { role: 'user', content: 'one second', timestamp: new Date(Date.now() - spokeSecondsAgo * 1000) },
        ],
    };
}

describe('extendCall gates', () => {
    beforeEach(() => {
        mockGetCallStatus.mockReset();
        mockEndCall.mockReset();
        mockGetCallStatus.mockResolvedValue('in-progress');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('grants when the call has proven it is alive', async () => {
        const svc = await freshService();
        svc.addCall(CALL, makeCall(5) as any);
        svc.startDurationTimer(CALL);

        const r = await svc.extendCall(CALL, 2);
        expect(r.granted).toBe(true);
        expect(r.extensionsUsed).toBe(1);
        expect(r.newDurationSec).toBeGreaterThan(0);
    });

    it('REFUSES a call that has been silent past the liveness window', async () => {
        const svc = await freshService();
        // Nobody has spoken for 5 minutes — the signature of a phantom.
        svc.addCall(CALL, makeCall(300, 400) as any);
        svc.startDurationTimer(CALL);

        const r = await svc.extendCall(CALL, 2);
        expect(r.granted).toBe(false);
        expect(r.reason).toMatch(/Nothing has been said/i);
    });

    it('REFUSES when Twilio cannot be reached — fails closed, not open', async () => {
        const svc = await freshService();
        svc.addCall(CALL, makeCall(5) as any);
        svc.startDurationTimer(CALL);
        mockGetCallStatus.mockResolvedValue(null);

        const r = await svc.extendCall(CALL, 2);
        expect(r.granted).toBe(false);
        expect(r.reason).toMatch(/[Cc]ould not confirm/);
    });

    it('REFUSES when Twilio says the call is no longer in progress', async () => {
        const svc = await freshService();
        svc.addCall(CALL, makeCall(5) as any);
        svc.startDurationTimer(CALL);
        mockGetCallStatus.mockResolvedValue('completed');

        const r = await svc.extendCall(CALL, 2);
        expect(r.granted).toBe(false);
        expect(r.reason).toMatch(/completed/);
    });

    it('REFUSES past the hard ceiling however many extensions remain', async () => {
        const svc = await freshService();
        svc.addCall(CALL, makeCall(5) as any);
        svc.startDurationTimer(CALL);

        // Walk right up to the ceiling; the run must stop before crossing it,
        // not merely slow down.
        let granted = 0;
        for (let i = 0; i < 30; i++) {
            const r = await svc.extendCall(CALL, 5);
            if (!r.granted) {
                expect(r.reason).toMatch(/ceiling|extended \d+ times/i);
                break;
            }
            granted++;
            expect(r.newDurationSec!).toBeLessThanOrEqual(3600);
        }
        expect(granted).toBeGreaterThan(0);
        expect(granted).toBeLessThan(30);
    });

    it('REFUSES a single bump larger than the per-extension cap', async () => {
        const svc = await freshService();
        svc.addCall(CALL, makeCall(5) as any);
        svc.startDurationTimer(CALL);

        const r = await svc.extendCall(CALL, 60);
        expect(r.granted).toBe(false);
        expect(r.reason).toMatch(/capped/i);
    });

    it('REFUSES nonsense input rather than coercing it', async () => {
        const svc = await freshService();
        svc.addCall(CALL, makeCall(5) as any);
        svc.startDurationTimer(CALL);

        for (const bad of [0, -5, NaN]) {
            const r = await svc.extendCall(CALL, bad as number);
            expect(r.granted).toBe(false);
        }
    });

    it('REFUSES an unknown call', async () => {
        const svc = await freshService();
        const r = await svc.extendCall('CAnope', 2);
        expect(r.granted).toBe(false);
        expect(r.reason).toMatch(/not found/i);
    });

    it('never consults Twilio once a cheaper gate has already refused', async () => {
        const svc = await freshService();
        svc.addCall(CALL, makeCall(300, 400) as any);
        svc.startDurationTimer(CALL);

        await svc.extendCall(CALL, 2);
        // Silence is decided locally; spending a network round-trip on a call we
        // already know is dead is pure latency on the deciding path.
        expect(mockGetCallStatus).not.toHaveBeenCalled();
    });
});

describe('expiry timers', () => {
    beforeEach(() => {
        mockGetCallStatus.mockReset();
        mockEndCall.mockReset();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('clearDurationTimer clears the WARNING timer too', async () => {
        const svc = await freshService();
        svc.addCall(CALL, makeCall(0, 0) as any);
        svc.startDurationTimer(CALL);

        const call = svc.getCall(CALL)!;
        expect(call.expiryWarningTimer).toBeDefined();

        svc.clearDurationTimer(CALL);
        // ⛔ Leaving this armed fires "expiring soon" at an agent about a call
        // that ended minutes ago — the same class of lie as a heartbeat
        // insisting a hung-up call is live.
        expect(svc.getCall(CALL)!.expiryWarningTimer).toBeUndefined();
        expect(svc.getCall(CALL)!.maxDurationTimer).toBeUndefined();
    });

    it('does not hang up a call that still has time left', async () => {
        const svc = await freshService();
        svc.addCall(CALL, makeCall(0, 0) as any);
        svc.startDurationTimer(CALL);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(mockEndCall).not.toHaveBeenCalled();
    });

    it('ACTUALLY hangs up when the allowance runs out', async () => {
        // Covers the wiring: timer fires → endCall is reached.
        // ⚠️ This does NOT by itself cover the bug that motivated it — see the
        // "real TwilioCallService" test below. The mock in this file supplies
        // getInstance, so it would pass even against the broken class.
        const svc = await freshService();
        svc.addCall(CALL, makeCall(0, 0) as any);
        svc.startDurationTimer(CALL);

        await vi.advanceTimersByTimeAsync(601_000);
        expect(mockEndCall).toHaveBeenCalledWith(CALL);
    });

    it('warns before it kills, not at the same moment', async () => {
        const svc = await freshService();
        svc.addCall(CALL, makeCall(0, 0) as any);
        svc.startDurationTimer(CALL);

        // Past the 90s warning point but short of the 600s cap.
        await vi.advanceTimersByTimeAsync(520_000);
        expect(mockEndCall).not.toHaveBeenCalled();
        expect(svc.getCall(CALL)).toBeDefined();
    });
});

/*
 * ⛔ WHERE THE ORIGINAL DEFECT IS ACTUALLY CAUGHT — read this before assuming
 * the tests above cover it.
 *
 * CallStateService's auto-hangup called TwilioCallService.getInstance(), a
 * method the class did not have, from OUTSIDE its try/catch. So when a call hit
 * its duration cap the timer threw an unhandled rejection, logged nothing, and
 * never hung the call up. The safety ceiling silently did nothing.
 *
 * ⚠️ NOTHING IN THIS FILE CAN SEE THAT. The vi.mock above supplies getInstance,
 * so the wiring tests pass against the broken class just as happily.
 *
 * The guard is `npx tsc --noEmit`, which reports it as
 *   TS2339: Property 'getInstance' does not exist on type 'typeof TwilioCallService'
 * and is how it was found. ⛔ That check is NOT part of the build — tsup does not
 * typecheck — so `npm run build` alone will ship this class of bug again. Run tsc
 * separately and diff against the known-error baseline.
 *
 * A runtime version of this test was written and removed: importing the real
 * module pulls in the whole Twilio SDK, took 76s on NFS, and timed out under
 * parallel load. A slow flaky test is a worse guard than the fast reliable one
 * that already exists.
 */
