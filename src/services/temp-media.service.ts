import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';

const TEMP_DIR = '/tmp/phony-media';
const PERMANENT_SUBDIR = 'permanent'; // files under this subdir skipped by TTL cleanup
const FILE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Capability tokens on media URLs.
 *
 * ⛔ WHY. `location /media/` is deliberately open at nginx — Twilio fetches
 * attachments from it at send time, so it cannot be closed without breaking
 * outbound MMS. That left every file under `permanent/` retrievable by anyone
 * who had the URL, forever, with no expiry and no revocation. Two photographs
 * of a third party's driver's licence sat there for 32 days (2026-08-31).
 *
 * ⭐ THE SIGNATURE IS OVER THE PATH, AND THERE IS NO IP LOGIC HERE ON PURPOSE.
 * Access control by source address is what failed at the nginx layer: LAN
 * allow-rules matched hairpinned traffic and matched the WireGuard relay peer,
 * so "internal" was never a property the server could actually observe. A token
 * is checked the same way from every ingress — LAN, hairpin, relay, or the open
 * internet — so none of those paths can be a bypass, and equally none of them
 * are broken by this.
 *
 * ⚠️ The secret must survive a restart. DYNAMIC_API_SECRET is regenerated at
 * startup and would silently invalidate every URL Twilio had not yet fetched,
 * which surfaces as MMS that just never deliver.
 */

/** Long enough to cover delivery and Twilio's retries. Justified, not guessed:
 *  non-permanent media has always been deleted after FILE_TTL_MS (1h) and
 *  outbound MMS works, so Twilio demonstrably always fetches inside an hour.
 *  6h is that bound with margin. */
const DEFAULT_URL_TTL_SEC = 6 * 60 * 60;

function mediaUrlSecret(): string {
    const explicit = process.env.MEDIA_URL_SECRET;
    if (explicit) return explicit;
    // Derived, not random: stable across restarts without needing new config.
    // ⛔ Never log or return this value.
    const base = process.env.TWILIO_AUTH_TOKEN;
    if (!base) throw new Error('MEDIA_URL_SECRET or TWILIO_AUTH_TOKEN required to sign media URLs');
    return createHmac('sha256', base).update('phony:media-url:v1').digest('hex');
}

function computeSig(pathname: string, exp: number): string {
    return createHmac('sha256', mediaUrlSecret()).update(`${pathname}:${exp}`).digest('hex');
}

/** True for paths this scheme governs. Anything else is a caller-supplied
 *  third-party URL and must pass through untouched. */
function isOwnMediaPath(pathname: string): boolean {
    return pathname.startsWith('/media/temp/');
}

/**
 * Mint a fresh capability token for one of our own media URLs.
 *
 * Idempotent: an already-signed URL is re-signed from scratch, so read paths can
 * call this on whatever is stored without accumulating query parameters or
 * handing out a token that expired while it sat in the database.
 */
export function signMediaUrl(url: string, ttlSec = DEFAULT_URL_TTL_SEC): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return url; // not a URL we can reason about — leave it alone
    }
    if (!isOwnMediaPath(parsed.pathname)) return url;

    parsed.searchParams.delete('exp');
    parsed.searchParams.delete('sig');
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    parsed.searchParams.set('exp', String(exp));
    parsed.searchParams.set('sig', computeSig(parsed.pathname, exp));
    return parsed.toString();
}

/** Map helper for the read paths. Non-media URLs pass through unchanged. */
export function signMediaUrls(urls: string[] | undefined, ttlSec?: number): string[] | undefined {
    if (!urls) return urls;
    return urls.map(u => (typeof u === 'string' ? signMediaUrl(u, ttlSec) : u));
}

/**
 * Re-sign every `mediaUrls` array anywhere in a response payload.
 *
 * ⭐ Applied once at the /api boundary rather than in each handler. Those return
 * raw documents from several different code paths, and a media URL that silently
 * ships without a live token shows up as a broken image in the UI — a failure
 * that looks like missing data rather than an auth problem. One choke point
 * cannot be forgotten by the next handler somebody adds.
 */
export function resignMediaUrlsDeep<T>(value: T, depth = 0): T {
    // Cap is generous on purpose: exceeding it returns the URL UNSIGNED, which
    // fails as a broken image rather than an error. Each document costs two
    // levels now that toJSON is a hop of its own.
    if (depth > 12 || value === null || typeof value !== 'object') return value;
    // ⛔ Serialize first. These payloads are Mongoose documents; rebuilding one
    // field-by-field discards its toJSON and ships Mongoose internals ($__,
    // _doc, activePaths) to the client instead of the document. Caught in
    // deploy verification, not by the tests — which used plain objects.
    if (typeof (value as any).toJSON === 'function') {
        return resignMediaUrlsDeep((value as any).toJSON(), depth + 1) as unknown as T;
    }
    if (Array.isArray(value)) {
        return value.map(v => resignMediaUrlsDeep(v, depth + 1)) as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = k === 'mediaUrls' && Array.isArray(v)
            ? signMediaUrls(v as string[])
            : resignMediaUrlsDeep(v, depth + 1);
    }
    return out as unknown as T;
}

export type MediaAuthResult = { ok: true } | { ok: false; reason: 'missing' | 'expired' | 'invalid' };

/**
 * Verify a token. Distinguishes the failure modes so the log can tell an expired
 * link (ordinary, expected) from a forged one (worth noticing).
 */
export function verifyMediaSignature(pathname: string, exp: unknown, sig: unknown): MediaAuthResult {
    if (typeof exp !== 'string' || typeof sig !== 'string' || !exp || !sig) return { ok: false, reason: 'missing' };
    const expNum = Number(exp);
    if (!Number.isFinite(expNum)) return { ok: false, reason: 'invalid' };

    // Compare before checking expiry so a forged signature never reads as
    // merely "expired", which would understate what happened.
    const expected = Buffer.from(computeSig(pathname, expNum), 'utf8');
    const provided = Buffer.from(sig, 'utf8');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        return { ok: false, reason: 'invalid' };
    }
    if (expNum * 1000 < Date.now()) return { ok: false, reason: 'expired' };
    return { ok: true };
}

/**
 * Service for temporarily hosting base64 file content so Twilio can fetch it via public URL.
 */
export class TempMediaService {
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        // Ensure temp directory exists
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }
    }

    /**
     * Copy a file at the given absolute path into temp media and return its public URL.
     * Path must be under /mnt/db/ or /tmp/ to prevent arbitrary filesystem reads.
     */
    savePathFile(filename: string, mimeType: string, srcPath: string): string {
        if (!path.isAbsolute(srcPath)) {
            throw new Error(`Path must be absolute: ${srcPath}`);
        }
        const normalized = path.normalize(srcPath);
        if (!normalized.startsWith('/mnt/db/') && !normalized.startsWith('/tmp/')) {
            throw new Error(`Path must be under /mnt/db/ or /tmp/: ${srcPath}`);
        }
        if (!fs.existsSync(normalized)) {
            throw new Error(`File not found: ${srcPath}`);
        }

        const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const diskName = `${randomUUID()}-${safeFilename}`;
        const filePath = path.join(TEMP_DIR, diskName);
        fs.copyFileSync(normalized, filePath);

        const publicUrl = process.env.PUBLIC_URL;
        if (!publicUrl) {
            throw new Error('PUBLIC_URL environment variable is required for temp media hosting');
        }
        return signMediaUrl(`${publicUrl}/media/temp/${diskName}`);
    }

    /**
     * Save base64-encoded file content to disk and return its public URL.
     */
    saveBase64File(filename: string, mimeType: string, base64Data: string): string {
        const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const diskName = `${randomUUID()}-${safeFilename}`;
        const filePath = path.join(TEMP_DIR, diskName);

        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

        const publicUrl = process.env.PUBLIC_URL;
        if (!publicUrl) {
            throw new Error('PUBLIC_URL environment variable is required for temp media hosting');
        }

        return signMediaUrl(`${publicUrl}/media/temp/${diskName}`);
    }

    /**
     * Download a media resource from Twilio MCS (Media Content Service) and
     * persist it under /tmp/phony-media/permanent/ so its public URL stays
     * stable across the TTL cleanup. Returns the public URL.
     *
     * Used by the Conversations webhook / reconciler for inbound group MMS
     * media: the webhook payload carries only the media SID + metadata, and
     * MCS-signed URLs expire in ~5 minutes — rehosting gives us durable URLs
     * Claude/UI can follow later.
     */
    async saveFromTwilioMedia(
        mediaSid: string,
        contentType: string,
        filename: string | undefined,
        accountSid: string,
        authToken: string,
        chatServiceSid: string,
    ): Promise<string> {
        // MCS endpoint — needs the Conversation's chatServiceSid (IS…), not
        // the literal "default". Returns JSON metadata with a short-lived
        // signed URL under links.content_direct_temporary.
        const mcsUrl = `https://mcs.us1.twilio.com/v1/Services/${chatServiceSid}/Media/${mediaSid}`;
        const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

        // First GET returns JSON metadata including `links.content_direct_temporary`
        // (a short-lived S3 URL) or similar. Fall back to following redirects.
        const metaRes = await fetch(mcsUrl, { headers: { Authorization: auth } });
        if (!metaRes.ok) {
            throw new Error(`MCS metadata fetch ${mediaSid}: HTTP ${metaRes.status} ${await metaRes.text()}`);
        }
        const meta: any = await metaRes.json();
        const signedUrl = meta.links?.content_direct_temporary || meta.links?.content || null;
        if (!signedUrl) {
            throw new Error(`MCS ${mediaSid}: no content link in metadata ${JSON.stringify(meta).slice(0, 200)}`);
        }

        const blobRes = await fetch(signedUrl);
        if (!blobRes.ok) {
            throw new Error(`MCS blob fetch ${mediaSid}: HTTP ${blobRes.status}`);
        }
        const buf = Buffer.from(await blobRes.arrayBuffer());

        const safeName = (filename || this.extensionFromContentType(contentType) || mediaSid)
            .replace(/[^a-zA-Z0-9._-]/g, '_');
        const diskName = `${mediaSid}-${safeName}`;
        const permanentDir = path.join(TEMP_DIR, PERMANENT_SUBDIR);
        if (!fs.existsSync(permanentDir)) fs.mkdirSync(permanentDir, { recursive: true });
        const filePath = path.join(permanentDir, diskName);
        fs.writeFileSync(filePath, buf);

        const publicUrl = process.env.PUBLIC_URL;
        if (!publicUrl) throw new Error('PUBLIC_URL env required');
        // Signed here so the URL works immediately; the token in whatever row
        // this lands in will expire, and every read path re-signs on the way out.
        return signMediaUrl(`${publicUrl}/media/temp/${PERMANENT_SUBDIR}/${diskName}`);
    }

    private extensionFromContentType(ct: string): string {
        if (!ct) return 'media';
        const map: Record<string, string> = {
            'image/jpeg': 'image.jpg', 'image/jpg': 'image.jpg',
            'image/png': 'image.png', 'image/gif': 'image.gif',
            'image/heic': 'image.heic', 'image/webp': 'image.webp',
            'video/mp4': 'video.mp4', 'video/quicktime': 'video.mov', 'video/3gpp': 'video.3gp',
            'audio/mpeg': 'audio.mp3', 'audio/amr': 'audio.amr',
            'application/pdf': 'document.pdf',
        };
        return map[ct.toLowerCase()] || 'media';
    }

    /**
     * Start periodic cleanup of files older than TTL.
     */
    startCleanup(intervalMs = 10 * 60 * 1000): void {
        if (this.cleanupInterval) return;

        this.cleanupInterval = setInterval(() => {
            this.cleanupExpired();
        }, intervalMs);

        console.log(`[TempMedia] Cleanup scheduled every ${intervalMs / 1000}s (TTL: ${FILE_TTL_MS / 1000}s)`);
    }

    private cleanupExpired(): void {
        if (!fs.existsSync(TEMP_DIR)) return;

        const now = Date.now();
        let removed = 0;

        for (const file of fs.readdirSync(TEMP_DIR)) {
            if (file === PERMANENT_SUBDIR) continue; // never purge persistent group-MMS media
            const filePath = path.join(TEMP_DIR, file);
            try {
                const stat = fs.statSync(filePath);
                if (!stat.isFile()) continue;
                if (now - stat.mtimeMs > FILE_TTL_MS) {
                    fs.unlinkSync(filePath);
                    removed++;
                }
            } catch {
                // file may have been removed concurrently
            }
        }

        if (removed > 0) {
            console.log(`[TempMedia] Cleaned up ${removed} expired file(s)`);
        }
    }
}
