import 'dotenv/config';
import mongoose from 'mongoose';
import { SmsModel } from '../src/models/sms.model.js';
import { CallModel } from '../src/models/call.model.js';
import { GroupConversationModel } from '../src/models/group-conversation.model.js';
import { WebhookConfigModel } from '../src/models/webhook-config.model.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);

  const smsCount = await SmsModel.countDocuments();
  const callCount = await CallModel.countDocuments();
  const groupConvCount = await GroupConversationModel.countDocuments();
  const whCount = await WebhookConfigModel.countDocuments();

  console.log('=== Post-merge counts ===');
  console.log(`sms:              ${smsCount}  (baseline 2025, expected ~2067)`);
  console.log(`calls:            ${callCount}  (baseline 62, expected 62)`);
  console.log(`groupConv:        ${groupConvCount}  (expected +1 vs unknown baseline)`);
  console.log(`webhookConfig:    ${whCount}  (baseline 16)`);

  // Junk/integrity scan: empty body + no messageSid is the "merge inserted empty docs" failure mode.
  const emptyMessageSid = await SmsModel.countDocuments({
    $or: [{ messageSid: null }, { messageSid: '' }, { messageSid: { $exists: false } }],
  });
  const emptyBody = await SmsModel.countDocuments({
    $or: [{ body: '' }, { body: null }],
    numMedia: { $in: [0, null, undefined] },
  });
  console.log(`\n=== Integrity scan ===`);
  console.log(`SMS w/ null/empty messageSid: ${emptyMessageSid}  (must be 0)`);
  console.log(`SMS w/ empty body AND no media: ${emptyBody}  (legit reaction stickers etc — informational)`);

  // The 42 outage SMS: anything created between blackout start (06-22 ~11:12 UTC) and now
  console.log(`\n=== Outage-window SMS (created 2026-06-22T11:12Z → now) ===`);
  const outageSms = await SmsModel.find({
    createdAt: { $gte: new Date('2026-06-22T11:12:31Z') },
  }).sort({ createdAt: 1 }).lean();
  console.log(`count: ${outageSms.length}  (expected ~42)`);
  let badSid = 0, badBody = 0;
  for (const m of outageSms) {
    if (!m.messageSid || !(m.messageSid.startsWith('SM') || m.messageSid.startsWith('IM') || m.messageSid.startsWith('MM'))) badSid++;
    if (!m.body && !(m.numMedia ?? 0)) badBody++;
  }
  console.log(`  with non-Twilio-style messageSid: ${badSid}  (must be 0)`);
  console.log(`  with empty body + no media:       ${badBody}  (informational)`);

  // Sample first + last few
  console.log(`\nFirst 3 outage-window SMS:`);
  for (const m of outageSms.slice(0, 3)) {
    console.log(`  [${m.createdAt?.toISOString()}] dir=${m.direction} from=${m.fromNumber} to=${m.toNumber} sid=${m.messageSid}`);
    console.log(`     body: "${(m.body || '').slice(0, 80).replace(/\n/g, ' ')}" media=${m.numMedia ?? 0}`);
  }
  console.log(`\nLast 3 outage-window SMS:`);
  for (const m of outageSms.slice(-3)) {
    console.log(`  [${m.createdAt?.toISOString()}] dir=${m.direction} from=${m.fromNumber} to=${m.toNumber} sid=${m.messageSid}`);
    console.log(`     body: "${(m.body || '').slice(0, 80).replace(/\n/g, ' ')}" media=${m.numMedia ?? 0}`);
  }

  // messageSid uniqueness on the whole collection — if merge introduced any dupe, the unique index would have rejected,
  // but verify nothing slipped through (defensive)
  const dupSids = await SmsModel.aggregate([
    { $group: { _id: '$messageSid', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $limit: 5 },
  ]);
  console.log(`\nDuplicate messageSids: ${dupSids.length}  (must be 0)`);
  if (dupSids.length) for (const d of dupSids) console.log(`  ${d._id}: ${d.n}x`);

  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
