import twilio from 'twilio';

/**
 * Audits the Twilio IncomingPhoneNumbers configuration against the URLs we
 * expect Phony to be serving. Catches silent webhook hijacks like the one
 * caused by importing a Twilio number into the ElevenLabs dashboard
 * (June 5, 2026 — rewrote voiceUrl to api.us.elevenlabs.io/twilio/inbound_call,
 * silently intercepted 4 days of inbound calls before the drift was noticed).
 *
 * Run periodically (daily cron) and at process startup. Reports any number
 * whose configured URLs don't match what Phony serves.
 */

export interface ExpectedConfig {
    voiceUrl: string;
    statusCallback: string;
    smsUrl: string;
}

export interface NumberAudit {
    phoneNumber: string;
    friendlyName: string;
    sid: string;
    drift: Array<{ field: 'voiceUrl' | 'statusCallback' | 'smsUrl'; expected: string; actual: string }>;
}

export interface AuditResult {
    expected: ExpectedConfig;
    audited: NumberAudit[];          // every number we looked at
    drifted: NumberAudit[];          // subset with at least one drift entry
    ok: boolean;                     // drifted.length === 0
}

export class TwilioWebhookAuditService {
    private readonly twilioClient: twilio.Twilio;
    private readonly publicUrl: string;

    constructor(twilioClient: twilio.Twilio, publicUrl: string) {
        this.twilioClient = twilioClient;
        this.publicUrl = publicUrl.replace(/\/$/, '');
    }

    public expectedConfig(): ExpectedConfig {
        return {
            voiceUrl: `${this.publicUrl}/call/incoming`,
            statusCallback: `${this.publicUrl}/call/status`,
            smsUrl: `${this.publicUrl}/sms/incoming`,
        };
    }

    public async audit(): Promise<AuditResult> {
        const expected = this.expectedConfig();
        const numbers = await this.twilioClient.incomingPhoneNumbers.list({ limit: 50 });

        const audited: NumberAudit[] = numbers.map((n) => {
            const drift: NumberAudit['drift'] = [];

            // Lenient matching: an empty URL on a given channel is treated as
            // "intentional — number doesn't use that channel". A NON-empty URL
            // that points anywhere other than the expected Phony endpoint is
            // drift. This catches the ElevenLabs hijack pattern (URL rewritten
            // to api.us.elevenlabs.io) without false-positiving on retired
            // secondary numbers with no callbacks set.
            if (n.voiceUrl && n.voiceUrl !== expected.voiceUrl) {
                drift.push({ field: 'voiceUrl', expected: expected.voiceUrl, actual: n.voiceUrl });
            }
            if (n.statusCallback && n.statusCallback !== expected.statusCallback) {
                drift.push({ field: 'statusCallback', expected: expected.statusCallback, actual: n.statusCallback });
            }
            if (n.smsUrl && n.smsUrl !== expected.smsUrl) {
                drift.push({ field: 'smsUrl', expected: expected.smsUrl, actual: n.smsUrl });
            }

            return {
                phoneNumber: n.phoneNumber,
                friendlyName: n.friendlyName,
                sid: n.sid,
                drift,
            };
        });

        const drifted = audited.filter((a) => a.drift.length > 0);
        return { expected, audited, drifted, ok: drifted.length === 0 };
    }

    /**
     * Format an audit result for logs or ATC posting.
     * Concise enough for stdout, detailed enough for a human to act on.
     */
    public static formatReport(result: AuditResult): string {
        const lines: string[] = [];
        lines.push(`Twilio webhook audit — ${result.audited.length} number(s) checked.`);
        lines.push(`  Expected voice  → ${result.expected.voiceUrl}`);
        lines.push(`  Expected status → ${result.expected.statusCallback}`);
        lines.push(`  Expected sms    → ${result.expected.smsUrl}`);

        if (result.ok) {
            lines.push(`✓ All ${result.audited.length} numbers configured correctly.`);
            return lines.join('\n');
        }

        lines.push(`⚠️  DRIFT on ${result.drifted.length} number(s):`);
        for (const n of result.drifted) {
            lines.push(`\n  ${n.phoneNumber} (${n.friendlyName} — ${n.sid})`);
            for (const d of n.drift) {
                lines.push(`    ${d.field}:`);
                lines.push(`      expected: ${d.expected}`);
                lines.push(`      actual:   ${d.actual}`);
            }
        }
        return lines.join('\n');
    }
}
