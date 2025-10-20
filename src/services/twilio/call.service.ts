import twilio from 'twilio';
import { DYNAMIC_API_SECRET, RECORD_CALLS } from '../../config/constants.js';

/**
 * Service for handling Twilio call operations
 */
export class TwilioCallService {
    private readonly twilioClient: twilio.Twilio;

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


    public async makeCall(twilioCallbackUrl: string, toNumber: string, systemInstructions: string, callInstructions: string, voice = 'sage', fromNumber?: string): Promise<string> {
        try {
            const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

            const systemInstructionsEncoded = encodeURIComponent(systemInstructions);
            const callInstructionsEncoded = encodeURIComponent(callInstructions);

            // Use provided fromNumber or fall back to default TWILIO_NUMBER
            const callerNumber = fromNumber || process.env.TWILIO_NUMBER || '';

            const call = await twilioClient.calls.create({
                to: toNumber,
                from: callerNumber,
                url: `${twilioCallbackUrl}/call/outgoing?apiSecret=${DYNAMIC_API_SECRET}&callType=outgoing&systemInstructions=${systemInstructionsEncoded}&callInstructions=${callInstructionsEncoded}&voice=${voice}`,
            });

            return call.sid;
        } catch (error) {
            console.error(`Error making call: ${error}`);
            throw error;
        }
    }
}
