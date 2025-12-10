import { ConversationModel, IConversation, ConversationType } from '../../models/conversation.model.js';
import { SmsModel, ISms } from '../../models/sms.model.js';
import { MongoDBService } from '../database/mongodb.service.js';

/**
 * Service for managing group conversations and threading
 */
export class ConversationService {
    private mongoService: MongoDBService;

    constructor() {
        this.mongoService = MongoDBService.getInstance();
    }

    /**
     * Create a new conversation
     */
    public async createConversation(data: {
        participants: string[];
        createdBy: string;
        name?: string;
    }): Promise<IConversation | null> {
        if (!this.mongoService.getIsConnected()) {
            console.log('[ConversationService] MongoDB not connected, cannot create conversation');
            return null;
        }

        try {
            // Validate participants
            if (data.participants.length < 2) {
                throw new Error('Conversation must have at least 2 participants');
            }

            // Determine conversation type
            const type: ConversationType = data.participants.length === 2 ? '1-to-1' : 'group';

            // Generate conversation ID
            const conversationId = (ConversationModel as any).generateConversationId(data.participants);

            // Create conversation
            const conversation = await ConversationModel.create({
                conversationId,
                type,
                participants: data.participants,
                createdBy: data.createdBy,
                name: data.name,
                messageCount: 0
            });

            console.log(`[ConversationService] Created ${type} conversation ${conversationId} with ${data.participants.length} participants`);
            return conversation;
        } catch (error) {
            console.error('[ConversationService] Error creating conversation:', error);
            return null;
        }
    }

    /**
     * Find existing conversation by participants or create new one
     */
    public async findOrCreateConversation(
        participants: string[],
        createdBy: string,
        name?: string
    ): Promise<IConversation | null> {
        if (!this.mongoService.getIsConnected()) {
            console.log('[ConversationService] MongoDB not connected');
            return null;
        }

        try {
            // Try to find existing conversation
            const existing = await (ConversationModel as any).findByParticipants(participants);

            if (existing) {
                console.log(`[ConversationService] Found existing conversation ${existing.conversationId}`);
                return existing;
            }

            // Create new conversation
            return await this.createConversation({ participants, createdBy, name });
        } catch (error) {
            console.error('[ConversationService] Error finding/creating conversation:', error);
            return null;
        }
    }

    /**
     * Get conversation by ID
     */
    public async getConversation(conversationId: string): Promise<IConversation | null> {
        if (!this.mongoService.getIsConnected()) {
            return null;
        }

        try {
            return await ConversationModel.findOne({ conversationId });
        } catch (error) {
            console.error('[ConversationService] Error retrieving conversation:', error);
            return null;
        }
    }

    /**
     * List all conversations for a phone number
     */
    public async listConversations(phoneNumber: string, limit: number = 50): Promise<IConversation[]> {
        if (!this.mongoService.getIsConnected()) {
            return [];
        }

        try {
            return await ConversationModel.find({
                participants: phoneNumber
            })
            .sort({ lastMessageAt: -1 })
            .limit(limit);
        } catch (error) {
            console.error('[ConversationService] Error listing conversations:', error);
            return [];
        }
    }

    /**
     * Add participant to a group conversation
     */
    public async addParticipant(
        conversationId: string,
        phoneNumber: string
    ): Promise<IConversation | null> {
        if (!this.mongoService.getIsConnected()) {
            return null;
        }

        try {
            const conversation = await ConversationModel.findOne({ conversationId });

            if (!conversation) {
                console.error(`[ConversationService] Conversation ${conversationId} not found`);
                return null;
            }

            // Only groups can have participants added
            if (conversation.type !== 'group') {
                console.error(`[ConversationService] Cannot add participants to 1-to-1 conversation`);
                return null;
            }

            // Check if already a participant
            if (conversation.participants.includes(phoneNumber)) {
                console.log(`[ConversationService] ${phoneNumber} already in conversation ${conversationId}`);
                return conversation;
            }

            // Add participant
            conversation.participants.push(phoneNumber);
            await conversation.save();

            console.log(`[ConversationService] Added ${phoneNumber} to conversation ${conversationId}`);
            return conversation;
        } catch (error) {
            console.error('[ConversationService] Error adding participant:', error);
            return null;
        }
    }

    /**
     * Remove participant from a group conversation
     */
    public async removeParticipant(
        conversationId: string,
        phoneNumber: string
    ): Promise<IConversation | null> {
        if (!this.mongoService.getIsConnected()) {
            return null;
        }

        try {
            const conversation = await ConversationModel.findOne({ conversationId });

            if (!conversation) {
                console.error(`[ConversationService] Conversation ${conversationId} not found`);
                return null;
            }

            // Only groups can have participants removed
            if (conversation.type !== 'group') {
                console.error(`[ConversationService] Cannot remove participants from 1-to-1 conversation`);
                return null;
            }

            // Must have at least 2 participants after removal
            if (conversation.participants.length <= 2) {
                console.error(`[ConversationService] Cannot remove participant - conversation must have at least 2 participants`);
                return null;
            }

            // Remove participant
            conversation.participants = conversation.participants.filter(p => p !== phoneNumber);
            await conversation.save();

            console.log(`[ConversationService] Removed ${phoneNumber} from conversation ${conversationId}`);
            return conversation;
        } catch (error) {
            console.error('[ConversationService] Error removing participant:', error);
            return null;
        }
    }

    /**
     * Update conversation name (group conversations only)
     */
    public async updateConversationName(
        conversationId: string,
        name: string
    ): Promise<IConversation | null> {
        if (!this.mongoService.getIsConnected()) {
            return null;
        }

        try {
            const conversation = await ConversationModel.findOne({ conversationId });

            if (!conversation) {
                console.error(`[ConversationService] Conversation ${conversationId} not found`);
                return null;
            }

            if (conversation.type !== 'group') {
                console.error(`[ConversationService] Cannot name 1-to-1 conversations`);
                return null;
            }

            conversation.name = name;
            await conversation.save();

            console.log(`[ConversationService] Updated name for conversation ${conversationId} to "${name}"`);
            return conversation;
        } catch (error) {
            console.error('[ConversationService] Error updating conversation name:', error);
            return null;
        }
    }

    /**
     * Get all messages in a conversation
     */
    public async getConversationMessages(
        conversationId: string,
        limit: number = 100
    ): Promise<ISms[]> {
        if (!this.mongoService.getIsConnected()) {
            return [];
        }

        try {
            return await SmsModel.find({ conversationId })
                .sort({ createdAt: 1 }) // Ascending order for conversation flow
                .limit(limit);
        } catch (error) {
            console.error('[ConversationService] Error retrieving conversation messages:', error);
            return [];
        }
    }

    /**
     * Update conversation metadata when a new message is added
     */
    public async updateLastMessage(conversationId: string): Promise<void> {
        if (!this.mongoService.getIsConnected()) {
            return;
        }

        try {
            await ConversationModel.updateOne(
                { conversationId },
                {
                    $set: { lastMessageAt: new Date() },
                    $inc: { messageCount: 1 }
                }
            );
        } catch (error) {
            console.error('[ConversationService] Error updating conversation metadata:', error);
        }
    }

    /**
     * Link an SMS message to a conversation
     * This will find or create a conversation for the participants
     */
    public async linkMessageToConversation(
        messageSid: string,
        fromNumber: string,
        toNumber: string
    ): Promise<string | null> {
        if (!this.mongoService.getIsConnected()) {
            return null;
        }

        try {
            // For now, we only handle 1-to-1 conversations
            // Group SMS would require additional logic to determine participants
            const participants = [fromNumber, toNumber];

            // Find or create conversation
            const conversation = await this.findOrCreateConversation(
                participants,
                fromNumber
            );

            if (!conversation) {
                return null;
            }

            // Update the SMS message with conversationId
            await SmsModel.updateOne(
                { messageSid },
                { conversationId: conversation.conversationId }
            );

            // Update conversation metadata
            await this.updateLastMessage(conversation.conversationId);

            console.log(`[ConversationService] Linked message ${messageSid} to conversation ${conversation.conversationId}`);
            return conversation.conversationId;
        } catch (error) {
            console.error('[ConversationService] Error linking message to conversation:', error);
            return null;
        }
    }
}
