import mongoose from 'mongoose';

/**
 * MongoDB connection service
 */
export class MongoDBService {
    private static instance: MongoDBService;
    private isConnected = false;

    private constructor() {}

    public static getInstance(): MongoDBService {
        if (!MongoDBService.instance) {
            MongoDBService.instance = new MongoDBService();
        }
        return MongoDBService.instance;
    }

    /**
     * Connect to MongoDB
     */
    public async connect(): Promise<void> {
        if (this.isConnected) {
            console.log('[MongoDB] Already connected');
            return;
        }

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            console.log('[MongoDB] MONGODB_URI not configured, skipping database connection');
            return;
        }

        try {
            await mongoose.connect(mongoUri, {
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 5000
            });
            this.isConnected = true;
            console.log('[MongoDB] Connected successfully to:', mongoUri.replace(/\/\/.*@/, '//***@'));
        } catch (error) {
            console.error('[MongoDB] Connection failed:', error);
            console.log('[MongoDB] Continuing without database - transcripts will not be saved');
            // Don't throw - allow app to continue without database
        }
    }

    /**
     * Disconnect from MongoDB
     */
    public async disconnect(): Promise<void> {
        if (!this.isConnected) {
            return;
        }

        try {
            await mongoose.disconnect();
            this.isConnected = false;
            console.log('[MongoDB] Disconnected');
        } catch (error) {
            console.error('[MongoDB] Error disconnecting:', error);
        }
    }

    /**
     * Check if connected to MongoDB
     */
    public getIsConnected(): boolean {
        return this.isConnected && mongoose.connection.readyState === 1;
    }
}
