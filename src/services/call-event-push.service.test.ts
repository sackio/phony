import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallEventPushService } from './call-event-push.service.js';

/**
 * Regression cover for the digest-cadence failure found on the A. Duie Pyle
 * calls, 2026-08-27.
 *
 * The push stream went permanently silent after its first digest: a fired
 * setTimeout leaves its handle truthy and `nextFlushAt` in the past, so every
 * later schedule() early-returned believing a sooner flush was still pending.
 * On CAb04e913… that meant seq 1 at 9s, then nothing for 8.5 minutes, then 108
 * transcript lines dumped at once after the call was already over — the
 * controlling agent could not have intervened, and the dead stream was
 * indistinguishable from a quiet line.
 *
 * These tests are the reason that cannot come back silently.
 */

const CALL = 'CAtest0000000000000000000000000000';

interface Captured { event: string; seq: number; lines: number; reason?: string }

function harness() {
    const sent: Captured[] = [];
    const dispatcher: any = {
        dispatch: async (event: string, data: any) => {
            sent.push({ event, seq: data.seq, lines: data.line_count ?? 0, reason: data.reason });
        },
    };
    // The service is a singleton; reach past the cached instance so each test
    // gets its own dispatcher rather than the first test's.
    (CallEventPushService as any).instance = undefined;
    return { sent, svc: CallEventPushService.getInstance(dispatcher) };
}

const digests = (sent: Captured[]) => sent.filter(s => s.event === 'call.transcript');

describe('CallEventPushService cadence', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('keeps flushing after the first digest while speech continues', async () => {
        const { sent, svc } = harness();
        svc.start(CALL, { toNumber: '+18005550115', fromNumber: '+18575550111' });

        // Six lines 8s apart — more often than the 30s heartbeat, so every one
        // of these should ride out on the 5s content debounce.
        for (let i = 0; i < 6; i++) {
            svc.recordLine(CALL, i % 2 === 0 ? 'assistant' : 'user', `line ${i}`);
            await vi.advanceTimersByTimeAsync(8_000);
        }

        const d = digests(sent);
        // The bug produced exactly one. Anything <= 1 is the bug returning.
        expect(d.length).toBeGreaterThan(1);
        expect(d.reduce((n, x) => n + x.lines, 0)).toBe(6);

        await svc.end(CALL);
    });

    it('emits empty heartbeats while the line is quiet', async () => {
        const { sent, svc } = harness();
        svc.start(CALL);

        await vi.advanceTimersByTimeAsync(95_000);

        // ⛔ An empty digest IS the signal — it is the only thing separating
        // "nobody spoke" from "the push path is dead". Suppressing it to save
        // traffic re-creates the defect this service exists to remove.
        const empties = digests(sent).filter(x => x.lines === 0);
        expect(empties.length).toBeGreaterThanOrEqual(2);

        await svc.end(CALL);
    });

    it('numbers every event gaplessly so a receiver can detect a lost delivery', async () => {
        const { sent, svc } = harness();
        svc.start(CALL);

        svc.recordLine(CALL, 'assistant', 'hello');
        await vi.advanceTimersByTimeAsync(40_000);
        svc.recordLine(CALL, 'user', 'hi');
        await vi.advanceTimersByTimeAsync(40_000);
        await svc.end(CALL);

        expect(sent.map(s => s.seq)).toEqual(sent.map((_, i) => i + 1));
    });

    it('flushes the tail on end — that is where the call outcome lives', async () => {
        const { sent, svc } = harness();
        svc.start(CALL);

        svc.recordLine(CALL, 'user', 'confirmation number is 12345');
        // End immediately, inside the debounce window, so the line has NOT been
        // flushed by any interval tick.
        await svc.end(CALL);

        const final = digests(sent).find(d => d.reason === 'call-ended');
        expect(final).toBeDefined();
        expect(final!.lines).toBe(1);
        expect(sent.some(s => s.event === 'call.stream_complete')).toBe(true);
    });

    it('end() is idempotent — local teardown and the Twilio callback both fire', async () => {
        const { sent, svc } = harness();
        svc.start(CALL);

        await svc.end(CALL, { ended_via: 'local-teardown' });
        const after = sent.length;
        await svc.end(CALL, { ended_via: 'twilio-status' });

        expect(sent.length).toBe(after);
    });
});
