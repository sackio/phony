import twilio from 'twilio';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { DYNAMIC_API_SECRET, RECORD_CALLS } from '../../config/constants.js';

/**
 * Service for handling Twilio call operations
 */
export class TwilioCallService {
    private readonly twilioClient: twilio.Twilio;
    private readonly openaiClient: OpenAI;

    // Deduplication: track recent call attempts to prevent double-dial
    private recentCallAttempts: Map<string, number> = new Map();
    private static DEDUP_WINDOW_MS = 15000; // 15 seconds

    /**
     * Create a new Twilio call service
     * @param twilioClient The Twilio client
     */
    constructor(twilioClient: twilio.Twilio) {
        this.twilioClient = twilioClient;
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
        voice = 'sage',
        fromNumber?: string,
        provider: 'openai' | 'elevenlabs' = 'openai',
        elevenLabsAgentId?: string,
        elevenLabsVoiceId?: string
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

            // Build URL with provider information
            let url = `${twilioCallbackUrl}/call/outgoing?apiSecret=${DYNAMIC_API_SECRET}&callType=outgoing&systemInstructions=${systemInstructionsEncoded}&callInstructions=${callInstructionsEncoded}&voice=${voice}&provider=${provider}`;

            // Add ElevenLabs-specific parameters if using elevenlabs provider
            if (provider === 'elevenlabs') {
                if (elevenLabsAgentId) {
                    url += `&elevenLabsAgentId=${encodeURIComponent(elevenLabsAgentId)}`;
                }
                if (elevenLabsVoiceId) {
                    url += `&elevenLabsVoiceId=${encodeURIComponent(elevenLabsVoiceId)}`;
                }
            }

            const call = await twilioClient.calls.create({
                to: toNumber,
                from: callerNumber,
                url: url,
            });

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
        voice: string = 'alloy',
        provider: 'openai' | 'elevenlabs' = 'openai',
        elevenLabsAgentId?: string,
        elevenLabsVoiceId?: string,
        fromNumber?: string
    ): Promise<{ sid: string; status: string }> {
        const publicUrl = process.env.PUBLIC_URL || '';

        const callSid = await this.makeCall(
            publicUrl,
            toNumber,
            systemInstructions,
            callInstructions,
            voice,
            fromNumber,
            provider,
            elevenLabsAgentId,
            elevenLabsVoiceId
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
     * Put a call on hold with a hold message using the agent's voice
     * @param twilioCallSid The Twilio call SID
     * @param voice The voice to use for the hold message (from call state)
     */
    public async holdCall(twilioCallSid: string, voice: string = 'sage'): Promise<void> {
        if (!twilioCallSid) {
            throw new Error('Call SID is required');
        }

        try {
            // Create TwiML to play hold message with the agent's voice
            const VoiceResponse = (await import('twilio/lib/twiml/VoiceResponse.js')).default;
            const twiml = new VoiceResponse();

            // Map OpenAI Realtime API voice names to pre-generated hold message files
            // Available voices: alloy, echo, fable, onyx, nova, shimmer
            const voiceMapping: Record<string, string> = {
                'alloy': 'alloy',
                'echo': 'echo',
                'fable': 'fable',
                'onyx': 'onyx',
                'nova': 'nova',
                'shimmer': 'shimmer',
                // Map sage (deprecated voice) to alloy as fallback
                'sage': 'alloy'
            };

            const mappedVoice = voiceMapping[voice] || 'alloy';
            const holdMessageUrl = `${process.env.PUBLIC_URL}/audio/hold/hold-${mappedVoice}.mp3`;

            // Play pre-generated hold message in the agent's voice
            twiml.play(holdMessageUrl);

            // Play hold music continuously
            twiml.play({ loop: 0 }, 'http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3');

            // Update the call with new TwiML
            await this.twilioClient.calls(twilioCallSid).update({
                twiml: twiml.toString()
            });

            console.log(`[Twilio Service] Put call ${twilioCallSid} on hold with voice: ${voice} (using pre-generated message: hold-${mappedVoice}.mp3)`);
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
