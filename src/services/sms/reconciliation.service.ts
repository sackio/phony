import twilio from 'twilio';
import { SmsModel } from '../../models/sms.model.js';
import { SmsDirection, SmsStatus } from '../../types.js';
import { MongoDBService } from '../database/mongodb.service.js';
import { TwilioSmsService } from '../twilio/sms.service.js';
import { TwilioConversationsService } from '../twilio/conversations.service.js';
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

        const conversationsService = new TwilioConversationsService(this.twilioClient);
        this.twilioSmsService = new TwilioSmsService(this.twilioClient, conversationsService);
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
                        // Only inbound (received) messages
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
}
