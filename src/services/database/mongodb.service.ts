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
     * Connect to MongoDB with retry logic for boot race conditions
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

        const maxRetries = 10;
        const baseDelayMs = 2000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await mongoose.connect(mongoUri, {
                    serverSelectionTimeoutMS: 5000,
                    connectTimeoutMS: 5000
                });
                this.isConnected = true;
                console.log('[MongoDB] Connected successfully to:', mongoUri.replace(/\/\/.*@/, '//***@'));
                return;
            } catch (error) {
                const delay = Math.min(baseDelayMs * attempt, 15000);
                if (attempt < maxRetries) {
                    console.warn(`[MongoDB] Connection attempt ${attempt}/${maxRetries} failed, retrying in ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error('[MongoDB] Connection failed after all retries:', error);
                    console.log('[MongoDB] Continuing without database - transcripts will not be saved');
                    // Start background reconnect loop
                    this.startBackgroundReconnect(mongoUri);
                }
            }
        }
    }

    /**
     * Periodically attempt to reconnect to MongoDB in the background
     */
    private startBackgroundReconnect(mongoUri: string): void {
        const intervalMs = 30000;
        console.log(`[MongoDB] Starting background reconnect every ${intervalMs / 1000}s`);
        const interval = setInterval(async () => {
            try {
                await mongoose.connect(mongoUri, {
                    serverSelectionTimeoutMS: 5000,
                    connectTimeoutMS: 5000
                });
                this.isConnected = true;
                console.log('[MongoDB] Background reconnect succeeded:', mongoUri.replace(/\/\/.*@/, '//***@'));
                clearInterval(interval);
            } catch {
                console.warn('[MongoDB] Background reconnect attempt failed, will retry...');
            }
        }, intervalMs);
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
