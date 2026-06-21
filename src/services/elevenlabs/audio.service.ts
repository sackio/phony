/**
 * Audio service — DTMF tone generation only.
 *
 * Audio conversion (µ-law ↔ PCM, 8↔16kHz resampling) was removed in the
 * Phase 1 refactor: the ElevenLabs agent is now configured for ulaw_8000
 * end-to-end, matching Twilio's native format. Audio frames pass through
 * untouched in both directions.
 *
 * What remains here:
 *   - DTMF tone synthesis at µ-law 8kHz (matches Twilio's media stream).
 *   - Silence generation for inter-tone pauses and chunk pacing.
 *
 * DTMF chunks are paced at the Twilio media cadence (~20ms per frame)
 * to avoid overrunning Twilio's playback buffer. See `sendDtmfPaced` in
 * the ElevenLabs handler for the timing loop.
 */

/** DTMF frequency pairs — standard telephone keypad. */
const DTMF_FREQUENCIES: Record<string, [number, number]> = {
    '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
    '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
    '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
    '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
    'A': [697, 1633], 'B': [770, 1633], 'C': [852, 1633], 'D': [941, 1633],
};

/** Twilio's media cadence — one frame per 20ms. Chunk DTMF audio to match. */
export const TWILIO_FRAME_MS = 20;

/** Encode 16-bit linear PCM sample as 8-bit µ-law byte. */
function linearToUlaw(sample: number): number {
    const BIAS = 0x84;
    const CLIP = 32635;

    const sign = sample < 0 ? 0x80 : 0;
    if (sample < 0) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;

    let exponent = 7;
    let mask = 0x4000;
    while ((sample & mask) === 0 && exponent > 0) {
        exponent--;
        mask >>= 1;
    }
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/**
 * Generate one DTMF tone as µ-law 8kHz audio, base64-encoded.
 * Splits into 20ms chunks so the caller can pace delivery via setTimeout
 * matching Twilio's frame cadence.
 */
export function generateDtmfTone(digit: string, durationMs: number = 350): string[] | null {
    const freqs = DTMF_FREQUENCIES[digit.toUpperCase()];
    if (!freqs) return null;

    const sampleRate = 8000;
    const numSamples = Math.floor(sampleRate * durationMs / 1000);
    const [f1, f2] = freqs;
    // Push amplitude close to peak — IVR detectors need clear tones. Two sines
    // at 12000 sum to ~24000 peak; with the clamp below we lose minor clipping
    // on amplitude crests but the IVR sees the tone unmistakably.
    const amplitude = 12000;

    const ulawBuf = Buffer.alloc(numSamples);
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const pcm = Math.round(amplitude * (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t)));
        const clamped = Math.max(-32768, Math.min(32767, pcm));
        ulawBuf[i] = linearToUlaw(clamped);
    }

    return chunkUlaw(ulawBuf, TWILIO_FRAME_MS, sampleRate);
}

/** Generate `durationMs` of µ-law silence (byte 0xFF), chunked at 20ms. */
export function generateSilence(durationMs: number): string[] {
    const sampleRate = 8000;
    const numSamples = Math.floor(sampleRate * durationMs / 1000);
    const buf = Buffer.alloc(numSamples, 0xFF);
    return chunkUlaw(buf, TWILIO_FRAME_MS, sampleRate);
}

/** Split a µ-law buffer into base64-encoded chunks of `chunkMs` milliseconds. */
function chunkUlaw(buf: Buffer, chunkMs: number, sampleRate: number): string[] {
    const samplesPerChunk = Math.floor(sampleRate * chunkMs / 1000);
    const chunks: string[] = [];
    for (let off = 0; off < buf.length; off += samplesPerChunk) {
        chunks.push(buf.subarray(off, Math.min(off + samplesPerChunk, buf.length)).toString('base64'));
    }
    return chunks;
}

/**
 * Generate a sequence of DTMF tones with pauses between them.
 * Returns an array of 20ms-aligned base64 chunks suitable for paced delivery
 * via the Twilio media stream.
 *
 *   `w` = 0.5s silence
 *   `W` = 1.0s silence
 *   ` ` (space) = ignored
 */
export function generateDtmfSequence(
    digits: string,
    toneDurationMs: number = 200,
    pauseDurationMs: number = 100,
): string[] {
    const chunks: string[] = [];
    for (const ch of digits) {
        if (ch === ' ') continue;
        if (ch === 'w') { chunks.push(...generateSilence(500)); continue; }
        if (ch === 'W') { chunks.push(...generateSilence(1000)); continue; }
        const tone = generateDtmfTone(ch, toneDurationMs);
        if (tone) {
            chunks.push(...tone);
            chunks.push(...generateSilence(pauseDurationMs));
        }
    }
    return chunks;
}
