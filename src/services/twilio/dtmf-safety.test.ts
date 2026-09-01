import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DTMF must never be sent by redirecting the call.
 *
 * ⛔ The property under test is that the DESTRUCTIVE path cannot be reached by
 * accident. `calls.update({twiml})` moves a call off its media stream: our
 * WebSocket dies, /call/outgoing starts a SECOND ElevenLabs conversation with no
 * history, the agent restarts mid-call saying "Hello!", and the post-call save
 * overwrites the real transcript with that one line. The record still reads
 * status=completed, so the damage is invisible to anyone who wasn't listening.
 *
 * Measured 2026-09-01: a live 10-message call became a single "Hello!" and the
 * call ended. This is the standing pattern here — a destructive outcome stored
 * as a value indistinguishable from a legitimate short call — so these tests
 * assert the refusal, not the success.
 */

import { SessionManagerService } from '../session-manager.service.js';

function makeSessionManager() {
    // The constructor only stores its arguments; nothing here touches the network.
    return new SessionManagerService({} as any, {} as any);
}

describe('SessionManagerService.injectDtmf', () => {
    it('writes tones in-band through the live session handler', async () => {
        const sm = makeSessionManager();
        const injectDtmfNow = vi.fn().mockResolvedValue(undefined);
        sm.registerSessionByCallSid('CA_live', { injectDtmfNow } as any);

        await expect(sm.injectDtmf('CA_live', '1')).resolves.toBe(true);
        expect(injectDtmfNow).toHaveBeenCalledWith('1');
    });

    it('⛔ reports false for an unknown call rather than finding another way', async () => {
        // False must mean "no safe path exists". A caller that reads it as
        // "try the REST route instead" reintroduces the exact defect.
        const sm = makeSessionManager();

        await expect(sm.injectDtmf('CA_missing', '1')).resolves.toBe(false);
    });

    it('stops routing DTMF once the session is unregistered', async () => {
        const sm = makeSessionManager();
        const injectDtmfNow = vi.fn().mockResolvedValue(undefined);
        sm.registerSessionByCallSid('CA_live', { injectDtmfNow } as any);
        sm.unregisterSessionByCallSid('CA_live');

        await expect(sm.injectDtmf('CA_live', '1')).resolves.toBe(false);
        expect(injectDtmfNow).not.toHaveBeenCalled();
    });
});

describe('TwilioCallService.sendDTMF — the destructive path', () => {
    let update: ReturnType<typeof vi.fn>;
    let service: any;

    beforeEach(async () => {
        update = vi.fn().mockResolvedValue({});
        // PUBLIC_URL is read when building the redirect TwiML. Pinned here so the
        // suite does not change meaning when .env does.
        process.env.PUBLIC_URL = 'https://phony.example.com';

        const { TwilioCallService } = await import('./call.service.js');
        service = new TwilioCallService({ calls: () => ({ update }) } as any);
    });

    it('⛔ THROWS by default, and does not touch the call', async () => {
        // The regression guard. Before the fix this redirected the call and
        // reported success.
        await expect(service.sendDTMF('CA_live', '1')).rejects.toThrow(/destroys the in-progress conversation/);
        expect(update).not.toHaveBeenCalled();
    });

    it('the refusal names the safe alternative', async () => {
        // An error that only says "no" sends the caller looking for a way around it.
        await expect(service.sendDTMF('CA_live', '1')).rejects.toThrow(/injectDtmf/);
    });

    it('proceeds only when the caller explicitly accepts the teardown', async () => {
        // Positive control: proves the throw above is the guard talking, not a
        // broken mock that would swallow a real call too.
        await service.sendDTMF('CA_nostream', '1', { acceptStreamTeardown: true });

        expect(update).toHaveBeenCalledTimes(1);
        const twiml = update.mock.calls[0][0].twiml as string;
        expect(twiml).toContain('digits="1"');
        expect(twiml).toContain('/call/outgoing');
    });

    it('still validates its arguments before the teardown guard', async () => {
        await expect(service.sendDTMF('', '1', { acceptStreamTeardown: true })).rejects.toThrow(/required/);
        await expect(service.sendDTMF('CA_x', '', { acceptStreamTeardown: true })).rejects.toThrow(/required/);
        expect(update).not.toHaveBeenCalled();
    });
});
