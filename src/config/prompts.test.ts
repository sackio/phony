import { describe, it, expect } from 'vitest';
import { spokenOpening } from './prompts.js';

/**
 * `first_message` is spoken VERBATIM to whoever answers the phone.
 *
 * ⛔ THE PROPERTY UNDER TEST: this must FAIL CLOSED. When in doubt it returns
 * LESS speech, never more. The previous implementation took everything up to
 * the first blank line, which fails OPEN — instructions written one-per-line
 * with no blank line anywhere come back whole, and the agent recites the
 * caller's entire private brief to the other party.
 *
 * Measured 2026-08-28 on CA318bfde8de…: ~40s of an agent reading "At a menu,
 * choose customer service or tracing", "Goal: HOLD IT AT THE PYLE TERMINAL…"
 * and five numbered asks into a carrier's phone tree, which then dropped the
 * call. Third failed call to that carrier in 48h.
 */

// The exact shape that broke the call: single newlines, no blank line.
const REAL_CASE = [
    "Hi, I'm an assistant calling on behalf of Ben Sack about a shipment coming to him from Southeastern Freight Lines.",
    'At a menu, choose customer service or tracing, or say "representative".',
    'Goal: HOLD IT AT THE PYLE TERMINAL SERVING GROTON MA 01450 FOR CUSTOMER PICKUP - do not deliver to the house.',
    '1. Confirm the hold is ENTERED, not just noted.',
    "Before hanging up get the rep's name and a confirmation number.",
].join('\n');

describe('spokenOpening', () => {
    it('speaks ONLY the first line of a one-direction-per-line block', () => {
        const spoken = spokenOpening(REAL_CASE);

        expect(spoken).toBe(
            "Hi, I'm an assistant calling on behalf of Ben Sack about a shipment coming to him from Southeastern Freight Lines."
        );
        // The blank-line version returned the whole block. These are the words
        // that were actually read aloud to Pyle.
        expect(spoken).not.toContain('Goal:');
        expect(spoken).not.toContain('At a menu');
        expect(spoken).not.toContain("rep's name");
    });

    it('never leaks a later line, however the caller spaces the block', () => {
        // Blank lines, CRLF, ragged indentation — none of it may widen what is
        // spoken. Each of these defeated some earlier heuristic.
        const variants = [
            'Opening sentence.\n\nSecret plan.',
            'Opening sentence.\r\nSecret plan.',
            'Opening sentence.\n   \nSecret plan.',
            'Opening sentence.\n\n\n   Secret plan.',
        ];
        for (const v of variants) {
            expect(spokenOpening(v)).toBe('Opening sentence.');
            expect(spokenOpening(v)).not.toContain('Secret');
        }
    });

    it('returns undefined for empty input so first_message is omitted, not blank', () => {
        // An empty string override would make the agent open with silence,
        // which on an IVR is indistinguishable from a dead line.
        expect(spokenOpening(undefined)).toBeUndefined();
        expect(spokenOpening(null)).toBeUndefined();
        expect(spokenOpening('')).toBeUndefined();
        expect(spokenOpening('   ')).toBeUndefined();
        expect(spokenOpening('\n\nSomething')).toBeUndefined();
    });

    it('passes a single-line instruction through unchanged', () => {
        expect(spokenOpening('Hi, calling about the shipment.'))
            .toBe('Hi, calling about the shipment.');
    });

    it('trims surrounding whitespace on the spoken line', () => {
        expect(spokenOpening('  Hello there.  \nrest')).toBe('Hello there.');
    });
});
