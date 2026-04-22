import mongoose, { Schema, Document } from 'mongoose';

export interface IContactSlug extends Document {
    phoneNumber: string;   // E.164 phone number
    slug: string;          // Short label like "elio", "joao"
    createdAt: Date;
    updatedAt: Date;
}

const ContactSlugSchema = new Schema<IContactSlug>({
    phoneNumber: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        index: true
    }
}, {
    timestamps: true
});

export const ContactSlugModel = mongoose.model<IContactSlug>('ContactSlug', ContactSlugSchema);
