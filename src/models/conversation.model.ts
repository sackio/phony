import mongoose, { Document, Schema } from 'mongoose';

export type ConversationType = '1-to-1' | 'group';

export interface IConversation extends Document {
    conversationId: string; // Unique identifier
    type: ConversationType; // '1-to-1' or 'group'
    participants: string[]; // Array of phone numbers (E.164 format)
    name?: string; // Optional name for group conversations
    createdBy: string; // Phone number of creator
    createdAt: Date;
    updatedAt: Date;
    lastMessageAt?: Date; // Timestamp of most recent message
    messageCount: number; // Total messages in conversation
}

const ConversationSchema = new Schema<IConversation>({
    conversationId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    type: {
        type: String,
        enum: ['1-to-1', 'group'],
        required: true
    },
    participants: {
        type: [String],
        required: true,
        validate: {
            validator: function(participants: string[]) {
                // Must have at least 2 participants
                return participants.length >= 2;
            },
            message: 'Conversation must have at least 2 participants'
        }
    },
    name: {
        type: String,
        required: false
    },
    createdBy: {
        type: String,
        required: true
    },
    lastMessageAt: {
        type: Date,
        required: false
    },
    messageCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Compound index for finding conversations by participants
// Sort participants array to ensure consistent ordering
ConversationSchema.index({ participants: 1 });

// Index for sorting by most recent activity
ConversationSchema.index({ lastMessageAt: -1 });

// Helper method to generate conversation ID from participants
ConversationSchema.statics.generateConversationId = function(participants: string[]): string {
    // Sort participants to ensure consistent ID regardless of order
    const sorted = [...participants].sort();
    // For 1-to-1, use simple format
    if (sorted.length === 2) {
        return `conv_${sorted[0]}_${sorted[1]}`.replace(/\+/g, '');
    }
    // For groups, use hash
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update(sorted.join(':')).digest('hex');
    return `conv_group_${hash}`;
};

// Helper method to find conversation by participants
ConversationSchema.statics.findByParticipants = async function(participants: string[]) {
    const sorted = [...participants].sort();

    // For 1-to-1, exact match
    if (sorted.length === 2) {
        return await this.findOne({
            type: '1-to-1',
            participants: { $all: sorted, $size: 2 }
        });
    }

    // For groups, find conversation containing all these participants
    return await this.findOne({
        type: 'group',
        participants: { $all: sorted, $size: sorted.length }
    });
};

export const ConversationModel = mongoose.model<IConversation>('Conversation', ConversationSchema);
