import mongoose, { Schema, Document } from 'mongoose';

export interface IIncomingConfig extends Document {
    phoneNumber: string;
    name: string;
    systemInstructions: string;
    callInstructions: string; // Optional call-specific context (usually empty for incoming)
    voice: string;
    enabled: boolean;
    messageOnly: boolean; // If true, just play hangupMessage and hang up (no AI conversation)
    hangupMessage?: string; // Message to play when messageOnly is true
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
        voice: {
            type: String,
            default: 'sage'
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
        }
    },
    {
        timestamps: true
    }
);

export const IncomingConfigModel = mongoose.model<IIncomingConfig>('IncomingConfig', IncomingConfigSchema);
