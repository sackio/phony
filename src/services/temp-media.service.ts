import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const TEMP_DIR = '/tmp/phony-media';
const PERMANENT_SUBDIR = 'permanent'; // files under this subdir skipped by TTL cleanup
const FILE_TTL_MS = 60 * 60 * 1000; // 1 hour

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
        return `${publicUrl}/media/temp/${diskName}`;
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

        return `${publicUrl}/media/temp/${diskName}`;
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
        return `${publicUrl}/media/temp/${PERMANENT_SUBDIR}/${diskName}`;
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
