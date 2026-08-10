import twilio from 'twilio';

/**
 * Service for managing Twilio Conversations API (true group MMS).
 *
 * Participant pattern (verified working 2026-04-20):
 *   - System (Phony): identity + messagingBinding.projectedAddress = TWILIO_NUMBER
 *     — no address, no proxy_address
 *   - External SMS: messagingBinding.address = "+1NPANXXXXXX" ONLY
 *     — no proxy_address, no projected_address
 *
 * Do NOT set messagingServiceSid on conversations.create — that re-triggers
 * the A2P / Address-Config mutex that caused the April 13 rollback. Standalone
 * Conversations route correctly when the number is MMS-capable and the
 * account is pre-2022-03-15.
 *
 * Accounts created after 2022-03-15 cannot use Group MMS (Twilio-wide
 * lockout); callers should not create group Conversations on such accounts.
 *
 * Ben/Laura are NOT added as Conversation participants. They are proxied
 * externally as 1-on-1 SMS from the Conversations webhook so the external
 * group never sees their numbers.
 */
export class TwilioConversationsService {
    private readonly twilioClient: twilio.Twilio;
    private readonly systemIdentity: string = 'phony';

    constructor(twilioClient: twilio.Twilio) {
        this.twilioClient = twilioClient;
    }

    /**
     * Create a new group Conversation with Phony as projectedAddress and
     * the given external phone numbers as native SMS participants.
     */
    public async createGroupConversation(
        twilioNumber: string,
        externalAddresses: string[],
        options?: { friendlyName?: string; uniqueName?: string }
    ): Promise<string> {
        const conv = await this.withRetry(
            () => this.twilioClient.conversations.v1.conversations.create({
                ...(options?.friendlyName && { friendlyName: options.friendlyName }),
                ...(options?.uniqueName && { uniqueName: options.uniqueName }),
            }),
            'createGroupConversation'
        );
        console.log(`[Conversations] Created ${conv.sid}${options?.friendlyName ? ` (${options.friendlyName})` : ''}`);

        await this.ensureSystemParticipant(conv.sid, twilioNumber);
        for (const addr of externalAddresses) {
            await this.addExternalParticipant(conv.sid, addr);
        }
        return conv.sid;
    }

    /**
     * Ensure Phony is present as the projectedAddress participant.
     * No-op if already present by identity OR by projectedAddress binding
     * (Twilio's autocreate path adds the projected participant automatically
     * without assigning our identity).
     *
     * Harmless races during onConversationAdded:
     *   - 50433: participant already exists
     *   - 50438 / "still initializing": webhook fired before Twilio finished
     *     wiring up autocreate; Phony will be added by that process anyway.
     */
    public async ensureSystemParticipant(conversationSid: string, twilioNumber: string): Promise<void> {
        const participants = await this.listParticipants(conversationSid);
        const existing = participants.find(p =>
            p.identity === this.systemIdentity || p.projectedAddress === twilioNumber
        );
        if (existing) return;

        try {
            await this.withRetry(
                () => this.twilioClient.conversations.v1
                    .conversations(conversationSid)
                    .participants.create({
                        identity: this.systemIdentity,
                        'messagingBinding.projectedAddress': twilioNumber,
                    }),
                `ensureSystemParticipant ${conversationSid}`
            );
            console.log(`[Conversations] Added system participant (projected=${twilioNumber}) to ${conversationSid}`);
        } catch (error: any) {
            if (error.code === 50433) return; // already exists
            if (error.code === 50438 || error.message?.includes('still initializing')) {
                console.log(`[Conversations] ${conversationSid} still initializing; autocreate will add Phony`);
                return;
            }
            throw error;
        }
    }

    /**
     * Add a native SMS participant by their external phone number.
     * address-only pattern — no proxy, no projected.
     */
    public async addExternalParticipant(conversationSid: string, phoneNumber: string): Promise<void> {
        try {
            await this.withRetry(
                () => this.twilioClient.conversations.v1
                    .conversations(conversationSid)
                    .participants.create({
                        'messagingBinding.address': phoneNumber,
                    }),
                `addExternalParticipant ${phoneNumber}`
            );
            console.log(`[Conversations] Added external ${phoneNumber} to ${conversationSid}`);
        } catch (error: any) {
            if (error.code === 50433) return; // already exists
            throw error;
        }
    }

    /**
     * Remove an external SMS participant from a Conversation. Returns true
     * if the participant existed and was removed, false if not found.
     */
    public async removeExternalParticipant(conversationSid: string, phoneNumber: string): Promise<boolean> {
        const participants = await this.listParticipants(conversationSid);
        const match = participants.find(p => p.address === phoneNumber);
        if (!match) return false;
        await this.withRetry(
            () => this.twilioClient.conversations.v1
                .conversations(conversationSid)
                .participants(match.sid).remove(),
            `removeExternalParticipant ${phoneNumber}`
        );
        console.log(`[Conversations] Removed ${phoneNumber} from ${conversationSid}`);
        return true;
    }

    /**
     * Update a Conversation's friendlyName.
     */
    public async updateFriendlyName(conversationSid: string, friendlyName: string): Promise<void> {
        await this.withRetry(
            () => this.twilioClient.conversations.v1
                .conversations(conversationSid)
                .update({ friendlyName }),
            `updateFriendlyName ${conversationSid}`
        );
        console.log(`[Conversations] Renamed ${conversationSid} → "${friendlyName}"`);
    }

    /**
     * Post a message into a Conversation as Phony.
     *
     * Twilio's group-MMS constraint: message `author` must match a
     * participant. Phony's representation varies by how the Conversation
     * was created:
     *   - Phony-created: participant with identity="phony" +
     *     projectedAddress=TWILIO_NUMBER → author: "phony"
     *   - Autocreated from inbound (user-started groups): participant with
     *     messagingBinding.address=TWILIO_NUMBER (regular SMS) → author
     *     must be TWILIO_NUMBER, not "phony"
     *
     * We look up the right author at post time.
     */
    public async postMessage(
        conversationSid: string,
        body: string,
        mediaSids?: string[]
    ): Promise<string> {
        // Twilio Conversations Messages support AT MOST ONE mediaSid per
        // message. Passing an array via the SDK silently coerces to the last
        // one AND drops the body during MMS fan-out. Split into separate
        // messages so all media and the body land on participant phones:
        //   - If only body: 1 message (body).
        //   - If only media: N messages (1 media each, no body).
        //   - If both: 1 message body-only, then N messages media-only.
        // Returns the SID of the FIRST posted message (body if present, else
        // first media) — that's what gets surfaced as the "primary" SID. The
        // onMessageAdded webhook fires for each individual message, and the
        // Fix-A self-author persistence will record each as a row.
        const author = await this.resolveSelfAuthor(conversationSid);
        const hasBody = !!(body && body.length > 0);
        const medias = mediaSids ?? [];
        if (!hasBody && medias.length === 0) {
            throw new Error('postMessage requires body or at least one mediaSid');
        }

        // Inter-message spacing for the split. Twilio reports `delivered` on
        // every sub-message even when carriers/handsets coalesce or drop rapid
        // MMS from the same sender (observed 2026-06-20: 2nd photo of a 3-msg
        // split posted within ~1s of the first showed delivered:all in Twilio
        // delivery receipts but never appeared on the recipient iPhone; a
        // manual retry 84s later with identical content landed fine).
        const SUBMSG_DELAY_MS = 1500;
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

        let firstSid: string | undefined;

        if (hasBody) {
            const msg = await this.withRetry(
                () => this.twilioClient.conversations.v1
                    .conversations(conversationSid)
                    .messages.create({ author, body }),
                `postMessage(body) to ${conversationSid}`
            );
            console.log(`[Conversations] Posted ${msg.sid} (body) to ${conversationSid} (author=${author})`);
            firstSid = msg.sid;
            if (medias.length > 0) await sleep(SUBMSG_DELAY_MS);
        }

        for (let i = 0; i < medias.length; i++) {
            const mediaSid = medias[i];
            const msg = await this.withRetry(
                () => this.twilioClient.conversations.v1
                    .conversations(conversationSid)
                    .messages.create({ author, mediaSid }),
                `postMessage(media ${i + 1}/${medias.length}) to ${conversationSid}`
            );
            console.log(`[Conversations] Posted ${msg.sid} (media ${mediaSid}) to ${conversationSid}`);
            if (!firstSid) firstSid = msg.sid;
            if (i < medias.length - 1) await sleep(SUBMSG_DELAY_MS);
        }

        return firstSid!;
    }

    /**
     * Find the author string Phony should use when posting into a given
     * Conversation. Returns the systemIdentity if a participant with that
     * identity exists, otherwise the Phony-owned number matching an
     * address-bound (or projectedAddress-bound) participant.
     *
     * Multi-number support: Phony owns multiple Twilio numbers (e.g.
     * +18575550111, +19785550112, +16175550113, +16175550114). A group
     * autocreated by inbound MMS to one of them will only have THAT number
     * as its self-participant — not TWILIO_NUMBER env. So we accept any of
     * SMS_ENABLED_NUMBERS (which is the canonical list) plus TWILIO_NUMBER.
     */
    public async resolveSelfAuthor(conversationSid: string): Promise<string> {
        const participants = await this.listParticipants(conversationSid);
        const byIdentity = participants.find(p => p.identity === this.systemIdentity);
        if (byIdentity) return this.systemIdentity;

        const { SMS_ENABLED_NUMBERS } = await import('../../config/constants.js');
        const phonyNumbers = new Set<string>(SMS_ENABLED_NUMBERS);
        if (process.env.TWILIO_NUMBER) phonyNumbers.add(process.env.TWILIO_NUMBER);

        const byAddress = participants.find(p =>
            (p.address && phonyNumbers.has(p.address)) ||
            (p.projectedAddress && phonyNumbers.has(p.projectedAddress))
        );
        if (byAddress) return (byAddress.address || byAddress.projectedAddress)!;

        throw new Error(`No self-participant found in ${conversationSid} — cannot post as Phony (participants: ${participants.map(p => p.address || p.projectedAddress || p.identity).join(', ')}; expected one of: ${Array.from(phonyNumbers).join(', ')})`);
    }

    /**
     * Test whether a given message author string represents Phony itself
     * (for echo-loop suppression in onMessageAdded handlers).
     */
    public isSelfAuthor(author: string | null | undefined): boolean {
        if (!author) return false;
        if (author === this.systemIdentity) return true;
        // Multi-number: any Phony-owned number counts as self.
        if (process.env.TWILIO_NUMBER && author === process.env.TWILIO_NUMBER) return true;
        try {
            // Sync const import; safe because constants.ts has no side effects.
            const { SMS_ENABLED_NUMBERS } = require('../../config/constants.js');
            if (Array.isArray(SMS_ENABLED_NUMBERS) && SMS_ENABLED_NUMBERS.includes(author)) return true;
        } catch { /* ignore */ }
        return false;
    }

    /**
     * Fetch all participants for a Conversation.
     */
    public async listParticipants(conversationSid: string): Promise<Array<{
        sid: string;
        identity: string | null;
        address: string | null;
        projectedAddress: string | null;
        proxyAddress: string | null;
    }>> {
        const list = await this.twilioClient.conversations.v1
            .conversations(conversationSid)
            .participants.list({ limit: 50 });
        return list.map(p => {
            const binding = (p.messagingBinding ?? {}) as Record<string, unknown>;
            return {
                sid: p.sid,
                identity: p.identity ?? null,
                address: typeof binding.address === 'string' ? binding.address : null,
                projectedAddress: typeof binding.projected_address === 'string' ? binding.projected_address : null,
                proxyAddress: typeof binding.proxy_address === 'string' ? binding.proxy_address : null,
            };
        });
    }

    /**
     * Resolve which Phony-owned number a Conversation lives on: the system
     * participant's projectedAddress (group pattern), else any participant's
     * proxyAddress (legacy 1-on-1 / autocreate pattern), else TWILIO_NUMBER.
     */
    public resolvePhonyNumberFromParticipants(
        participants: Array<{ projectedAddress: string | null; proxyAddress: string | null }>
    ): string | null {
        const projected = participants.find(p => p.projectedAddress)?.projectedAddress;
        if (projected) return projected;
        const proxy = participants.find(p => p.proxyAddress)?.proxyAddress;
        if (proxy) return proxy;
        // Deliberately NO env fallback. Defaulting to TWILIO_NUMBER here is
        // indistinguishable from a correct answer at the call site, and a
        // failed listParticipants (which yields an empty array) would silently
        // rewrite a message's destination to the wrong Phony number. Callers
        // must treat null as "cannot resolve — defer", never as a default.
        return null;
    }

    /**
     * Extract the list of external E.164 addresses from a Conversation's
     * participants (everyone except the Phony system identity).
     */
    public async getExternalAddresses(conversationSid: string): Promise<string[]> {
        const participants = await this.listParticipants(conversationSid);
        return participants
            .filter(p => p.identity !== this.systemIdentity && p.address)
            .map(p => p.address!);
    }

    /**
     * Identity used by Phony when posting into a Conversation.
     * Messages authored by this identity should NOT be re-proxied
     * (they're echoes of messages Phony itself sent).
     */
    public getSystemIdentity(): string {
        return this.systemIdentity;
    }

    /**
     * Fetch a Conversation's chatServiceSid (ISxxxxxxxxxxxx). Required for
     * calling MCS to download inbound media. Cached per-call site for the
     * process lifetime since chatServiceSid never changes for a given
     * Conversation.
     */
    private chatServiceSidCache = new Map<string, string>();
    public async getChatServiceSid(conversationSid: string): Promise<string> {
        const cached = this.chatServiceSidCache.get(conversationSid);
        if (cached) return cached;
        const conv = await this.twilioClient.conversations.v1.conversations(conversationSid).fetch();
        this.chatServiceSidCache.set(conversationSid, conv.chatServiceSid);
        return conv.chatServiceSid;
    }

    private async withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                const isTransient = error.code === 'EAI_AGAIN' || error.code === 'ENOTFOUND'
                    || error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET'
                    || error.message?.includes('EAI_AGAIN') || error.message?.includes('getaddrinfo');
                if (isTransient && attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    console.warn(`[Conversations] ${label} attempt ${attempt}/${maxRetries} failed (${error.code || 'network error'}), retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    throw error;
                }
            }
        }
        throw new Error('Unreachable');
    }
}
