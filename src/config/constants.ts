import dotenv from 'dotenv';

// Load environment variables BEFORE using them
dotenv.config();

export const LOG_EVENT_TYPES = [
    'error',
];

// Use fixed secret from env for testing, or generate random one for security
export const DYNAMIC_API_SECRET = process.env.API_SECRET || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
export const SHOW_TIMING_MATH = true;
export const RECORD_CALLS = process.env.RECORD === 'true';
// More specific goodbye phrases to avoid false positives
// Only match clear, unambiguous farewell statements
export const GOODBYE_PHRASES = [
    'goodbye',
    'bye bye',
    'bye now',
    'talk to you later',
    'gotta go',
    'have to go now',
    'need to go',
    'end the call',
    'hang up now',
    'have a great day',
    'have a good day',
    'have a nice day',
    'take care',
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

// Test receiver endpoint (optional for internal testing)
export const ENABLE_TEST_RECEIVER = process.env.ENABLE_TEST_RECEIVER === 'true';

// SMS Configuration - Whitelist of numbers that can send SMS
// Only these numbers are allowed to send text messages
export const SMS_ENABLED_NUMBERS = process.env.SMS_ENABLED_NUMBERS
    ? process.env.SMS_ENABLED_NUMBERS.split(',').map(n => n.trim())
    : ['+18575550111']; // Default to 857 number only

// Ordered preference list for automatic failover resends when an outbound
// SMS bounces (e.g. Twilio 30005). Excludes persona lines (Ben's direct
// +16175550113) and toll-free numbers by default — failover messages must
// come from a general-purpose Phony number.
export const SMS_FAILOVER_NUMBERS: string[] = process.env.SMS_FAILOVER_NUMBERS
    ? process.env.SMS_FAILOVER_NUMBERS.split(',').map(n => n.trim())
    : ['+19785550112', '+18575550111'];

// Default incoming call redirect message (played when no config exists)
// Encourages callers to use SMS instead of phone calls
export const DEFAULT_INCOMING_CALL_MESSAGE = process.env.DEFAULT_INCOMING_CALL_MESSAGE ||
    'Due to unwanted calls, please send text messages to this number instead. If you absolutely must speak over the phone, send a message to setup a call, but messages are preferred. Thank you.';

// Voice for the default incoming call message (Polly.Matthew is a natural male US English voice)
export const DEFAULT_INCOMING_CALL_VOICE = process.env.DEFAULT_INCOMING_CALL_VOICE || 'Polly.Matthew';

// SMS Proxy Configuration
// When enabled, incoming SMS and voicemail notifications are forwarded to these numbers
// Uses Twilio Conversations API for native group MMS threads
export const SMS_PROXY_TARGET_NUMBERS: string[] = process.env.SMS_PROXY_TARGET_NUMBERS
    ? process.env.SMS_PROXY_TARGET_NUMBERS.split(',').map(n => n.trim())
    : ['+13015550101', '+13015550102'];
export const SMS_PROXY_ENABLED = process.env.SMS_PROXY_ENABLED !== 'false'; // Enabled by default

// Twilio Messaging Service SID (optional - auto-created if not set)
// Required for Conversations API group MMS
export const TWILIO_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID || '';

// ElevenLabs Configuration
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
export const ELEVENLABS_DEFAULT_AGENT_ID = process.env.ELEVENLABS_DEFAULT_AGENT_ID || '';
export const ELEVENLABS_DEFAULT_VOICE_ID = process.env.ELEVENLABS_DEFAULT_VOICE_ID || '';

// Native Twilio integration — used when calls go through
// POST /v1/convai/twilio/outbound-call (Phase 2 hybrid path).
// Get phnum_… by importing the Twilio number in the ElevenLabs dashboard.
export const ELEVENLABS_AGENT_PHONE_NUMBER_ID = process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID || '';

// Shared secret ElevenLabs uses to sign the post-call webhook body.
// Configured per-webhook in the agent's Security tab. Empty disables HMAC check
// (don't run with empty in prod — use the dashboard-provided wsec_… value).
export const ELEVENLABS_POSTCALL_WEBHOOK_SECRET = process.env.ELEVENLABS_POSTCALL_WEBHOOK_SECRET || '';

