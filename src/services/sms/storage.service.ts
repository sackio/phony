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
                mediaUrls: data.mediaUrls || []
            });
            console.log(`[SmsStorage] Saved ${data.direction} SMS ${data.messageSid} from ${data.fromNumber} to ${data.toNumber}`);

            // Automatically link message to conversation
            await this.conversationService.linkMessageToConversation(
                data.messageSid,
                data.fromNumber,
                data.toNumber
            );
        } catch (error) {
            console.error(`[SmsStorage] Error saving SMS:`, error);
        }
    }

    /**
     * Get an SMS message by messageSid
     */
    public async getSms(messageSid: string): Promise<ISms | null> {
        if (!this.mongoService.getIsConnected()) {
            return null;
        }

        try {
            return await SmsModel.findOne({ messageSid });
        } catch (error) {
            console.error(`[SmsStorage] Error retrieving SMS:`, error);
            return null;
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
        if (!this.mongoService.getIsConnected()) {
            return [];
        }

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
            return [];
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
        if (!this.mongoService.getIsConnected()) {
            return [];
        }

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
            return [];
        }
    }
}
