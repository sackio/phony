import twilio from 'twilio';
import { SmsDirection, SmsStatus } from '../../types.js';
import { SmsStorageService } from '../sms/storage.service.js';
import { SMS_ENABLED_NUMBERS, SMS_PROXY_TARGET_NUMBER, SMS_PROXY_ENABLED } from '../../config/constants.js';

/**
 * Service for handling Twilio SMS operations
 */
export class TwilioSmsService {
    private readonly twilioClient: twilio.Twilio;
    private readonly storageService: SmsStorageService;

    // SMS Proxy conversation tracking using last 4 digits of phone number
    // Maps: twilioNumber -> (last4digits -> fullSenderNumber)
    private static codeToSender: Map<string, Map<string, string>> = new Map();

    /**
     * Create a new Twilio SMS service
     * @param twilioClient The Twilio client
     */
    constructor(twilioClient: twilio.Twilio) {
        this.twilioClient = twilioClient;
        this.storageService = new SmsStorageService();
    }

    /**
     * Extract last 4 digits from phone number as code
     */
    private static getCodeFromNumber(phoneNumber: string): string {
        // Remove non-digits and get last 4
        const digits = phoneNumber.replace(/\D/g, '');
        return digits.slice(-4);
    }

    /**
     * Register a sender and return their code (last 4 digits)
     */
    private static registerSender(twilioNumber: string, senderNumber: string): string {
        if (!this.codeToSender.has(twilioNumber)) {
            this.codeToSender.set(twilioNumber, new Map());
        }

        const codeMap = this.codeToSender.get(twilioNumber)!;
        const code = this.getCodeFromNumber(senderNumber);

        // Check if this code is already used by a different number
        const existing = codeMap.get(code);
        if (existing && existing !== senderNumber) {
            console.log(`[TwilioSMS Proxy] Code collision: ${code} already mapped to ${existing}, now also ${senderNumber}`);
            // In case of collision, the most recent sender wins
        }

        codeMap.set(code, senderNumber);
        console.log(`[TwilioSMS Proxy] Registered [${code}] -> ${senderNumber} on ${twilioNumber}`);
        return code;
    }

    /**
     * Look up sender by code (last 4 digits) for a Twilio number
     */
    private static getSenderByCode(twilioNumber: string, code: string): string | undefined {
        const codeMap = this.codeToSender.get(twilioNumber);
        return codeMap?.get(code);
    }

    /**
     * Parse reply to extract code prefix (e.g., "1234: message" or "1234 message")
     * Returns { code, message } or null if no code prefix found
     */
    private static parseReplyCode(body: string): { code: string; message: string } | null {
        // Match 4-digit code at start followed by : . or space
        const match = body.match(/^(\d{4})[:.\s]\s*([\s\S]*)$/);
        if (match) {
            const code = match[1];
            const message = match[2].trim();
            if (message.length > 0) {
                return { code, message };
            }
        }
        return null;
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

            // SMS Proxy Logic
            if (SMS_PROXY_ENABLED) {
                await this.handleSmsProxy(data.From, data.To, data.Body || '', mediaUrls);
            }
        } catch (error) {
            console.error(`[TwilioSMS] Error handling incoming SMS:`, error);
        }
    }

    /**
     * Handle SMS proxy forwarding with short code routing
     * - If from external sender: forward to proxy target with short code
     * - If from proxy target: parse code prefix and route to correct sender
     */
    private async handleSmsProxy(from: string, to: string, body: string, mediaUrls: string[]): Promise<void> {
        const isFromProxyTarget = from === SMS_PROXY_TARGET_NUMBER;

        if (isFromProxyTarget) {
            // This is a reply from the proxy target - parse code and route
            const parsed = TwilioSmsService.parseReplyCode(body);

            if (!parsed) {
                console.log(`[TwilioSMS Proxy] No code prefix found in reply - cannot route`);
                try {
                    await this.sendSmsInternal(
                        SMS_PROXY_TARGET_NUMBER,
                        `[System] Reply format: <last4digits>: <message>\nExample: 1234: Yes, I can help`,
                        to
                    );
                } catch (e) {
                    console.error('[TwilioSMS Proxy] Failed to send format help:', e);
                }
                return;
            }

            const { code, message } = parsed;
            const recipient = TwilioSmsService.getSenderByCode(to, code);

            if (!recipient) {
                console.log(`[TwilioSMS Proxy] No sender found for code [${code}] on ${to}`);
                try {
                    await this.sendSmsInternal(
                        SMS_PROXY_TARGET_NUMBER,
                        `[System] No conversation with code [${code}] on ${to}`,
                        to
                    );
                } catch (e) {
                    console.error('[TwilioSMS Proxy] Failed to send invalid code notification:', e);
                }
                return;
            }

            console.log(`[TwilioSMS Proxy] Routing reply [${code}] to ${recipient} via ${to}`);

            try {
                await this.sendSmsInternal(recipient, message, to);
                console.log(`[TwilioSMS Proxy] ✓ Reply forwarded to ${recipient}`);
            } catch (error) {
                console.error(`[TwilioSMS Proxy] Failed to forward reply:`, error);
            }
        } else {
            // This is from an external sender - register with last 4 digits as code
            const code = TwilioSmsService.registerSender(to, from);
            console.log(`[TwilioSMS Proxy] Forwarding message from ${from} [${code}] to proxy target`);

            // Format: [code] sender → twilioNumber\nmessage
            const forwardedBody = `[${code}] ${from} → ${to}\n${body}`;

            try {
                await this.sendSmsInternal(SMS_PROXY_TARGET_NUMBER, forwardedBody, to);
                console.log(`[TwilioSMS Proxy] ✓ Message forwarded to proxy target with code [${code}]`);
            } catch (error) {
                console.error(`[TwilioSMS Proxy] Failed to forward message:`, error);
            }
        }
    }

    /**
     * Internal SMS send that bypasses whitelist check (for proxy forwarding)
     */
    private async sendSmsInternal(
        toNumber: string,
        body: string,
        fromNumber: string
    ): Promise<{ messageSid: string; status: string }> {
        const publicUrl = process.env.PUBLIC_URL;
        const statusCallbackUrl = publicUrl ? `${publicUrl}/sms/status` : undefined;

        const message = await this.twilioClient.messages.create({
            from: fromNumber,
            to: toNumber,
            body: body,
            ...(statusCallbackUrl && { statusCallback: statusCallbackUrl })
        });

        // Save forwarded message to MongoDB
        await this.storageService.saveSms({
            messageSid: message.sid,
            fromNumber: fromNumber,
            toNumber: toNumber,
            direction: SmsDirection.OUTBOUND,
            body: body,
            status: this.mapTwilioStatus(message.status),
            twilioStatus: message.status,
            numMedia: 0
        });

        return {
            messageSid: message.sid,
            status: message.status
        };
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
