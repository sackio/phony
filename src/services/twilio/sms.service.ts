import twilio from 'twilio';
import { SmsDirection, SmsStatus } from '../../types.js';
import { SmsStorageService } from '../sms/storage.service.js';
import { SMS_ENABLED_NUMBERS, SMS_PROXY_ENABLED } from '../../config/constants.js';
import { TwilioConversationsService } from './conversations.service.js';

/**
 * Service for handling Twilio SMS operations
 */
export class TwilioSmsService {
    private readonly twilioClient: twilio.Twilio;
    private readonly storageService: SmsStorageService;
    private readonly conversationsService: TwilioConversationsService;

    /**
     * Create a new Twilio SMS service
     * @param twilioClient The Twilio client
     * @param conversationsService The Twilio Conversations service for group MMS
     */
    constructor(twilioClient: twilio.Twilio, conversationsService: TwilioConversationsService) {
        this.twilioClient = twilioClient;
        this.storageService = new SmsStorageService();
        this.conversationsService = conversationsService;
    }

    /**
     * Validate E.164 phone number format
     * @param phoneNumber The phone number to validate
     * @returns True if valid, false otherwise
     */
    private isValidE164(phoneNumber: string): boolean {
        return /^\+[1-9]\d{1,14}$/.test(phoneNumber);
    }

    /**
     * Send an SMS/MMS message
     * @param toNumber The recipient phone number (E.164 format)
     * @param body The message body
     * @param fromNumber Optional sender phone number (defaults to TWILIO_NUMBER)
     * @param mediaUrls Optional array of media URLs for MMS (images, files, etc.)
     * @returns The message SID
     */
    public async sendSms(
        toNumber: string,
        body: string,
        fromNumber?: string,
        mediaUrls?: string[]
    ): Promise<{ messageSid: string; status: string }> {
        // Validate phone numbers
        if (!this.isValidE164(toNumber)) {
            throw new Error(`Invalid recipient phone number format. Must be E.164 format (e.g., +11234567890). Got: ${toNumber}`);
        }

        // Use provided fromNumber or fall back to default TWILIO_NUMBER
        const sender = fromNumber || process.env.TWILIO_NUMBER;
        if (!sender) {
            throw new Error('No sender phone number provided and TWILIO_NUMBER environment variable not set');
        }

        if (!this.isValidE164(sender)) {
            throw new Error(`Invalid sender phone number format. Must be E.164 format (e.164., +11234567890). Got: ${sender}`);
        }

        // Production Safety Control: Check SMS whitelist
        if (!SMS_ENABLED_NUMBERS.includes(sender)) {
            console.log(`[TwilioSMS] ⚠️  SMS rejected - sender not in whitelist: ${sender}`);
            console.log(`[TwilioSMS] Allowed numbers:`, SMS_ENABLED_NUMBERS);
            throw new Error(`SMS sending is not enabled for number ${sender}. Only whitelisted numbers can send SMS.`);
        }

        // Validate body
        if (!body || body.trim().length === 0) {
            throw new Error('SMS body cannot be empty');
        }

        if (body.length > 1600) {
            throw new Error(`SMS body too long (${body.length} characters). Maximum is 1600 characters.`);
        }

        try {
            // Get PUBLIC_URL for status callbacks
            const publicUrl = process.env.PUBLIC_URL;
            const statusCallbackUrl = publicUrl ? `${publicUrl}/sms/status` : undefined;

            // Build message options
            const messageOptions: any = {
                from: sender,
                to: toNumber,
                body: body.trim(),
                ...(statusCallbackUrl && { statusCallback: statusCallbackUrl })
            };

            // Add media URLs for MMS if provided
            if (mediaUrls && mediaUrls.length > 0) {
                // Twilio accepts up to 10 media URLs
                messageOptions.mediaUrl = mediaUrls.slice(0, 10);
            }

            const message = await this.twilioClient.messages.create(messageOptions);

            // Save to MongoDB
            await this.storageService.saveSms({
                messageSid: message.sid,
                fromNumber: sender,
                toNumber: toNumber,
                direction: SmsDirection.OUTBOUND,
                body: body.trim(),
                status: this.mapTwilioStatus(message.status),
                twilioStatus: message.status,
                numMedia: mediaUrls ? mediaUrls.length : 0,
                mediaUrls: mediaUrls
            });

            console.log(`[TwilioSMS] Sent SMS ${message.sid} from ${sender} to ${toNumber}`);

            return {
                messageSid: message.sid,
                status: message.status
            };
        } catch (error: any) {
            console.error(`[TwilioSMS] Error sending SMS:`, error);
            throw new Error(`Failed to send SMS: ${error.message || 'Unknown error'}`);
        }
    }

    /**
     * Map Twilio status to our SmsStatus enum
     * @param twilioStatus The Twilio status string
     * @returns Our SmsStatus enum value
     */
    private mapTwilioStatus(twilioStatus: string): SmsStatus {
        // Handle undefined/null status
        if (!twilioStatus) {
            console.warn(`[TwilioSMS] Received undefined/null status, defaulting to QUEUED`);
            return SmsStatus.QUEUED;
        }

        const statusMap: { [key: string]: SmsStatus } = {
            'queued': SmsStatus.QUEUED,
            'sending': SmsStatus.SENDING,
            'sent': SmsStatus.SENT,
            'delivered': SmsStatus.DELIVERED,
            'undelivered': SmsStatus.UNDELIVERED,
            'failed': SmsStatus.FAILED,
            'received': SmsStatus.RECEIVED
        };

        return statusMap[twilioStatus.toLowerCase()] || SmsStatus.QUEUED;
    }

    /**
     * Handle incoming SMS webhook from Twilio
     * @param data The webhook data from Twilio
     */
    public async handleIncomingSms(data: {
        MessageSid: string;
        From: string;
        To: string;
        Body: string;
        NumMedia?: string;
        MediaUrl0?: string;
        MediaUrl1?: string;
        MediaUrl2?: string;
        MediaUrl3?: string;
        MediaUrl4?: string;
    }): Promise<void> {
        try {
            const numMedia = data.NumMedia ? parseInt(data.NumMedia) : 0;
            const mediaUrls: string[] = [];

            // Collect media URLs if present
            if (numMedia > 0) {
                for (let i = 0; i < numMedia && i < 10; i++) {
                    const mediaUrl = (data as any)[`MediaUrl${i}`];
                    if (mediaUrl) {
                        mediaUrls.push(mediaUrl);
                    }
                }
            }

            // Save the original message
            await this.storageService.saveSms({
                messageSid: data.MessageSid,
                fromNumber: data.From,
                toNumber: data.To,
                direction: SmsDirection.INBOUND,
                body: data.Body || '',
                status: SmsStatus.RECEIVED,
                twilioStatus: 'received',
                numMedia: numMedia,
                mediaUrls: mediaUrls
            });

            console.log(`[TwilioSMS] Received SMS ${data.MessageSid} from ${data.From} to ${data.To}`);

            // SMS Proxy via Twilio Conversations API (group MMS)
            if (SMS_PROXY_ENABLED) {
                await this.handleSmsProxy(data.From, data.To, data.Body || '');
            }
        } catch (error) {
            console.error(`[TwilioSMS] Error handling incoming SMS:`, error);
        }
    }

    /**
     * Handle SMS proxy using Twilio Conversations API for native group MMS.
     * Finds or creates a Conversation with [sender, Ben, Laura] and posts the message.
     * The sender won't receive a duplicate since they're the author.
     * Replies from any participant are auto-routed by Twilio.
     */
    private async handleSmsProxy(from: string, to: string, body: string): Promise<void> {
        try {
            console.log(`[TwilioSMS Proxy] Routing message from ${from} via Conversations API`);

            const conversationSid = await this.conversationsService.findOrCreateConversation(from, to);

            // Post the message to the conversation with the sender as author
            // The author won't receive a duplicate
            await this.conversationsService.sendMessage(conversationSid, body, from);

            console.log(`[TwilioSMS Proxy] ✓ Message posted to conversation ${conversationSid}`);
        } catch (error) {
            console.error(`[TwilioSMS Proxy] Failed to route message via Conversations API:`, error);
        }
    }

    /**
     * Handle SMS status callback from Twilio
     * @param data The status callback data from Twilio
     */
    public async handleStatusCallback(data: {
        MessageSid: string;
        MessageStatus: string;
        ErrorCode?: string;
        ErrorMessage?: string;
    }): Promise<void> {
        try {
            await this.storageService.updateSmsStatus(
                data.MessageSid,
                this.mapTwilioStatus(data.MessageStatus),
                data.MessageStatus,
                data.ErrorMessage,
                data.ErrorCode
            );

            console.log(`[TwilioSMS] Updated SMS ${data.MessageSid} status to ${data.MessageStatus}`);
        } catch (error) {
            console.error(`[TwilioSMS] Error handling status callback:`, error);
        }
    }
}
