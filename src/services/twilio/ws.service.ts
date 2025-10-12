import { WebSocket } from 'ws';
import { CallState } from '../../types.js';
import { SHOW_TIMING_MATH } from '../../config/constants.js';

/**
 * Service for handling Twilio WebSocket streams
 */
export class TwilioWsService {
    private readonly webSocket: WebSocket;
    private readonly callState: CallState;

    /**
     * Create a new Twilio stream service
     * @param webSocket The Twilio WebSocket connection
     * @param callState The state of the call
     */
    constructor(webSocket: WebSocket, callState: CallState) {
        this.webSocket = webSocket;
        this.callState = callState;
    }

    /**
     * Close the WebSocket connection
     */
    public close(): void {
        if (this.webSocket.readyState === WebSocket.OPEN) {
            this.webSocket.close();
        }
    }

    /**
     * Send a mark event to Twilio
     */
    public sendMark(): void {
        if (!this.callState.streamSid) {
            return;
        }

        const markEvent = {
            event: 'mark',
            streamSid: this.callState.streamSid,
            mark: { name: 'responsePart' }
        };
        this.webSocket.send(JSON.stringify(markEvent));
        this.callState.markQueue.push('responsePart');

        if (SHOW_TIMING_MATH) {
            console.log(`[Twilio Mark] Sent mark, queue length: ${this.callState.markQueue.length}`);
        }
    }

    /**
     * Send audio data to Twilio
     * @param payload The audio payload to send
     */
    public sendAudio(payload: string): void {
        if (!this.callState.streamSid) {
            return;
        }

        const audioDelta = {
            event: 'media',
            streamSid: this.callState.streamSid,
            media: { payload }
        };
        this.webSocket.send(JSON.stringify(audioDelta));
    }

    /**
     * Clear the Twilio stream
     */
    public clearStream(): void {
        if (!this.callState.streamSid) {
            return;
        }

        this.webSocket.send(JSON.stringify({
            event: 'clear',
            streamSid: this.callState.streamSid
        }));
    }

    /**
     * Set up event handlers for the Twilio WebSocket
     * @param onMessage Callback for handling messages from Twilio
     * @param onClose Callback for when the connection is closed
     */
    public setupEventHandlers(
        onMessage: (message: Buffer | string) => void,
        onClose: () => void
    ): void {
        this.webSocket.on('message', onMessage);
        this.webSocket.on('close', onClose);
    }

    /**
     * Process a Twilio start event
     * @param data The start event data
     */
    public processStartEvent(data: any): void {
        this.callState.streamSid = data.start.streamSid;
        this.callState.responseStartTimestampTwilio = null;
        this.callState.latestMediaTimestamp = 0;
        this.callState.callSid = data.start.callSid;
    }

    /**
     * Process a Twilio mark event
     */
    public processMarkEvent(): void {
        if (this.callState.markQueue.length > 0) {
            this.callState.markQueue.shift();
        }
    }

    /**
     * Process a Twilio media event
     * @param data The media event data
     */
    public processMediaEvent(data: any): void {
        this.callState.latestMediaTimestamp = data.media.timestamp;
        if (SHOW_TIMING_MATH) {
            // console.log(`Received media message with timestamp: ${this.callState.latestMediaTimestamp}ms`);
        }
    }
}
