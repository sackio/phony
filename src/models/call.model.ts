import mongoose, { Schema, Document } from 'mongoose';

export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export interface ICall extends Document {
    callSid: string;
    fromNumber: string;
    toNumber: string;
    callType: 'inbound' | 'outbound';
    voice: string;
    callContext: string;
    conversationHistory: ConversationMessage[];
    startedAt: Date;
    endedAt?: Date;
    duration?: number; // in seconds
    status: 'initiated' | 'in-progress' | 'completed' | 'failed';
}

const ConversationMessageSchema = new Schema({
    role: {
        type: String,
        enum: ['user', 'assistant'],
        required: true
    },
    content: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const CallSchema = new Schema<ICall>({
    callSid: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    fromNumber: {
        type: String,
        required: true
    },
    toNumber: {
        type: String,
        required: true
    },
    callType: {
        type: String,
        enum: ['inbound', 'outbound'],
        required: true
    },
    voice: {
        type: String,
        default: 'sage'
    },
    callContext: {
        type: String,
        default: ''
    },
    conversationHistory: {
        type: [ConversationMessageSchema],
        default: []
    },
    startedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    endedAt: {
        type: Date
    },
    duration: {
        type: Number
    },
    status: {
        type: String,
        enum: ['initiated', 'in-progress', 'completed', 'failed'],
        default: 'initiated',
        index: true
    }
}, {
    timestamps: true
});

// Create indexes for common queries
CallSchema.index({ startedAt: -1 });
CallSchema.index({ status: 1, startedAt: -1 });

export const CallModel = mongoose.model<ICall>('Call', CallSchema);
