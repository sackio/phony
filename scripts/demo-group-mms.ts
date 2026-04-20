#!/usr/bin/env -S npx tsx
/**
 * Standalone demo of true Twilio Group MMS via Conversations API.
 *
 * Usage:
 *   npx tsx scripts/demo-group-mms.ts create
 *   npx tsx scripts/demo-group-mms.ts send <conversationSid> "<message>"
 *   npx tsx scripts/demo-group-mms.ts inspect <conversationSid>
 *   npx tsx scripts/demo-group-mms.ts cleanup <conversationSid>
 *
 * Participants:
 *   - Phony (identity + projectedAddress = TWILIO_NUMBER)
 *   - Ben   (messagingBinding.address = +13015550101)
 *   - Demo  (messagingBinding.address = +19175550106)
 *
 * For 3+ participants with the projected-address pattern, Twilio will send
 * outbound as native group MMS (single thread on iPhone/Android) rather than
 * fanning out 1:1.
 */

import dotenv from 'dotenv';
import twilio from 'twilio';

dotenv.config();

const TWILIO_NUMBER = process.env.TWILIO_NUMBER!;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

if (!TWILIO_NUMBER || !ACCOUNT_SID || !AUTH_TOKEN) {
    console.error('Missing TWILIO_NUMBER / TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN in env');
    process.exit(1);
}

const BEN = '+13015550101';
const DEMO = '+19175550106';
const SYSTEM_IDENTITY = 'phony';

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function createConversation(): Promise<void> {
    const friendlyName = `Group MMS Demo ${new Date().toISOString()}`;

    console.log(`\n[1/4] Creating Conversation: "${friendlyName}"`);
    const conv = await client.conversations.v1.conversations.create({ friendlyName });
    console.log(`      → SID: ${conv.sid}`);

    console.log(`\n[2/4] Adding system participant (projectedAddress = ${TWILIO_NUMBER})`);
    const sys = await client.conversations.v1
        .conversations(conv.sid)
        .participants.create({
            identity: SYSTEM_IDENTITY,
            'messagingBinding.projectedAddress': TWILIO_NUMBER,
        });
    console.log(`      → Participant SID: ${sys.sid}`);

    for (const [label, number] of [['Ben', BEN], ['Demo', DEMO]] as const) {
        console.log(`\n[3/4] Adding ${label} (messagingBinding.address = ${number})`);
        const p = await client.conversations.v1
            .conversations(conv.sid)
            .participants.create({
                'messagingBinding.address': number,
            });
        console.log(`      → Participant SID: ${p.sid}`);
    }

    console.log(`\n[4/4] Sending opening message as "${SYSTEM_IDENTITY}"`);
    const msg = await client.conversations.v1
        .conversations(conv.sid)
        .messages.create({
            author: SYSTEM_IDENTITY,
            body: 'True group MMS demo from Phony. Reply here — both phones should see each other.',
        });
    console.log(`      → Message SID: ${msg.sid}`);

    console.log(`\n✅ Done. Conversation: ${conv.sid}`);
    console.log(`   Inspect:  npx tsx scripts/demo-group-mms.ts inspect ${conv.sid}`);
    console.log(`   Send:     npx tsx scripts/demo-group-mms.ts send ${conv.sid} "hello"`);
    console.log(`   Cleanup:  npx tsx scripts/demo-group-mms.ts cleanup ${conv.sid}`);
}

async function sendMessage(conversationSid: string, body: string): Promise<void> {
    const msg = await client.conversations.v1
        .conversations(conversationSid)
        .messages.create({ author: SYSTEM_IDENTITY, body });
    console.log(`✅ Sent ${msg.sid}: "${body}"`);
}

async function inspect(conversationSid: string): Promise<void> {
    const conv = await client.conversations.v1.conversations(conversationSid).fetch();
    console.log(`\nConversation ${conv.sid}`);
    console.log(`  FriendlyName: ${conv.friendlyName}`);
    console.log(`  State:        ${conv.state}`);
    console.log(`  DateCreated:  ${conv.dateCreated}`);

    const participants = await client.conversations.v1
        .conversations(conversationSid)
        .participants.list();
    console.log(`\nParticipants (${participants.length}):`);
    for (const p of participants) {
        console.log(`  ${p.sid}`);
        console.log(`    identity:   ${p.identity ?? '(none)'}`);
        console.log(`    binding:    ${JSON.stringify(p.messagingBinding)}`);
    }

    const messages = await client.conversations.v1
        .conversations(conversationSid)
        .messages.list({ limit: 20 });
    console.log(`\nMessages (${messages.length}):`);
    for (const m of messages) {
        console.log(`  [${m.dateCreated.toISOString()}] ${m.author}: ${m.body?.slice(0, 80) ?? '(no body)'}`);
        if (m.delivery) {
            console.log(`    delivery: ${JSON.stringify(m.delivery)}`);
        }
    }
}

async function cleanup(conversationSid: string): Promise<void> {
    await client.conversations.v1.conversations(conversationSid).remove();
    console.log(`✅ Deleted conversation ${conversationSid}`);
}

const [cmd, ...args] = process.argv.slice(2);

(async () => {
    switch (cmd) {
        case 'create':
            await createConversation();
            break;
        case 'send':
            if (args.length < 2) throw new Error('Usage: send <conversationSid> <message>');
            await sendMessage(args[0], args.slice(1).join(' '));
            break;
        case 'inspect':
            if (args.length < 1) throw new Error('Usage: inspect <conversationSid>');
            await inspect(args[0]);
            break;
        case 'cleanup':
            if (args.length < 1) throw new Error('Usage: cleanup <conversationSid>');
            await cleanup(args[0]);
            break;
        default:
            console.error('Usage: demo-group-mms.ts <create|send|inspect|cleanup> [args...]');
            process.exit(1);
    }
})().catch(err => {
    console.error('\n❌ ERROR:', err.message);
    if (err.code) console.error('   Twilio code:', err.code);
    if (err.moreInfo) console.error('   More info:', err.moreInfo);
    if (err.status) console.error('   HTTP status:', err.status);
    process.exit(1);
});
