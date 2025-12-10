#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const VOICES = ['nova', 'shimmer'];
const HOLD_MESSAGE = 'Please hold for a moment while I gather that information for you.';
const OUTPUT_DIR = path.join(__dirname, '../public/audio/hold');

async function generateHoldMessage(voice) {
    console.log(`Generating hold message for voice: ${voice}...`);

    try {
        const mp3 = await openai.audio.speech.create({
            model: 'tts-1',
            voice: voice,
            input: HOLD_MESSAGE,
            speed: 1.0
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        const outputPath = path.join(OUTPUT_DIR, `hold-${voice}.mp3`);

        fs.writeFileSync(outputPath, buffer);
        console.log(`✓ Generated: ${outputPath}`);
    } catch (error) {
        console.error(`✗ Failed to generate hold message for ${voice}:`, error.message);
    }
}

async function main() {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`Created directory: ${OUTPUT_DIR}`);
    }

    console.log('Generating hold messages for all OpenAI voices...\n');

    // Generate all hold messages
    for (const voice of VOICES) {
        await generateHoldMessage(voice);
    }

    console.log('\n✓ All hold messages generated successfully!');
    console.log(`Files saved to: ${OUTPUT_DIR}`);
}

main().catch(console.error);
