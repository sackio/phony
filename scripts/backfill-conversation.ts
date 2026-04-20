#!/usr/bin/env -S npx tsx
/**
 * Backfill a Twilio Conversation into Phony's DB.
 *
 *   1. Register the group in GroupConversationModel (allocates slug, caches externals).
 *   2. Retag existing 1-on-1 SmsModel rows between the Twilio number and any
 *      Conversation participant with conversationId = CH…, so they thread.
 *   3. Pull any Conversation-native messages (from Twilio) that aren't in
 *      SmsModel and save them with conversationId set. skipNotify=true — no
 *      proxy SMS storm.
 *
 * Usage: npx tsx scripts/backfill-conversation.ts <ConversationSid> [--since YYYY-MM-DD]
 */

import dotenv from 'dotenv';
import twilio from 'twilio';
import { MongoDBService } from '../src/services/database/mongodb.service.js';
import { SmsReconciliationService } from '../src/services/sms/reconciliation.service.js';
import { TwilioConversationsService } from '../src/services/twilio/conversations.service.js';
import { TwilioSmsService } from '../src/services/twilio/sms.service.js';

dotenv.config();

const args = process.argv.slice(2);
const conversationSid = args[0];
const sinceIdx = args.indexOf('--since');
const since = sinceIdx >= 0 ? new Date(args[sinceIdx + 1]) : undefined;

if (!conversationSid || !conversationSid.startsWith('CH')) {
    console.error('Usage: backfill-conversation.ts <ConversationSid> [--since YYYY-MM-DD]');
    process.exit(1);
}

(async () => {
    const mongo = MongoDBService.getInstance();
    await mongo.connect();

    const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
    const convs = new TwilioConversationsService(client);
    const sms = new TwilioSmsService(client, convs);
    const recon = SmsReconciliationService.getInstance();

    console.log(`\n[1/3] Registering group ${conversationSid}...`);
    const externals = await convs.getExternalAddresses(conversationSid);
    const twilioNumber = process.env.TWILIO_NUMBER!;
    const { slug } = await sms.registerGroup(conversationSid, twilioNumber, externals);
    console.log(`      slug: {${slug}} · externals: ${externals.join(', ')}`);

    console.log(`\n[2/3] Retagging historical 1-on-1 SMS${since ? ` since ${since.toISOString()}` : ''}...`);
    const retag = await recon.retagHistoricalSmsForConversation(conversationSid, { since });
    console.log(`      matched=${retag.matched}, modified=${retag.modified}`);

    console.log(`\n[3/3] Replaying Conversation-native messages (skipNotify)...`);
    const replay = await recon.backfillConversation(conversationSid);
    console.log(`      checked=${replay.checked}, reconciled=${replay.reconciled}`);

    console.log(`\n✅ Done. Group {${slug}} is fully in Phony's DB.`);
    await mongo.disconnect();
    process.exit(0);
})().catch(err => {
    console.error('\n❌ ERROR:', err);
    process.exit(1);
});
