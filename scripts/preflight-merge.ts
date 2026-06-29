import 'dotenv/config';
import mongoose from 'mongoose';
import { SmsModel } from '../src/models/sms.model.js';
import { CallModel } from '../src/models/call.model.js';
import { WebhookConfigModel } from '../src/models/webhook-config.model.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const smsCount = await SmsModel.countDocuments();
  const callCount = await CallModel.countDocuments();
  const whCount = await WebhookConfigModel.countDocuments();
  const latestSms = await SmsModel.find().sort({ createdAt: -1 }).limit(1).lean();
  const latestCall = await CallModel.find().sort({ createdAt: -1 }).limit(1).lean();
  console.log('=== server4 phony DB baseline (pre-merge) ===');
  console.log(`sms:           ${smsCount}`);
  console.log(`calls:         ${callCount}`);
  console.log(`webhookconfig: ${whCount}`);
  console.log(`latest SMS:    ${latestSms[0]?.createdAt?.toISOString()} sid=${latestSms[0]?.messageSid}`);
  console.log(`latest Call:   ${latestCall[0]?.createdAt?.toISOString()} sid=${(latestCall[0] as any)?.callSid}`);
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
