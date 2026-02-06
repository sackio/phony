/**
 * Audio conversion service for ElevenLabs integration
 * Handles µ-law (G.711) ↔ PCM conversion between Twilio and ElevenLabs
 */

/**
 * Convert µ-law 8kHz audio to PCM 16-bit 16kHz
 * Twilio sends audio in µ-law format at 8kHz
 * ElevenLabs expects PCM 16-bit at 16kHz
 */
export function ulawToPcm16k(ulawData: Buffer): Buffer {
    // µ-law expansion table (8-bit µ-law to 16-bit linear PCM)
    const ULAW_TO_LINEAR: number[] = [];
    for (let i = 0; i < 256; i++) {
        const ulaw = ~i;
        const sign = (ulaw & 0x80) !== 0;
        const exponent = (ulaw >> 4) & 0x07;
        const mantissa = ulaw & 0x0f;

        let sample = ((mantissa << 3) + 0x84) << exponent;
        sample -= 0x84;

        ULAW_TO_LINEAR[i] = sign ? -sample : sample;
    }

    // Expand µ-law to 16-bit linear at 8kHz
    const pcm8k = Buffer.alloc(ulawData.length * 2);
    for (let i = 0; i < ulawData.length; i++) {
        const sample = ULAW_TO_LINEAR[ulawData[i]];
        pcm8k.writeInt16LE(sample, i * 2);
    }

    // Upsample from 8kHz to 16kHz using linear interpolation
    const pcm16k = Buffer.alloc(pcm8k.length * 2);
    const inputSamples = pcm8k.length / 2;

    for (let i = 0; i < inputSamples; i++) {
        const sample = pcm8k.readInt16LE(i * 2);
        const nextSample = i < inputSamples - 1
            ? pcm8k.readInt16LE((i + 1) * 2)
            : sample;

        // Write original sample
        pcm16k.writeInt16LE(sample, i * 4);

        // Write interpolated sample
        const interpolated = Math.round((sample + nextSample) / 2);
        pcm16k.writeInt16LE(interpolated, i * 4 + 2);
    }

    return pcm16k;
}

/**
 * Convert PCM 16-bit to µ-law 8kHz
 * ElevenLabs can output in ulaw_8000 format natively, so this is mainly
 * for fallback if we need to convert from PCM output
 */
export function pcmToUlaw(pcmData: Buffer, inputSampleRate: number = 16000): Buffer {
    let pcm8k: Buffer;
    if (inputSampleRate === 16000) {
        // Each PCM sample is 2 bytes. Downsample 16kHz→8kHz by taking every other sample.
        const inputSamples = Math.floor(pcmData.length / 2);
        const outputSamples = Math.floor(inputSamples / 2);
        pcm8k = Buffer.alloc(outputSamples * 2);
        for (let i = 0; i < outputSamples; i++) {
            const sample = pcmData.readInt16LE(i * 4);
            pcm8k.writeInt16LE(sample, i * 2);
        }
    } else {
        pcm8k = pcmData;
    }

    // Convert 16-bit linear PCM to 8-bit µ-law
    const numSamples = Math.floor(pcm8k.length / 2);
    const ulawData = Buffer.alloc(numSamples);

    for (let i = 0; i < numSamples; i++) {
        const sample = pcm8k.readInt16LE(i * 2);
        ulawData[i] = linearToUlaw(sample);
    }

    return ulawData;
}

/**
 * Convert a single 16-bit linear PCM sample to 8-bit µ-law
 */
function linearToUlaw(sample: number): number {
    const BIAS = 0x84;
    const CLIP = 32635;

    // Get the sign and magnitude
    const sign = sample < 0 ? 0x80 : 0;
    if (sample < 0) sample = -sample;

    // Clip the sample
    if (sample > CLIP) sample = CLIP;

    // Add bias for encoding
    sample += BIAS;

    // Find the exponent
    let exponent = 7;
    let mask = 0x4000;
    while ((sample & mask) === 0 && exponent > 0) {
        exponent--;
        mask >>= 1;
    }

    // Get the mantissa
    const mantissa = (sample >> (exponent + 3)) & 0x0f;

    // Combine and complement
    return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/**
 * Encode audio buffer to base64 for WebSocket transmission
 */
export function audioToBase64(audioBuffer: Buffer): string {
    return audioBuffer.toString('base64');
}

/**
 * Decode base64 audio data to buffer
 */
export function base64ToAudio(base64Data: string): Buffer {
    return Buffer.from(base64Data, 'base64');
}

/**
 * Convert base64 µ-law audio from Twilio to base64 PCM for ElevenLabs
 */
export function convertTwilioToElevenLabs(twilioBase64: string): string {
    const ulawBuffer = base64ToAudio(twilioBase64);
    const pcmBuffer = ulawToPcm16k(ulawBuffer);
    return audioToBase64(pcmBuffer);
}

/**
 * Audio format constants
 */
export const TWILIO_AUDIO_FORMAT = {
    encoding: 'g711_ulaw',
    sampleRate: 8000,
    channels: 1
};

export const ELEVENLABS_INPUT_FORMAT = {
    encoding: 'pcm_16000',
    sampleRate: 16000,
    channels: 1
};

export const ELEVENLABS_OUTPUT_FORMAT = {
    // Request ulaw_8000 from ElevenLabs to match Twilio's native format
    encoding: 'ulaw_8000',
    sampleRate: 8000,
    channels: 1
};
