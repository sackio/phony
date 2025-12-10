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

// Production Safety Controls - ALWAYS ENFORCED
// These limits prevent runaway costs and enforce safe operation

// Maximum concurrent calls (incoming + outgoing combined)
export const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_CALLS || '10');

// Maximum concurrent outgoing calls specifically
export const MAX_CONCURRENT_OUTGOING_CALLS = parseInt(process.env.MAX_CONCURRENT_OUTGOING_CALLS || '5');

// Maximum concurrent incoming calls specifically
export const MAX_CONCURRENT_INCOMING_CALLS = parseInt(process.env.MAX_CONCURRENT_INCOMING_CALLS || '5');

// Maximum duration for outgoing calls in seconds (auto-hangup after this)
export const MAX_OUTGOING_CALL_DURATION = parseInt(process.env.MAX_OUTGOING_CALL_DURATION || '600'); // 10 minutes default

// Maximum duration for incoming calls in seconds (auto-hangup after this)
export const MAX_INCOMING_CALL_DURATION = parseInt(process.env.MAX_INCOMING_CALL_DURATION || '1800'); // 30 minutes default

// Test receiver endpoint (optional for internal testing without OpenAI costs)
export const ENABLE_TEST_RECEIVER = process.env.ENABLE_TEST_RECEIVER === 'true';

// SMS Configuration - Whitelist of numbers that can send SMS
// Only these numbers are allowed to send text messages
export const SMS_ENABLED_NUMBERS = process.env.SMS_ENABLED_NUMBERS
    ? process.env.SMS_ENABLED_NUMBERS.split(',').map(n => n.trim())
    : ['+18578167225']; // Default to 857 number only
