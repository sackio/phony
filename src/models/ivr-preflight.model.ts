import mongoose, { Schema, Document } from 'mongoose';

/**
 * Per-target-number dtmfPreflight registry. Looks up a known-good Twilio
 * sendDigits string for a phone number that's been probed before. Auto-applied
 * by phony_create_call when no explicit dtmfPreflight is passed.
 *
 * Use case: barge-in-disabled IVRs (e.g. Petco 603-555-0108) where the agent
 * can't fire DTMF in time. We probe the IVR once, map menu timing, synthesize
 * a precise preflight that lands a digit in the accept window, and cache it
 * here so future calls to that number "just work".
 */

export interface IIvrPreflight extends Document {
    /** E.164 phone number this entry applies to. */
    phoneNumber: string;
    /** Twilio sendDigits string (e.g. "wwww...0w0w0"). */
    preflight: string;
    /** Optional rationale / how this preflight was derived. Free text. */
    notes?: string;
    /** Which callSid this was synthesized from (probe call). null if hand-set. */
    derivedFrom?: string;
    /** When this entry was last regenerated. */
    derivedAt?: Date;
    /** Versioning: increments whenever the entry is regenerated. */
    generation: number;
    /** Optional structured map of the IVR (digit -> announcement timestamp). */
    menuMap?: Array<{ digit: string; label: string; announcedAt?: number }>;
    /** Soft-disable flag so a stale entry can be deactivated without delete. */
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const IvrPreflightSchema = new Schema<IIvrPreflight>({
    phoneNumber: { type: String, required: true, unique: true, index: true },
    preflight: { type: String, required: true },
    notes: { type: String },
    derivedFrom: { type: String },
    derivedAt: { type: Date },
    generation: { type: Number, default: 1 },
    menuMap: [{
        digit: String,
        label: String,
        announcedAt: Number,
    }],
    enabled: { type: Boolean, default: true, index: true },
}, { timestamps: true });

export const IvrPreflightModel = mongoose.model<IIvrPreflight>('IvrPreflight', IvrPreflightSchema);
