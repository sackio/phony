import twilio from 'twilio';
import { SmsModel } from '../../models/sms.model.js';
import { SmsDirection, SmsStatus } from '../../types.js';
import { MongoDBService } from '../database/mongodb.service.js';
import { TwilioSmsService } from '../twilio/sms.service.js';
import { TwilioConversationsService } from '../twilio/conversations.service.js';
import { GroupConversationModel } from '../../models/group-conversation.model.js';
import { TempMediaService } from '../temp-media.service.js';
import { SMS_ENABLED_NUMBERS } from '../../config/constants.js';

/**
 * Reconciliation service that periodically checks Twilio for inbound SMS
 * messages that may have been missed by the webhook (e.g., due to downtime,
 * network issues, or webhook failures).
 *
 * Runs as a singleton on a configurable interval. For each missed message,
 * it triggers the same processing pipeline as the webhook handler
 * (storage + proxy notifications/forwarding).
 */
export class SmsReconciliationService {
    private static instance: SmsReconciliationService | null = null;

    private readonly twilioClient: twilio.Twilio;
    private readonly twilioSmsService: TwilioSmsService;
    private readonly conversationsService: TwilioConversationsService;
    private readonly tempMediaService: TempMediaService;
    private readonly intervalMs: number;
    private readonly lookbackMs: number;
    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private running = false;
    private reconciling = false;

    /**
     * @param intervalMs  How often to run reconciliation (default: 5 minutes)
     * @param lookbackMs  How far back to look for missed messages (default: 30 minutes)
     */
    constructor(options?: { intervalMs?: number; lookbackMs?: number }) {
        this.intervalMs = options?.intervalMs ?? 5 * 60 * 1000;
        this.lookbackMs = options?.lookbackMs ?? 30 * 60 * 1000;

        const accountSid = process.env.TWILIO_ACCOUNT_SID!;
        const authToken = process.env.TWILIO_AUTH_TOKEN!;
        this.twilioClient = twilio(accountSid, authToken);

        this.conversationsService = new TwilioConversationsService(this.twilioClient);
        this.twilioSmsService = new TwilioSmsService(this.twilioClient, this.conversationsService);
        this.tempMediaService = new TempMediaService();
    }

    /**
     * For a Conversation message with attached media, fetch each media via
     * the Twilio Conversations SDK (`message.media` sub-resource), rehost
     * locally, and return durable public URLs. Returns [] on no media.
     */
    private async fetchConversationMessageMedia(
        conversationSid: string,
        messageSid: string
    ): Promise<string[]> {
        try {
            const msg = await this.twilioClient.conversations.v1
                .conversations(conversationSid)
                .messages(messageSid)
                .fetch();
            const mediaList: Array<{ sid?: string; content_type?: string; filename?: string }> =
                (msg as any).media || [];
            if (!Array.isArray(mediaList) || mediaList.length === 0) return [];

            const chatServiceSid = await this.conversationsService.getChatServiceSid(conversationSid);
            const accountSid = process.env.TWILIO_ACCOUNT_SID!;
            const authToken = process.env.TWILIO_AUTH_TOKEN!;
            const urls: string[] = [];
            for (const m of mediaList) {
                if (!m.sid) continue;
                try {
                    const url = await this.tempMediaService.saveFromTwilioMedia(
                        m.sid,
                        m.content_type || 'application/octet-stream',
                        m.filename,
                        accountSid,
                        authToken,
                        chatServiceSid,
                    );
                    urls.push(url);
                } catch (err: any) {
                    console.error(`[SmsReconciliation] Failed to ingest media ${m.sid} for ${messageSid}:`, err.message);
                }
            }
            return urls;
        } catch (err: any) {
            console.error(`[SmsReconciliation] Failed to fetch message media for ${messageSid}:`, err.message);
            return [];
        }
    }

    static getInstance(options?: { intervalMs?: number; lookbackMs?: number }): SmsReconciliationService {
        if (!SmsReconciliationService.instance) {
            SmsReconciliationService.instance = new SmsReconciliationService(options);
        }
        return SmsReconciliationService.instance;
    }

    /**
     * Start periodic reconciliation.
     * Also runs one immediate reconciliation pass.
     */
    public start(): void {
        if (this.running) {
            console.log('[SmsReconciliation] Already running');
            return;
        }

        this.running = true;
        console.log(
            `[SmsReconciliation] Starting — interval=${this.intervalMs / 1000}s, lookback=${this.lookbackMs / 1000}s`
        );

        // Run immediately on start, then on interval
        this.reconcile().catch(err =>
            console.error('[SmsReconciliation] Error on initial reconciliation:', err)
        );

        this.intervalHandle = setInterval(() => {
            this.reconcile().catch(err =>
                console.error('[SmsReconciliation] Error during scheduled reconciliation:', err)
            );
        }, this.intervalMs);
    }

    /**
     * Stop periodic reconciliation.
     */
    public stop(): void {
        if (!this.running) {
            console.log('[SmsReconciliation] Not running');
            return;
        }

        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
        this.running = false;
        console.log('[SmsReconciliation] Stopped');
    }

    public isRunning(): boolean {
        return this.running;
    }

    /**
     * Run a single reconciliation pass:
     * 1. Query Twilio REST API for inbound messages in the lookback window
     * 2. Check each messageSid against MongoDB
     * 3. For missing messages, run them through the same inbound pipeline as the webhook
     */
    public async reconcile(): Promise<{ checked: number; reconciled: number }> {
        if (this.reconciling) {
            console.log('[SmsReconciliation] Reconciliation already in progress, skipping');
            return { checked: 0, reconciled: 0 };
        }

        const mongo = MongoDBService.getInstance();
        if (!mongo.getIsConnected()) {
            console.log('[SmsReconciliation] MongoDB not connected, skipping');
            return { checked: 0, reconciled: 0 };
        }

        this.reconciling = true;
        const dateSentAfter = new Date(Date.now() - this.lookbackMs);
        let checked = 0;
        let reconciled = 0;

        try {
            // Query Twilio for inbound messages to each of our enabled numbers
            for (const twilioNumber of SMS_ENABLED_NUMBERS) {
                try {
                    const messages = await this.twilioClient.messages.list({
                        to: twilioNumber,
                        dateSentAfter,
                        // Hard cap — with a 24h window this prevents a runaway
                        // scan if an upstream issue inflates counts. At steady
                        // volume (~50/day), real pages stay well under this.
                        limit: 500,
                    });

                    // Filter to only inbound/received messages (Twilio list can include
                    // outbound messages to this number from other accounts, but direction
                    // field disambiguates)
                    const inboundMessages = messages.filter(
                        m => m.direction === 'inbound'
                    );

                    for (const msg of inboundMessages) {
                        checked++;

                        // Check if we already have this message
                        const existing = await SmsModel.findOne({ messageSid: msg.sid }).lean();
                        if (existing) {
                            continue;
                        }

                        // Message is missing — process it through the same pipeline as the webhook
                        console.log(
                            `[SmsReconciliation] Found missed message ${msg.sid} from ${msg.from} to ${msg.to}: "${msg.body?.substring(0, 50)}..."`
                        );

                        // Collect media URLs if present
                        const numMedia = msg.numMedia ? parseInt(msg.numMedia) : 0;
                        let mediaUrls: string[] = [];
                        if (numMedia > 0) {
                            try {
                                const mediaList = await this.twilioClient
                                    .messages(msg.sid)
                                    .media.list();
                                mediaUrls = mediaList.map(
                                    m => `https://api.twilio.com${m.uri.replace('.json', '')}`
                                );
                            } catch (mediaErr) {
                                console.warn(
                                    `[SmsReconciliation] Failed to fetch media for ${msg.sid}:`,
                                    mediaErr
                                );
                            }
                        }

                        // Use TwilioSmsService.handleIncomingSms — same as the webhook handler
                        // This saves to DB, links to conversation, and triggers proxy notifications
                        try {
                            await this.twilioSmsService.handleIncomingSms({
                                MessageSid: msg.sid,
                                From: msg.from,
                                To: msg.to,
                                Body: msg.body || '',
                                NumMedia: numMedia.toString(),
                                ...(mediaUrls[0] && { MediaUrl0: mediaUrls[0] }),
                                ...(mediaUrls[1] && { MediaUrl1: mediaUrls[1] }),
                                ...(mediaUrls[2] && { MediaUrl2: mediaUrls[2] }),
                                ...(mediaUrls[3] && { MediaUrl3: mediaUrls[3] }),
                                ...(mediaUrls[4] && { MediaUrl4: mediaUrls[4] }),
                            });
                            reconciled++;
                            console.log(
                                `[SmsReconciliation] Reconciled message ${msg.sid} from ${msg.from}`
                            );
                        } catch (processErr) {
                            console.error(
                                `[SmsReconciliation] Failed to process missed message ${msg.sid}:`,
                                processErr
                            );
                        }
                    }
                } catch (fetchErr) {
                    console.error(
                        `[SmsReconciliation] Failed to fetch messages for ${twilioNumber}:`,
                        fetchErr
                    );
                }
            }

            // Also reconcile Conversation-sourced messages (group MMS).
            const convResult = await this.reconcileConversations(dateSentAfter).catch(err => {
                console.error('[SmsReconciliation] Conversations pass failed:', err);
                return { checked: 0, reconciled: 0 };
            });
            checked += convResult.checked;
            reconciled += convResult.reconciled;

            if (reconciled > 0) {
                console.log(
                    `[SmsReconciliation] Completed — checked=${checked}, reconciled=${reconciled}`
                );
            } else {
                console.log(
                    `[SmsReconciliation] Completed — checked=${checked}, no missed messages`
                );
            }
        } catch (error) {
            console.error('[SmsReconciliation] Unexpected error during reconciliation:', error);
        } finally {
            this.reconciling = false;
        }

        return { checked, reconciled };
    }

    /**
     * Reconcile Twilio Conversations: for each Conversation updated in the
     * lookback window, compare its message list against SmsModel and replay
     * anything missing through the same pipeline as the webhook.
     *
     * Catches gaps from: webhook downtime, network issues during autocreate,
     * Twilio queueing delays, and missed onMessageAdded retries.
     */
    public async reconcileConversations(dateSentAfter: Date): Promise<{ checked: number; reconciled: number }> {
        let checked = 0;
        let reconciled = 0;

        let conversations: Array<{ sid: string; dateUpdated: Date | null }> = [];
        try {
            // Twilio Conversations API doesn't support server-side date
            // filtering on list(); pull recent pages newest-first and stop
            // once we see ones older than the window (default ordering is
            // by dateUpdated desc).
            const raw = await this.twilioClient.conversations.v1.conversations.list({ limit: 200 });
            conversations = raw
                .map(c => ({ sid: c.sid, dateUpdated: c.dateUpdated }))
                .filter(c => !c.dateUpdated || c.dateUpdated >= dateSentAfter);
        } catch (err) {
            console.error('[SmsReconciliation] Failed to list Conversations:', err);
            return { checked: 0, reconciled: 0 };
        }

        for (const conv of conversations) {
            try {
                const messages = await this.twilioClient.conversations.v1
                    .conversations(conv.sid)
                    .messages.list({ limit: 50, order: 'desc' });

                for (const msg of messages) {
                    if (msg.dateCreated && msg.dateCreated < dateSentAfter) continue;
                    checked++;

                    // Skip-by-existing check BEFORE fetching media (avoid
                    // expensive MCS calls for messages we already saved).
                    const existing = await SmsModel.findOne({ messageSid: msg.sid }).lean();
                    if (existing) continue;

                    const author = msg.author || '';
                    const body = msg.body || '';
                    const mediaUrls = await this.fetchConversationMessageMedia(conv.sid, msg.sid);

                    const wasProcessed = await this.twilioSmsService
                        .processInboundGroupMessage(conv.sid, msg.sid, author, body, mediaUrls, msg.dateCreated ?? undefined, { skipNotify: true })
                        .catch(err => {
                            console.error(`[SmsReconciliation] Failed to replay ${msg.sid} in ${conv.sid}:`, err);
                            return false;
                        });
                    if (wasProcessed) {
                        reconciled++;
                        console.log(`[SmsReconciliation] Replayed ${msg.sid} in ${conv.sid} from ${author}${mediaUrls.length ? ` (+${mediaUrls.length} media)` : ''}: "${body.substring(0, 60)}"`);
                    }
                }
            } catch (err: any) {
                // 20404 = conversation was deleted since we listed it; skip
                if (err.status === 404 || err.code === 20404) continue;
                console.error(`[SmsReconciliation] Failed to fetch messages for ${conv.sid}:`, err);
            }
        }

        return { checked, reconciled };
    }

    /**
     * Retag SmsModel rows that predate autocreate so they join the group's
     * thread in our DB. Matches 1-on-1 SMS entries where one side is the
     * Conversation's projectedAddress (+18575550111) and the other side is
     * any of the Conversation's external participants, within an optional
     * time window, and sets conversationId = convSid.
     *
     * Idempotent — $set is a no-op if conversationId is already correct.
     */
    public async retagHistoricalSmsForConversation(
        conversationSid: string,
        options?: { since?: Date; until?: Date }
    ): Promise<{ matched: number; modified: number; externals: string[] }> {
        const mongo = MongoDBService.getInstance();
        if (!mongo.getIsConnected()) {
            return { matched: 0, modified: 0, externals: [] };
        }

        const externals = await this.conversationsService
            .getExternalAddresses(conversationSid)
            .catch(() => [] as string[]);
        if (externals.length === 0) {
            console.log(`[SmsReconciliation] No externals for ${conversationSid}, nothing to retag`);
            return { matched: 0, modified: 0, externals };
        }

        const projected = process.env.TWILIO_NUMBER!;
        // Exclude proxy-notification bodies: outbound SMS we sent to
        // SMS_PROXY_TARGET_NUMBERS copying what happened in a 1-on-1 thread.
        // Those aren't group-conversation content, they're operational noise.
        const proxyPrefixRe = /^(📥|📤|👥|Reply formats:|\{.*-grp\} |$)/;

        const filter: any = {
            $or: [
                { fromNumber: projected, toNumber: { $in: externals } },
                { fromNumber: { $in: externals }, toNumber: projected },
            ],
            // Don't stomp rows that already belong to a different Twilio
            // Conversation (CH…). Rows with no conversationId or with a
            // `conv_*` 1-on-1 pairing get retagged — the CH SID is the
            // canonical thread from now on.
            $and: [
                {
                    $or: [
                        { conversationId: { $exists: false } },
                        { conversationId: null },
                        { conversationId: { $regex: '^conv_' } },
                        { conversationId: conversationSid },
                    ],
                },
            ],
            body: { $not: proxyPrefixRe },
        };
        if (options?.since || options?.until) {
            filter.createdAt = {};
            if (options.since) filter.createdAt.$gte = options.since;
            if (options.until) filter.createdAt.$lte = options.until;
        }

        const result = await SmsModel.updateMany(filter, { $set: { conversationId: conversationSid } });
        console.log(`[SmsReconciliation] Retagged ${result.modifiedCount}/${result.matchedCount} historical SMS for ${conversationSid} (externals: ${externals.join(', ')})`);
        return { matched: result.matchedCount, modified: result.modifiedCount, externals };
    }

    /**
     * Backfill a specific Conversation's entire message history (no time
     * window). Use once to absorb a group that started before autocreate
     * was enabled. Idempotent — safe to re-run.
     *
     * Always passes `skipNotify: true` so historical messages don't spam
     * the proxy targets.
     */
    public async backfillConversation(conversationSid: string): Promise<{ checked: number; reconciled: number }> {
        let checked = 0;
        let reconciled = 0;

        try {
            const messages = await this.twilioClient.conversations.v1
                .conversations(conversationSid)
                .messages.list({ limit: 1000, order: 'asc' });

            for (const msg of messages) {
                checked++;
                const existing = await SmsModel.findOne({ messageSid: msg.sid }).lean();
                if (existing) continue;

                const mediaUrls = await this.fetchConversationMessageMedia(conversationSid, msg.sid);

                const wasProcessed = await this.twilioSmsService
                    .processInboundGroupMessage(
                        conversationSid,
                        msg.sid,
                        msg.author || '',
                        msg.body || '',
                        mediaUrls,
                        msg.dateCreated ?? undefined,
                        { skipNotify: true }
                    )
                    .catch(err => {
                        console.error(`[SmsReconciliation] Backfill replay ${msg.sid} failed:`, err);
                        return false;
                    });
                if (wasProcessed) {
                    reconciled++;
                    console.log(`[SmsReconciliation] Backfilled ${msg.sid} in ${conversationSid} from ${msg.author}${mediaUrls.length ? ` (+${mediaUrls.length} media)` : ''}: "${(msg.body || '').substring(0, 60)}"`);
                }
            }
            console.log(`[SmsReconciliation] Backfill ${conversationSid}: checked=${checked}, reconciled=${reconciled}`);
        } catch (err) {
            console.error(`[SmsReconciliation] Backfill failed for ${conversationSid}:`, err);
        }

        return { checked, reconciled };
    }
}
