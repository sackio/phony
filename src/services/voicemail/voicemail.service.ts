import { VoicemailModel, IVoicemail, VoicemailStatus } from '../../models/voicemail.model.js';
import { MongoDBService } from '../database/mongodb.service.js';

/**
 * Service for managing voicemail records
 */
export class VoicemailService {
    private mongoService: MongoDBService;

    constructor() {
        this.mongoService = MongoDBService.getInstance();
    }

    /**
     * Create a new voicemail record (called when recording starts)
     */
    public async createVoicemail(data: {
        callSid: string;
        recordingSid: string;
        fromNumber: string;
        toNumber: string;
        duration: number;
        recordingUrl: string;
    }): Promise<IVoicemail> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const voicemail = await VoicemailModel.create({
                ...data,
                status: VoicemailStatus.TRANSCRIBING,
                isRead: false
            });
            console.log(`[Voicemail] Created voicemail ${data.recordingSid} from ${data.fromNumber}`);
            return voicemail;
        } catch (error) {
            console.error('[Voicemail] Error creating voicemail:', error);
            throw error;
        }
    }

    /**
     * Update voicemail with transcription
     */
    public async updateTranscription(
        recordingSid: string,
        transcription: string,
        transcriptionSid?: string
    ): Promise<IVoicemail | null> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const voicemail = await VoicemailModel.findOneAndUpdate(
                { recordingSid },
                {
                    $set: {
                        transcription,
                        transcriptionSid,
                        status: VoicemailStatus.COMPLETED
                    }
                },
                { new: true }
            );
            console.log(`[Voicemail] Updated transcription for ${recordingSid}`);
            return voicemail;
        } catch (error) {
            console.error('[Voicemail] Error updating transcription:', error);
            throw error;
        }
    }

    /**
     * Mark transcription as failed
     */
    public async markTranscriptionFailed(
        recordingSid: string,
        errorMessage: string
    ): Promise<IVoicemail | null> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const voicemail = await VoicemailModel.findOneAndUpdate(
                { recordingSid },
                {
                    $set: {
                        status: VoicemailStatus.FAILED,
                        errorMessage
                    }
                },
                { new: true }
            );
            console.log(`[Voicemail] Marked transcription failed for ${recordingSid}`);
            return voicemail;
        } catch (error) {
            console.error('[Voicemail] Error marking transcription failed:', error);
            throw error;
        }
    }

    /**
     * Get voicemail by recording SID
     */
    public async getVoicemail(recordingSid: string): Promise<IVoicemail | null> {
        if (!this.mongoService.getIsConnected()) {
            return null;
        }

        try {
            return await VoicemailModel.findOne({ recordingSid });
        } catch (error) {
            console.error('[Voicemail] Error getting voicemail:', error);
            return null;
        }
    }

    /**
     * Get voicemail by call SID
     */
    public async getVoicemailByCallSid(callSid: string): Promise<IVoicemail | null> {
        if (!this.mongoService.getIsConnected()) {
            return null;
        }

        try {
            return await VoicemailModel.findOne({ callSid });
        } catch (error) {
            console.error('[Voicemail] Error getting voicemail by call SID:', error);
            return null;
        }
    }

    /**
     * List voicemails with optional filtering
     */
    public async listVoicemails(options: {
        toNumber?: string;
        fromNumber?: string;
        isRead?: boolean;
        status?: VoicemailStatus;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
    } = {}): Promise<IVoicemail[]> {
        if (!this.mongoService.getIsConnected()) {
            return [];
        }

        try {
            const query: any = {};

            if (options.toNumber) {
                query.toNumber = options.toNumber;
            }
            if (options.fromNumber) {
                query.fromNumber = options.fromNumber;
            }
            if (options.isRead !== undefined) {
                query.isRead = options.isRead;
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

            const limit = Math.min(options.limit || 100, 200);

            return await VoicemailModel.find(query)
                .sort({ createdAt: -1 })
                .limit(limit);
        } catch (error) {
            console.error('[Voicemail] Error listing voicemails:', error);
            return [];
        }
    }

    /**
     * Mark voicemail as read
     */
    public async markAsRead(recordingSid: string): Promise<IVoicemail | null> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            return await VoicemailModel.findOneAndUpdate(
                { recordingSid },
                { $set: { isRead: true } },
                { new: true }
            );
        } catch (error) {
            console.error('[Voicemail] Error marking as read:', error);
            throw error;
        }
    }

    /**
     * Mark voicemail as unread
     */
    public async markAsUnread(recordingSid: string): Promise<IVoicemail | null> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            return await VoicemailModel.findOneAndUpdate(
                { recordingSid },
                { $set: { isRead: false } },
                { new: true }
            );
        } catch (error) {
            console.error('[Voicemail] Error marking as unread:', error);
            throw error;
        }
    }

    /**
     * Delete a voicemail
     */
    public async deleteVoicemail(recordingSid: string): Promise<boolean> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const result = await VoicemailModel.deleteOne({ recordingSid });
            console.log(`[Voicemail] Deleted voicemail ${recordingSid}`);
            return result.deletedCount > 0;
        } catch (error) {
            console.error('[Voicemail] Error deleting voicemail:', error);
            throw error;
        }
    }

    /**
     * Delete multiple voicemails matching filters
     */
    public async deleteManyVoicemails(options: {
        fromNumber?: string;
        toNumber?: string;
        isRead?: boolean;
        status?: VoicemailStatus;
        startDate?: Date;
        endDate?: Date;
    }): Promise<number> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const query: any = {};

            if (options.fromNumber) query.fromNumber = options.fromNumber;
            if (options.toNumber) query.toNumber = options.toNumber;
            if (options.isRead !== undefined) query.isRead = options.isRead;
            if (options.status) query.status = options.status;

            if (options.startDate || options.endDate) {
                query.createdAt = {};
                if (options.startDate) query.createdAt.$gte = options.startDate;
                if (options.endDate) query.createdAt.$lte = options.endDate;
            }

            if (Object.keys(query).length === 0) {
                throw new Error('At least one filter is required for bulk delete');
            }

            const result = await VoicemailModel.deleteMany(query);
            console.log(`[Voicemail] Deleted ${result.deletedCount} voicemails`);
            return result.deletedCount;
        } catch (error) {
            console.error('[Voicemail] Error deleting voicemails:', error);
            throw error;
        }
    }

    /**
     * Get unread voicemail count for a phone number
     */
    public async getUnreadCount(toNumber: string): Promise<number> {
        if (!this.mongoService.getIsConnected()) {
            return 0;
        }

        try {
            return await VoicemailModel.countDocuments({
                toNumber,
                isRead: false,
                status: VoicemailStatus.COMPLETED
            });
        } catch (error) {
            console.error('[Voicemail] Error getting unread count:', error);
            return 0;
        }
    }

    /**
     * Search voicemails by transcription text
     */
    public async searchVoicemails(query: string, options: {
        toNumber?: string;
        limit?: number;
    } = {}): Promise<IVoicemail[]> {
        if (!this.mongoService.getIsConnected()) {
            return [];
        }

        try {
            const searchQuery: any = {
                $text: { $search: query },
                status: VoicemailStatus.COMPLETED
            };

            if (options.toNumber) {
                searchQuery.toNumber = options.toNumber;
            }

            const limit = Math.min(options.limit || 50, 100);

            return await VoicemailModel.find(searchQuery)
                .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
                .limit(limit);
        } catch (error) {
            console.error('[Voicemail] Error searching voicemails:', error);
            return [];
        }
    }
}
