import mongoose, { Schema, Document } from 'mongoose';

/**
 * Smart-router thread state. When a proxy target (Ben/Laura) texts a phony
 * number without a slug/code/label reply format, phony fires sms.needs_routing
 * and the phony Claude session picks a target agent session, DMs it, and
 * relays the reply back as SMS. To make follow-up messages stick with the
 * same agent (implicit sub-thread), state per (fromNumber, twilioNumber) is
 * persisted here with a TTL. The router flips targetSession when the human
 * names a different agent or the topic shifts.
 */
export interface ISmartRouteThread extends Document {
    /** Human sender (E.164), the proxy target — usually +13015550101 or +13015550102. */
    fromNumber: string;
    /** Phony Twilio number the human texted. */
    twilioNumber: string;
    /** ATC session id being routed to (e.g. "hvac", "house", "assistant"). */
    targetSession: string;
    /** Optional summary of what the current thread is about (used to detect topic shift). */
    topic?: string;
    /** Optional history of recent (short) messages so the router can reason about drift. */
    recentMessages?: Array<{ ts: Date; body: string }>;
    /** When this thread expires. Mongo TTL index sweeps it away. */
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const SmartRouteThreadSchema = new Schema<ISmartRouteThread>({
    fromNumber: { type: String, required: true, index: true },
    twilioNumber: { type: String, required: true },
    targetSession: { type: String, required: true, index: true },
    topic: { type: String },
    recentMessages: [{
        ts: { type: Date, default: Date.now },
        body: { type: String },
    }],
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

SmartRouteThreadSchema.index({ fromNumber: 1, twilioNumber: 1 }, { unique: true });

export const SmartRouteThreadModel = mongoose.model<ISmartRouteThread>('SmartRouteThread', SmartRouteThreadSchema);
