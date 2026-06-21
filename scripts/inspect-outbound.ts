import 'dotenv/config';
import twilio from 'twilio';

async function main() {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const tok = process.env.TWILIO_AUTH_TOKEN!;
  const client = twilio(sid, tok);

  // Look at ALL outbound from +18575550111 in a 5-min window around the send
  const after = new Date('2026-06-20T14:40:00Z');
  const before = new Date('2026-06-20T14:50:00Z');
  const msgs = await client.messages.list({
    from: '+18575550111',
    dateSentAfter: after,
    dateSentBefore: before,
    limit: 50,
  });
  console.log('=== Outbound from Phony 14:40-14:50 UTC ===');
  for (const m of msgs.sort((a, b) => (a.dateSent?.getTime() ?? 0) - (b.dateSent?.getTime() ?? 0))) {
    console.log({
      sid: m.sid,
      sent: m.dateSent?.toISOString(),
      from: m.from,
      to: m.to,
      status: m.status,
      numMedia: m.numMedia,
      bodyLen: m.body?.length ?? 0,
      bodyPreview: m.body ? m.body.slice(0, 80) : '',
    });
  }
  console.log('total:', msgs.length);
}
main().catch(e => { console.error(e); process.exit(1); });
