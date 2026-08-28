import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Hold-audio suppression: mute the agent while it is being read a recording.
 *
 * ⛔ THE PROPERTY UNDER TEST IS THE FAIL DIRECTION. Muting a live human loses
 * the entire call; pitching a recording only wastes money. So every ambiguous
 * case must resolve toward SPEAKING. These tests exist mainly to pin that
 * asymmetry, not the detection itself.
 *
 * Measured 2026-08-28 on an A. Duie Pyle queue: the agent delivered its full
 * request to the hold announcement three times and to the queue-position
 * recording once, including after an injection telling it to stay silent.
 */

vi.mock('../socket.service.js', () => ({
    SocketService: { getInstance: () => ({ emitTranscriptUpdate: vi.fn() }) },
}));
vi.mock('../call-state.service.js', () => ({
    CallStateService: { getInstance: () => ({ addTranscript: vi.fn(), getCall: () => undefined }) },
}));
vi.mock('../call-event-push.service.js', () => ({
    CallEventPushService: {
        getInstance: () => ({
            recordLine: vi.fn(), record: vi.fn(), emitNow: vi.fn(), note: vi.fn(),
        }),
    },
}));

const { ElevenLabsEventService } = await import('./event.service.js');

const ANNOUNCEMENT =
    'Thank you for calling A. Duie Pyle. Your call will be answered by the first available representative.';
// Same recording, transcribed differently on a second pass — the real case.
const ANNOUNCEMENT_ASR_VARIANT =
    'Thank you for calling A2E Pile. Your call will be answered by the first available representative.';

function build() {
    const sent: string[] = [];
    const callState: any = {
        callSid: 'CAtest',
        responseStartTimestampTwilio: null,
        latestMediaTimestamp: 0,
        addToConversation: vi.fn(),
        conversationHistory: [],
    };
    const svc = new (ElevenLabsEventService as any)(
        callState,
        async () => {},
        (p: string) => sent.push(p),
        () => {},
        () => {},
    );
    return { svc, sent };
}

describe('hold-audio suppression', () => {
    let svc: any, sent: string[];
    beforeEach(() => { ({ svc, sent } = build()); });

    it('speaks normally when nothing has repeated', () => {
        svc.handleUserTranscript(ANNOUNCEMENT, true);
        svc.handleAudio('audio-1');
        expect(sent).toEqual(['audio-1']);
    });

    it('MUTES on a near-verbatim repeat, even with different ASR wording', () => {
        svc.handleUserTranscript(ANNOUNCEMENT, true);
        svc.handleAudio('first-reply');
        svc.handleUserTranscript(ANNOUNCEMENT_ASR_VARIANT, true);
        svc.handleAudio('second-reply');

        // The first pitch gets out — we cannot know it is a recording yet.
        // The second must not.
        expect(sent).toEqual(['first-reply']);
    });

    it('UNMUTES the moment a genuinely new utterance arrives', () => {
        svc.handleUserTranscript(ANNOUNCEMENT, true);
        svc.handleUserTranscript(ANNOUNCEMENT_ASR_VARIANT, true);
        svc.handleAudio('suppressed');
        expect(sent).toEqual([]);

        // A human finally picks up.
        svc.handleUserTranscript('Hi there, this is Michael, how can I help you today?', true);
        svc.handleAudio('to-the-human');

        expect(sent).toEqual(['to-the-human']);
    });

    it('never mutes on short conversational replies, however often they recur', () => {
        // "Okay" / "No" / "Thank you" repeat constantly in real dialogue.
        for (const line of ['Okay.', 'No.', 'Okay.', 'Thank you.', 'No.', 'Okay.']) {
            svc.handleUserTranscript(line, true);
        }
        svc.handleAudio('still-talking');
        expect(sent).toEqual(['still-talking']);
    });

    it('does not let a short interjection unmute an active hold', () => {
        // A queue interleaves "Your position in queue is one." with the loop.
        // Treating that as fresh human speech would unmute onto the recording.
        svc.handleUserTranscript(ANNOUNCEMENT, true);
        svc.handleUserTranscript(ANNOUNCEMENT_ASR_VARIANT, true);
        svc.handleUserTranscript('Position one.', true);
        svc.handleAudio('should-stay-muted');

        expect(sent).toEqual([]);
    });

    it('ignores partial transcripts entirely', () => {
        svc.handleUserTranscript(ANNOUNCEMENT, true);
        svc.handleUserTranscript(ANNOUNCEMENT, false); // partial repeat
        svc.handleAudio('not-suppressed-by-a-partial');
        expect(sent).toEqual(['not-suppressed-by-a-partial']);
    });

    it('does not mark a suppressed turn as a response that started', () => {
        svc.handleUserTranscript(ANNOUNCEMENT, true);
        svc.handleUserTranscript(ANNOUNCEMENT_ASR_VARIANT, true);
        svc.handleAudio('suppressed');
        // Timestamp bookkeeping drives interruption handling; a muted turn
        // must not look like audio the caller actually heard.
        expect(svc.callState.responseStartTimestampTwilio).toBeNull();
    });
});
