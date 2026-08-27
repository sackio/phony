import twilio from 'twilio';
import { DYNAMIC_API_SECRET, RECORD_CALLS } from '../../config/constants.js';

/**
 * Service for handling Twilio call operations
 */
export class TwilioCallService {
    private readonly twilioClient: twilio.Twilio;

    // Deduplication: track recent call attempts to prevent double-dial
    private recentCallAttempts: Map<string, number> = new Map();
    private static DEDUP_WINDOW_MS = 15000; // 15 seconds

    /**
     * The most recently constructed instance, for callers that cannot be handed
     * one directly.
     *
     * ⛔ THIS EXISTS BECAUSE ITS ABSENCE WAS A LIVE BUG. `CallStateService`'s
     * auto-hangup called `TwilioCallService.getInstance()` — a method that did
     * not exist on this class. The call sits outside that function's try/catch,
     * so when a call hit its duration cap the timer threw
     * "getInstance is not a function" as an unhandled rejection and the call was
     * NEVER TERMINATED. The safety ceiling silently did nothing, which is the
     * worst version of this codebase's recurring defect: the reassuring outcome
     * is the broken one, and nothing in the logs says so.
     *
     * Every construction here uses the same account credentials, so sharing the
     * latest is safe. Registering in the constructor rather than lazily building
     * from env keeps credential handling in one place — the composition root.
     */
    private static sharedInstance: TwilioCallService | undefined;

    /**
     * @throws if no instance has been constructed yet. ⛔ Deliberately throws
     * rather than returning undefined: a null here would be checked with `?.`
     * by some future caller and silently skip the hangup, restoring the exact
     * bug this replaced.
     */
    public static getInstance(): TwilioCallService {
        if (!TwilioCallService.sharedInstance) {
            throw new Error('TwilioCallService.getInstance() called before any instance was constructed');
        }
        return TwilioCallService.sharedInstance;
    }

    /** For tests, so one case cannot leak a client into the next. */
    public static resetInstance(): void {
        TwilioCallService.sharedInstance = undefined;
    }

    /**
     * Create a new Twilio call service
     * @param twilioClient The Twilio client
     */
    constructor(twilioClient: twilio.Twilio) {
        this.twilioClient = twilioClient;
        TwilioCallService.sharedInstance = this;
    }

    /**
     * Get the Twilio client instance
     * @returns The Twilio client
     */
    public getTwilioClient(): twilio.Twilio {
        return this.twilioClient;
    }

    /**
     * Start recording a call
     * @param callSid The SID of the call to record
     */
    public async startRecording(callSid: string): Promise<void> {
        if (!RECORD_CALLS || !callSid) {
            return;
        }

        try {
            await this.twilioClient.calls(callSid)
                .recordings
                .create();
        } catch (error) {
            console.error(`Failed to start recording for call ${callSid}:`, error);
        }
    }

    /**
     * End a call
     * @param callSid The SID of the call to end
     */
    public async endCall(callSid: string): Promise<void> {
        if (!callSid) {
            return;
        }

        try {
            await this.twilioClient.calls(callSid)
                .update({ status: 'completed' });
        } catch (error) {
            console.error(`Failed to end call ${callSid}:`, error);
        }
    }

    /**
     * Ask Twilio what it thinks a call's status is, right now.
     *
     * ⛔ FAILS CLOSED. On any error this returns null rather than a reassuring
     * default, and every caller must treat null as "cannot confirm" — never as
     * "probably fine". This is used to gate call extensions, so a laundered
     * success here would hand an unbounded extension to exactly the wedged call
     * the check exists to stop.
     *
     * ⚠️ Twilio being happy is NOT proof a conversation is happening. On the
     * 2026-08-27 warm-transfer failure Twilio reported the call in-progress
     * throughout while the human on the other end heard nothing at all. Pair
     * this with a transcript-liveness check; it is the weaker of the two.
     */
    public async getCallStatus(callSid: string): Promise<string | null> {
        if (!callSid) {
            return null;
        }

        try {
            const call = await this.twilioClient.calls(callSid).fetch();
            return call.status ?? null;
        } catch (error: any) {
            console.error(`[TwilioCall] Could not fetch status for ${callSid}:`, error?.message ?? error);
            return null;
        }
    }

    /**
     * List all incoming phone numbers in the Twilio account
     * @returns Array of phone numbers with their details
     */
    public async listPhoneNumbers(): Promise<Array<{
        phoneNumber: string;
        friendlyName: string;
        sid: string;
        voiceUrl: string | null;
        hasVoiceWebhook: boolean;
    }>> {
        try {
            const numbers = await this.twilioClient.incomingPhoneNumbers.list();

            return numbers.map(number => ({
                phoneNumber: number.phoneNumber,
                friendlyName: number.friendlyName,
                sid: number.sid,
                voiceUrl: number.voiceUrl || null,
                hasVoiceWebhook: !!(number.voiceUrl && number.voiceUrl.trim())
            }));
        } catch (error) {
            console.error('Error listing Twilio phone numbers:', error);
            throw error;
        }
    }


    /**
     * Options for making an outbound call
     */
    public async makeCall(
        twilioCallbackUrl: string,
        toNumber: string,
        systemInstructions: string,
        callInstructions: string,
        fromNumber?: string,
        elevenLabsAgentId?: string,
        elevenLabsVoiceId?: string,
        dtmfScriptJson?: string,
        dtmfPreflight?: string,
        recordingEnabled?: boolean,
        /**
         * Answering-machine detection mode. Defaults to 'Enable' — decide
         * human-vs-machine at answer and report it. Pass 'DetectMessageEnd' only
         * when the caller intends to LEAVE a message: it holds the line through
         * the entire outgoing greeting waiting for the beep, which is dead air
         * to a human who picked up.
         */
        amdMode: 'Enable' | 'DetectMessageEnd' = 'Enable',
    ): Promise<string> {
        try {
            // Deduplication: prevent placing two calls to the same number within the window
            const now = Date.now();
            const lastAttempt = this.recentCallAttempts.get(toNumber);
            if (lastAttempt && (now - lastAttempt) < TwilioCallService.DEDUP_WINDOW_MS) {
                const secondsAgo = ((now - lastAttempt) / 1000).toFixed(1);
                console.log(`[Twilio Service] Duplicate call to ${toNumber} rejected - last attempt was ${secondsAgo}s ago`);
                throw new Error(`Duplicate call to ${toNumber} rejected - another call was placed ${secondsAgo}s ago`);
            }
            this.recentCallAttempts.set(toNumber, now);

            // Clean up old entries periodically
            if (this.recentCallAttempts.size > 50) {
                for (const [key, timestamp] of this.recentCallAttempts) {
                    if (now - timestamp > TwilioCallService.DEDUP_WINDOW_MS) {
                        this.recentCallAttempts.delete(key);
                    }
                }
            }

            const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

            const systemInstructionsEncoded = encodeURIComponent(systemInstructions);
            const callInstructionsEncoded = encodeURIComponent(callInstructions);

            // Use provided fromNumber or fall back to default TWILIO_NUMBER
            const callerNumber = fromNumber || process.env.TWILIO_NUMBER || '';

            // Build URL for ElevenLabs call
            let url = `${twilioCallbackUrl}/call/outgoing?apiSecret=${DYNAMIC_API_SECRET}&callType=outgoing&systemInstructions=${systemInstructionsEncoded}&callInstructions=${callInstructionsEncoded}`;

            if (elevenLabsAgentId) {
                url += `&elevenLabsAgentId=${encodeURIComponent(elevenLabsAgentId)}`;
            }
            if (elevenLabsVoiceId) {
                url += `&elevenLabsVoiceId=${encodeURIComponent(elevenLabsVoiceId)}`;
            }
            if (dtmfScriptJson) {
                url += `&dtmfScript=${encodeURIComponent(dtmfScriptJson)}`;
            }

            // The instructions ride in the webhook URL, so Twilio's 4000-char URL
            // cap is really an instruction-length cap — and it applies to the
            // PERCENT-ENCODED form, which inflates ordinary prose by roughly 40%.
            // Twilio's own rejection ("Url must be 4000 characters or less") names
            // neither the real limit nor which argument to shorten, so check here
            // and say what to cut. Measured 2026-08-27: 1,768 raw chars → 2,494
            // encoded, which fits; the practical raw budget is ~1,700-1,800.
            const TWILIO_URL_LIMIT = 4000;
            if (url.length > TWILIO_URL_LIMIT) {
                const overBy = url.length - TWILIO_URL_LIMIT;
                const rawTotal = systemInstructions.length + callInstructions.length;
                const inflation = rawTotal > 0
                    ? (systemInstructionsEncoded.length + callInstructionsEncoded.length) / rawTotal
                    : 1;
                const rawToCut = Math.ceil(overBy / Math.max(inflation, 1));
                throw new Error(
                    `Call instructions are too long for Twilio's 4000-character URL limit. ` +
                    `The assembled URL is ${url.length} chars (${overBy} over). ` +
                    `systemInstructions (${systemInstructions.length}) + callInstructions (${callInstructions.length}) ` +
                    `= ${rawTotal} raw chars, which percent-encodes to ${Math.round(rawTotal * inflation)}. ` +
                    `Cut at least ~${rawToCut} raw characters. Encoding inflates by about ` +
                    `${Math.round((inflation - 1) * 100)}% on this text, so aim for ~1,700-1,800 raw total.`
                );
            }

            const createParams: any = {
                to: toNumber,
                from: callerNumber,
                url: url,
                // ⛔ WITHOUT THIS, /call/status NEVER FIRES FOR AN OUTBOUND CALL.
                // The route existed and was only ever reached by inbound calls,
                // so nothing marked an outbound call finished: the live-call push
                // stream never sent call.ended, and its 30s heartbeat kept
                // reporting "the call is still up" long after the far end had
                // hung up. Measured 2026-08-27 on a real test call — seq 4 landed
                // 30 seconds after hangup still claiming the call was live, which
                // is strictly worse than having no heartbeat at all.
                statusCallback: `${twilioCallbackUrl}/call/status`,
                statusCallbackMethod: 'POST',
                statusCallbackEvent: ['completed'],

                // ⛔ ANSWERING-MACHINE DETECTION. Until this, an outbound call
                // that reached voicemail was indistinguishable from one a person
                // picked up: the agent delivered its pitch to a recording, paid
                // for the minutes, left a mangled half-message that started
                // mid-greeting, and nothing told the controlling agent any of it
                // had happened. Most numbers this system dials — carriers,
                // contractors, claims desks — go to voicemail routinely.
                //
                // `asyncAmd` is what makes this safe to switch on: detection runs
                // ALONGSIDE the call rather than delaying the connection, so a
                // human who answers is not left listening to silence while Twilio
                // makes up its mind. The verdict arrives separately on
                // /call/amd-status.
                //
                // 'Enable' decides human-vs-machine at answer. 'DetectMessageEnd'
                // additionally waits for the beep, which is the only mode that
                // supports leaving a message — but it holds the line through the
                // whole outgoing greeting, so it is opt-in per call rather than
                // the default.
                machineDetection: amdMode,
                asyncAmd: 'true',
                asyncAmdStatusCallback: `${twilioCallbackUrl}/call/amd-status`,
                asyncAmdStatusCallbackMethod: 'POST',
            };
            // sendDigits: Twilio dials these DTMF digits at the carrier level
            // immediately after the called party answers, before any TwiML / media
            // stream takes over. Use 'w' for half-second pauses. Reliable for
            // IVR menu navigation.
            if (dtmfPreflight) createParams.sendDigits = dtmfPreflight;

            // Per-call recording override. When true, asks Twilio to record
            // both legs from answer to hangup. Useful for debugging IVR
            // transmission (whether our DTMF tones actually reach the line)
            // and for probe calls that map an IVR's menu timing.
            if (recordingEnabled) {
                createParams.record = true;
                createParams.recordingChannels = 'dual';
            }

            const call = await twilioClient.calls.create(createParams);

            return call.sid;
        } catch (error) {
            console.error(`Error making call: ${error}`);
            throw error;
        }
    }

    /**
     * Make an outbound call with options object (new interface)
     */
    public async makeOutboundCall(
        toNumber: string,
        systemInstructions: string,
        callInstructions: string,
        elevenLabsAgentId?: string,
        elevenLabsVoiceId?: string,
        fromNumber?: string,
        dtmfScriptJson?: string,
        dtmfPreflight?: string,
        recordingEnabled?: boolean,
    ): Promise<{ sid: string; status: string }> {
        const publicUrl = process.env.PUBLIC_URL || '';

        const callSid = await this.makeCall(
            publicUrl,
            toNumber,
            systemInstructions,
            callInstructions,
            fromNumber,
            elevenLabsAgentId,
            elevenLabsVoiceId,
            dtmfScriptJson,
            dtmfPreflight,
            recordingEnabled,
        );

        return { sid: callSid, status: 'initiated' };
    }

    /**
     * Send DTMF tones to an active call
     * @param twilioCallSid The Twilio call SID
     * @param digits DTMF digits to send (0-9, *, #, A-D, w, W)
     */
    public async sendDTMF(twilioCallSid: string, digits: string): Promise<void> {
        if (!twilioCallSid || !digits) {
            throw new Error('Call SID and digits are required');
        }

        try {
            // Create TwiML to play DTMF tones
            const VoiceResponse = (await import('twilio/lib/twiml/VoiceResponse.js')).default;
            const twiml = new VoiceResponse();
            twiml.play({ digits });

            // Redirect back to the media stream after DTMF
            twiml.redirect(`${process.env.PUBLIC_URL}/call/outgoing?apiSecret=${DYNAMIC_API_SECRET}`);

            // Update the call with new TwiML
            await this.twilioClient.calls(twilioCallSid).update({
                twiml: twiml.toString()
            });

            console.log(`[Twilio Service] Sent DTMF tones "${digits}" to call ${twilioCallSid}`);
        } catch (error) {
            console.error(`[Twilio Service] Error sending DTMF to call ${twilioCallSid}:`, error);
            throw error;
        }
    }

    /**
     * Put a call on hold with hold music
     * @param twilioCallSid The Twilio call SID
     */
    public async holdCall(twilioCallSid: string): Promise<void> {
        if (!twilioCallSid) {
            throw new Error('Call SID is required');
        }

        try {
            const VoiceResponse = (await import('twilio/lib/twiml/VoiceResponse.js')).default;
            const twiml = new VoiceResponse();

            twiml.say({ voice: 'Polly.Matthew' }, 'One moment please.');
            twiml.play({ loop: 0 }, 'http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3');

            await this.twilioClient.calls(twilioCallSid).update({
                twiml: twiml.toString()
            });

            console.log(`[Twilio Service] Put call ${twilioCallSid} on hold`);
        } catch (error) {
            console.error(`[Twilio Service] Error holding call ${twilioCallSid}:`, error);
            throw error;
        }
    }

    /**
     * Resume a call from hold state
     * @param twilioCallSid The Twilio call SID
     */
    public async resumeCall(twilioCallSid: string): Promise<void> {
        if (!twilioCallSid) {
            throw new Error('Call SID is required');
        }

        try {
            // Create TwiML to redirect back to the media stream
            const VoiceResponse = (await import('twilio/lib/twiml/VoiceResponse.js')).default;
            const twiml = new VoiceResponse();

            // Redirect back to the media stream to resume AI conversation
            twiml.redirect(`${process.env.PUBLIC_URL}/call/outgoing?apiSecret=${DYNAMIC_API_SECRET}`);

            // Update the call with new TwiML
            await this.twilioClient.calls(twilioCallSid).update({
                twiml: twiml.toString()
            });

            console.log(`[Twilio Service] Resumed call ${twilioCallSid} from hold`);
        } catch (error) {
            console.error(`[Twilio Service] Error resuming call ${twilioCallSid}:`, error);
            throw error;
        }
    }
}
