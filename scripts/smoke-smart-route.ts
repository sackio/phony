import 'dotenv/config';
import mongoose from 'mongoose';
import { SmartRouteThreadModel } from '../src/models/smart-route-thread.model.js';

async function main() {
    const uri = process.env.MONGODB_URI || 'mongodb://voicecalls_admin:password@127.0.0.1:27018/phony?authSource=admin';
    await mongoose.connect(uri);

    const from = '+13015550101';
    const to = '+18575550111';

    // Upsert
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const set1 = await SmartRouteThreadModel.findOneAndUpdate(
        { fromNumber: from, twilioNumber: to },
        { fromNumber: from, twilioNumber: to, targetSession: 'hvac', topic: 'furnace question', expiresAt, recentMessages: [{ ts: new Date(), body: 'smoke test body' }] },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    console.log('SET →', { targetSession: set1?.targetSession, expiresAt: set1?.expiresAt, topic: set1?.topic });

    // Get
    const got = await SmartRouteThreadModel.findOne({ fromNumber: from, twilioNumber: to }).lean();
    console.log('GET →', { targetSession: got?.targetSession, topic: got?.topic, msgs: got?.recentMessages?.length });

    // Update target
    const set2 = await SmartRouteThreadModel.findOneAndUpdate(
        { fromNumber: from, twilioNumber: to },
        { targetSession: 'house', topic: 'window install schedule', $push: { recentMessages: { ts: new Date(), body: 'second smoke message' } } },
        { new: true }
    ).lean();
    console.log('REASSIGN →', { targetSession: set2?.targetSession, topic: set2?.topic, msgs: set2?.recentMessages?.length });

    // List
    const list = await SmartRouteThreadModel.find({}).lean();
    console.log(`LIST → ${list.length} thread(s)`);

    // Clear
    const del = await SmartRouteThreadModel.deleteMany({ fromNumber: from });
    console.log('CLEAR →', del.deletedCount, 'deleted');

    await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
