import mongoose, { Schema, Document } from 'mongoose';

export interface ConversationMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    truncated?: boolean;
    truncatedAt?: number; // audio_end_ms - how much was actually spoken before interruption
}

export interface TwilioEvent {
    type: string;
    timestamp: Date;
    data: any;
}

export interface OpenAIEvent {
    type: string;
    timestamp: Date;
    data: any;
}

export interface ICall extends Document {
    callSid: string;
    fromNumber: string;
    toNumber: string;
    callType: 'inbound' | 'outbound';
    voice: string;
    callContext: string;
    conversationHistory: ConversationMessage[];
    twilioEvents: TwilioEvent[];
    openaiEvents: OpenAIEvent[];
    systemInstructions?: string;
    callInstructions?: string;
    startedAt: Date;
    endedAt?: Date;
    duration?: number; // in seconds
    status: 'initiated' | 'in-progress' | 'completed' | 'failed';
    errorMessage?: string;
}

const ConversationMessageSchema = new Schema({
    role: {
        type: String,
        enum: ['user', 'assistant', 'system'],
        required: true
    },
    content: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    truncated: {
        type: Boolean,
        default: false
    },
    truncatedAt: {
        type: Number,
        required: false
    }
}, { _id: false });

const TwilioEventSchema = new Schema({
    type: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    data: {
        type: Schema.Types.Mixed,
        required: true
    }
}, { _id: false });

const OpenAIEventSchema = new Schema({
    type: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    data: {
        type: Schema.Types.Mixed,
        required: true
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
    twilioEvents: {
        type: [TwilioEventSchema],
        default: []
    },
    openaiEvents: {
        type: [OpenAIEventSchema],
        default: []
    },
    systemInstructions: {
        type: String
    },
    callInstructions: {
        type: String
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
    },
    errorMessage: {
        type: String
    }
}, {
    timestamps: true
});

// Create indexes for common queries
CallSchema.index({ startedAt: -1 });
CallSchema.index({ status: 1, startedAt: -1 });

export const CallModel = mongoose.model<ICall>('Call', CallSchema);
