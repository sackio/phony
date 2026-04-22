import mongoose, { Schema, Document } from 'mongoose';

/**
 * Persistent record for a Twilio group-MMS Conversation that Phony proxies
 * to SMS_PROXY_TARGET_NUMBERS (Ben, Laura).
 *
 * - `conversationSid` is the Twilio CH… SID.
 * - `slug` is how Ben/Laura address the group in replies (`{slug}: msg`).
 * - `externalParticipants` is the known E.164 list of non-Phony members,
 *   maintained best-effort from onConversationAdded / onParticipantAdded.
 * - `twilioNumber` is the projected address Phony uses inside this group.
 */
export interface IGroupConversation extends Document {
    conversationSid: string;
    slug: string;
    twilioNumber: string;
    externalParticipants: string[];
    friendlyName?: string;
    lastActivityAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const GroupConversationSchema = new Schema<IGroupConversation>({
    conversationSid: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    twilioNumber: { type: String, required: true, index: true },
    externalParticipants: { type: [String], default: [] },
    friendlyName: { type: String },
    lastActivityAt: { type: Date },
}, { timestamps: true });

export const GroupConversationModel =
    mongoose.model<IGroupConversation>('GroupConversation', GroupConversationSchema);
