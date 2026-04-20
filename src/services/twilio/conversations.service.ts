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
     * Post a message into a Conversation as Phony. Twilio will group-MMS
     * fan-out to all external participants.
     */
    public async postMessage(
        conversationSid: string,
        body: string,
        mediaSids?: string[]
    ): Promise<string> {
        const payload: any = {
            author: this.systemIdentity,
            ...(body && { body }),
            ...(mediaSids && mediaSids.length > 0 && { mediaSid: mediaSids }),
        };
        const msg = await this.withRetry(
            () => this.twilioClient.conversations.v1
                .conversations(conversationSid)
                .messages.create(payload),
            `postMessage to ${conversationSid}`
        );
        console.log(`[Conversations] Posted ${msg.sid} to ${conversationSid}`);
        return msg.sid;
    }

    /**
     * Fetch all participants for a Conversation.
     */
    public async listParticipants(conversationSid: string): Promise<Array<{
        sid: string;
        identity: string | null;
        address: string | null;
        projectedAddress: string | null;
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
            };
        });
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
