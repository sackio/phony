import mongoose, { Schema, Document } from 'mongoose';

export enum VoicemailStatus {
    RECORDING = 'recording',
    TRANSCRIBING = 'transcribing',
    COMPLETED = 'completed',
    FAILED = 'failed'
}

export interface IVoicemail extends Document {
    callSid: string; // Twilio call SID
    recordingSid: string; // Twilio recording SID
    fromNumber: string; // Caller's phone number
    toNumber: string; // Called phone number (your Twilio number)
    duration: number; // Recording duration in seconds
    recordingUrl: string; // URL to the recording
    transcription?: string; // Transcribed text
    transcriptionSid?: string; // Twilio transcription SID
    status: VoicemailStatus;
    isRead: boolean; // Whether the voicemail has been read/listened to
    tags: string[];
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
}

const VoicemailSchema = new Schema<IVoicemail>({
    callSid: {
        type: String,
        required: true,
        index: true
    },
    recordingSid: {
        type: String,
        required: true,
        unique: true,
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
    duration: {
        type: Number,
        required: true
    },
    recordingUrl: {
        type: String,
        required: true
    },
    transcription: {
        type: String,
        required: false
    },
    transcriptionSid: {
        type: String,
        required: false
    },
    status: {
        type: String,
        enum: Object.values(VoicemailStatus),
        default: VoicemailStatus.RECORDING,
        index: true
    },
    isRead: {
        type: Boolean,
        default: false,
        index: true
    },
    errorMessage: {
        type: String,
        required: false
    },
    tags: {
        type: [String],
        default: []
    }
}, {
    timestamps: true
});

// Compound indexes for common queries
VoicemailSchema.index({ toNumber: 1, createdAt: -1 });
VoicemailSchema.index({ fromNumber: 1, createdAt: -1 });
VoicemailSchema.index({ isRead: 1, createdAt: -1 });
VoicemailSchema.index({ status: 1, createdAt: -1 });

// Text index for searching transcriptions
VoicemailSchema.index({ transcription: 'text' });
VoicemailSchema.index({ tags: 1 });

export const VoicemailModel = mongoose.model<IVoicemail>('Voicemail', VoicemailSchema);
