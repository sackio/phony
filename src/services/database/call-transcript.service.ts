import { CallModel, ICall, ConversationMessage } from '../../models/call.model.js';
import { MongoDBService } from './mongodb.service.js';
import { CallType } from '../../types.js';

/**
 * Service for saving and retrieving call transcripts
 */
export class CallTranscriptService {
    private mongoService: MongoDBService;

    constructor() {
        this.mongoService = MongoDBService.getInstance();
    }

    /**
     * Create a new call record
     */
    public async createCall(data: {
        callSid: string;
        fromNumber: string;
        toNumber: string;
        callType: CallType;
        voiceProvider?: string;
        elevenLabsAgentId?: string;
        elevenLabsVoiceId?: string;
        callContext: string;
        systemInstructions?: string;
        callInstructions?: string;
    }): Promise<void> {
        if (!this.mongoService.getIsConnected()) {
            console.log('[CallTranscript] MongoDB not connected, skipping call creation');
            return;
        }

        try {
            await CallModel.create({
                callSid: data.callSid,
                fromNumber: data.fromNumber,
                toNumber: data.toNumber,
                callType: data.callType === CallType.INBOUND ? 'inbound' : 'outbound',
                voiceProvider: data.voiceProvider || 'elevenlabs',
                elevenLabsAgentId: data.elevenLabsAgentId,
                elevenLabsVoiceId: data.elevenLabsVoiceId,
                callContext: data.callContext,
                systemInstructions: data.systemInstructions,
                callInstructions: data.callInstructions,
                status: 'initiated',
                conversationHistory: [],
                twilioEvents: [],
                startedAt: new Date()
            });
            console.log(`[CallTranscript] Created call record for ${data.callSid} (provider: ${data.voiceProvider || 'elevenlabs'})`);
        } catch (error) {
            console.error(`[CallTranscript] Error creating call record:`, error);
        }
    }

    /**
     * Update call status to in-progress
     */
    public async markCallInProgress(callSid: string): Promise<void> {
        if (!this.mongoService.getIsConnected()) {
            return;
        }

        try {
            await CallModel.updateOne(
                { callSid },
                {
                    status: 'in-progress',
                    startedAt: new Date()
                }
            );
            console.log(`[CallTranscript] Marked call ${callSid} as in-progress`);
        } catch (error) {
            console.error(`[CallTranscript] Error updating call status:`, error);
        }
    }

    /**
     * Save the complete conversation transcript when call ends
     */
    public async saveTranscript(data: {
        callSid: string;
        conversationHistory: Array<{ role: string; content: string; truncated?: boolean; truncatedAt?: number; timestamp?: Date }>;
        twilioEvents?: Array<{ type: string; timestamp: Date; data: any }>;
        endedAt: Date;
        duration?: number;
        status: 'completed' | 'failed';
        errorMessage?: string;
    }): Promise<void> {
        if (!this.mongoService.getIsConnected()) {
            console.log('[CallTranscript] MongoDB not connected, skipping transcript save');
            return;
        }

        try {
            // Convert conversation history to include timestamps and preserve truncation data
            const conversationWithTimestamps: ConversationMessage[] = data.conversationHistory.map((msg, index) => ({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content,
                timestamp: msg.timestamp || new Date(data.endedAt.getTime() - (data.conversationHistory.length - index) * 1000),
                truncated: msg.truncated,
                truncatedAt: msg.truncatedAt
            }));

            const updateData: any = {
                conversationHistory: conversationWithTimestamps,
                endedAt: data.endedAt,
                duration: data.duration,
                status: data.status
            };

            if (data.twilioEvents) {
                updateData.twilioEvents = data.twilioEvents;
            }

            if (data.errorMessage) {
                updateData.errorMessage = data.errorMessage;
            }

            await CallModel.updateOne(
                { callSid: data.callSid },
                updateData,
                { upsert: true }
            );

            console.log(`[CallTranscript] Saved transcript for call ${data.callSid} with ${data.conversationHistory.length} messages, ${data.twilioEvents?.length || 0} Twilio events`);
        } catch (error) {
            console.error(`[CallTranscript] Error saving transcript for call ${data.callSid}:`, error);
        }
    }

    /**
     * Get a call record by SID
     */
    public async getCall(callSid: string): Promise<ICall | null> {
        if (!this.mongoService.getIsConnected()) {
            return null;
        }

        try {
            return await CallModel.findOne({ callSid });
        } catch (error) {
            console.error(`[CallTranscript] Error retrieving call:`, error);
            return null;
        }
    }

    /**
     * Update conversation history for an active call
     * Used when placing call on hold to ensure history is available on resume
     */
    public async updateConversationHistory(callSid: string, conversationHistory: Array<{ role: string; content: string; timestamp?: Date }>): Promise<void> {
        if (!this.mongoService.getIsConnected()) {
            console.log('[CallTranscript] MongoDB not connected, skipping conversation history update');
            return;
        }

        try {
            const conversationWithTimestamps: ConversationMessage[] = conversationHistory.map((msg) => ({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content,
                timestamp: msg.timestamp || new Date()
            }));

            await CallModel.updateOne(
                { callSid },
                { conversationHistory: conversationWithTimestamps }
            );

            console.log(`[CallTranscript] Updated conversation history for call ${callSid} (${conversationHistory.length} messages)`);
        } catch (error) {
            console.error(`[CallTranscript] Error updating conversation history:`, error);
        }
    }

    /**
     * Delete a call record by callSid
     */
    public async deleteCall(callSid: string): Promise<boolean> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const result = await CallModel.deleteOne({ callSid });
            console.log(`[CallTranscript] Deleted call ${callSid}`);
            return result.deletedCount > 0;
        } catch (error) {
            console.error(`[CallTranscript] Error deleting call:`, error);
            throw error;
        }
    }

    /**
     * Delete multiple call records matching filters
     */
    public async deleteManyCalls(options: {
        callType?: string;
        status?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<number> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const query: any = {};

            if (options.callType) query.callType = options.callType;
            if (options.status) query.status = options.status;

            if (options.startDate || options.endDate) {
                query.startedAt = {};
                if (options.startDate) query.startedAt.$gte = options.startDate;
                if (options.endDate) query.startedAt.$lte = options.endDate;
            }

            // Require at least one filter to prevent accidental deletion of everything
            if (Object.keys(query).length === 0) {
                throw new Error('At least one filter is required for bulk delete');
            }

            const result = await CallModel.deleteMany(query);
            console.log(`[CallTranscript] Deleted ${result.deletedCount} call records`);
            return result.deletedCount;
        } catch (error) {
            console.error(`[CallTranscript] Error deleting call records:`, error);
            throw error;
        }
    }

    /**
     * Search calls by text content
     * Uses $text on callContext/systemInstructions and $regex on conversationHistory.content
     */
    public async searchCalls(options: {
        query: string;
        callType?: string;
        phoneNumber?: string;
        status?: string;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
    }): Promise<ICall[]> {
        if (!this.mongoService.getIsConnected()) {
            return [];
        }

        try {
            const limit = options.limit || 50;

            // First: text index search on callContext + systemInstructions
            const textFilter: any = {
                $text: { $search: options.query }
            };

            if (options.callType) textFilter.callType = options.callType;
            if (options.status) textFilter.status = options.status;
            if (options.phoneNumber) {
                textFilter.$or = [
                    { fromNumber: options.phoneNumber },
                    { toNumber: options.phoneNumber }
                ];
            }
            if (options.startDate || options.endDate) {
                textFilter.startedAt = {};
                if (options.startDate) textFilter.startedAt.$gte = options.startDate;
                if (options.endDate) textFilter.startedAt.$lte = options.endDate;
            }

            const textResults = await CallModel.find(textFilter, { score: { $meta: 'textScore' } })
                .sort({ score: { $meta: 'textScore' } })
                .limit(limit);

            // Second: regex search on conversationHistory.content for transcript matches
            const regexFilter: any = {
                'conversationHistory.content': { $regex: options.query, $options: 'i' }
            };

            if (options.callType) regexFilter.callType = options.callType;
            if (options.status) regexFilter.status = options.status;
            if (options.phoneNumber) {
                regexFilter.$or = [
                    { fromNumber: options.phoneNumber },
                    { toNumber: options.phoneNumber }
                ];
            }
            if (options.startDate || options.endDate) {
                regexFilter.startedAt = {};
                if (options.startDate) regexFilter.startedAt.$gte = options.startDate;
                if (options.endDate) regexFilter.startedAt.$lte = options.endDate;
            }

            const regexResults = await CallModel.find(regexFilter)
                .sort({ startedAt: -1 })
                .limit(limit);

            // Merge results, dedup by callSid, text matches first
            const seen = new Set<string>();
            const merged: ICall[] = [];

            for (const call of [...textResults, ...regexResults]) {
                if (!seen.has(call.callSid)) {
                    seen.add(call.callSid);
                    merged.push(call);
                }
            }

            return merged.slice(0, limit);
        } catch (error) {
            console.error(`[CallTranscript] Error searching calls:`, error);
            return [];
        }
    }

    /**
     * Get recent calls
     */
    public async getRecentCalls(limit: number = 50): Promise<ICall[]> {
        if (!this.mongoService.getIsConnected()) {
            return [];
        }

        try {
            return await CallModel.find()
                .sort({ startedAt: -1 })
                .limit(limit);
        } catch (error) {
            console.error(`[CallTranscript] Error retrieving recent calls:`, error);
            return [];
        }
    }
}
