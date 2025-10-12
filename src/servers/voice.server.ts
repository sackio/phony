import dotenv from 'dotenv';
import express, { Response } from 'express';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import ExpressWs from 'express-ws';
import { WebSocket } from 'ws';
import { CallType } from '../types.js';
import { DYNAMIC_API_SECRET } from '../config/constants.js';
import { CallSessionManager } from '../handlers/openai.handler.js';
dotenv.config();

export class VoiceServer {
    private app: express.Application & { ws: any };
    private port: number;
    private sessionManager: CallSessionManager;
    private callbackUrl: string;

    constructor(callbackUrl: string, sessionManager: CallSessionManager) {
        this.callbackUrl = callbackUrl;
        this.port = parseInt(process.env.PORT || '3004');
        this.app = ExpressWs(express()).app;
        this.sessionManager = sessionManager;
        this.configureMiddleware();
        this.setupRoutes();
    }

    private configureMiddleware(): void {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: false }));
    }

    private setupRoutes(): void {
        this.app.post('/call/outgoing', this.handleOutgoingCall.bind(this));
        this.app.ws('/call/connection-outgoing/:secret', this.handleOutgoingConnection.bind(this));
    }

    private async handleOutgoingCall(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] Incoming POST /call/outgoing');
        console.log('[Voice Server] Query params:', req.query);
        console.log('[Voice Server] Body:', req.body);

        const apiSecret = req.query.apiSecret?.toString();
        console.log('[Voice Server] API Secret comparison:', {
            received: apiSecret,
            expected: DYNAMIC_API_SECRET,
            match: apiSecret === DYNAMIC_API_SECRET
        });

        if (req.query.apiSecret?.toString() !== DYNAMIC_API_SECRET) {
            console.log('[Voice Server] 401: Unauthorized - Invalid or missing API secret');
            res.status(401).json({ error: 'Unauthorized: Invalid or missing API secret' });
            return;
        }

        const fromNumber = req.body.From;
        const toNumber = req.body.To;
        const callContext = req.query.callContext?.toString();
        const voice = req.query.voice?.toString() || 'sage';

        console.log('[Voice Server] Creating call with voice:', voice);

        const twiml = new VoiceResponse();
        const connect = twiml.connect();

        const stream = connect.stream({
            url: `${this.callbackUrl.replace('https://', 'wss://')}/call/connection-outgoing/${apiSecret}`,
        });

        stream.parameter({ name: 'fromNumber', value: fromNumber });
        stream.parameter({ name: 'toNumber', value: toNumber });
        stream.parameter({ name: 'callContext', value: callContext });
        stream.parameter({ name: 'voice', value: voice });

        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
    }

    private handleOutgoingConnection(ws: WebSocket, req: express.Request): void {
        console.log('[Voice Server] Incoming WebSocket connection /call/connection-outgoing/:secret');
        console.log('[Voice Server] Secret check:', {
            received: req.params.secret,
            expected: DYNAMIC_API_SECRET,
            match: req.params.secret === DYNAMIC_API_SECRET
        });

        if (req.params.secret !== DYNAMIC_API_SECRET) {
            console.log('[Voice Server] Closing WebSocket: Unauthorized');
            ws.close(1008, 'Unauthorized: Invalid or missing API secret');
            return;
        }

        console.log('[Voice Server] Creating session for outbound call');
        this.sessionManager.createSession(ws, CallType.OUTBOUND);
    }

    public start(): void {
        this.app.listen(this.port);
    }
}
