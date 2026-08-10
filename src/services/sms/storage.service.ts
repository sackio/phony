import { SmsModel, ISms } from '../../models/sms.model.js';
import { MongoDBService } from '../database/mongodb.service.js';
import { SmsDirection, SmsStatus } from '../../types.js';
import { ConversationService } from './conversation.service.js';

/**
 * Service for saving and retrieving SMS messages
 */
export class SmsStorageService {
    private mongoService: MongoDBService;
    private conversationService: ConversationService;

    constructor() {
        this.mongoService = MongoDBService.getInstance();
        this.conversationService = new ConversationService();
    }

    /**
     * Guard for READ paths.
     *
     * Returning [] / null when the database is unreachable produces an answer
     * that is byte-identical to a genuine "nothing matched" — the caller (an
     * MCP tool, a sweep, a human) cannot tell "0 matched" from "0 returned
     * because we never asked". Throw instead: every read caller already wraps
     * these in try/catch and surfaces an error, so the ambiguity disappears
     * without any of them changing.
     *
     * Write paths deliberately keep their existing skip-and-log behaviour —
     * changing those affects Twilio webhook retry semantics and is a separate
     * change.
     */
    private assertConnected(operation: string): void {
        if (!this.mongoService.getIsConnected()) {
            throw new Error(
                `MongoDB not connected — cannot ${operation}. This is a database availability error, ` +
                `not an empty result set.`
            );
        }
    }

    /**
     * Save an SMS message
     */
    public async saveSms(data: {
        messageSid: string;
        fromNumber: string;
        toNumber: string;
        direction: SmsDirection;
        body: string;
        status: SmsStatus;
        twilioStatus?: string;
        errorMessage?: string;
        errorCode?: string;
        numMedia?: number;
        mediaUrls?: string[];
        conversationSid?: string;
    }): Promise<void> {
        if (!this.mongoService.getIsConnected()) {
            console.log('[SmsStorage] MongoDB not connected, skipping SMS save');
            return;
        }

        try {
            await SmsModel.create({
                messageSid: data.messageSid,
                fromNumber: data.fromNumber,
                toNumber: data.toNumber,
                direction: data.direction,
                body: data.body,
                status: data.status,
                twilioStatus: data.twilioStatus,
                errorMessage: data.errorMessage,
                errorCode: data.errorCode,
                numMedia: data.numMedia || 0,
                mediaUrls: data.mediaUrls || [],
                // Store Twilio Conversation SID (CH…) in the existing
                // conversationId field so Conversation-sourced inbound
                // messages are queryable alongside the 1-on-1 stream.
                ...(data.conversationSid && { conversationId: data.conversationSid })
            });
            console.log(`[SmsStorage] Saved ${data.direction} SMS ${data.messageSid} from ${data.fromNumber} to ${data.toNumber}${data.conversationSid ? ` (conv ${data.conversationSid})` : ''}`);

            // Only link to the 1-on-1 ConversationModel if this isn't already
            // tagged with a Twilio Conversation SID (those are group threads).
            if (!data.conversationSid) {
                await this.conversationService.linkMessageToConversation(
                    data.messageSid,
                    data.fromNumber,
                    data.toNumber
                );
            }
        } catch (error) {
            console.error(`[SmsStorage] Error saving SMS:`, error);
        }
    }

    /**
     * Get an SMS message by messageSid
     */
    public async getSms(messageSid: string): Promise<ISms | null> {
        this.assertConnected(`retrieve SMS ${messageSid}`);

        try {
            return await SmsModel.findOne({ messageSid });
        } catch (error) {
            // null must mean "no such message", never "the lookup failed" —
            // callers render null as "Message not found".
            console.error(`[SmsStorage] Error retrieving SMS:`, error);
            throw error;
        }
    }

    /**
     * Update SMS status
     */
    public async updateSmsStatus(
        messageSid: string,
        status: SmsStatus,
        twilioStatus?: string,
        errorMessage?: string,
        errorCode?: string
    ): Promise<void> {
        if (!this.mongoService.getIsConnected()) {
            return;
        }

        try {
            const updateData: any = { status };

            if (twilioStatus) {
                updateData.twilioStatus = twilioStatus;
            }

            if (errorMessage) {
                updateData.errorMessage = errorMessage;
            }

            if (errorCode) {
                updateData.errorCode = errorCode;
            }

            await SmsModel.updateOne(
                { messageSid },
                updateData
            );
            console.log(`[SmsStorage] Updated SMS ${messageSid} status to ${status}`);
        } catch (error) {
            console.error(`[SmsStorage] Error updating SMS status:`, error);
        }
    }

    /**
     * List SMS messages with optional filtering
     */
    public async listSms(options: {
        direction?: SmsDirection;
        fromNumber?: string;
        toNumber?: string;
        status?: SmsStatus;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
    } = {}): Promise<ISms[]> {
        this.assertConnected('list SMS messages');

        try {
            const query: any = {};

            if (options.direction) {
                query.direction = options.direction;
            }

            if (options.fromNumber) {
                query.fromNumber = options.fromNumber;
            }

            if (options.toNumber) {
                query.toNumber = options.toNumber;
            }

            if (options.status) {
                query.status = options.status;
            }

            if (options.startDate || options.endDate) {
                query.createdAt = {};
                if (options.startDate) {
                    query.createdAt.$gte = options.startDate;
                }
                if (options.endDate) {
                    query.createdAt.$lte = options.endDate;
                }
            }

            const limit = options.limit || 100;

            return await SmsModel.find(query)
                .sort({ createdAt: -1 })
                .limit(limit);
        } catch (error) {
            console.error(`[SmsStorage] Error listing SMS:`, error);
            throw error;
        }
    }

    /**
     * Get conversation between two phone numbers
     */
    public async getConversation(
        number1: string,
        number2: string,
        limit: number = 100
    ): Promise<ISms[]> {
        this.assertConnected(`retrieve conversation between ${number1} and ${number2}`);

        try {
            return await SmsModel.find({
                $or: [
                    { fromNumber: number1, toNumber: number2 },
                    { fromNumber: number2, toNumber: number1 }
                ]
            })
            .sort({ createdAt: 1 }) // Ascending order for conversation flow
            .limit(limit);
        } catch (error) {
            console.error(`[SmsStorage] Error retrieving conversation:`, error);
            throw error;
        }
    }

    /**
     * Delete an SMS message by messageSid
     */
    public async deleteSms(messageSid: string): Promise<boolean> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const result = await SmsModel.deleteOne({ messageSid });
            console.log(`[SmsStorage] Deleted SMS ${messageSid}`);
            return result.deletedCount > 0;
        } catch (error) {
            console.error('[SmsStorage] Error deleting SMS:', error);
            throw error;
        }
    }

    /**
     * Delete multiple SMS messages matching filters
     */
    public async deleteManySms(options: {
        direction?: SmsDirection;
        fromNumber?: string;
        toNumber?: string;
        status?: SmsStatus;
        startDate?: Date;
        endDate?: Date;
    }): Promise<number> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const query: any = {};

            if (options.direction) query.direction = options.direction;
            if (options.fromNumber) query.fromNumber = options.fromNumber;
            if (options.toNumber) query.toNumber = options.toNumber;
            if (options.status) query.status = options.status;

            if (options.startDate || options.endDate) {
                query.createdAt = {};
                if (options.startDate) query.createdAt.$gte = options.startDate;
                if (options.endDate) query.createdAt.$lte = options.endDate;
            }

            // Require at least one filter to prevent accidental deletion of everything
            if (Object.keys(query).length === 0) {
                throw new Error('At least one filter is required for bulk delete');
            }

            const result = await SmsModel.deleteMany(query);
            console.log(`[SmsStorage] Deleted ${result.deletedCount} SMS messages`);
            return result.deletedCount;
        } catch (error) {
            console.error('[SmsStorage] Error deleting SMS messages:', error);
            throw error;
        }
    }

    /**
     * Search SMS messages by text content using MongoDB full-text search
     */
    public async searchSms(options: {
        query: string;
        direction?: SmsDirection;
        phoneNumber?: string;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
    }): Promise<ISms[]> {
        this.assertConnected(`search SMS messages for "${options.query}"`);

        try {
            const filter: any = {
                $text: { $search: options.query }
            };

            if (options.direction) {
                filter.direction = options.direction;
            }

            if (options.phoneNumber) {
                // Match either fromNumber or toNumber
                filter.$or = [
                    { fromNumber: options.phoneNumber },
                    { toNumber: options.phoneNumber }
                ];
            }

            if (options.startDate || options.endDate) {
                filter.createdAt = {};
                if (options.startDate) {
                    filter.createdAt.$gte = options.startDate;
                }
                if (options.endDate) {
                    filter.createdAt.$lte = options.endDate;
                }
            }

            const limit = options.limit || 100;

            return await SmsModel.find(filter, { score: { $meta: 'textScore' } })
                .sort({ score: { $meta: 'textScore' } })
                .limit(limit);
        } catch (error) {
            console.error(`[SmsStorage] Error searching SMS:`, error);
            throw error;
        }
    }
}
