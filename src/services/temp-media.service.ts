import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const TEMP_DIR = '/tmp/phony-media';
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
     * Path must be under /mnt/nas/ or /tmp/ to prevent arbitrary filesystem reads.
     */
    savePathFile(filename: string, mimeType: string, srcPath: string): string {
        if (!path.isAbsolute(srcPath)) {
            throw new Error(`Path must be absolute: ${srcPath}`);
        }
        const normalized = path.normalize(srcPath);
        if (!normalized.startsWith('/mnt/nas/') && !normalized.startsWith('/tmp/')) {
            throw new Error(`Path must be under /mnt/nas/ or /tmp/: ${srcPath}`);
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
            const filePath = path.join(TEMP_DIR, file);
            try {
                const stat = fs.statSync(filePath);
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
