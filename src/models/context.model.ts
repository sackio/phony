import mongoose, { Schema, Document } from 'mongoose';

export interface IContext extends Document {
    name: string;
    description?: string;
    systemInstructions: string;
    exampleCallInstructions?: string; // Optional example of call-specific instructions
    contextType: 'incoming' | 'outgoing' | 'both';
    createdAt: Date;
    updatedAt: Date;
}

const ContextSchema: Schema = new Schema(
    {
        name: {
            type: String,
            required: true,
            index: true
        },
        description: {
            type: String,
            default: ''
        },
        systemInstructions: {
            type: String,
            required: true
        },
        exampleCallInstructions: {
            type: String,
            default: ''
        },
        contextType: {
            type: String,
            enum: ['incoming', 'outgoing', 'both'],
            default: 'both',
            index: true
        }
    },
    {
        timestamps: true
    }
);

export const ContextModel = mongoose.model<IContext>('Context', ContextSchema);
