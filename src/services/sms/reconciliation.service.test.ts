import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The Conversations reconciliation pass — the safety net under group MMS.
 *
 * ⛔ THE PROPERTY UNDER TEST: coverage must not be decided by
 * `Conversation.dateUpdated`. Measured 2026-08-28, Twilio does NOT bump that
 * field when a message is added — CHc240213de36a48fc… reported dateUpdated
 * 2026-07-29T21:21:47Z while holding an inbound message from 2026-08-28T13:15Z.
 * The old code filtered the conversation list on it, which passed ZERO of 71
 * conversations and made this pass examine nothing at all from 2026-07-30
 * onward, while still logging "no missed messages".
 *
 * That is the standing phony failure shape: a pass that could not look,
 * reporting the same thing as a pass that looked and found nothing. The test
 * below is written to fail loudly against that version.
 */

const CONV = 'CHtest0000000000000000000000000001';
const RECENT_MSG = 'IMrecent00000000000000000000000001';

// A conversation whose parent resource has been untouched for a month, holding
// a message from five minutes ago. This is the real, measured shape.
const STALE_DATE_UPDATED = new Date('2026-07-29T21:21:47Z');
const now = new Date('2026-08-28T14:00:00Z');
const messageDate = new Date(now.getTime() - 5 * 60 * 1000);
const lookbackStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

const findOne = vi.fn();
vi.mock('../../models/sms.model.js', () => ({
    SmsModel: { findOne: (...a: any[]) => findOne(...a) },
}));
vi.mock('../../models/group-conversation.model.js', () => ({
    GroupConversationModel: { findOne: vi.fn(), updateOne: vi.fn(), deleteOne: vi.fn() },
}));
vi.mock('twilio', () => ({ default: vi.fn(() => ({})) }));
vi.mock('../twilio/sms.service.js', () => ({ TwilioSmsService: vi.fn(() => ({})) }));
vi.mock('../twilio/conversations.service.js', () => ({ TwilioConversationsService: vi.fn(() => ({})) }));
vi.mock('../temp-media.service.js', () => ({ TempMediaService: vi.fn(() => ({})) }));
vi.mock('../database/mongodb.service.js', () => ({
    MongoDBService: { getInstance: vi.fn(() => ({ getIsConnected: () => true })) },
}));

const { SmsReconciliationService } = await import('./reconciliation.service.js');

/**
 * Build a service with its Twilio client and downstream pipeline stubbed.
 * `processInboundGroupMessage` reports true, as it does for a message it has
 * not seen before.
 */
function buildService(conversations: Array<{ sid: string; dateUpdated: Date | null }>) {
    const svc: any = new (SmsReconciliationService as any)({});
    const processed: string[] = [];

    svc.twilioClient = {
        conversations: {
            v1: {
                conversations: Object.assign(
                    (sid: string) => ({
                        messages: {
                            list: async () => [
                                { sid: RECENT_MSG, author: '+15551230000', body: 'hello', dateCreated: messageDate },
                            ],
                        },
                    }),
                    { list: async () => conversations },
                ),
            },
        },
    };
    svc.fetchConversationMessageMedia = async () => [];
    svc.twilioSmsService = {
        processInboundGroupMessage: async (_c: string, sid: string) => {
            processed.push(sid);
            return true;
        },
    };
    return { svc, processed };
}

describe('reconcileConversations coverage', () => {
    beforeEach(() => {
        findOne.mockReset();
        // Nothing is stored yet, so a found message counts as missed.
        findOne.mockReturnValue({ lean: async () => null });
    });

    it('reconciles a conversation whose dateUpdated is STALE but whose message is recent', async () => {
        const { svc, processed } = buildService([{ sid: CONV, dateUpdated: STALE_DATE_UPDATED }]);

        const result = await svc.reconcileConversations(lookbackStart);

        // Against the dateUpdated-filtered version these are all 0: the
        // conversation never entered the loop.
        expect(result.checked).toBe(1);
        expect(result.reconciled).toBe(1);
        expect(processed).toEqual([RECENT_MSG]);
    });

    it('examines conversations regardless of the order the API returns them in', async () => {
        // Measured: conversations.list() is not sorted by dateUpdated — the
        // real page ran 07-29, 06-03, 04-20 … and ended on 08-13. Any logic
        // that stops early on an "old" entry silently drops the tail.
        const { svc, processed } = buildService([
            { sid: 'CHa', dateUpdated: new Date('2026-07-29T21:21:47Z') },
            { sid: 'CHb', dateUpdated: new Date('2026-04-20T16:42:52Z') },
            { sid: 'CHc', dateUpdated: new Date('2026-08-13T14:39:14Z') },
        ]);

        const result = await svc.reconcileConversations(lookbackStart);

        expect(result.checked).toBe(3);
        expect(processed).toHaveLength(3);
    });

    it('still bounds work by message date, not conversation date', async () => {
        const { svc } = buildService([{ sid: CONV, dateUpdated: null }]);
        // Window starts after the message was created.
        const result = await svc.reconcileConversations(new Date(now.getTime() - 60 * 1000));

        expect(result.checked).toBe(0);
        expect(result.reconciled).toBe(0);
    });

    it('does not replay a message that is already stored', async () => {
        findOne.mockReturnValue({ lean: async () => ({ messageSid: RECENT_MSG }) });
        const { svc, processed } = buildService([{ sid: CONV, dateUpdated: STALE_DATE_UPDATED }]);

        const result = await svc.reconcileConversations(lookbackStart);

        expect(result.checked).toBe(1);   // it was examined
        expect(result.reconciled).toBe(0); // and correctly left alone
        expect(processed).toEqual([]);
    });

    it('reports a listing failure as a failure, never as a clean pass', async () => {
        const { svc } = buildService([]);
        svc.twilioClient.conversations.v1.conversations.list = async () => {
            throw new Error('network');
        };

        const result = await svc.reconcileConversations(lookbackStart);

        expect(result.failures).toBe(1);
        expect(result.reconciled).toBe(0);
    });
});
