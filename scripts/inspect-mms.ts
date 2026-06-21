import 'dotenv/config';
import twilio from 'twilio';

async function main() {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const tok = process.env.TWILIO_AUTH_TOKEN!;
  const client = twilio(sid, tok);

  // One of the per-participant MMS deliveries (the 0101-grp's outbound to Ben)
  const mms = ['MMf45afbad324a449588a3148e350f5bd6','MMe9f8dbdbd6b64646a83abe94598a2755','MMdfa09e73da6a4173b4294be6acf41e4f','MM1e441f81342a47d7a15e888c68fe1a21'];

  for (const m of mms) {
    try {
      const msg = await client.messages(m).fetch();
      console.log({
        sid: msg.sid,
        from: msg.from,
        to: msg.to,
        status: msg.status,
        numMedia: msg.numMedia,
        numSegments: msg.numSegments,
        body: msg.body ? msg.body.slice(0, 80) + (msg.body.length > 80 ? '…' : '') : '(empty)',
        bodyLen: msg.body?.length ?? 0,
        errorCode: msg.errorCode,
      });
      // Fetch media list
      const media = await client.messages(m).media.list();
      console.log('  media:', media.map(x => ({sid: x.sid, contentType: x.contentType})));
    } catch (e: any) {
      console.error(m, 'fetch failed:', e.message);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
