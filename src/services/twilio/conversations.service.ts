import twilio from 'twilio';
import { SMS_PROXY_TARGET_NUMBERS, TWILIO_MESSAGING_SERVICE_SID } from '../../config/constants.js';

/**
 * Service for managing Twilio Conversations API (group MMS)
 * Creates native group MMS threads where all participants see all messages
 */
export class TwilioConversationsService {
    private readonly twilioClient: twilio.Twilio;
    private messagingServiceSid: string = '';
    private initialized: boolean = false;

    // Cache: senderNumber:twilioNumber -> conversationSid
    private conversationCache: Map<string, string> = new Map();

    constructor(twilioClient: twilio.Twilio) {
        this.twilioClient = twilioClient;
    }

    /**
     * Initialize the Conversations service
     * Ensures a Messaging Service exists (creates one if TWILIO_MESSAGING_SERVICE_SID not set)
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            if (TWILIO_MESSAGING_SERVICE_SID) {
                this.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID;
                console.log(`[Conversations] Using existing Messaging Service: ${this.messagingServiceSid}`);
            } else {
                // Auto-create a Messaging Service
                this.messagingServiceSid = await this.findOrCreateMessagingService();
            }
            this.initialized = true;
            console.log(`[Conversations] Initialized with Messaging Service: ${this.messagingServiceSid}`);
        } catch (error) {
            console.error('[Conversations] Failed to initialize:', error);
            throw error;
        }
    }

    /**
     * Find existing or create a new Messaging Service for Phony
     */
    private async findOrCreateMessagingService(): Promise<string> {
        // Check for existing Phony messaging service
        const services = await this.twilioClient.messaging.v1.services.list({ limit: 50 });
        const existing = services.find(s => s.friendlyName === 'Phony Group SMS');
        if (existing) {
            console.log(`[Conversations] Found existing Messaging Service: ${existing.sid}`);
            await this.ensureNumbersInMessagingService(existing.sid);
            return existing.sid;
        }

        // Create new one
        const service = await this.twilioClient.messaging.v1.services.create({
            friendlyName: 'Phony Group SMS',
            useInboundWebhookOnNumber: true
        });
        console.log(`[Conversations] Created Messaging Service: ${service.sid}`);

        // Add Twilio numbers to the Messaging Service
        await this.ensureNumbersInMessagingService(service.sid);

        return service.sid;
    }

    /**
     * Ensure our Twilio numbers are in the Messaging Service
     */
    private async ensureNumbersInMessagingService(serviceSid: string): Promise<void> {
        const twilioNumber = process.env.TWILIO_NUMBER;
        if (!twilioNumber) return;

        try {
            // List phone numbers on the account to get SIDs
            const incomingNumbers = await this.twilioClient.incomingPhoneNumbers.list({ phoneNumber: twilioNumber });
            if (incomingNumbers.length === 0) {
                console.warn(`[Conversations] Twilio number ${twilioNumber} not found on account`);
                return;
            }

            const numberSid = incomingNumbers[0].sid;

            // Check if already in the service
            try {
                const existing = await this.twilioClient.messaging.v1
                    .services(serviceSid)
                    .phoneNumbers
                    .list({ limit: 50 });
                if (existing.some(n => n.sid === numberSid)) {
                    console.log(`[Conversations] Number ${twilioNumber} already in Messaging Service`);
                    return;
                }
            } catch {
                // If listing fails, try to add anyway
            }

            await this.twilioClient.messaging.v1
                .services(serviceSid)
                .phoneNumbers
                .create({ phoneNumberSid: numberSid });
            console.log(`[Conversations] Added ${twilioNumber} to Messaging Service`);
        } catch (error: any) {
            // 21710 = number already in a messaging service
            if (error.code === 21710) {
                console.log(`[Conversations] Number ${twilioNumber} already associated with a Messaging Service`);
            } else {
                console.error(`[Conversations] Error adding number to Messaging Service:`, error.message);
            }
        }
    }

    /**
     * Find or create a Twilio Conversation for a sender + Twilio number pair.
     * Creates a group MMS thread with [sender, ...proxyTargets].
     *
     * @param senderNumber The external sender's phone number (E.164)
     * @param twilioNumber The Twilio phone number that received the message (E.164)
     * @returns The Twilio Conversation SID
     */
    public async findOrCreateConversation(senderNumber: string, twilioNumber: string): Promise<string> {
        await this.ensureInitialized();

        const cacheKey = `${senderNumber}:${twilioNumber}`;

        // Check cache first
        const cached = this.conversationCache.get(cacheKey);
        if (cached) {
            // Verify it's still active
            try {
                const conv = await this.twilioClient.conversations.v1.conversations(cached).fetch();
                if (conv.state !== 'closed') {
                    return cached;
                }
                // Closed — remove from cache and create new
                this.conversationCache.delete(cacheKey);
            } catch {
                // Not found — remove from cache
                this.conversationCache.delete(cacheKey);
            }
        }

        // Search for existing active conversation with this sender
        const existingSid = await this.findExistingConversation(senderNumber, twilioNumber);
        if (existingSid) {
            this.conversationCache.set(cacheKey, existingSid);
            return existingSid;
        }

        // Create new conversation
        const conversationSid = await this.createConversation(senderNumber, twilioNumber);
        this.conversationCache.set(cacheKey, conversationSid);
        return conversationSid;
    }

    /**
     * Search for an existing active conversation that has this sender as a participant
     */
    private async findExistingConversation(senderNumber: string, twilioNumber: string): Promise<string | null> {
        try {
            // Use uniqueName convention to find conversations
            const uniqueName = this.getUniqueName(senderNumber, twilioNumber);
            try {
                const conv = await this.twilioClient.conversations.v1
                    .conversations(uniqueName)
                    .fetch();
                if (conv.state !== 'closed') {
                    console.log(`[Conversations] Found existing conversation ${conv.sid} for ${senderNumber}`);
                    return conv.sid;
                }
            } catch {
                // Not found by uniqueName — that's fine, we'll create
            }
        } catch (error) {
            console.error('[Conversations] Error searching for existing conversation:', error);
        }
        return null;
    }

    /**
     * Create a new Twilio Conversation with sender + proxy targets
     */
    private async createConversation(senderNumber: string, twilioNumber: string): Promise<string> {
        const uniqueName = this.getUniqueName(senderNumber, twilioNumber);

        const conversation = await this.twilioClient.conversations.v1.conversations.create({
            friendlyName: `SMS with ${senderNumber}`,
            uniqueName,
            messagingServiceSid: this.messagingServiceSid
        });

        console.log(`[Conversations] Created conversation ${conversation.sid} for ${senderNumber}`);

        // Add the external sender as participant
        await this.addParticipant(conversation.sid, senderNumber, twilioNumber);

        // Add proxy target numbers (Ben, Laura, etc.)
        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            await this.addParticipant(conversation.sid, target, twilioNumber);
        }

        console.log(`[Conversations] Added ${1 + SMS_PROXY_TARGET_NUMBERS.length} participants to ${conversation.sid}`);
        return conversation.sid;
    }

    /**
     * Add an SMS participant to a conversation
     */
    private async addParticipant(conversationSid: string, phoneNumber: string, proxyNumber: string): Promise<void> {
        try {
            await this.twilioClient.conversations.v1
                .conversations(conversationSid)
                .participants
                .create({
                    'messagingBinding.address': phoneNumber,
                    'messagingBinding.proxyAddress': proxyNumber
                });
            console.log(`[Conversations] Added participant ${phoneNumber} to ${conversationSid}`);
        } catch (error: any) {
            // 50433 = participant already exists
            if (error.code === 50433) {
                console.log(`[Conversations] Participant ${phoneNumber} already in ${conversationSid}`);
            } else {
                console.error(`[Conversations] Failed to add participant ${phoneNumber}:`, error.message);
                throw error;
            }
        }
    }

    /**
     * Send a message to a Twilio Conversation
     * The author won't receive a duplicate of the message
     *
     * @param conversationSid The Twilio Conversation SID
     * @param body The message body
     * @param authorAddress The phone number of the message author (won't receive duplicate)
     */
    public async sendMessage(conversationSid: string, body: string, authorAddress?: string): Promise<string> {
        await this.ensureInitialized();

        const message = await this.twilioClient.conversations.v1
            .conversations(conversationSid)
            .messages
            .create({
                body,
                author: authorAddress || 'system',
                xTwilioWebhookEnabled: 'true'
            });

        console.log(`[Conversations] Sent message ${message.sid} to conversation ${conversationSid}`);
        return message.sid;
    }

    /**
     * Generate a unique name for a conversation based on sender and Twilio number
     */
    private getUniqueName(senderNumber: string, twilioNumber: string): string {
        // Remove + signs for clean unique name
        const sender = senderNumber.replace(/\+/g, '');
        const twilio = twilioNumber.replace(/\+/g, '');
        return `sms_group_${sender}_${twilio}`;
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }
}
