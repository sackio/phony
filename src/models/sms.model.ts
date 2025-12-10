import mongoose, { Schema, Document } from 'mongoose';
import { SmsDirection, SmsStatus } from '../types.js';

export interface ISms extends Document {
    messageSid: string;
    conversationId?: string; // Links message to a conversation (for group threading)
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
    createdAt: Date;
    updatedAt: Date;
}

const SmsSchema = new Schema<ISms>({
    messageSid: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    conversationId: {
        type: String,
        required: false,
        index: true
    },
    fromNumber: {
        type: String,
        required: true,
        index: true
    },
    toNumber: {
        type: String,
        required: true,
        index: true
    },
    direction: {
        type: String,
        enum: Object.values(SmsDirection),
        required: true,
        index: true
    },
    body: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: Object.values(SmsStatus),
        default: SmsStatus.QUEUED,
        index: true
    },
    twilioStatus: {
        type: String
    },
    errorMessage: {
        type: String
    },
    errorCode: {
        type: String
    },
    numMedia: {
        type: Number,
        default: 0
    },
    mediaUrls: {
        type: [String],
        default: []
    }
}, {
    timestamps: true
});

// Create compound indexes for common queries
SmsSchema.index({ fromNumber: 1, toNumber: 1, createdAt: -1 });
SmsSchema.index({ toNumber: 1, fromNumber: 1, createdAt: -1 });
SmsSchema.index({ direction: 1, createdAt: -1 });
SmsSchema.index({ status: 1, createdAt: -1 });
SmsSchema.index({ createdAt: -1 });

export const SmsModel = mongoose.model<ISms>('Sms', SmsSchema);
