import 'dotenv/config';
import twilio from 'twilio';

async function main() {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const tok = process.env.TWILIO_AUTH_TOKEN!;
  const client = twilio(sid, tok);

  const convSid = 'CH21945a80e14b454ebfd984d624f601f1'; // 0101-grp
  const primarySid = 'IMfa5a3187f5784a5693bd672ed4b2f83c';

  // Pull the 6 most recent conversation messages — we expect:
  //   primary (body), media#1, media#2 from the split
  //   then separately IM36a9bdf723774c47a701477a8cd8dfbf (manual retry from house)
  const msgs = await client.conversations.v1.conversations(convSid)
    .messages.list({ order: 'desc', limit: 10 });

  console.log('=== Last 10 Conversation Messages ===');
  for (const m of msgs) {
    const media = (m as any).media as Array<{ sid: string; content_type: string; size: number }> | null;
    console.log({
      sid: m.sid,
      dateCreated: m.dateCreated,
      author: m.author,
      bodyLen: m.body?.length ?? 0,
      bodyPreview: m.body ? m.body.slice(0, 60) : '',
      media: media?.map(x => ({ sid: x.sid, size: x.size })) ?? [],
      delivery: m.delivery,
    });
  }

  // For each of the recent messages around the primary, pull delivery receipts
  console.log('\n=== Delivery receipts for primary + siblings ===');
  const recentBetween = msgs.filter(m => {
    if (!m.dateCreated) return false;
    const t = m.dateCreated.getTime();
    const primaryTime = new Date('2026-06-20T14:47:22Z').getTime();
    return Math.abs(t - primaryTime) < 60_000;
  });
  for (const m of recentBetween) {
    const receipts = await client.conversations.v1.conversations(convSid)
      .messages(m.sid).deliveryReceipts.list({ limit: 50 });
    console.log(`\n--- ${m.sid} (created ${m.dateCreated?.toISOString()}) ---`);
    for (const r of receipts) {
      console.log({
        channelMessageSid: r.channelMessageSid,
        participantSid: r.participantSid,
        status: r.status,
        errorCode: r.errorCode,
      });
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
