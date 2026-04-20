import twilio from 'twilio';
import { SmsDirection, SmsStatus } from '../../types.js';
import { SmsStorageService } from '../sms/storage.service.js';
import { SmsModel } from '../../models/sms.model.js';
import { ContactSlugModel } from '../../models/contact-slug.model.js';
import { GroupConversationModel } from '../../models/group-conversation.model.js';
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

    // Group conversation slug maps: slug -> Twilio Conversation SID and reverse
    private static groupSlugToSid: Map<string, string> = new Map();
    private static sidToGroupSlug: Map<string, string> = new Map();

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

        // Load group conversation slugs
        try {
            const groups = await GroupConversationModel.find({});
            for (const g of groups) {
                TwilioSmsService.groupSlugToSid.set(g.slug.toLowerCase(), g.conversationSid);
                TwilioSmsService.sidToGroupSlug.set(g.conversationSid, g.slug.toLowerCase());
            }
            console.log(`[TwilioSMS Proxy] Loaded ${groups.length} group conversation slugs`);
        } catch (error) {
            console.error('[TwilioSMS Proxy] Error loading group slugs:', error);
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
        const hasMedia = !!(mediaUrls && mediaUrls.length > 0);
        if ((!body || body.trim().length === 0) && !hasMedia) throw new Error('SMS body cannot be empty (unless sending media)');
        if (body && body.length > 1600) throw new Error(`SMS body too long (${body.length} chars). Max 1600.`);

        try {
            const publicUrl = process.env.PUBLIC_URL;
            const statusCallbackUrl = publicUrl ? `${publicUrl}/sms/status` : undefined;

            const trimmedBody = (body || '').trim();
            const messageOptions: any = {
                from: sender,
                to: toNumber,
                ...(trimmedBody && { body: trimmedBody }),
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
                body: trimmedBody,
                status: this.mapTwilioStatus(message.status),
                twilioStatus: message.status,
                numMedia: mediaUrls ? mediaUrls.length : 0,
                mediaUrls: mediaUrls
            });

            console.log(`[TwilioSMS] Sent SMS ${message.sid} from ${sender} to ${toNumber}`);

            if (SMS_PROXY_ENABLED && !options?.skipNotification) {
                TwilioSmsService.registerSender(sender, toNumber);
                this.notifyOutboundSms(sender, toNumber, trimmedBody, mediaUrls).catch(err =>
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

    private async notifyOutboundSms(fromNumber: string, toNumber: string, body: string, mediaUrls?: string[]): Promise<void> {
        const label = TwilioSmsService.getDisplayLabel(toNumber);
        const cheatsheet = TwilioSmsService.getCheatsheet(toNumber);
        const mediaNote = mediaUrls && mediaUrls.length ? `\n[📎 ${mediaUrls.length} attachment${mediaUrls.length > 1 ? 's' : ''}]` : '';
        const notification = `📤 ${label} Sent to ${toNumber}:\n${body || '(no text)'}${mediaNote}${cheatsheet}`;

        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            if (target === toNumber) continue;
            try {
                await this.sendSms(target, notification, fromNumber, mediaUrls && mediaUrls.length ? mediaUrls : undefined, { skipNotification: true });
                console.log(`[TwilioSMS] Outbound notification sent to ${target}${mediaUrls && mediaUrls.length ? ` (+${mediaUrls.length} media)` : ''}`);
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

            // Dedup against active group Conversations: if this inbound
            // MessageSid is (or corresponds to) a message Twilio already
            // routed into a group Conversation, the /conversations/webhook
            // path owns it. Don't re-save or re-proxy.
            const isFromProxyTarget = SMS_PROXY_TARGET_NUMBERS.includes(data.From);
            if (!isFromProxyTarget) {
                const inGroup = await GroupConversationModel.findOne({
                    twilioNumber: data.To,
                    externalParticipants: data.From,
                }).lean();
                if (inGroup) {
                    console.log(`[TwilioSMS] ${data.MessageSid} from ${data.From} is a group participant in ${inGroup.conversationSid} — Conversations webhook owns this, skipping 1-on-1 path`);
                    return;
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

            if (isFromProxyTarget) {
                await this.handleProxyReply(data.From, data.To, data.Body || '');
            } else {
                await this.handleExternalIncoming(data.From, data.To, data.Body || '', mediaUrls);
            }
        } catch (error) {
            console.error(`[TwilioSMS] Error handling incoming SMS:`, error);
        }
    }

    /**
     * External sender texted a Twilio number.
     * Register their code and notify all proxy targets.
     */
    private async handleExternalIncoming(from: string, to: string, body: string, mediaUrls: string[] = []): Promise<void> {
        const code = TwilioSmsService.registerSender(to, from);
        const label = TwilioSmsService.getDisplayLabel(from);

        const cheatsheet = TwilioSmsService.getCheatsheet(from);
        const mediaNote = mediaUrls.length > 0 ? `\n[📎 ${mediaUrls.length} attachment${mediaUrls.length > 1 ? 's' : ''}]` : '';
        const notification = `📥 ${label} ${from} → ${to}:\n${body || '(no text)'}${mediaNote}${cheatsheet}`;

        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            try {
                await this.sendSms(target, notification, to, mediaUrls.length > 0 ? mediaUrls : undefined, { skipNotification: true });
                console.log(`[TwilioSMS Proxy] Incoming notification sent to ${target} ${label}${mediaUrls.length ? ` (+${mediaUrls.length} media)` : ''}`);
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

        // Group slug takes priority over contact slug (names are in the
        // same namespace; uniqueness is enforced when slugs are allocated)
        if (parsed.type === 'slug_reply') {
            const groupSid = TwilioSmsService.getGroupSidBySlug(parsed.slug);
            if (groupSid) {
                await this.handleGroupReply(from, twilioNumber, groupSid, parsed.slug, parsed.message);
                return;
            }
        }

        // Resolve the recipient (1-on-1 contact path)
        let recipient: string | undefined;
        let resolvedVia: string;

        if (parsed.type === 'slug_reply') {
            recipient = TwilioSmsService.slugToNumber.get(parsed.slug);
            resolvedVia = `{${parsed.slug}}`;
            if (!recipient) {
                await this.sendSms(from, `No contact or group found for slug {${parsed.slug}}`, twilioNumber, undefined, { skipNotification: true }).catch(() => {});
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

    // --- Group conversation slug management ---

    /**
     * Allocate a slug for a new group Conversation. Prefers the contact slug
     * of the first external participant (e.g. "murilo-grp"); falls back to
     * last-4 of first external ("9797-grp") and finally "g-<sidSuffix>".
     */
    private static generateGroupSlug(conversationSid: string, externalAddresses: string[]): string {
        const attempts: string[] = [];

        for (const addr of externalAddresses) {
            const contactSlug = this.numberToSlug.get(addr);
            if (contactSlug) attempts.push(`${contactSlug}-grp`);
            attempts.push(`${this.getCodeFromNumber(addr)}-grp`);
        }
        attempts.push(`g-${conversationSid.slice(-6)}`);

        for (let base of attempts) {
            base = base.toLowerCase().replace(/[^a-z0-9_-]/g, '');
            if (!base) continue;
            if (!this.groupSlugToSid.has(base) && !this.slugToNumber.has(base)) return base;
            for (let n = 2; n < 20; n++) {
                const candidate = `${base}-${n}`;
                if (!this.groupSlugToSid.has(candidate) && !this.slugToNumber.has(candidate)) return candidate;
            }
        }
        return `g-${conversationSid.slice(-6)}`;
    }

    public static getGroupSlug(conversationSid: string): string | undefined {
        return this.sidToGroupSlug.get(conversationSid);
    }

    public static getGroupSidBySlug(slug: string): string | undefined {
        return this.groupSlugToSid.get(slug.toLowerCase());
    }

    /**
     * Resolve a group reference that may be either a CH-SID or a slug
     * (with or without braces: "{0101-grp}", "0101-grp", or "CH…").
     */
    public static resolveGroupSid(ref: string): string | undefined {
        const trimmed = ref.trim().replace(/^\{|\}$/g, '');
        if (trimmed.startsWith('CH') && trimmed.length === 34) {
            return this.sidToGroupSlug.has(trimmed) ? trimmed : undefined;
        }
        return this.groupSlugToSid.get(trimmed.toLowerCase());
    }

    public getConversationsService(): TwilioConversationsService {
        return this.conversationsService;
    }

    /**
     * Persist a new group Conversation and allocate a slug. Idempotent —
     * returns the existing record if already registered.
     */
    public async registerGroup(
        conversationSid: string,
        twilioNumber: string,
        externalAddresses: string[],
        friendlyName?: string
    ): Promise<{ slug: string; isNew: boolean }> {
        const existing = await GroupConversationModel.findOne({ conversationSid });
        if (existing) {
            TwilioSmsService.groupSlugToSid.set(existing.slug.toLowerCase(), conversationSid);
            TwilioSmsService.sidToGroupSlug.set(conversationSid, existing.slug.toLowerCase());
            const merged = Array.from(new Set([...existing.externalParticipants, ...externalAddresses]));
            if (merged.length !== existing.externalParticipants.length) {
                existing.externalParticipants = merged;
                await existing.save();
            }
            return { slug: existing.slug, isNew: false };
        }

        const slug = TwilioSmsService.generateGroupSlug(conversationSid, externalAddresses);
        await GroupConversationModel.create({
            conversationSid,
            slug,
            twilioNumber,
            externalParticipants: externalAddresses,
            friendlyName,
            lastActivityAt: new Date(),
        });
        TwilioSmsService.groupSlugToSid.set(slug, conversationSid);
        TwilioSmsService.sidToGroupSlug.set(conversationSid, slug);
        for (const addr of externalAddresses) {
            TwilioSmsService.registerSender(twilioNumber, addr, false);
        }
        console.log(`[TwilioSMS Proxy] Registered group ${conversationSid} as {${slug}} with ${externalAddresses.length} externals`);
        return { slug, isNew: true };
    }

    /**
     * Forget a group Conversation: drop the DB row and free the slug.
     * Called from onConversationRemoved.
     */
    public async unregisterGroup(conversationSid: string): Promise<void> {
        const slug = TwilioSmsService.sidToGroupSlug.get(conversationSid);
        if (slug) {
            TwilioSmsService.groupSlugToSid.delete(slug);
            TwilioSmsService.sidToGroupSlug.delete(conversationSid);
        }
        await GroupConversationModel.deleteOne({ conversationSid }).catch(err =>
            console.error(`[TwilioSMS Proxy] Failed to delete group ${conversationSid}:`, err)
        );
        console.log(`[TwilioSMS Proxy] Unregistered group ${conversationSid}${slug ? ` ({${slug}})` : ''}`);
    }

    /**
     * Replace the stored external participant list for a group. Called from
     * onParticipantAdded/Removed so slug metadata stays in sync with Twilio.
     */
    public async updateGroupExternals(conversationSid: string, externals: string[]): Promise<void> {
        await GroupConversationModel.updateOne(
            { conversationSid },
            { $set: { externalParticipants: externals, lastActivityAt: new Date() } }
        ).catch(err => console.error(`[TwilioSMS Proxy] updateGroupExternals failed:`, err));
    }

    /**
     * Full inbound-pipeline for a Conversation message: idempotent persist
     * into SmsModel + register group if unknown + fan out proxy notifications.
     * Safe to call from both the live webhook and the periodic reconciler.
     *
     * Returns `true` if the message was processed this call, `false` if it
     * was already in SmsModel (deduped).
     */
    public async processInboundGroupMessage(
        conversationSid: string,
        messageSid: string | undefined,
        author: string,
        body: string,
        mediaUrls: string[],
        messageDate?: Date,
        options?: { skipNotify?: boolean }
    ): Promise<boolean> {
        const systemIdentity = this.conversationsService.getSystemIdentity();
        if (!author || author === systemIdentity) return false;
        if (!body && mediaUrls.length === 0) return false;

        // Idempotency: if we've already stored this messageSid, this is a
        // retry (webhook duplicate or reconciler replay) — skip.
        if (messageSid) {
            const existing = await SmsModel.findOne({ messageSid }).lean();
            if (existing) return false;
        }

        // Ensure the group is registered (covers webhook-missed onConversationAdded)
        if (!TwilioSmsService.getGroupSlug(conversationSid)) {
            const twilioNumber = process.env.TWILIO_NUMBER!;
            const externals = await this.conversationsService
                .getExternalAddresses(conversationSid)
                .catch(() => [] as string[]);
            await this.registerGroup(conversationSid, twilioNumber, externals);
        }

        // Persist to SmsModel tagged with the Conversation SID for audit
        if (messageSid) {
            try {
                await this.storageService.saveSms({
                    messageSid,
                    fromNumber: author,
                    toNumber: process.env.TWILIO_NUMBER!,
                    direction: SmsDirection.INBOUND,
                    body,
                    status: SmsStatus.RECEIVED,
                    twilioStatus: 'received',
                    numMedia: mediaUrls.length,
                    mediaUrls,
                    conversationSid,
                });
            } catch (err: any) {
                // Duplicate-key (E11000) means we lost the idempotency race
                // with another caller; treat as already processed.
                if (err.code === 11000) return false;
                throw err;
            }
        }

        if (!options?.skipNotify) {
            await this.notifyGroupMessage(conversationSid, author, body, mediaUrls);
        }
        return true;
    }

    /**
     * Fan a group-Conversation inbound message out to SMS_PROXY_TARGET_NUMBERS
     * as 1-on-1 SMS notifications, with enough context for Ben/Laura to reply.
     */
    public async notifyGroupMessage(
        conversationSid: string,
        authorAddress: string,
        body: string,
        mediaUrls?: string[]
    ): Promise<void> {
        if (!SMS_PROXY_ENABLED) return;
        const slug = TwilioSmsService.getGroupSlug(conversationSid);
        if (!slug) {
            console.warn(`[TwilioSMS Proxy] No slug for group ${conversationSid}, skipping fan-out`);
            return;
        }

        // Skip:
        //   - the author (already saw it in their own sent box)
        //   - any proxy target who is ALSO an external participant in the
        //     group — they received the message natively via group MMS, so a
        //     1-on-1 proxy notification would be duplicative noise.
        const skipTargets = new Set<string>();
        if (SMS_PROXY_TARGET_NUMBERS.includes(authorAddress)) skipTargets.add(authorAddress);

        const group = await GroupConversationModel.findOne({ conversationSid }).lean();
        const externalsInGroup = new Set(group?.externalParticipants ?? []);
        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            if (externalsInGroup.has(target)) skipTargets.add(target);
        }

        const authorLabel = TwilioSmsService.getDisplayLabel(authorAddress);
        const mediaNote = mediaUrls && mediaUrls.length ? `\n[📎 ${mediaUrls.length}]` : '';
        const notification = `📥 {${slug}} ${authorLabel} ${authorAddress} → group:\n${body || '(no text)'}${mediaNote}\n---\nReply: {${slug}}: msg`;

        const twilioNumber = process.env.TWILIO_NUMBER!;
        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            if (skipTargets.has(target)) continue;
            try {
                await this.sendSms(target, notification, twilioNumber, mediaUrls && mediaUrls.length ? mediaUrls : undefined, { skipNotification: true });
            } catch (err) {
                console.error(`[TwilioSMS Proxy] Group fan-out to ${target} failed:`, err);
            }
        }

        // Touch lastActivityAt
        GroupConversationModel.updateOne(
            { conversationSid },
            { $set: { lastActivityAt: new Date() } }
        ).catch(err => console.error(`[TwilioSMS Proxy] Touch group failed:`, err));
    }

    /**
     * Handle a proxy-target reply that resolved to a group slug: post the
     * message to the Conversation so Twilio fans out to all externals.
     */
    private async handleGroupReply(
        from: string,
        twilioNumber: string,
        conversationSid: string,
        slug: string,
        message: string
    ): Promise<void> {
        try {
            await this.conversationsService.postMessage(conversationSid, message);
            console.log(`[TwilioSMS Proxy] Routed {${slug}} reply from ${from} → ${conversationSid}`);
        } catch (err: any) {
            console.error(`[TwilioSMS Proxy] Failed to post into group {${slug}}:`, err);
            await this.sendSms(from, `Failed to post into {${slug}}: ${err.message}`, twilioNumber, undefined, { skipNotification: true }).catch(() => {});
            return;
        }

        // CC the OTHER proxy targets with what got sent (so both Ben and
        // Laura see the reply, mirroring the 1-on-1 CC pattern).
        const senderLabel = TwilioSmsService.getDisplayLabel(from);
        const ccNote = `📤 {${slug}} ${senderLabel} → group:\n${message}\n---\nReply: {${slug}}: msg`;
        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            if (target === from) continue;
            await this.sendSms(target, ccNote, twilioNumber, undefined, { skipNotification: true }).catch(err =>
                console.error(`[TwilioSMS Proxy] Group CC to ${target} failed:`, err)
            );
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
