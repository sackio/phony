import 'dotenv/config';
import twilio from 'twilio';

async function main() {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  const callSid = 'CA20cc7af2540de330db9866254d57dc1c';
  const call = await client.calls(callSid).fetch();
  console.log('=== Call ===');
  console.log({
    sid: call.sid,
    from: call.from, to: call.to,
    direction: call.direction,
    status: call.status,
    startTime: call.startTime?.toISOString(),
    endTime: call.endTime?.toISOString(),
    durationSec: call.duration,
    answeredBy: call.answeredBy,
    price: call.price,
  });
  const events = await client.calls(callSid).events.list({ limit: 50 }).catch(() => null);
  console.log('\n=== Events (sample fields) ===');
  if (events) {
    for (const e of events) {
      const r: any = e.request || {};
      const resp: any = e.response || {};
      console.log(`[${(r.timestamp || resp.timestamp || e.timestamp) ?? '-'}] req.method=${r.method} req.url=${r.url?.slice?.(0, 90) ?? '-'} resp.status=${resp.response_code ?? '-'}`);
    }
  } else console.log('(no events accessible)');
  const notes = await client.calls(callSid).notifications.list({ limit: 20 }).catch(() => null);
  console.log('\n=== Notifications ===');
  if (notes && notes.length) {
    for (const n of notes) {
      console.log({ sid: n.sid, errorCode: n.errorCode, msg: n.messageText?.slice(0, 140), date: n.dateCreated?.toISOString() });
    }
  } else console.log('(none)');
}
main().catch(e => { console.error(e); process.exit(1); });
