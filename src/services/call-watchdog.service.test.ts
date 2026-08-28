import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The watchdog hangs up real calls, so the property under test is the FAIL
 * DIRECTION, not the arithmetic.
 *
 * ⛔ Killing a live conversation with a real person is the expensive mistake;
 * letting one run 60 more seconds is not. So every uncertain case must resolve
 * toward LEAVING THE CALL UP — most importantly when Twilio cannot be reached,
 * where an empty list would otherwise read as "nothing is up" and reap
 * everything we are tracking.
 */

const mockEndCall = vi.fn();
const mockListLiveCalls = vi.fn();

vi.mock('./twilio/call.service.js', () => ({
    TwilioCallService: {
        getInstance: () => ({ endCall: mockEndCall, listLiveCalls: mockListLiveCalls }),
    },
}));

vi.mock('../config/constants.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../config/constants.js')>()),
    MAX_OUTGOING_CALL_DURATION: 600,
    MAX_INCOMING_CALL_DURATION: 1800,
    ABSOLUTE_MAX_CALL_DURATION: 3600,
}));

const mockGetCall = vi.fn();
const mockGetAllCalls = vi.fn();
const mockRemoveCall = vi.fn();
vi.mock('./call-state.service.js', () => ({
    CallStateService: {
        getInstance: () => ({
            getCall: mockGetCall,
            getAllCalls: mockGetAllCalls,
            removeCall: mockRemoveCall,
        }),
    },
}));

const { CallWatchdogService } = await import('./call-watchdog.service.js');

const SID = 'CAwatchdog00000000000000000000001';
const agoSec = (s: number) => new Date(Date.now() - s * 1000);
const liveCall = (sid: string, ageSec: number) => ({
    sid, startedAt: agoSec(ageSec), to: '+18005550115', from: '+18575550111', status: 'in-progress',
});

function fresh() {
    (CallWatchdogService as any).instance = undefined;
    return CallWatchdogService.getInstance();
}

describe('call watchdog', () => {
    beforeEach(() => {
        mockEndCall.mockReset().mockResolvedValue(undefined);
        mockListLiveCalls.mockReset().mockResolvedValue([]);
        mockGetCall.mockReset().mockReturnValue(undefined);
        mockGetAllCalls.mockReset().mockReturnValue([]);
        mockRemoveCall.mockReset();
    });

    it('leaves a call alone while it is inside its allowance', async () => {
        mockListLiveCalls.mockResolvedValue([liveCall(SID, 120)]);
        mockGetCall.mockReturnValue({ callSid: SID, callType: 'outgoing', startedAt: agoSec(120) });

        await fresh().sweep();

        expect(mockEndCall).not.toHaveBeenCalled();
    });

    it('KILLS an untracked live call past the default ceiling — the post-restart orphan', async () => {
        // The whole reason this service exists: our timer died with the
        // process, the leg stayed up, nothing else would ever stop it.
        mockListLiveCalls.mockResolvedValue([liveCall(SID, 900)]);
        mockGetCall.mockReturnValue(undefined);

        const r = await fresh().sweep();

        expect(mockEndCall).toHaveBeenCalledWith(SID);
        expect(r.killed).toBe(1);
    });

    it('honours a granted extension rather than the default ceiling', async () => {
        mockListLiveCalls.mockResolvedValue([liveCall(SID, 900)]);
        mockGetCall.mockReturnValue({
            callSid: SID, callType: 'outgoing', startedAt: agoSec(900), grantedDurationSec: 1200,
        });

        await fresh().sweep();

        expect(mockEndCall).not.toHaveBeenCalled();
    });

    it('⛔ does NOTHING when Twilio is unreachable, and reports the pass as failed', async () => {
        // An exception must never be read as "no calls are up" — that would
        // reap every tracked call and report a clean sweep over a blind one.
        mockListLiveCalls.mockRejectedValue(new Error('network'));
        mockGetAllCalls.mockReturnValue([{ callSid: SID, startedAt: agoSec(9999) }]);

        const r = await fresh().sweep();

        expect(r.failed).toBe(true);
        expect(mockEndCall).not.toHaveBeenCalled();
        expect(mockRemoveCall).not.toHaveBeenCalled();
    });

    it('reaps state for a tracked call Twilio no longer lists', async () => {
        mockListLiveCalls.mockResolvedValue([]);
        mockGetAllCalls.mockReturnValue([{ callSid: SID, startedAt: agoSec(600) }]);

        const r = await fresh().sweep();

        expect(mockRemoveCall).toHaveBeenCalledWith(SID);
        expect(r.reaped).toBe(1);
    });

    it('does not reap a call young enough to still be connecting', async () => {
        // Twilio may not list a call that is still being set up.
        mockListLiveCalls.mockResolvedValue([]);
        mockGetAllCalls.mockReturnValue([{ callSid: SID, startedAt: agoSec(10) }]);

        await fresh().sweep();

        expect(mockRemoveCall).not.toHaveBeenCalled();
    });

    it('still clears state when the hangup itself fails', async () => {
        // The call may be unkillable, but we must not keep timers armed and
        // spend metering for it on top of that.
        mockListLiveCalls.mockResolvedValue([liveCall(SID, 900)]);
        mockEndCall.mockRejectedValue(new Error('twilio 500'));

        const r = await fresh().sweep();

        expect(mockRemoveCall).toHaveBeenCalledWith(SID);
        expect(r.killed).toBe(0); // not counted as killed — it is still up
    });
});
