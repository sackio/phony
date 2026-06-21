import 'dotenv/config';
import mongoose from 'mongoose';
import { SmsModel } from '../src/models/sms.model.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const rows = await SmsModel.find({
    fromNumber: '+18575550111',
    toNumber: '+19785550105',
    createdAt: { $gte: new Date('2026-06-19T00:00:00Z') },
  }).sort({ createdAt: 1 }).lean();
  console.log('=== Outbound from Phony to David (4240) today ===');
  for (const m of rows) {
    console.log(`[${m.createdAt?.toISOString()}] sid=${m.messageSid} conv=${m.conversationId || '-'} dir=${m.direction}`);
    console.log('   body:', (m.body || '').slice(0,140).replace(/\n/g,' '));
  }
  console.log('rows:', rows.length);
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
