import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Media capability tokens.
 *
 * ⛔ The property under test is that an ABSENT or WRONG token FAILS. nginx leaves
 * /media/ open on purpose — Twilio has to fetch attachments — so this check is
 * the only thing in front of the files. A bug that let unsigned requests through
 * would restore exactly the condition that left a third party's driver's licence
 * publicly retrievable for 32 days, and it would look completely healthy from
 * inside: every legitimate URL would still work.
 *
 * ⚠️ Deliberately no IP is trusted anywhere in this scheme. Source-address trust
 * is what failed at the nginx layer — hairpinned LAN traffic and the WireGuard
 * relay peer both matched the RFC1918 allow-rules — so these tests assert the
 * verdict depends on the token alone.
 */

/**
 * ⛔ Restore INDIVIDUAL keys — never `process.env = {...saved}`.
 * That replaces Node's live env object process-wide, and vitest shares the
 * process across files: doing it here broke two unrelated call-state tests that
 * read Twilio credentials, while this file and that file each passed alone.
 */
const TOUCHED = ['MEDIA_URL_SECRET', 'PUBLIC_URL', 'TWILIO_AUTH_TOKEN'] as const;
const saved: Record<string, string | undefined> = {};

async function load() {
    vi.resetModules();
    return await import('./temp-media.service.js');
}

beforeEach(() => {
    for (const k of TOUCHED) saved[k] = process.env[k];
    process.env.MEDIA_URL_SECRET = 'test-secret-value';
    process.env.PUBLIC_URL = 'https://phony.example.com';
});

afterEach(() => {
    for (const k of TOUCHED) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k]!;
    }
    vi.useRealTimers();
});

const PATH = '/media/temp/permanent/MEabc-IMG_0001.jpg';
const url = (q = '') => `https://phony.example.com${PATH}${q}`;

describe('media capability tokens', () => {
    it('a signed URL verifies', async () => {
        const { signMediaUrl, verifyMediaSignature } = await load();
        const signed = new URL(signMediaUrl(url()));

        const r = verifyMediaSignature(PATH, signed.searchParams.get('exp'), signed.searchParams.get('sig'));

        expect(r.ok).toBe(true);
    });

    it('⛔ an UNSIGNED request is refused — the whole point of the scheme', async () => {
        const { verifyMediaSignature } = await load();

        expect(verifyMediaSignature(PATH, undefined, undefined)).toEqual({ ok: false, reason: 'missing' });
        expect(verifyMediaSignature(PATH, '', '')).toEqual({ ok: false, reason: 'missing' });
    });

    it('⛔ a token for a DIFFERENT file does not work on this one', async () => {
        // Otherwise one leaked URL would unlock every file in the directory.
        const { signMediaUrl, verifyMediaSignature } = await load();
        const other = new URL(signMediaUrl('https://phony.example.com/media/temp/permanent/MEother-IMG_9999.jpg'));

        const r = verifyMediaSignature(PATH, other.searchParams.get('exp'), other.searchParams.get('sig'));

        expect(r).toEqual({ ok: false, reason: 'invalid' });
    });

    it('⛔ a forged signature reports invalid, NOT expired', async () => {
        // An expired link is ordinary; a forged one is someone probing. Reporting
        // the first when it is the second buries the signal.
        const { verifyMediaSignature } = await load();
        const future = Math.floor(Date.now() / 1000) + 3600;

        const r = verifyMediaSignature(PATH, String(future), 'f'.repeat(64));

        expect(r).toEqual({ ok: false, reason: 'invalid' });
    });

    it('expires, and an expired token cannot be revived by editing exp', async () => {
        const { signMediaUrl, verifyMediaSignature } = await load();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
        const signed = new URL(signMediaUrl(url(), 60));

        vi.setSystemTime(new Date('2026-08-31T12:02:00Z'));
        expect(verifyMediaSignature(PATH, signed.searchParams.get('exp'), signed.searchParams.get('sig')))
            .toEqual({ ok: false, reason: 'expired' });

        // Pushing exp out by hand invalidates the signature it was signed with.
        const later = String(Math.floor(Date.now() / 1000) + 9999);
        expect(verifyMediaSignature(PATH, later, signed.searchParams.get('sig')))
            .toEqual({ ok: false, reason: 'invalid' });
    });

    it('a token minted under a different secret is refused', async () => {
        const { signMediaUrl } = await load();
        const signed = new URL(signMediaUrl(url()));

        process.env.MEDIA_URL_SECRET = 'a-completely-different-secret';
        const { verifyMediaSignature } = await load();

        expect(verifyMediaSignature(PATH, signed.searchParams.get('exp'), signed.searchParams.get('sig')))
            .toEqual({ ok: false, reason: 'invalid' });
    });

    it('re-signing is idempotent — no parameter pile-up, and the new token is live', async () => {
        // Read paths call this on whatever is stored, which may already carry a
        // stale token.
        const { signMediaUrl, verifyMediaSignature } = await load();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
        const once = signMediaUrl(url(), 60);

        vi.setSystemTime(new Date('2026-08-31T13:00:00Z'));
        const twice = new URL(signMediaUrl(once));

        expect(twice.searchParams.getAll('sig')).toHaveLength(1);
        expect(twice.searchParams.getAll('exp')).toHaveLength(1);
        expect(verifyMediaSignature(PATH, twice.searchParams.get('exp'), twice.searchParams.get('sig')).ok).toBe(true);
    });

    it('⛔ leaves third-party URLs completely alone', async () => {
        // Callers pass in external media URLs for outbound MMS. Appending our
        // query parameters to someone else's URL could break their fetch.
        const { signMediaUrl, signMediaUrls } = await load();
        const foreign = 'https://example.org/pic.jpg?token=theirs';

        expect(signMediaUrl(foreign)).toBe(foreign);
        expect(signMediaUrls([foreign, 'not a url'])).toEqual([foreign, 'not a url']);
    });

    it('resignMediaUrlsDeep refreshes nested mediaUrls and leaves other fields intact', async () => {
        const { resignMediaUrlsDeep, verifyMediaSignature } = await load();
        const payload = { data: { messages: [{ messageSid: 'IM1', body: 'hi', mediaUrls: [url('?exp=1&sig=dead')] }] } };

        const out: any = resignMediaUrlsDeep(payload);

        expect(out.data.messages[0].body).toBe('hi');
        expect(out.data.messages[0].messageSid).toBe('IM1');
        const signed = new URL(out.data.messages[0].mediaUrls[0]);
        expect(verifyMediaSignature(PATH, signed.searchParams.get('exp'), signed.searchParams.get('sig')).ok).toBe(true);
    });

    it('⛔ serializes Mongoose-like documents instead of rebuilding them field-by-field', async () => {
        // Regression: the API returns Mongoose documents. Walking one with
        // Object.entries discards its toJSON and ships internals ($__, _doc) to
        // the client. The response still parses as JSON, so this reads as a
        // shape change rather than an error — it reached production once.
        const { resignMediaUrlsDeep, verifyMediaSignature } = await load();
        const doc = {
            $__: { activePaths: { paths: { body: 'init' } } },
            _doc: { messageSid: 'IM1' },
            toJSON() { return { messageSid: 'IM1', body: 'hi', mediaUrls: [url()] }; },
        };

        const out: any = resignMediaUrlsDeep({ messages: [doc] });

        expect(out.messages[0].$__).toBeUndefined();
        expect(out.messages[0]._doc).toBeUndefined();
        expect(out.messages[0].messageSid).toBe('IM1');
        const signed = new URL(out.messages[0].mediaUrls[0]);
        expect(verifyMediaSignature(PATH, signed.searchParams.get('exp'), signed.searchParams.get('sig')).ok).toBe(true);
    });

    it('the derived secret is stable across restarts when MEDIA_URL_SECRET is unset', async () => {
        // A per-boot random secret would invalidate every URL Twilio had not yet
        // fetched, which surfaces as MMS that simply never arrive.
        delete process.env.MEDIA_URL_SECRET;
        process.env.TWILIO_AUTH_TOKEN = 'stand-in-token';

        const a = await load();
        const first = new URL(a.signMediaUrl(url(), 3600));
        const b = await load(); // fresh module instance = simulated restart

        expect(b.verifyMediaSignature(PATH, first.searchParams.get('exp'), first.searchParams.get('sig')).ok).toBe(true);
    });
});
