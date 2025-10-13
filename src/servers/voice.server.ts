import dotenv from 'dotenv';
import express, { Response } from 'express';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import ExpressWs from 'express-ws';
import { WebSocket } from 'ws';
import path from 'path';
import twilio from 'twilio';
import { Server as HTTPServer } from 'http';
import { CallType } from '../types.js';
import { DYNAMIC_API_SECRET } from '../config/constants.js';
import { CallSessionManager } from '../handlers/openai.handler.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { SocketService } from '../services/socket.service.js';
import { CallStateService } from '../services/call-state.service.js';
dotenv.config();

export class VoiceServer {
    private app: express.Application & { ws: any };
    private port: number;
    private sessionManager: CallSessionManager;
    private callbackUrl: string;
    private twilioCallService: TwilioCallService;
    private httpServer: HTTPServer | null = null;
    private socketService: SocketService;
    private callStateService: CallStateService;

    constructor(callbackUrl: string, sessionManager: CallSessionManager) {
        this.callbackUrl = callbackUrl;
        this.port = parseInt(process.env.PORT || '3004');
        this.app = ExpressWs(express()).app;
        this.sessionManager = sessionManager;

        // Initialize Twilio service
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        this.twilioCallService = new TwilioCallService(twilioClient);

        // Initialize Socket.IO and CallState services
        this.socketService = SocketService.getInstance();
        this.callStateService = CallStateService.getInstance();

        this.configureMiddleware();
        this.setupRoutes();
    }

    private configureMiddleware(): void {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: false }));

        // Serve frontend static files
        const frontendPath = path.join(process.cwd(), 'frontend/dist');
        console.log('[Voice Server] Serving frontend from:', frontendPath);
        this.app.use(express.static(frontendPath));
    }

    private setupRoutes(): void {
        // API routes
        this.app.get('/api/calls', this.handleListCalls.bind(this));
        this.app.post('/api/calls/create', this.handleCreateCall.bind(this));
        this.app.get('/api/calls/:callSid', this.handleGetCall.bind(this));
        this.app.post('/api/calls/:callSid/hold', this.handleHoldCall.bind(this));
        this.app.post('/api/calls/:callSid/resume', this.handleResumeCall.bind(this));
        this.app.post('/api/calls/:callSid/hangup', this.handleHangupCall.bind(this));
        this.app.post('/api/calls/:callSid/inject-context', this.handleInjectContext.bind(this));

        this.app.post('/call/outgoing', this.handleOutgoingCall.bind(this));
        this.app.ws('/call/connection-outgoing/:secret', this.handleOutgoingConnection.bind(this));

        // Serve frontend for all other routes (SPA fallback)
        this.app.get('*', (req, res) => {
            const frontendPath = path.join(process.cwd(), 'frontend/dist/index.html');
            res.sendFile(frontendPath);
        });
    }

    private async handleCreateCall(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] Incoming POST /api/calls/create');
        console.log('[Voice Server] Query params:', req.query);
        console.log('[Voice Server] Body:', req.body);

        // Verify API secret
        const apiSecret = req.query.apiSecret?.toString();
        if (apiSecret !== DYNAMIC_API_SECRET) {
            console.log('[Voice Server] 401: Unauthorized - Invalid or missing API secret');
            res.status(401).json({ error: 'Unauthorized: Invalid or missing API secret' });
            return;
        }

        const toNumber = req.body.To;
        const callContext = req.query.callContext?.toString() || '';
        const voice = req.query.voice?.toString() || 'sage';

        if (!toNumber) {
            res.status(400).json({ error: 'Missing required field: To' });
            return;
        }

        try {
            console.log('[Voice Server] Creating call to:', toNumber, 'with voice:', voice);
            const twilioCallSid = await this.twilioCallService.makeCall(this.callbackUrl, toNumber, callContext, voice);

            // Store call state (will be created in MongoDB when websocket connects)
            this.callStateService.addCall(twilioCallSid, {
                callSid: twilioCallSid,
                twilioCallSid: twilioCallSid,
                toNumber: toNumber,
                fromNumber: process.env.TWILIO_NUMBER || '',
                status: 'initiated',
                startedAt: new Date(),
                conversationHistory: []
            });

            console.log('[Voice Server] Call created successfully. SID:', twilioCallSid);
            res.status(200).json({
                callSid: twilioCallSid,
                status: 'initiated',
                message: 'Call created successfully'
            });
        } catch (error) {
            console.error('[Voice Server] Error creating call:', error);
            res.status(500).json({
                error: 'Failed to create call',
                details: error instanceof Error ? error.message : String(error)
            });
        }
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

    private async handleListCalls(req: express.Request, res: Response): Promise<void> {
        try {
            // Get calls from MongoDB
            const CallModel = (await import('../models/call.model.js')).CallModel;
            const calls = await CallModel.find()
                .sort({ startedAt: -1 })
                .limit(100)
                .lean();

            res.json(calls);
        } catch (error) {
            console.error('[Voice Server] Error listing calls:', error);
            res.status(500).json({ error: 'Failed to list calls' });
        }
    }

    private async handleGetCall(req: express.Request, res: Response): Promise<void> {
        const { callSid } = req.params;

        // First try to get from active call state
        let call = this.callStateService.getCall(callSid);

        // If not active, try MongoDB
        if (!call) {
            try {
                const CallModel = (await import('../models/call.model.js')).CallModel;
                const dbCall = await CallModel.findOne({ callSid }).lean();
                if (dbCall) {
                    call = dbCall as any;
                }
            } catch (error) {
                console.error('[Voice Server] Error fetching call from DB:', error);
            }
        }

        if (!call) {
            res.status(404).json({ error: 'Call not found' });
            return;
        }

        res.json(call);
    }

    private async handleHoldCall(req: express.Request, res: Response): Promise<void> {
        try {
            const { callSid } = req.params;
            const call = this.callStateService.getCall(callSid);

            if (!call || !call.twilioCallSid) {
                res.status(404).json({ error: 'Call not found' });
                return;
            }

            // Update status BEFORE updating Twilio to prevent race condition
            this.callStateService.updateCallStatus(callSid, 'on_hold');
            this.socketService.emitCallStatusChanged(callSid, 'on_hold');

            // Emit hold marker in transcript
            const holdMarker = {
                speaker: 'system' as const,
                text: '⏸ Call placed on hold by operator',
                timestamp: new Date(),
                isPartial: false,
                isInterruption: false
            };
            this.socketService.emitTranscriptUpdate(callSid, holdMarker);

            // Add to conversation history
            this.callStateService.addTranscript(callSid, {
                role: 'system',
                content: holdMarker.text,
                timestamp: holdMarker.timestamp
            });

            // Update Twilio call to play hold music
            await this.twilioCallService.getTwilioClient()
                .calls(call.twilioCallSid)
                .update({
                    twiml: '<Response><Say voice="alice">Sorry, one moment please.</Say><Play loop="10">http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3</Play></Response>'
                });

            res.json({ status: 'on_hold', message: 'Call placed on hold' });
        } catch (error) {
            console.error('[Voice Server] Error holding call:', error);
            res.status(500).json({ error: 'Failed to hold call' });
        }
    }

    private async handleResumeCall(req: express.Request, res: Response): Promise<void> {
        try {
            const { callSid } = req.params;
            const call = this.callStateService.getCall(callSid);

            if (!call || !call.twilioCallSid) {
                res.status(404).json({ error: 'Call not found' });
                return;
            }

            // Update status BEFORE resuming to prevent race condition
            this.callStateService.updateCallStatus(callSid, 'active');
            this.socketService.emitCallStatusChanged(callSid, 'active');

            // Emit resume marker in transcript
            const resumeMarker = {
                speaker: 'system' as const,
                text: '▶️ Call resumed by operator',
                timestamp: new Date(),
                isPartial: false,
                isInterruption: false
            };
            this.socketService.emitTranscriptUpdate(callSid, resumeMarker);

            // Add to conversation history
            this.callStateService.addTranscript(callSid, {
                role: 'system',
                content: resumeMarker.text,
                timestamp: resumeMarker.timestamp
            });

            // Resume the call - redirect back to the media stream
            const apiSecret = DYNAMIC_API_SECRET;
            await this.twilioCallService.getTwilioClient()
                .calls(call.twilioCallSid)
                .update({
                    url: `${this.callbackUrl}/call/outgoing?apiSecret=${apiSecret}`,
                    method: 'POST'
                });

            res.json({ status: 'active', message: 'Call resumed' });
        } catch (error) {
            console.error('[Voice Server] Error resuming call:', error);
            res.status(500).json({ error: 'Failed to resume call' });
        }
    }

    private async handleHangupCall(req: express.Request, res: Response): Promise<void> {
        try {
            const { callSid } = req.params;
            const call = this.callStateService.getCall(callSid);

            if (!call || !call.twilioCallSid) {
                res.status(404).json({ error: 'Call not found' });
                return;
            }

            // Hangup the Twilio call
            await this.twilioCallService.getTwilioClient()
                .calls(call.twilioCallSid)
                .update({ status: 'completed' });

            this.callStateService.updateCallStatus(callSid, 'completed');
            this.socketService.emitCallStatusChanged(callSid, 'completed');
            this.callStateService.removeCall(callSid);

            res.json({ status: 'completed', message: 'Call ended' });
        } catch (error) {
            console.error('[Voice Server] Error hanging up call:', error);
            res.status(500).json({ error: 'Failed to hangup call' });
        }
    }

    private async handleInjectContext(req: express.Request, res: Response): Promise<void> {
        try {
            const { callSid } = req.params;
            const { context } = req.body;

            if (!context) {
                res.status(400).json({ error: 'Missing required field: context' });
                return;
            }

            const call = this.callStateService.getCall(callSid);

            if (!call) {
                res.status(404).json({ error: 'Call not found' });
                return;
            }

            console.log('[Voice Server] Injecting context into call:', callSid);

            // Emit transcript marker showing operator injection
            const contextMarker = {
                speaker: 'system' as const,
                text: `💬 Operator note: ${context}`,
                timestamp: new Date(),
                isPartial: false,
                isInterruption: false
            };
            this.socketService.emitTranscriptUpdate(callSid, contextMarker);

            // Add to conversation history
            this.callStateService.addTranscript(callSid, {
                role: 'system',
                content: contextMarker.text,
                timestamp: contextMarker.timestamp
            });

            // Inject context into the OpenAI session
            const success = this.sessionManager.injectContext(callSid, context, call.conversationHistory);

            if (!success) {
                console.error('[Voice Server] Failed to inject context - session not found');
                res.status(404).json({ error: 'Active session not found for this call' });
                return;
            }

            res.json({ status: 'success', message: 'Context injected' });
        } catch (error) {
            console.error('[Voice Server] Error injecting context:', error);
            res.status(500).json({ error: 'Failed to inject context' });
        }
    }

    public start(): void {
        this.httpServer = this.app.listen(this.port);
        this.socketService.initialize(this.httpServer);
    }

    public getHttpServer(): HTTPServer | null {
        return this.httpServer;
    }
}
