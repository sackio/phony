import twilio from 'twilio';
import { SmsDirection, SmsStatus } from '../../types.js';
import { SmsStorageService } from '../sms/storage.service.js';
import { SmsModel } from '../../models/sms.model.js';
import { ContactSlugModel } from '../../models/contact-slug.model.js';
import { GroupConversationModel } from '../../models/group-conversation.model.js';
import { SMS_ENABLED_NUMBERS, SMS_PROXY_ENABLED, SMS_PROXY_TARGET_NUMBERS } from '../../config/constants.js';
import { TwilioConversationsService } from './conversations.service.js';
import { MongoDBService } from '../database/mongodb.service.js';
import { WebhookDispatcher } from '../webhook-dispatcher.service.js';

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
    private readonly webhookDispatcher: WebhookDispatcher = new WebhookDispatcher();

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

            // Fire sms.outgoing webhook event. `initiator` distinguishes
            // user-facing messages ("mcp") from proxy notifications / system
            // replies ("proxy") so downstream agents can filter the noise.
            this.webhookDispatcher.dispatch('sms.outgoing', {
                message_sid: message.sid,
                conversation_sid: null,
                from: sender,
                to: toNumber,
                body: trimmedBody,
                media_urls: mediaUrls ?? [],
                direction: 'outbound',
                initiator: options?.skipNotification ? 'proxy' : 'mcp',
                twilio_status: message.status,
            }).catch(e => console.error('[TwilioSMS] sms.outgoing dispatch error:', e));

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
        /** When the message was actually sent (reconciler replays). Defaults to now. */
        SentAt?: Date;
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

            // Dedup against active group Conversations: when the sender
            // is a current external participant in a group on this Twilio
            // number, the /conversations/webhook already handled the real
            // message. The 1-on-1 inbound Twilio ALSO delivers is a
            // duplicate of the group content.
            //
            // Exception: if the sender is one of our proxy targets
            // (Ben/Laura) AND the message parses as a reply command
            // ({slug}: msg | 1234: msg | label N slug), we still process
            // it — that's their channel for posting into groups or
            // routing to individual contacts. Only true duplicate group
            // content gets skipped.
            const isFromProxyTarget = SMS_PROXY_TARGET_NUMBERS.includes(data.From);
            const parsedReply = isFromProxyTarget ? TwilioSmsService.parseIncoming(data.Body || '') : null;
            const inGroup = await GroupConversationModel.findOne({
                twilioNumber: data.To,
                externalParticipants: data.From,
            }).lean();
            if (inGroup && !parsedReply) {
                console.log(`[TwilioSMS] ${data.MessageSid} from ${data.From} is a group participant in ${inGroup.conversationSid} and doesn't parse as a reply command — Conversations webhook owns this, skipping 1-on-1 path`);
                return;
            }

            // Dedup against the Conversations-side copy: with autocreate, the
            // same human message surfaces twice — live via /conversations/webhook
            // (IM… sid, persisted with a CH… conversationId) and again via the
            // SMS reconciler replaying the Programmable Messaging record
            // (SM/MM… sid). Same content, different sids, so match on
            // sender+body near the message's send time. (Media-only messages
            // have no body to match on; let those through.)
            if (data.Body) {
                const sentAt = data.SentAt ?? new Date();
                const conversationCopy = await SmsModel.findOne({
                    fromNumber: data.From,
                    body: data.Body,
                    direction: SmsDirection.INBOUND,
                    conversationId: { $regex: /^CH/ },
                    createdAt: {
                        $gte: new Date(sentAt.getTime() - 10 * 60 * 1000),
                        $lte: new Date(sentAt.getTime() + 10 * 60 * 1000),
                    },
                }).lean();
                if (conversationCopy) {
                    console.log(`[TwilioSMS] ${data.MessageSid} from ${data.From} duplicates Conversations message ${(conversationCopy as any).messageSid} — skipping 1-on-1 path`);
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

            // Fire-and-forget outbound webhook dispatch for any user-configured
            // routes that match this message (e.g. forward to ATC, home-assistant,
            // n8n, etc.). Errors are logged inside the dispatcher; never bubble up
            // into the Twilio handler since that would cause Twilio to retry.
            this.webhookDispatcher.dispatch('sms.incoming', {
                message_sid: data.MessageSid,
                conversation_sid: null,                          // 1-on-1; group MMS dispatches from processInboundGroupMessage
                conversation_label: null,
                from: data.From,
                from_label: TwilioSmsService.numberToSlug.get(data.From) ?? null,
                to: data.To,
                body: data.Body || '',
                media_urls: mediaUrls,
                num_segments: parseInt((data as any).NumSegments) || 1,
            }, {
                reply: {
                    kind: '1on1',
                    tool: 'phony_send_sms',
                    args: { to: data.From, from: data.To },
                    description: `To reply, call phony_send_sms with to="${data.From}" body="<your reply>". The message will appear as a 1-on-1 SMS back to the sender.`,
                },
            }).catch((e) => console.error('[TwilioSMS] webhook dispatch error:', e));

            if (!SMS_PROXY_ENABLED) return;

            if (isFromProxyTarget) {
                await this.handleProxyReply(data.From, data.To, data.Body || '', { messageSid: data.MessageSid, mediaUrls });
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
     *
     * If body doesn't match any known reply format, fires `sms.needs_routing`
     * so the phony Claude session (subscribed via ATC) can pick a target
     * agent and relay the message. Only falls back to the "Reply formats:"
     * auto-help SMS if no live subscriber is handling the event.
     */
    private async handleProxyReply(
        from: string,
        twilioNumber: string,
        body: string,
        opts?: { messageSid?: string; mediaUrls?: string[] }
    ): Promise<void> {
        const parsed = TwilioSmsService.parseIncoming(body);

        if (!parsed) {
            console.log(`[TwilioSMS Proxy] Reply from ${from} has no recognized format — checking for smart-router subscriber`);
            const mediaUrls = opts?.mediaUrls ?? [];
            const eventPayload = {
                message_sid: opts?.messageSid ?? '',
                from,
                to: twilioNumber,
                from_proxy: from,
                twilio_number: twilioNumber,
                body,
                media_urls: mediaUrls,
                num_media: mediaUrls.length,
                received_at: new Date().toISOString(),
            };
            let hasRouter = false;
            try {
                hasRouter = await this.webhookDispatcher.hasSubscriber('sms.needs_routing', eventPayload);
            } catch (e) {
                console.error('[TwilioSMS Proxy] hasSubscriber check failed:', e);
            }
            if (hasRouter) {
                console.log(`[TwilioSMS Proxy] Dispatching sms.needs_routing for ${from} → smart router`);
                this.webhookDispatcher.dispatch('sms.needs_routing', eventPayload, {
                    ...(opts?.messageSid ? { eventId: `phony-needs-routing-${opts.messageSid}` } : {}),
                }).catch(e => console.error('[TwilioSMS Proxy] sms.needs_routing dispatch error:', e));
                return;
            }
            // No live router — fall back to the original format-help auto-reply.
            try {
                await this.sendSms(
                    from,
                    `Reply formats:\n• 1234: your message\n• {slug}: your message\n• label 1234 slug\n(Smart-router offline — text an agent name to reach one.)`,
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
        let deliveredSid: string | undefined;
        try {
            const result = await this.sendSms(recipient, parsed.message, twilioNumber, undefined, { skipNotification: true });
            deliveredSid = result.messageSid;
            console.log(`[TwilioSMS Proxy] Reply sent to ${recipient}`);
        } catch (err) {
            console.error(`[TwilioSMS Proxy] Failed to send reply to ${recipient}:`, err);
            return;
        }

        // Fire sms.proxy_routed so subscribed agent sessions see manual replies.
        this.webhookDispatcher.dispatch('sms.proxy_routed', {
            from_proxy: from,
            twilio_number: twilioNumber,
            parsed_kind: parsed.type === 'slug_reply' ? 'slug' : 'code',
            body: parsed.message,
            routed_via: '1on1',
            routed_to_number: recipient,
            routed_to_conversation_sid: null,
            routed_to_slug: parsed.type === 'slug_reply' ? parsed.slug : null,
            delivered_message_sid: deliveredSid ?? '',
        }, {
            ...(deliveredSid ? { eventId: `phony-proxy-routed-${deliveredSid}` } : {}),
        }).catch(e => console.error('[TwilioSMS] sms.proxy_routed dispatch error:', e));

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
        if (!author) return false;
        if (!body && mediaUrls.length === 0) return false;

        // Idempotency: covers both directions (self-authored echo from the
        // outbound send-path and real inbound from a participant).
        if (messageSid) {
            const existing = await SmsModel.findOne({ messageSid }).lean();
            if (existing) return false;
        }

        // Self-authored group message: Phony posted via phony_send_group_sms,
        // Twilio fanned out to externals, and the same message echoes back to
        // us via onMessageAdded. Persist as outbound so the group thread has
        // full history — but skip inbound fan-out (notifyOutboundGroupMessage
        // already handled proxy echo on the send path).
        if (this.conversationsService.isSelfAuthor(author)) {
            if (!messageSid) return false;
            const slug = TwilioSmsService.getGroupSlug(conversationSid) ?? '';
            try {
                await this.storageService.saveSms({
                    messageSid,
                    fromNumber: process.env.TWILIO_NUMBER!,
                    toNumber: slug ? `group:${slug}` : conversationSid,
                    direction: SmsDirection.OUTBOUND,
                    body,
                    status: SmsStatus.SENT,
                    twilioStatus: 'sent',
                    numMedia: mediaUrls.length,
                    mediaUrls,
                    conversationSid,
                });
            } catch (err: any) {
                if (err.code === 11000) return false;
                throw err;
            }
            return true;
        }

        // Resolve this Conversation's actual participants + Phony number once.
        // Multi-number: a Conversation can live on any SMS_ENABLED_NUMBERS
        // entry (projectedAddress for groups, proxyAddress for autocreated
        // 1-on-1s) — never assume TWILIO_NUMBER.
        const participants = await this.conversationsService
            .listParticipants(conversationSid)
            .catch(() => [] as Awaited<ReturnType<TwilioConversationsService['listParticipants']>>);
        const twilioNumber = this.conversationsService.resolvePhonyNumberFromParticipants(participants);
        const externals = participants
            .filter(p => p.address && !this.conversationsService.isSelfAuthor(p.address))
            .map(p => p.address!);

        // Proxy target (Ben/Laura) texting a Phony number 1-on-1: with the
        // Messaging Service set to "Autocreate a Conversation", their plain
        // SMS arrives HERE — inside a Conversation whose other members are
        // at most fellow proxy targets — and never reaches the /sms/incoming
        // proxy-reply path. Hand it off to handleProxyReply so slug replies,
        // label commands, and the sms.needs_routing smart-router all work.
        const isProxyOnlyConversation =
            SMS_PROXY_TARGET_NUMBERS.includes(author) &&
            externals.length > 0 &&
            externals.every(a => SMS_PROXY_TARGET_NUMBERS.includes(a));
        if (isProxyOnlyConversation) {
            if (messageSid) {
                try {
                    await this.storageService.saveSms({
                        messageSid,
                        fromNumber: author,
                        toNumber: twilioNumber,
                        direction: SmsDirection.INBOUND,
                        body,
                        status: SmsStatus.RECEIVED,
                        twilioStatus: 'received',
                        numMedia: mediaUrls.length,
                        mediaUrls,
                        conversationSid,
                    });
                } catch (err: any) {
                    if (err.code === 11000) return false;
                    throw err;
                }
            }
            this.webhookDispatcher.dispatch('sms.incoming', {
                message_sid: messageSid ?? '',
                conversation_sid: conversationSid,
                conversation_label: null,
                from: author,
                from_label: TwilioSmsService.numberToSlug.get(author) ?? null,
                to: twilioNumber,
                body,
                media_urls: mediaUrls,
            }, {
                reply: {
                    kind: '1on1',
                    tool: 'phony_send_sms',
                    args: { to: author, from: twilioNumber },
                    description: `To reply, call phony_send_sms with to="${author}" body="<your reply>". The message will appear as a 1-on-1 SMS back to the sender.`,
                },
                ...(messageSid ? { eventId: `phony-msg-${messageSid}` } : {}),
            }).catch((e) => console.error('[TwilioSMS] proxy-conv webhook dispatch error:', e));
            if (SMS_PROXY_ENABLED && !options?.skipNotify) {
                console.log(`[TwilioSMS Proxy] ${messageSid ?? '(no sid)'} from ${author} via proxy-only Conversation ${conversationSid} → handleProxyReply`);
                await this.handleProxyReply(author, twilioNumber, body, { messageSid, mediaUrls });
            }
            return true;
        }

        // Ensure the group is registered (covers webhook-missed onConversationAdded)
        if (!TwilioSmsService.getGroupSlug(conversationSid)) {
            await this.registerGroup(conversationSid, twilioNumber, externals);
        }

        // Persist to SmsModel tagged with the Conversation SID for audit
        if (messageSid) {
            try {
                await this.storageService.saveSms({
                    messageSid,
                    fromNumber: author,
                    toNumber: twilioNumber,
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

        // Fire-and-forget outbound webhook dispatch for any matching routes.
        // Done before notifyGroupMessage so the webhook always runs even if
        // the proxy fan-out is disabled (SMS_PROXY_ENABLED off).
        const groupSlug = TwilioSmsService.getGroupSlug(conversationSid) ?? null;
        this.webhookDispatcher.dispatch('sms.incoming', {
            message_sid: messageSid ?? '',
            conversation_sid: conversationSid,
            conversation_label: groupSlug,
            from: author,
            from_label: TwilioSmsService.numberToSlug.get(author) ?? null,
            to: twilioNumber,
            body,
            media_urls: mediaUrls,
            // seq deferred to v2 — requires plumbing Twilio Conversations Message.Index
            // through both webhook + reconciler callers.
        }, {
            reply: {
                kind: 'group',
                tool: 'phony_send_group_sms',
                args: { conversationSid, ...(groupSlug ? { slug: groupSlug } : {}) },
                description: `To reply to the whole group, call phony_send_group_sms with conversationSid="${conversationSid}"${groupSlug ? ` (slug "${groupSlug}")` : ''} body="<your reply>". The reply fans out to every participant in the group.`,
            },
            ...(messageSid ? { eventId: `phony-msg-${messageSid}` } : {}),
        }).catch((e) => console.error('[TwilioSMS] group webhook dispatch error:', e));

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
     * Fan a group-Conversation OUTBOUND message (one we just posted via the
     * Conversations API) out to SMS_PROXY_TARGET_NUMBERS as a 1-on-1 SMS echo.
     * Mirrors `notifyGroupMessage` so Ben/Laura can see what Phony's agents
     * are sending into groups they aren't members of.
     *
     * Skip targets:
     *   - any proxy target who IS an external participant in the group —
     *     they don't get a native fan-out (Phony's the projectedAddress, not
     *     them), but they're presumed to be watching the thread themselves so
     *     the echo would be duplicative. (Same skip rule as inbound for parity.)
     */
    public async notifyOutboundGroupMessage(
        conversationSid: string,
        body: string,
        mediaUrls?: string[],
    ): Promise<void> {
        if (!SMS_PROXY_ENABLED) return;
        const slug = TwilioSmsService.getGroupSlug(conversationSid);
        if (!slug) {
            console.warn(`[TwilioSMS Proxy] No slug for group ${conversationSid}, skipping outbound echo`);
            return;
        }

        const skipTargets = new Set<string>();
        const group = await GroupConversationModel.findOne({ conversationSid }).lean();
        const externalsInGroup = new Set(group?.externalParticipants ?? []);
        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            if (externalsInGroup.has(target)) skipTargets.add(target);
        }

        const mediaNote = mediaUrls && mediaUrls.length ? `\n[📎 ${mediaUrls.length}]` : '';
        const notification = `📤 {${slug}} agent → group:\n${body || '(no text)'}${mediaNote}\n---\nReply: {${slug}}: msg`;

        const twilioNumber = process.env.TWILIO_NUMBER!;
        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            if (skipTargets.has(target)) continue;
            try {
                await this.sendSms(target, notification, twilioNumber, mediaUrls && mediaUrls.length ? mediaUrls : undefined, { skipNotification: true });
            } catch (err) {
                console.error(`[TwilioSMS Proxy] Outbound group echo to ${target} failed:`, err);
            }
        }

        GroupConversationModel.updateOne(
            { conversationSid },
            { $set: { lastActivityAt: new Date() } },
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
    ): Promise<string | undefined> {
        let deliveredSid: string | undefined;
        try {
            deliveredSid = await this.conversationsService.postMessage(conversationSid, message);
            console.log(`[TwilioSMS Proxy] Routed {${slug}} reply from ${from} → ${conversationSid}`);
        } catch (err: any) {
            console.error(`[TwilioSMS Proxy] Failed to post into group {${slug}}:`, err);
            await this.sendSms(from, `Failed to post into {${slug}}: ${err.message}`, twilioNumber, undefined, { skipNotification: true }).catch(() => {});
            return undefined;
        }

        // Fire sms.proxy_routed so subscribed agent sessions see manual
        // replies that Ben/Laura sent into a group.
        this.webhookDispatcher.dispatch('sms.proxy_routed', {
            from_proxy: from,
            twilio_number: twilioNumber,
            parsed_kind: 'slug',
            body: message,
            routed_via: 'group',
            routed_to_number: null,
            routed_to_conversation_sid: conversationSid,
            routed_to_slug: slug,
            delivered_message_sid: deliveredSid ?? '',
        }, {
            ...(deliveredSid ? { eventId: `phony-proxy-routed-${deliveredSid}` } : {}),
        }).catch(e => console.error('[TwilioSMS] sms.proxy_routed dispatch error:', e));

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

        return deliveredSid;
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

            const status = data.MessageStatus?.toLowerCase();

            // Fire webhook events on terminal status transitions.
            // event_id is derived from message_sid + status so retries dedup.
            const original = await SmsModel.findOne({ messageSid: data.MessageSid }).lean();
            if (status === 'delivered') {
                this.webhookDispatcher.dispatch('sms.delivered', {
                    message_sid: data.MessageSid,
                    from: original?.fromNumber ?? null,
                    to: original?.toNumber ?? null,
                    delivered_at: new Date().toISOString(),
                }, { eventId: `phony-sms-delivered-${data.MessageSid}` })
                    .catch(e => console.error('[TwilioSMS] sms.delivered dispatch error:', e));
            } else if (status === 'failed' || status === 'undelivered') {
                this.webhookDispatcher.dispatch('sms.failed', {
                    message_sid: data.MessageSid,
                    from: original?.fromNumber ?? null,
                    to: original?.toNumber ?? null,
                    error_code: data.ErrorCode ?? null,
                    error_message: data.ErrorMessage ?? null,
                    twilio_status: data.MessageStatus,
                }, { eventId: `phony-sms-failed-${data.MessageSid}` })
                    .catch(e => console.error('[TwilioSMS] sms.failed dispatch error:', e));
            }

            // Notify proxy targets on delivery failure (legacy proxy path)
            if (SMS_PROXY_ENABLED && (status === 'failed' || status === 'undelivered')) {
                await this.notifyFailure(data.MessageSid, data.MessageStatus, data.ErrorCode, data.ErrorMessage);
            }
        } catch (error) {
            console.error(`[TwilioSMS] Error handling status callback:`, error);
        }
    }

    /**
     * Notify proxy targets when an outbound SMS fails or is undelivered.
     * Called from handleStatusCallback on failed/undelivered Twilio status.
     *
     * Skips: inbound messages (origin 'received'), notifications sent to
     * proxy targets themselves (loop prevention), and cases where the
     * original message isn't in SmsModel (can't build a preview).
     */
    private async notifyFailure(messageSid: string, status: string, errorCode?: string, errorMessage?: string): Promise<void> {
        try {
            const original = await this.storageService.getSms(messageSid);
            if (!original) {
                console.log(`[TwilioSMS] Cannot notify failure - message ${messageSid} not found in DB`);
                return;
            }
            if (original.direction !== SmsDirection.OUTBOUND) return;
            if (SMS_PROXY_TARGET_NUMBERS.includes(original.toNumber)) return; // loop guard

            const preview = original.body && original.body.length > 100 ? original.body.substring(0, 100) + '...' : (original.body || '(no text)');
            const errorInfo = errorCode ? ` (${errorCode}: ${errorMessage || 'unknown'})` : '';
            const failBody = `⚠️ SMS to ${original.toNumber} ${status}${errorInfo}\nFrom: ${original.fromNumber}\nMsg: ${preview}`;

            for (const target of SMS_PROXY_TARGET_NUMBERS) {
                try {
                    await this.sendSms(target, failBody, original.fromNumber, undefined, { skipNotification: true });
                    console.log(`[TwilioSMS] Failure notification sent to ${target}`);
                } catch (notifError) {
                    console.error(`[TwilioSMS] Failed to send failure notification to ${target}:`, notifError);
                }
            }
        } catch (error) {
            console.error(`[TwilioSMS] Error sending failure notification:`, error);
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
