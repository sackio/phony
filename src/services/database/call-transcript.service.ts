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
        voice: string;
        callContext: string;
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
                voice: data.voice,
                callContext: data.callContext,
                status: 'initiated',
                conversationHistory: [],
                startedAt: new Date()
            });
            console.log(`[CallTranscript] Created call record for ${data.callSid}`);
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
        conversationHistory: Array<{ role: string; content: string }>;
        endedAt: Date;
        duration?: number;
        status: 'completed' | 'failed';
    }): Promise<void> {
        if (!this.mongoService.getIsConnected()) {
            console.log('[CallTranscript] MongoDB not connected, skipping transcript save');
            return;
        }

        try {
            // Convert conversation history to include timestamps
            const conversationWithTimestamps: ConversationMessage[] = data.conversationHistory.map((msg, index) => ({
                role: msg.role as 'user' | 'assistant',
                content: msg.content,
                timestamp: new Date(data.endedAt.getTime() - (data.conversationHistory.length - index) * 1000)
            }));

            await CallModel.updateOne(
                { callSid: data.callSid },
                {
                    conversationHistory: conversationWithTimestamps,
                    endedAt: data.endedAt,
                    duration: data.duration,
                    status: data.status
                },
                { upsert: true }
            );

            console.log(`[CallTranscript] Saved transcript for call ${data.callSid} with ${data.conversationHistory.length} messages`);
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
