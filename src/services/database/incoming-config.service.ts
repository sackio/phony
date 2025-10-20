import { IncomingConfigModel, IIncomingConfig } from '../../models/incoming-config.model.js';
import { MongoDBService } from './mongodb.service.js';

/**
 * Service for managing incoming call configurations
 */
export class IncomingConfigService {
    private mongoService: MongoDBService;

    constructor() {
        this.mongoService = MongoDBService.getInstance();
    }

    /**
     * Create a new incoming call configuration
     */
    public async createConfig(data: {
        phoneNumber: string;
        name: string;
        systemInstructions: string;
        callInstructions?: string;
        voice?: string;
        enabled?: boolean;
        messageOnly?: boolean;
        hangupMessage?: string;
    }): Promise<IIncomingConfig> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const config = await IncomingConfigModel.create({
                phoneNumber: data.phoneNumber,
                name: data.name,
                systemInstructions: data.systemInstructions,
                callInstructions: data.callInstructions || '',
                voice: data.voice || 'sage',
                enabled: data.enabled !== undefined ? data.enabled : true,
                messageOnly: data.messageOnly || false,
                hangupMessage: data.hangupMessage || undefined
            });
            console.log(`[IncomingConfig] Created config for ${data.phoneNumber}${data.messageOnly ? ' (message-only mode)' : ''}`);
            return config;
        } catch (error) {
            console.error(`[IncomingConfig] Error creating config:`, error);
            throw error;
        }
    }

    /**
     * Get configuration by phone number
     */
    public async getConfigByNumber(phoneNumber: string): Promise<IIncomingConfig | null> {
        if (!this.mongoService.getIsConnected()) {
            return null;
        }

        try {
            return await IncomingConfigModel.findOne({ phoneNumber, enabled: true });
        } catch (error) {
            console.error(`[IncomingConfig] Error retrieving config:`, error);
            return null;
        }
    }

    /**
     * Get all configurations
     */
    public async getAllConfigs(): Promise<IIncomingConfig[]> {
        if (!this.mongoService.getIsConnected()) {
            return [];
        }

        try {
            return await IncomingConfigModel.find().sort({ createdAt: -1 });
        } catch (error) {
            console.error(`[IncomingConfig] Error retrieving configs:`, error);
            return [];
        }
    }

    /**
     * Update a configuration
     */
    public async updateConfig(
        phoneNumber: string,
        updates: {
            name?: string;
            systemInstructions?: string;
            callInstructions?: string;
            voice?: string;
            enabled?: boolean;
            messageOnly?: boolean;
            hangupMessage?: string;
        }
    ): Promise<IIncomingConfig | null> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const config = await IncomingConfigModel.findOneAndUpdate(
                { phoneNumber },
                { $set: updates },
                { new: true }
            );
            console.log(`[IncomingConfig] Updated config for ${phoneNumber}`);
            return config;
        } catch (error) {
            console.error(`[IncomingConfig] Error updating config:`, error);
            throw error;
        }
    }

    /**
     * Delete a configuration
     */
    public async deleteConfig(phoneNumber: string): Promise<boolean> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const result = await IncomingConfigModel.deleteOne({ phoneNumber });
            console.log(`[IncomingConfig] Deleted config for ${phoneNumber}`);
            return result.deletedCount > 0;
        } catch (error) {
            console.error(`[IncomingConfig] Error deleting config:`, error);
            throw error;
        }
    }
}
