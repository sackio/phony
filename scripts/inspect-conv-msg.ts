import 'dotenv/config';
import twilio from 'twilio';

async function main() {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const tok = process.env.TWILIO_AUTH_TOKEN!;
  const client = twilio(sid, tok);

  const convSid = 'CH21945a80e14b454ebfd984d624f601f1'; // 0101-grp per house's earlier reproducer
  const msgSid = 'IMc18acfa3943f4bc7ae4af381af916a75';

  // 1) Fetch the Conversations Message
  console.log('=== Conversations Message ===');
  try {
    const m = await client.conversations.v1.conversations(convSid).messages(msgSid).fetch();
    console.log({
      sid: m.sid,
      author: m.author,
      body: m.body,
      dateCreated: m.dateCreated,
      dateUpdated: m.dateUpdated,
      delivery: m.delivery,
      media: m.media,
      attributes: m.attributes,
      participantSid: m.participantSid,
    });
  } catch (e: any) {
    console.error('fetch failed:', e.message);
  }

  // 2) Fetch delivery receipts
  console.log('\n=== Delivery receipts ===');
  try {
    const receipts = await client.conversations.v1.conversations(convSid)
      .messages(msgSid).deliveryReceipts.list({ limit: 50 });
    for (const r of receipts) {
      console.log({
        sid: r.sid,
        channelMessageSid: r.channelMessageSid,
        participantSid: r.participantSid,
        status: r.status,
        errorCode: r.errorCode,
        dateCreated: r.dateCreated,
      });
    }
  } catch (e: any) {
    console.error('delivery receipts failed:', e.message);
  }

  // 3) Look at the underlying SMS messages (if delivery receipts referenced channelMessageSid SMxxx)
  // We'll print them below if found.

  // 4) Participants on this conv
  console.log('\n=== Participants ===');
  try {
    const ps = await client.conversations.v1.conversations(convSid).participants.list({ limit: 20 });
    for (const p of ps) {
      console.log({
        sid: p.sid,
        identity: p.identity,
        messagingBinding: p.messagingBinding,
      });
    }
  } catch (e: any) {
    console.error('participants failed:', e.message);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
