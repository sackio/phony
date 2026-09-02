import { WebSocket } from 'ws';
import { GOODBYE_PHRASES, FAR_END_GOODBYE_MAX_CHARS } from '../config/constants.js';

export const checkForGoodbye = (text: string): boolean => {
    const lowercaseText = text.toLowerCase();
    return GOODBYE_PHRASES.some(phrase => lowercaseText.includes(phrase));
};

/**
 * Goodbye check for the FAR END. Deliberately much stricter than
 * `checkForGoodbye`, which is a bare substring match.
 *
 * ⛔ A substring match on far-end speech hangs up on working calls. IVR hold
 * loops routinely contain our goodbye phrases mid-announcement — Citi's says
 * "please hang up now and call the number on your credit card", which matched
 * 'hang up now'. Measured 2026-09-01: three consecutive calls were terminated
 * ~2s after entering the representative queue, i.e. exactly when they were
 * about to succeed. `ended_via` reads `local-teardown`, so from the outside it
 * looks like the far end dropped us rather than us dropping them.
 *
 * Two guards, both required:
 *   - the utterance must be SHORT. Someone ringing off says a few words; a hold
 *     announcement runs for hundreds of characters.
 *   - the phrase must END the utterance, not merely appear inside it.
 *     "if you'd like to end the call, press 9" is an instruction, not a farewell.
 */
export const isFarEndGoodbye = (text: string): boolean => {
    const trimmed = (text || '').trim().toLowerCase();
    if (!trimmed || trimmed.length > FAR_END_GOODBYE_MAX_CHARS) return false;
    const stripped = trimmed.replace(/[\s.!?,;:'"]+$/, '');
    return GOODBYE_PHRASES.some(phrase => stripped.endsWith(phrase));
};

export const endCall = (ws: WebSocket, openAiWs: WebSocket): void => {
    setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
        if (openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.close();
        }
    }, 5000);
};
