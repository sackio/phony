/**
 * Daily Twilio webhook drift check.
 *
 * Pulls every IncomingPhoneNumber from Twilio and compares its voice/status/sms
 * callbacks against the expected Phony URLs. Exits 0 if all OK, exits 1 if any
 * number has drifted (so the calling routine can react: email, page, ATC post).
 *
 * Designed to run as a scheduled remote agent — output is the formatted report,
 * exit code is the signal. No side effects: this script only reads from Twilio,
 * doesn't auto-correct.
 *
 * Run manually: `npx tsx scripts/check-twilio-webhooks.ts`
 * Suggested cron: `35 9 * * *` (09:35 local, weekdays-only fine too)
 */
import twilio from 'twilio';
import { TwilioWebhookAuditService } from '../src/services/twilio/webhook-audit.service.js';

async function main() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const publicUrl = process.env.PUBLIC_URL;
    if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
    if (!publicUrl) throw new Error('PUBLIC_URL must be set (e.g. https://phony.pushbuild.com)');

    const client = twilio(sid, token);
    const service = new TwilioWebhookAuditService(client, publicUrl);

    const result = await service.audit();
    console.log(TwilioWebhookAuditService.formatReport(result));

    process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
    console.error('[check-twilio-webhooks] failed:', err?.message ?? err);
    process.exit(2);
});
