import 'dotenv/config';
import mongoose from 'mongoose';
import { SmsModel } from '../src/models/sms.model.js';
import { GroupConversationModel } from '../src/models/group-conversation.model.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);

  const grp4240 = await GroupConversationModel.findOne({ slug: '4240-grp' }).lean();
  console.log('=== Group 4240-grp ===');
  console.log(JSON.stringify(grp4240, null, 2));
  const convSid = grp4240?.conversationSid;

  console.log('\n=== Last 20 SMS to/from +13015550101 (Ben) today ===');
  const benMsgs = await SmsModel.find({
    $or: [{ fromNumber: '+13015550101' }, { toNumber: '+13015550101' }],
    createdAt: { $gte: new Date('2026-06-19T00:00:00Z') },
  }).sort({ createdAt: -1 }).limit(20).lean();
  for (const m of benMsgs) {
    console.log(`[${m.createdAt?.toISOString()}] dir=${m.direction} from=${m.fromNumber} to=${m.toNumber} conv=${m.conversationId || '-'} sid=${m.messageSid}`);
    console.log(`   body: ${(m.body || '').slice(0,140).replace(/\n/g, ' ')}`);
  }

  console.log('\n=== Messages tagged with conversationId=' + convSid + ' (last 25) ===');
  const groupMsgs = await SmsModel.find({ conversationId: convSid })
    .sort({ createdAt: -1 }).limit(25).lean();
  for (const m of groupMsgs) {
    console.log(`[${m.createdAt?.toISOString()}] dir=${m.direction} from=${m.fromNumber} to=${m.toNumber} sid=${m.messageSid}`);
    console.log(`   body: ${(m.body || '').slice(0,100).replace(/\n/g, ' ')}`);
  }

  const inb = await SmsModel.countDocuments({ conversationId: convSid, direction: 'inbound' });
  const out = await SmsModel.countDocuments({ conversationId: convSid, direction: 'outbound' });
  console.log(`\n=== Count: inbound=${inb} outbound=${out} ===`);

  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
