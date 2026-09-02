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

/**
 * Longest far-end utterance still eligible for goodbye detection.
 *
 * ⚠️ This is a length guard, not a style preference. Every phrase above appears
 * routinely inside IVR hold announcements, which run to hundreds of characters;
 * a person actually ringing off says a handful of words. Raising this re-opens
 * the failure where a hold loop containing "hang up now" or "have a nice day"
 * terminates a call that was about to reach a representative.
 */
export const FAR_END_GOODBYE_MAX_CHARS = 60;

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

// ─── Live call extension ────────────────────────────────────────────────────
// A controlling agent can push the auto-hangup back while a call is genuinely
// still going. ⛔ THE HAZARD IS THE PHANTOM CALL — a leg that is technically up
// while nothing is happening on it: the far end gone, dead air, or the warm
// transfer failure electric measured on 2026-08-27 where our side rendered
// audio perfectly and the human heard silence. An extension granted on request
// alone would let one of those bill forever.
//
// So an extension is never granted because it was asked for. The call has to
// have PROVEN it is alive, and these four bounds are the proof.

// Longest single bump. Small on purpose: a call that needs more comes back and
// re-proves it is alive, rather than buying an hour on one moment's evidence.
export const CALL_EXTENSION_MAX_MINUTES = parseInt(process.env.CALL_EXTENSION_MAX_MINUTES || '5');

// Ceiling nothing can cross, however many extensions are granted. The last
// backstop between a wedged call and an unbounded Twilio bill.
export const ABSOLUTE_MAX_CALL_DURATION = parseInt(process.env.ABSOLUTE_MAX_CALL_DURATION || '3600'); // 1 hour

// How many times one call may be extended at all.
export const MAX_CALL_EXTENSIONS = parseInt(process.env.MAX_CALL_EXTENSIONS || '8');

// ⭐ THE GATE THAT ACTUALLY CATCHES A PHANTOM. Someone must have spoken within
// this window. A phantom call is silent by definition, so this is the only
// check that distinguishes "still working the problem" from "nobody is there" —
// Twilio's own status does not, because on the warm-transfer failure Twilio
// still considered that call perfectly healthy.
export const CALL_LIVENESS_WINDOW_MS = parseInt(process.env.CALL_LIVENESS_WINDOW_MS || '60000'); // 60s

// How long before the auto-hangup to warn the controlling agent. Until this
// existed the cap fired as a bare Twilio endCall — mid-sentence, with nothing
// told to anyone. Extension without a warning just moves where that happens.
export const CALL_EXPIRY_WARNING_MS = parseInt(process.env.CALL_EXPIRY_WARNING_MS || '90000'); // 90s

// ─── Per-call spend ceiling ─────────────────────────────────────────────────
// Duration was always a PROXY for cost. A minute-based cap silently means a
// different amount of money whenever the voice provider, model or destination
// changes, so this meters the real quantity underneath it.
//
// ⛔ It does NOT replace the duration cap. A wedged call is cheap and endless —
// it accrues almost nothing per minute, so a dollar ceiling would never fire on
// exactly the phantom the duration cap exists to kill. Busy-and-expensive and
// silent-and-endless are different failures and each needs its own gate.

// Blended rate is split so either leg can be repriced alone when a contract
// changes. Twilio US outbound long-code voice, and the ElevenLabs conversational
// leg (~$0.08-0.10/min per the project's own cost notes; take the pessimistic
// end, since a ceiling built on the optimistic number is not a ceiling).
export const CALL_COST_TELEPHONY_USD_PER_MIN = parseFloat(process.env.CALL_COST_TELEPHONY_USD_PER_MIN || '0.014');
export const CALL_COST_VOICE_AI_USD_PER_MIN = parseFloat(process.env.CALL_COST_VOICE_AI_USD_PER_MIN || '0.10');

// ~$0.114/min blended ⇒ the 1200s default allowance is ~$2.28 and the 3600s
// absolute ceiling is ~$6.84. $5.00 therefore binds at ~44 min: inside the hard
// duration ceiling, but far outside any normal call, so it acts as a backstop on
// a long chain of granted extensions rather than interrupting ordinary work.
export const CALL_BUDGET_USD = parseFloat(process.env.CALL_BUDGET_USD || '5.00');

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

