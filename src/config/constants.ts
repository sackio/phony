import dotenv from 'dotenv';

// Load environment variables BEFORE using them
dotenv.config();

export const LOG_EVENT_TYPES = [
    'error',
    'session.created',
    'response.audio.delta',
    'response.audio_transcript.done',
    'conversation.item.input_audio_transcription.completed',
    'input_audio_buffer.speech_started',
    'input_audio_buffer.speech_stopped',
    'input_audio_buffer.committed',
];

// Use fixed secret from env for testing, or generate random one for security
export const DYNAMIC_API_SECRET = process.env.API_SECRET || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
export const SHOW_TIMING_MATH = true;
export const VOICE = 'sage';
export const RECORD_CALLS = process.env.RECORD === 'true';
// More specific goodbye phrases to avoid false positives
// Only match clear, unambiguous farewell statements
export const GOODBYE_PHRASES = [
    'goodbye now',
    'bye bye',
    'talk to you later',
    'gotta go',
    'have to go now',
    'need to go',
    'end the call',
    'hang up now'
];
