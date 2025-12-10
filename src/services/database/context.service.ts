import { ContextModel, IContext } from '../../models/context.model.js';
import { MongoDBService } from './mongodb.service.js';

/**
 * Service for managing call contexts (reusable templates)
 */
export class ContextService {
    private mongoService: MongoDBService;

    constructor() {
        this.mongoService = MongoDBService.getInstance();
    }

    /**
     * Create a new context
     */
    public async createContext(data: {
        name: string;
        description?: string;
        systemInstructions: string;
        exampleCallInstructions: string;
        contextType: 'incoming' | 'outgoing' | 'both';
    }): Promise<IContext> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const context = await ContextModel.create({
                name: data.name,
                description: data.description || '',
                systemInstructions: data.systemInstructions,
                exampleCallInstructions: data.exampleCallInstructions,
                contextType: data.contextType
            });
            console.log(`[Context] Created context: ${data.name}`);
            return context;
        } catch (error) {
            console.error(`[Context] Error creating context:`, error);
            throw error;
        }
    }

    /**
     * Get all contexts, optionally filtered by type
     */
    public async getAllContexts(contextType?: 'incoming' | 'outgoing' | 'both'): Promise<IContext[]> {
        if (!this.mongoService.getIsConnected()) {
            return [];
        }

        try {
            const query: any = {};
            if (contextType) {
                // Return contexts that match the type or are marked as 'both'
                query.$or = [
                    { contextType: contextType },
                    { contextType: 'both' }
                ];
            }
            return await ContextModel.find(query).sort({ createdAt: -1 });
        } catch (error) {
            console.error(`[Context] Error retrieving contexts:`, error);
            return [];
        }
    }

    /**
     * Get context by ID
     */
    public async getContextById(id: string): Promise<IContext | null> {
        if (!this.mongoService.getIsConnected()) {
            return null;
        }

        try {
            return await ContextModel.findById(id);
        } catch (error) {
            console.error(`[Context] Error retrieving context:`, error);
            return null;
        }
    }

    /**
     * Update a context
     */
    public async updateContext(
        id: string,
        updates: {
            name?: string;
            description?: string;
            systemInstructions?: string;
            exampleCallInstructions?: string;
            contextType?: 'incoming' | 'outgoing' | 'both';
        }
    ): Promise<IContext | null> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const context = await ContextModel.findByIdAndUpdate(
                id,
                { $set: updates },
                { new: true }
            );
            console.log(`[Context] Updated context: ${id}`);
            return context;
        } catch (error) {
            console.error(`[Context] Error updating context:`, error);
            throw error;
        }
    }

    /**
     * Delete a context
     */
    public async deleteContext(id: string): Promise<boolean> {
        if (!this.mongoService.getIsConnected()) {
            throw new Error('MongoDB not connected');
        }

        try {
            const result = await ContextModel.deleteOne({ _id: id });
            console.log(`[Context] Deleted context: ${id}`);
            return result.deletedCount > 0;
        } catch (error) {
            console.error(`[Context] Error deleting context:`, error);
            throw error;
        }
    }
}
