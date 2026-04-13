import twilio from 'twilio';
import { SmsDirection, SmsStatus } from '../../types.js';
import { SmsStorageService } from '../sms/storage.service.js';
import { SmsModel } from '../../models/sms.model.js';
import { ContactSlugModel } from '../../models/contact-slug.model.js';
import { SMS_ENABLED_NUMBERS, SMS_PROXY_ENABLED, SMS_PROXY_TARGET_NUMBERS } from '../../config/constants.js';
import { TwilioConversationsService } from './conversations.service.js';
import { MongoDBService } from '../database/mongodb.service.js';

/**
 * SMS Proxy system:
 * 1. Outbound: When the system sends an SMS, proxy targets get notified
 * 2. Inbound: External senders trigger notification to proxy targets with [last4] code
 * 3. Reply routing: Proxy targets reply with "1234: msg" or "{slug}: msg" to route outbound
 * 4. Slug labeling: Proxy targets text "label 1234 elio" to assign a slug to a number
 */
export class TwilioSmsService {
    private readonly twilioClient: twilio.Twilio;
    private readonly storageService: SmsStorageService;
    private readonly conversationsService: TwilioConversationsService;

    // Maps: twilioNumber -> (last4code -> fullSenderNumber)
    private static codeToSender: Map<string, Map<string, string>> = new Map();

    // Maps: slug -> fullPhoneNumber and phoneNumber -> slug (bidirectional)
    private static slugToNumber: Map<string, string> = new Map();
    private static numberToSlug: Map<string, string> = new Map();

    constructor(twilioClient: twilio.Twilio, conversationsService: TwilioConversationsService) {
        this.twilioClient = twilioClient;
        this.storageService = new SmsStorageService();
        this.conversationsService = conversationsService;
    }

    /**
     * Load code-to-sender mappings from DB (recent inbound SMS) and slug mappings.
     * Call this on server startup after MongoDB is connected.
     */
    public async loadProxyState(): Promise<void> {
        const mongo = MongoDBService.getInstance();
        if (!mongo.getIsConnected()) {
            console.log('[TwilioSMS Proxy] MongoDB not connected, skipping state load');
            return;
        }

        // Load codes from recent inbound messages (last 90 days)
        try {
            const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
            const inboundMessages = await SmsModel.aggregate([
                {
                    $match: {
                        direction: 'inbound',
                        createdAt: { $gte: cutoff },
                        // Exclude messages from proxy targets (those are replies)
                        fromNumber: { $nin: SMS_PROXY_TARGET_NUMBERS }
                    }
                },
                {
                    // Get the most recent message per sender+twilio pair
                    $group: {
                        _id: { from: '$fromNumber', to: '$toNumber' },
                        lastSeen: { $max: '$createdAt' }
                    }
                }
            ]);

            let codeCount = 0;
            for (const msg of inboundMessages) {
                const from = msg._id.from;
                const to = msg._id.to;
                TwilioSmsService.registerSender(to, from, false); // silent registration
                codeCount++;
            }
            console.log(`[TwilioSMS Proxy] Loaded ${codeCount} sender codes from inbound DB`);
        } catch (error) {
            console.error('[TwilioSMS Proxy] Error loading sender codes:', error);
        }

        // Also register outbound-only recipients so they can be replied to by code
        // and labeled even if they've never texted back. Skip proxy targets
        // (notifications we sent to ourselves).
        try {
            const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
            const outboundRecipients = await SmsModel.aggregate([
                {
                    $match: {
                        direction: 'outbound',
                        createdAt: { $gte: cutoff },
                        toNumber: { $nin: SMS_PROXY_TARGET_NUMBERS }
                    }
                },
                {
                    $group: {
                        _id: { from: '$fromNumber', to: '$toNumber' },
                        lastSeen: { $max: '$createdAt' }
                    }
                }
            ]);

            let outCount = 0;
            for (const msg of outboundRecipients) {
                const from = msg._id.from; // our Twilio number
                const to = msg._id.to;     // the external recipient
                TwilioSmsService.registerSender(from, to, false);
                outCount++;
            }
            console.log(`[TwilioSMS Proxy] Loaded ${outCount} recipient codes from outbound DB`);
        } catch (error) {
            console.error('[TwilioSMS Proxy] Error loading outbound recipients:', error);
        }

        // Load slugs
        try {
            const slugs = await ContactSlugModel.find({});
            for (const s of slugs) {
                TwilioSmsService.slugToNumber.set(s.slug.toLowerCase(), s.phoneNumber);
                TwilioSmsService.numberToSlug.set(s.phoneNumber, s.slug.toLowerCase());
            }
            console.log(`[TwilioSMS Proxy] Loaded ${slugs.length} contact slugs`);
        } catch (error) {
            console.error('[TwilioSMS Proxy] Error loading slugs:', error);
        }
    }

    // --- Helpers ---

    private isValidE164(phoneNumber: string): boolean {
        return /^\+[1-9]\d{1,14}$/.test(phoneNumber);
    }

    private async withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                const isTransient = error.code === 'EAI_AGAIN' || error.code === 'ENOTFOUND' ||
                    error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' ||
                    error.message?.includes('EAI_AGAIN') || error.message?.includes('getaddrinfo');
                if (isTransient && attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    console.warn(`[TwilioSMS] ${label} attempt ${attempt}/${maxRetries} failed (${error.code || 'network error'}), retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    throw error;
                }
            }
        }
        throw new Error('Unreachable');
    }

    // --- Code routing ---

    private static getCodeFromNumber(phoneNumber: string): string {
        return phoneNumber.replace(/\D/g, '').slice(-4);
    }

    private static registerSender(twilioNumber: string, senderNumber: string, log = true): string {
        if (!this.codeToSender.has(twilioNumber)) {
            this.codeToSender.set(twilioNumber, new Map());
        }
        const code = this.getCodeFromNumber(senderNumber);
        this.codeToSender.get(twilioNumber)!.set(code, senderNumber);
        if (log) {
            console.log(`[TwilioSMS Proxy] Registered [${code}] -> ${senderNumber} on ${twilioNumber}`);
        }
        return code;
    }

    private static getSenderByCode(twilioNumber: string, code: string): string | undefined {
        return this.codeToSender.get(twilioNumber)?.get(code);
    }

    /**
     * Get display label for a phone number: "[1234/slug]" or "[1234]"
     */
    private static getDisplayLabel(phoneNumber: string): string {
        const code = this.getCodeFromNumber(phoneNumber);
        const slug = this.numberToSlug.get(phoneNumber);
        return slug ? `[${code}/{${slug}}]` : `[${code}]`;
    }

    /**
     * Get reply cheatsheet for a phone number's code/slug
     */
    private static getCheatsheet(phoneNumber: string): string {
        const code = this.getCodeFromNumber(phoneNumber);
        const slug = this.numberToSlug.get(phoneNumber);
        const lines = [`\n---`, `Reply: ${code}: msg`];
        if (slug) lines.push(`Or: {${slug}}: msg`);
        lines.push(`Label: label ${code} name`);
        return lines.join('\n');
    }

    // --- Slug management ---

    private static async setSlug(phoneNumber: string, slug: string): Promise<void> {
        const normalized = slug.toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (!normalized) throw new Error('Invalid slug');

        // Remove old slug for this number if any
        const oldSlug = this.numberToSlug.get(phoneNumber);
        if (oldSlug) this.slugToNumber.delete(oldSlug);

        // Remove old number for this slug if reassigning
        const oldNumber = this.slugToNumber.get(normalized);
        if (oldNumber) this.numberToSlug.delete(oldNumber);

        this.slugToNumber.set(normalized, phoneNumber);
        this.numberToSlug.set(phoneNumber, normalized);

        // Persist to DB
        await ContactSlugModel.findOneAndUpdate(
            { phoneNumber },
            { phoneNumber, slug: normalized },
            { upsert: true }
        );
        console.log(`[TwilioSMS Proxy] Set slug {${normalized}} -> ${phoneNumber}`);
    }

    // --- Reply parsing ---

    /**
     * Parse reply formats:
     * - "1234: message" or "1234 message" (4-digit code)
     * - "{slug}: message" or "{slug} message" (slug in braces)
     * - "label 1234 slug" (label command)
     */
    private static parseIncoming(body: string):
        | { type: 'reply'; code: string; message: string }
        | { type: 'slug_reply'; slug: string; message: string }
        | { type: 'label'; code: string; slug: string }
        | null {
        const trimmed = body.trim();

        // Label command: "label 1234 elio" or "name 1234 elio"
        const labelMatch = trimmed.match(/^(?:label|name)\s+(\d{4})\s+(\S+)$/i);
        if (labelMatch) {
            return { type: 'label', code: labelMatch[1], slug: labelMatch[2] };
        }

        // Slug reply: "{elio}: message" or "{elio} message"
        const slugMatch = trimmed.match(/^\{([^}]+)\}[:.\s]\s*([\s\S]*)$/);
        if (slugMatch && slugMatch[2].trim().length > 0) {
            return { type: 'slug_reply', slug: slugMatch[1].toLowerCase(), message: slugMatch[2].trim() };
        }

        // Code reply: "1234: message" or "1234 message"
        const codeMatch = trimmed.match(/^(\d{4})[:.\s]\s*([\s\S]*)$/);
        if (codeMatch && codeMatch[2].trim().length > 0) {
            return { type: 'reply', code: codeMatch[1], message: codeMatch[2].trim() };
        }

        return null;
    }

    // --- Core send ---

    public async sendSms(
        toNumber: string,
        body: string,
        fromNumber?: string,
        mediaUrls?: string[],
        options?: { skipNotification?: boolean }
    ): Promise<{ messageSid: string; status: string }> {
        if (!this.isValidE164(toNumber)) {
            throw new Error(`Invalid recipient phone number format. Must be E.164 format (e.g., +11234567890). Got: ${toNumber}`);
        }
        const sender = fromNumber || process.env.TWILIO_NUMBER;
        if (!sender) throw new Error('No sender phone number provided and TWILIO_NUMBER not set');
        if (!this.isValidE164(sender)) {
            throw new Error(`Invalid sender phone number format. Must be E.164 format (e.g., +11234567890). Got: ${sender}`);
        }
        if (!SMS_ENABLED_NUMBERS.includes(sender)) {
            console.log(`[TwilioSMS] SMS rejected - sender not in whitelist: ${sender}`);
            throw new Error(`SMS sending is not enabled for number ${sender}. Only whitelisted numbers can send SMS.`);
        }
        if (!body || body.trim().length === 0) throw new Error('SMS body cannot be empty');
        if (body.length > 1600) throw new Error(`SMS body too long (${body.length} chars). Max 1600.`);

        try {
            const publicUrl = process.env.PUBLIC_URL;
            const statusCallbackUrl = publicUrl ? `${publicUrl}/sms/status` : undefined;

            const messageOptions: any = {
                from: sender,
                to: toNumber,
                body: body.trim(),
                ...(statusCallbackUrl && { statusCallback: statusCallbackUrl })
            };
            if (mediaUrls && mediaUrls.length > 0) {
                messageOptions.mediaUrl = mediaUrls.slice(0, 10);
            }

            const message = await this.withRetry(
                () => this.twilioClient.messages.create(messageOptions),
                `SMS to ${toNumber}`
            );

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

            if (SMS_PROXY_ENABLED && !options?.skipNotification) {
                // Register the recipient under the sender's Twilio number so that
                // proxy targets can reply by code (e.g. "1055: hi") and label them
                // even before the contact has texted us back.
                TwilioSmsService.registerSender(sender, toNumber);
                this.notifyOutboundSms(sender, toNumber, body.trim()).catch(err =>
                    console.error(`[TwilioSMS] Error sending outbound notification:`, err)
                );
            }

            return { messageSid: message.sid, status: message.status };
        } catch (error: any) {
            console.error(`[TwilioSMS] Error sending SMS:`, error);
            throw new Error(`Failed to send SMS: ${error.message || 'Unknown error'}`);
        }
    }

    // --- Outbound notification ---

    private async notifyOutboundSms(fromNumber: string, toNumber: string, body: string): Promise<void> {
        const label = TwilioSmsService.getDisplayLabel(toNumber);
        const cheatsheet = TwilioSmsService.getCheatsheet(toNumber);
        const notification = `📤 ${label} Sent to ${toNumber}:\n${body}${cheatsheet}`;

        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            // Don't notify the recipient — they already got the actual message
            if (target === toNumber) continue;
            try {
                await this.sendSms(target, notification, fromNumber, undefined, { skipNotification: true });
                console.log(`[TwilioSMS] Outbound notification sent to ${target}`);
            } catch (err) {
                console.error(`[TwilioSMS] Failed to notify ${target} about outbound SMS:`, err);
            }
        }
    }

    // --- Incoming SMS handling ---

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
            if (numMedia > 0) {
                for (let i = 0; i < numMedia && i < 10; i++) {
                    const mediaUrl = (data as any)[`MediaUrl${i}`];
                    if (mediaUrl) mediaUrls.push(mediaUrl);
                }
            }

            await this.storageService.saveSms({
                messageSid: data.MessageSid,
                fromNumber: data.From,
                toNumber: data.To,
                direction: SmsDirection.INBOUND,
                body: data.Body || '',
                status: SmsStatus.RECEIVED,
                twilioStatus: 'received',
                numMedia,
                mediaUrls
            });

            console.log(`[TwilioSMS] Received SMS ${data.MessageSid} from ${data.From} to ${data.To}`);

            if (!SMS_PROXY_ENABLED) return;

            const isFromProxyTarget = SMS_PROXY_TARGET_NUMBERS.includes(data.From);

            if (isFromProxyTarget) {
                await this.handleProxyReply(data.From, data.To, data.Body || '');
            } else {
                await this.handleExternalIncoming(data.From, data.To, data.Body || '');
            }
        } catch (error) {
            console.error(`[TwilioSMS] Error handling incoming SMS:`, error);
        }
    }

    /**
     * External sender texted a Twilio number.
     * Register their code and notify all proxy targets.
     */
    private async handleExternalIncoming(from: string, to: string, body: string): Promise<void> {
        const code = TwilioSmsService.registerSender(to, from);
        const label = TwilioSmsService.getDisplayLabel(from);

        const cheatsheet = TwilioSmsService.getCheatsheet(from);
        const notification = `📥 ${label} ${from} → ${to}:\n${body}${cheatsheet}`;

        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            try {
                await this.sendSms(target, notification, to, undefined, { skipNotification: true });
                console.log(`[TwilioSMS Proxy] Incoming notification sent to ${target} ${label}`);
            } catch (err) {
                console.error(`[TwilioSMS Proxy] Failed to notify ${target}:`, err);
            }
        }
    }

    /**
     * A proxy target (Ben/Laura) texted a Twilio number.
     * Parse for: code reply, slug reply, or label command.
     */
    private async handleProxyReply(from: string, twilioNumber: string, body: string): Promise<void> {
        const parsed = TwilioSmsService.parseIncoming(body);

        if (!parsed) {
            console.log(`[TwilioSMS Proxy] Reply from ${from} has no recognized format`);
            try {
                await this.sendSms(
                    from,
                    `Reply formats:\n• 1234: your message\n• {slug}: your message\n• label 1234 slug`,
                    twilioNumber, undefined, { skipNotification: true }
                );
            } catch (e) {
                console.error('[TwilioSMS Proxy] Failed to send format help:', e);
            }
            return;
        }

        if (parsed.type === 'label') {
            await this.handleLabelCommand(from, twilioNumber, parsed.code, parsed.slug);
            return;
        }

        // Resolve the recipient
        let recipient: string | undefined;
        let resolvedVia: string;

        if (parsed.type === 'slug_reply') {
            recipient = TwilioSmsService.slugToNumber.get(parsed.slug);
            resolvedVia = `{${parsed.slug}}`;
            if (!recipient) {
                await this.sendSms(from, `No contact found for slug {${parsed.slug}}`, twilioNumber, undefined, { skipNotification: true }).catch(() => {});
                return;
            }
        } else {
            recipient = TwilioSmsService.getSenderByCode(twilioNumber, parsed.code);
            resolvedVia = `[${parsed.code}]`;
            if (!recipient) {
                await this.sendSms(from, `No conversation for code [${parsed.code}] on ${twilioNumber}`, twilioNumber, undefined, { skipNotification: true }).catch(() => {});
                return;
            }
        }

        // Send the reply to the external number
        console.log(`[TwilioSMS Proxy] Routing reply ${resolvedVia} from ${from} → ${recipient} via ${twilioNumber}`);
        try {
            await this.sendSms(recipient, parsed.message, twilioNumber, undefined, { skipNotification: true });
            console.log(`[TwilioSMS Proxy] Reply sent to ${recipient}`);
        } catch (err) {
            console.error(`[TwilioSMS Proxy] Failed to send reply to ${recipient}:`, err);
            return;
        }

        // CC other proxy targets
        const senderLast4 = TwilioSmsService.getCodeFromNumber(from);
        const recipientLabel = TwilioSmsService.getDisplayLabel(recipient);
        const cheatsheet = TwilioSmsService.getCheatsheet(recipient);
        const ccNotification = `📤 ${recipientLabel} Reply from [${senderLast4}] → ${recipient}:\n${parsed.message}${cheatsheet}`;
        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            if (target === from) continue;
            try {
                await this.sendSms(target, ccNotification, twilioNumber, undefined, { skipNotification: true });
            } catch (err) {
                console.error(`[TwilioSMS Proxy] Failed to CC ${target}:`, err);
            }
        }
    }

    /**
     * Handle "label 1234 elio" command from a proxy target.
     */
    private async handleLabelCommand(from: string, twilioNumber: string, code: string, slug: string): Promise<void> {
        // Find the number for this code (search all Twilio numbers)
        let phoneNumber: string | undefined;
        for (const [, codeMap] of TwilioSmsService.codeToSender) {
            const found = codeMap.get(code);
            if (found) {
                phoneNumber = found;
                break;
            }
        }

        if (!phoneNumber) {
            await this.sendSms(from, `No contact found for code [${code}]`, twilioNumber, undefined, { skipNotification: true }).catch(() => {});
            return;
        }

        try {
            await TwilioSmsService.setSlug(phoneNumber, slug);
            const label = TwilioSmsService.getDisplayLabel(phoneNumber);
            await this.sendSms(from, `Labeled ${phoneNumber} as {${slug.toLowerCase()}} ${label}`, twilioNumber, undefined, { skipNotification: true });

            // Notify other proxy targets
            for (const target of SMS_PROXY_TARGET_NUMBERS) {
                if (target === from) continue;
                await this.sendSms(target, `${phoneNumber} labeled as {${slug.toLowerCase()}} ${label}`, twilioNumber, undefined, { skipNotification: true }).catch(() => {});
            }
        } catch (err: any) {
            await this.sendSms(from, `Failed to set label: ${err.message}`, twilioNumber, undefined, { skipNotification: true }).catch(() => {});
        }
    }

    // --- Status callback ---

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

    private mapTwilioStatus(twilioStatus: string): SmsStatus {
        if (!twilioStatus) return SmsStatus.QUEUED;
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
}
