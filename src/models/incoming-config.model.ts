import mongoose, { Schema, Document } from 'mongoose';

export interface IIncomingConfig extends Document {
    phoneNumber: string;
    name: string;
    systemInstructions: string;
    callInstructions: string; // Optional call-specific context (usually empty for incoming)
    voiceProvider: 'openai' | 'elevenlabs';
    voice: string;
    elevenLabsAgentId?: string; // ElevenLabs agent ID (uses default if not specified)
    elevenLabsVoiceId?: string; // ElevenLabs voice ID
    enabled: boolean;
    messageOnly: boolean; // If true, just play hangupMessage and hang up (no AI conversation)
    hangupMessage?: string; // Message to play when messageOnly is true
    // Voicemail settings
    voicemailEnabled: boolean; // If true, record voicemail instead of AI conversation
    voicemailGreeting?: string; // Custom greeting message (TTS text)
    voicemailMaxLength: number; // Max recording length in seconds (default 120)
    createdAt: Date;
    updatedAt: Date;
}

const IncomingConfigSchema: Schema = new Schema(
    {
        phoneNumber: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        name: {
            type: String,
            required: true
        },
        systemInstructions: {
            type: String,
            required: false, // Not required when messageOnly is true
            default: ''
        },
        callInstructions: {
            type: String,
            default: '' // Usually empty for incoming calls
        },
        voiceProvider: {
            type: String,
            enum: ['openai', 'elevenlabs'],
            default: 'openai'
        },
        voice: {
            type: String,
            default: 'sage'
        },
        elevenLabsAgentId: {
            type: String
        },
        elevenLabsVoiceId: {
            type: String
        },
        enabled: {
            type: Boolean,
            default: true
        },
        messageOnly: {
            type: Boolean,
            default: false
        },
        hangupMessage: {
            type: String,
            required: false
        },
        voicemailEnabled: {
            type: Boolean,
            default: false
        },
        voicemailGreeting: {
            type: String,
            required: false
        },
        voicemailMaxLength: {
            type: Number,
            default: 120 // 2 minutes default
        }
    },
    {
        timestamps: true
    }
);

export const IncomingConfigModel = mongoose.model<IIncomingConfig>('IncomingConfig', IncomingConfigSchema);
