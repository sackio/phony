import { describe, it, expect } from 'vitest';
import { isFarEndGoodbye, checkForGoodbye } from './call-utils.js';

/**
 * Far-end goodbye detection.
 *
 * ⛔ The property under test is that we do NOT hang up on a call that is
 * working. Goodbye detection on far-end speech was a bare substring match, so
 * any IVR announcement containing one of our phrases terminated the call ~2s
 * later. Citi's hold loop says "please hang up now and call the number on your
 * credit card" — matching 'hang up now' — which meant we killed the call at the
 * precise moment it reached the representative queue.
 *
 * Measured 2026-09-01: three consecutive calls died there, all reporting
 * ended_via=local-teardown. That is the standing pattern here — our own
 * destructive action wearing the appearance of the far end dropping us.
 *
 * These tests therefore lead with the false positives, not the happy path.
 */

const CITI_HOLD = 'Please hold for the next available representative. We\'re sorry to keep you ' +
    'waiting. Your estimated wait time is less than five minutes. Please continue to hold and we ' +
    'will be with you as soon as the next associate is available. If you\'re calling about your ' +
    'Citibank credit card, please hang up now and call the number on your credit card or ' +
    '800-950-5114 for assistance. For TTY, we accept 711 or other relay services.';

describe('isFarEndGoodbye — false positives that ended real calls', () => {
    it('⛔ does NOT fire on the hold announcement that killed three calls', () => {
        expect(isFarEndGoodbye(CITI_HOLD)).toBe(false);
    });

    it('⛔ the old substring check DOES fire on it — proving this is the regression', () => {
        // Positive control. Without this, a broken isFarEndGoodbye that always
        // returns false would pass the test above and look correct.
        expect(checkForGoodbye(CITI_HOLD)).toBe(true);
    });

    it('⛔ does not fire on menu instructions that merely mention ending a call', () => {
        expect(isFarEndGoodbye('If you would like to end the call, press 9.')).toBe(false);
        expect(isFarEndGoodbye('To hear these options again say repeat, or hang up now to exit.')).toBe(false);
    });

    it('⛔ does not fire on a long sign-off buried in further instructions', () => {
        expect(isFarEndGoodbye(
            'Have a nice day, and remember you can reach us at any time on the website for more help.'
        )).toBe(false);
    });
});

describe('isFarEndGoodbye — genuine farewells still end the call', () => {
    it('fires on a short farewell', () => {
        expect(isFarEndGoodbye('Goodbye')).toBe(true);
        expect(isFarEndGoodbye('Okay, take care')).toBe(true);
        expect(isFarEndGoodbye('Thanks, have a nice day!')).toBe(true);
    });

    it('tolerates trailing punctuation and whitespace', () => {
        expect(isFarEndGoodbye('  goodbye.  ')).toBe(true);
        expect(isFarEndGoodbye('Bye now!!')).toBe(true);
        expect(isFarEndGoodbye('have a good day...')).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isFarEndGoodbye('GOODBYE')).toBe(true);
    });

    it('requires the phrase at the END, not merely present', () => {
        expect(isFarEndGoodbye('goodbye for now, let me transfer you')).toBe(false);
    });

    it('handles empty and missing input without firing', () => {
        expect(isFarEndGoodbye('')).toBe(false);
        expect(isFarEndGoodbye('   ')).toBe(false);
        expect(isFarEndGoodbye(undefined as any)).toBe(false);
    });
});
