import 'dotenv/config';
import mongoose from 'mongoose';
import { WebhookConfigModel } from '../src/models/webhook-config.model.js';

const HVAC_WEBHOOKS = [
  'hvac-groups',
  'hvac-1on1s',
  'hvac-wide-sweep-2026-06-08',
  'hvac-mon-sweep-2026-06-08',
  'hvac-cold-outreach',
  'hvac-andrew-0657-grp',
];

const NEW_EVENT = 'sms.proxy_routed';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI!);
  for (const name of HVAC_WEBHOOKS) {
    const cfg = await WebhookConfigModel.findOne({ name }).lean();
    if (!cfg) { console.log(`MISSING: ${name}`); continue; }
    const existing: string[] = cfg.eventTypes || [];
    if (existing.includes(NEW_EVENT)) { console.log(`SKIP (already): ${name} — events=${existing.join(',')}`); continue; }
    const next = [...existing, NEW_EVENT];
    await WebhookConfigModel.updateOne({ name }, { $set: { eventTypes: next } });
    console.log(`UPDATED: ${name} — events=${next.join(',')}`);
  }
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
