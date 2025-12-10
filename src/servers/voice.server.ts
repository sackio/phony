import dotenv from 'dotenv';
import express, { Response } from 'express';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import ExpressWs from 'express-ws';
import { WebSocket } from 'ws';
import path from 'path';
import twilio from 'twilio';
import { Server as HTTPServer } from 'http';
import { CallType } from '../types.js';
import { DYNAMIC_API_SECRET, ENABLE_TEST_RECEIVER } from '../config/constants.js';
import { CallSessionManager } from '../handlers/openai.handler.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { TwilioSmsService } from '../services/twilio/sms.service.js';
import { ConversationService } from '../services/sms/conversation.service.js';
import { SocketService } from '../services/socket.service.js';
import { CallStateService } from '../services/call-state.service.js';
import { IncomingConfigService } from '../services/database/incoming-config.service.js';
import { ContextService } from '../services/database/context.service.js';
import { CallTranscriptService } from '../services/database/call-transcript.service.js';
import { SessionManagerService } from '../services/session-manager.service.js';
import { createMCPRouter } from '../mcp/router.js';
dotenv.config();

export class VoiceServer {
    private app: express.Application & { ws: any };
    private port: number;
    private sessionManager: CallSessionManager;
    private callbackUrl: string;
    private twilioCallService: TwilioCallService;
    private twilioSmsService: TwilioSmsService;
    private conversationService: ConversationService;
    private httpServer: HTTPServer | null = null;
    private socketService: SocketService;
    private callStateService: CallStateService;
    private incomingConfigService: IncomingConfigService;
    private contextService: ContextService;
    private transcriptService: CallTranscriptService;

    constructor(callbackUrl: string, sessionManager: CallSessionManager, transcriptService: CallTranscriptService) {
        this.callbackUrl = callbackUrl;
        this.port = parseInt(process.env.PORT || '3004');
        this.app = ExpressWs(express()).app;
        this.sessionManager = sessionManager;
        this.transcriptService = transcriptService;

        // Initialize Twilio services
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        this.twilioCallService = new TwilioCallService(twilioClient);
        this.twilioSmsService = new TwilioSmsService(twilioClient);

        // Initialize SMS and conversation services
        this.conversationService = new ConversationService();

        // Initialize Socket.IO and CallState services
        this.socketService = SocketService.getInstance();
        this.callStateService = CallStateService.getInstance();
        this.incomingConfigService = new IncomingConfigService();
        this.contextService = new ContextService();

        this.configureMiddleware();
        this.setupRoutes();
    }

    private configureMiddleware(): void {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: false }));

        // Serve public directory for audio files (hold messages, etc.)
        const publicPath = path.join(process.cwd(), 'public');
        console.log('[Voice Server] Serving public files from:', publicPath);
        this.app.use('/audio', express.static(path.join(publicPath, 'audio')));

        // Serve frontend static files
        const frontendPath = path.join(process.cwd(), 'frontend/dist');
        console.log('[Voice Server] Serving frontend from:', frontendPath);
        this.app.use(express.static(frontendPath));
    }

    private setupRoutes(): void {
        // MCP discovery endpoint (must be before SPA fallback)
        this.app.get('/.well-known/mcp-info', (req, res) => {
            res.json({
                name: 'Phony Voice Call Server',
                version: '1.0.0',
                description: 'MCP server for managing voice calls with AI assistants',
                capabilities: {
                    tools: 21,
                    resources: 14,
                    prompts: 3
                },
                vendor: 'Phony',
                protocol: 'mcp-http'
            });
        });

        // API routes
        this.app.get('/api/calls', this.handleListCalls.bind(this));
        this.app.post('/api/calls/create', this.handleCreateCall.bind(this));
        this.app.get('/api/calls/:callSid', this.handleGetCall.bind(this));
        this.app.post('/api/calls/:callSid/hold', this.handleHoldCall.bind(this));
        this.app.post('/api/calls/:callSid/resume', this.handleResumeCall.bind(this));
        this.app.post('/api/calls/:callSid/hangup', this.handleHangupCall.bind(this));
        this.app.post('/api/calls/:callSid/inject-context', this.handleInjectContext.bind(this));
        this.app.post('/api/calls/:callSid/dtmf', this.handleSendDTMF.bind(this));

        // Emergency shutdown endpoint - protected by API secret
        this.app.post('/api/emergency-shutdown', this.handleEmergencyShutdown.bind(this));

        // Incoming call configuration routes
        this.app.get('/api/incoming-configs/available-numbers', this.handleListAvailableNumbers.bind(this));
        this.app.get('/api/incoming-configs', this.handleListIncomingConfigs.bind(this));
        this.app.post('/api/incoming-configs', this.handleCreateIncomingConfig.bind(this));
        this.app.put('/api/incoming-configs/:phoneNumber', this.handleUpdateIncomingConfig.bind(this));
        this.app.delete('/api/incoming-configs/:phoneNumber', this.handleDeleteIncomingConfig.bind(this));

        // Context template routes
        this.app.get('/api/contexts', this.handleListContexts.bind(this));
        this.app.get('/api/contexts/:id', this.handleGetContext.bind(this));
        this.app.post('/api/contexts', this.handleCreateContext.bind(this));
        this.app.put('/api/contexts/:id', this.handleUpdateContext.bind(this));
        this.app.delete('/api/contexts/:id', this.handleDeleteContext.bind(this));

        // SMS API routes
        this.app.post('/api/sms/send', this.handleSendSmsApi.bind(this));
        this.app.get('/api/sms/messages', this.handleListMessages.bind(this));
        this.app.get('/api/sms/messages/:messageSid', this.handleGetMessage.bind(this));
        this.app.get('/api/sms/conversation', this.handleGetConversation.bind(this));

        // Conversation API routes
        this.app.post('/api/conversations', this.handleCreateConversation.bind(this));
        this.app.get('/api/conversations', this.handleListConversations.bind(this));
        this.app.get('/api/conversations/:conversationId', this.handleGetConversationDetails.bind(this));
        this.app.get('/api/conversations/:conversationId/messages', this.handleGetConversationMessages.bind(this));
        this.app.post('/api/conversations/:conversationId/participants', this.handleAddParticipant.bind(this));
        this.app.delete('/api/conversations/:conversationId/participants/:phoneNumber', this.handleRemoveParticipant.bind(this));
        this.app.put('/api/conversations/:conversationId/name', this.handleUpdateGroupName.bind(this));
        this.app.post('/api/conversations/:conversationId/send', this.handleSendGroupSms.bind(this));

        // MCP routes - Get SessionManagerService from sessionManager
        const sessionManagerService = (this.sessionManager as any).sessionManager as SessionManagerService;
        const mcpRouter = createMCPRouter(
            this.transcriptService,
            this.incomingConfigService,
            this.contextService,
            this.twilioCallService,
            sessionManagerService
        );
        this.app.use('/mcp', mcpRouter);
        console.log('[Voice Server] MCP endpoints registered at /mcp/*');

        // Twilio webhook routes
        this.app.post('/call/outgoing', this.handleOutgoingCall.bind(this));
        this.app.post('/call/incoming', this.handleIncomingCall.bind(this));
        this.app.post('/call/hold', this.handleHoldLoop.bind(this));
        this.app.ws('/call/connection-outgoing/:secret', this.handleOutgoingConnection.bind(this));
        this.app.ws('/call/connection-incoming/:secret', this.handleIncomingConnection.bind(this));

        // Test mode route - for internal testing without consuming OpenAI credits
        if (ENABLE_TEST_RECEIVER) {
            this.app.post('/call/test-receiver', this.handleTestReceiver.bind(this));
            console.log('[Voice Server] Test receiver endpoint enabled at /call/test-receiver');
        }

        // SMS webhook routes
        this.app.post('/sms/incoming', this.handleIncomingSms.bind(this));
        this.app.post('/sms/status', this.handleSmsStatus.bind(this));

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
        const systemInstructions = req.query.systemInstructions?.toString() || req.body.systemInstructions || '';
        const callInstructions = req.query.callInstructions?.toString() || req.body.callInstructions || '';
        const voice = req.query.voice?.toString() || req.body.voice || 'sage';
        const fromNumber = req.query.fromNumber?.toString() || req.body.fromNumber || req.body.From;

        if (!toNumber) {
            res.status(400).json({ error: 'Missing required field: To' });
            return;
        }

        if (!systemInstructions) {
            res.status(400).json({ error: 'Missing required field: systemInstructions' });
            return;
        }

        // Production Safety Control: Check concurrent outgoing call limit
        if (!this.callStateService.canAcceptOutgoingCall()) {
            const stats = {
                totalCalls: this.callStateService.getActiveCallCount(),
                outgoingCalls: this.callStateService.getOutgoingCallCount(),
                incomingCalls: this.callStateService.getIncomingCallCount()
            };
            console.log('[Voice Server] ⚠️  Outgoing call rejected - limit reached', stats);
            res.status(429).json({
                error: 'Too many active calls',
                message: 'Maximum concurrent outgoing call limit reached',
                stats
            });
            return;
        }

        try {
            const callerNumber = fromNumber || process.env.TWILIO_NUMBER || '';
            console.log('[Voice Server] Creating call from:', callerNumber, 'to:', toNumber, 'with voice:', voice);
            const twilioCallSid = await this.twilioCallService.makeCall(this.callbackUrl, toNumber, systemInstructions, callInstructions, voice, fromNumber);

            // Store call state (will be created in MongoDB when websocket connects)
            this.callStateService.addCall(twilioCallSid, {
                callSid: twilioCallSid,
                twilioCallSid: twilioCallSid,
                toNumber: toNumber,
                fromNumber: callerNumber,
                callType: 'outgoing',
                voice: voice,
                status: 'initiated',
                startedAt: new Date(),
                conversationHistory: []
            });

            // Production Safety Control: Start auto-hangup timer
            this.callStateService.startDurationTimer(twilioCallSid);

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
        const systemInstructions = req.query.systemInstructions?.toString() || '';
        const callInstructions = req.query.callInstructions?.toString() || '';
        const voice = req.query.voice?.toString() || 'sage';

        console.log('[Voice Server] Creating call with voice:', voice);

        const twiml = new VoiceResponse();
        const connect = twiml.connect();

        const stream = connect.stream({
            url: `${this.callbackUrl.replace('https://', 'wss://')}/call/connection-outgoing/${apiSecret}`,
        });

        stream.parameter({ name: 'fromNumber', value: fromNumber });
        stream.parameter({ name: 'toNumber', value: toNumber });
        stream.parameter({ name: 'systemInstructions', value: systemInstructions });
        stream.parameter({ name: 'callInstructions', value: callInstructions });
        stream.parameter({ name: 'voice', value: voice });

        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
    }

    private async handleHoldLoop(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] Incoming POST /call/hold');
        console.log('[Voice Server] Query params:', req.query);

        const apiSecret = req.query.apiSecret?.toString();
        if (apiSecret !== DYNAMIC_API_SECRET) {
            console.log('[Voice Server] 401: Unauthorized - Invalid or missing API secret');
            res.status(401).json({ error: 'Unauthorized: Invalid or missing API secret' });
            return;
        }

        // Get voice parameter from query (passed by holdCall method)
        const voice = req.query.voice?.toString() || 'sage';

        console.log('[Voice Server] Creating hold loop with voice:', voice);

        // Create TwiML for hold with music
        const twiml = new VoiceResponse();

        // Play hold music continuously
        twiml.play({ loop: 0 }, 'http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3');

        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
    }

    /**
     * Test receiver endpoint - answers call and stays on line for limited duration
     * This is for internal testing without consuming OpenAI credits
     */
    private async handleTestReceiver(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] Test receiver endpoint called');
        console.log('[Voice Server] From:', req.body.From, 'To:', req.body.To);

        // Create TwiML response
        const twiml = new VoiceResponse();

        // Play greeting message
        twiml.say(
            { voice: 'Polly.Matthew' },
            'This is the Phony test receiver. Your call has been answered successfully. This line will remain open for testing purposes and will automatically disconnect after the timeout period.'
        );

        // Brief pause
        twiml.pause({ length: 2 });

        // Play hold music for limited duration (using timeout to control max duration)
        // Note: Twilio will enforce the timeout via the call duration limit
        twiml.play(
            { loop: 5 },
            'http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3'
        );

        // Say goodbye message before hanging up
        twiml.say(
            { voice: 'Polly.Matthew' },
            'Test call timeout reached. Disconnecting now. Thank you for testing.'
        );

        // Hangup
        twiml.hangup();

        console.log('[Voice Server] Test receiver TwiML generated (max duration: ~5 minutes)');

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
            // Get calls from MongoDB with optional filtering
            const CallModel = (await import('../models/call.model.js')).CallModel;

            // Build query filter
            const filter: any = {};

            // Filter by call type (inbound/outbound)
            if (req.query.callType) {
                filter.callType = req.query.callType;
            }

            // Filter by status
            if (req.query.status) {
                filter.status = req.query.status;
            }

            // Filter by phone numbers
            if (req.query.fromNumber) {
                filter.fromNumber = req.query.fromNumber;
            }
            if (req.query.toNumber) {
                filter.toNumber = req.query.toNumber;
            }

            // Filter by date range
            if (req.query.startDate || req.query.endDate) {
                filter.startedAt = {};
                if (req.query.startDate) {
                    filter.startedAt.$gte = new Date(req.query.startDate as string);
                }
                if (req.query.endDate) {
                    filter.startedAt.$lte = new Date(req.query.endDate as string);
                }
            }

            // Get limit from query or default to 100
            const limit = parseInt(req.query.limit as string) || 100;

            const calls = await CallModel.find(filter)
                .sort({ startedAt: -1 })
                .limit(limit)
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

            // Save conversation history to database BEFORE hold
            // This ensures it's available when resuming
            console.log('[Voice Server] Saving conversation history to database before hold');
            const conversationHistory = call.conversationHistory || [];
            await this.transcriptService.updateConversationHistory(callSid, conversationHistory);
            console.log(`[Voice Server] Saved ${conversationHistory.length} messages to database`);

            // Update Twilio call to play hold music
            // Use the agent's voice for the hold message (fallback to 'alice' if not set)
            const holdVoice = call.voice || 'alice';
            console.log(`[Voice Server] Holding call with voice: ${holdVoice} (call.voice was: ${call.voice})`);

            await this.twilioCallService.getTwilioClient()
                .calls(call.twilioCallSid)
                .update({
                    twiml: `<Response><Say voice="${holdVoice}">Sorry, one moment please.</Say><Play loop="10">http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3</Play></Response>`
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

    /**
     * Emergency shutdown endpoint - terminates ALL active calls
     * Protected by API secret for security
     */
    private async handleEmergencyShutdown(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] Emergency shutdown requested');

        // Verify API secret
        const apiSecret = req.query.apiSecret?.toString() || req.body.apiSecret;
        if (apiSecret !== DYNAMIC_API_SECRET) {
            console.log('[Voice Server] 401: Unauthorized - Invalid or missing API secret');
            res.status(401).json({ error: 'Unauthorized: Invalid or missing API secret' });
            return;
        }

        try {
            const activeCalls = this.callStateService.getActiveCalls();
            const terminatedCalls: string[] = [];
            const failedCalls: Array<{ callSid: string; error: string }> = [];

            console.log(`[Voice Server] Emergency shutdown: terminating ${activeCalls.length} active calls`);

            // Terminate each active call
            for (const call of activeCalls) {
                try {
                    if (call.twilioCallSid) {
                        await this.twilioCallService.getTwilioClient()
                            .calls(call.twilioCallSid)
                            .update({ status: 'completed' });

                        this.callStateService.updateCallStatus(call.callSid, 'completed');
                        this.socketService.emitCallStatusChanged(call.callSid, 'completed');
                        this.callStateService.removeCall(call.callSid);

                        terminatedCalls.push(call.callSid);
                        console.log(`[Voice Server] Emergency shutdown: terminated call ${call.callSid}`);
                    }
                } catch (error: any) {
                    console.error(`[Voice Server] Emergency shutdown: failed to terminate call ${call.callSid}:`, error);
                    failedCalls.push({
                        callSid: call.callSid,
                        error: error.message || 'Unknown error'
                    });
                }
            }

            res.json({
                success: true,
                message: 'Emergency shutdown completed',
                terminatedCount: terminatedCalls.length,
                failedCount: failedCalls.length,
                terminatedCalls,
                failedCalls: failedCalls.length > 0 ? failedCalls : undefined
            });

            console.log(`[Voice Server] Emergency shutdown complete: ${terminatedCalls.length} terminated, ${failedCalls.length} failed`);
        } catch (error) {
            console.error('[Voice Server] Emergency shutdown error:', error);
            res.status(500).json({ error: 'Emergency shutdown failed' });
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

            // Check if there's a pending context request from the agent
            const hadPendingRequest = this.callStateService.hasPendingContextRequest(callSid);
            if (hadPendingRequest) {
                const pendingRequest = call.pendingContextRequest;
                console.log(`[Voice Server] Answering pending context request: ${pendingRequest?.question}`);

                // Clear the pending context request
                this.callStateService.clearPendingContextRequest(callSid);

                // If call is on hold (from agent request), auto-resume it
                if (call.status === 'on_hold' && call.twilioCallSid) {
                    console.log('[Voice Server] Auto-resuming call after context provided');

                    // Update status BEFORE resuming
                    this.callStateService.updateCallStatus(callSid, 'active');
                    this.socketService.emitCallStatusChanged(callSid, 'active');

                    // Add resume marker to transcript
                    const resumeMarker = {
                        speaker: 'system' as const,
                        text: '▶️ Call resumed with operator context',
                        timestamp: new Date(),
                        isPartial: false,
                        isInterruption: false
                    };
                    this.socketService.emitTranscriptUpdate(callSid, resumeMarker);
                    this.callStateService.addTranscript(callSid, {
                        role: 'system',
                        content: resumeMarker.text,
                        timestamp: resumeMarker.timestamp
                    });

                    // Resume the call - redirect back to media stream
                    await this.twilioCallService.getTwilioClient()
                        .calls(call.twilioCallSid)
                        .update({
                            url: `${this.callbackUrl}/call/outgoing?apiSecret=${DYNAMIC_API_SECRET}`,
                            method: 'POST'
                        });

                    // Inject context into the OpenAI session
                    const success = this.sessionManager.injectContext(callSid, context, call.conversationHistory);

                    if (!success) {
                        console.error('[Voice Server] Failed to inject context after resume - session not found');
                        res.status(500).json({ error: 'Failed to inject context after resume' });
                        return;
                    }

                    res.json({
                        status: 'success',
                        message: 'Context injected and call auto-resumed',
                        resumed: true
                    });
                    return;
                }
            }

            // Only inject into active OpenAI session if call is NOT on hold
            if (call.status === 'on_hold') {
                console.log('[Voice Server] Call is on hold - context saved to history but not sent to AI yet');

                // Save updated conversation history to database so it's available on resume
                const conversationHistory = call.conversationHistory || [];
                await this.transcriptService.updateConversationHistory(callSid, conversationHistory);
                console.log(`[Voice Server] Saved ${conversationHistory.length} messages (including context) to database`);

                res.json({ status: 'success', message: 'Context saved (call on hold - will be applied on resume)' });
                return;
            }

            // Inject context into the OpenAI session (for active calls)
            const success = this.sessionManager.injectContext(callSid, context, call.conversationHistory);

            if (!success) {
                console.error('[Voice Server] Failed to inject context - session not found');
                res.status(404).json({ error: 'Active session not found for this call' });
                return;
            }

            res.json({ status: 'success', message: 'Context injected into active call' });
        } catch (error) {
            console.error('[Voice Server] Error injecting context:', error);
            res.status(500).json({ error: 'Failed to inject context' });
        }
    }

    private async handleSendDTMF(req: express.Request, res: Response): Promise<void> {
        try {
            const { callSid } = req.params;
            const { digits } = req.body;

            if (!digits) {
                res.status(400).json({ error: 'Missing required field: digits' });
                return;
            }

            // Validate DTMF digits (0-9, *, #, A-D, w, W)
            const validDTMF = /^[0-9*#A-DwW ]+$/;
            if (!validDTMF.test(digits)) {
                res.status(400).json({ error: 'Invalid DTMF digits. Allowed: 0-9, *, #, A-D, w (0.5s pause), W (1s pause)' });
                return;
            }

            const call = this.callStateService.getCall(callSid);

            if (!call || !call.twilioCallSid) {
                res.status(404).json({ error: 'Call not found' });
                return;
            }

            console.log(`[Voice Server] Sending DTMF tones "${digits}" to call:`, callSid);

            // Emit transcript marker showing DTMF injection
            const dtmfMarker = {
                speaker: 'system' as const,
                text: `🔢 DTMF sent: ${digits}`,
                timestamp: new Date(),
                isPartial: false,
                isInterruption: false
            };
            this.socketService.emitTranscriptUpdate(callSid, dtmfMarker);

            // Add to conversation history
            this.callStateService.addTranscript(callSid, {
                role: 'system',
                content: dtmfMarker.text,
                timestamp: dtmfMarker.timestamp
            });

            // Send DTMF tones using Twilio's Play verb with digits parameter
            // This requires updating the call to play the DTMF tones
            const twiml = new VoiceResponse();
            twiml.play({ digits });
            twiml.redirect(`${this.callbackUrl}/call/outgoing?apiSecret=${DYNAMIC_API_SECRET}`);

            await this.twilioCallService.getTwilioClient()
                .calls(call.twilioCallSid)
                .update({
                    twiml: twiml.toString()
                });

            res.json({ status: 'success', message: `DTMF tones "${digits}" sent to call` });
        } catch (error) {
            console.error('[Voice Server] Error sending DTMF:', error);
            res.status(500).json({ error: 'Failed to send DTMF tones' });
        }
    }

    // Incoming call configuration handlers
    private async handleListAvailableNumbers(req: express.Request, res: Response): Promise<void> {
        try {
            // Fetch all Twilio phone numbers
            const twilioNumbers = await this.twilioCallService.listPhoneNumbers();

            // Fetch all existing configs
            const configs = await this.incomingConfigService.getAllConfigs();

            // Create a map of phone numbers to configs
            const configMap = new Map(
                configs.map(config => [config.phoneNumber, config])
            );

            // Filter and merge Twilio numbers with config status
            // Only include numbers that either:
            // 1. Have a Phony config
            // 2. Have no webhook at all
            // 3. Have a phony.pushbuild.com webhook
            const availableNumbers = twilioNumbers
                .filter(twilioNumber => {
                    const config = configMap.get(twilioNumber.phoneNumber);
                    const hasPhonyWebhook = twilioNumber.voiceUrl?.includes('phony.pushbuild.com') || false;
                    const hasNoWebhook = !twilioNumber.hasVoiceWebhook;

                    // Include if: has config, has phony webhook, or has no webhook
                    return !!config || hasPhonyWebhook || hasNoWebhook;
                })
                .map(twilioNumber => {
                    const config = configMap.get(twilioNumber.phoneNumber);

                    return {
                        phoneNumber: twilioNumber.phoneNumber,
                        friendlyName: twilioNumber.friendlyName,
                        sid: twilioNumber.sid,
                        voiceUrl: twilioNumber.voiceUrl,
                        hasVoiceWebhook: twilioNumber.hasVoiceWebhook,
                        isConfigured: !!config,
                        config: config || null
                    };
                });

            res.json(availableNumbers);
        } catch (error) {
            console.error('[Voice Server] Error listing available numbers:', error);
            res.status(500).json({ error: 'Failed to list available numbers' });
        }
    }

    private async handleListIncomingConfigs(req: express.Request, res: Response): Promise<void> {
        try {
            const configs = await this.incomingConfigService.getAllConfigs();
            res.json(configs);
        } catch (error) {
            console.error('[Voice Server] Error listing incoming configs:', error);
            res.status(500).json({ error: 'Failed to list configurations' });
        }
    }

    private async handleCreateIncomingConfig(req: express.Request, res: Response): Promise<void> {
        try {
            const { phoneNumber, name, systemInstructions, callInstructions, voice, enabled, messageOnly, hangupMessage } = req.body;

            if (!phoneNumber || !name) {
                res.status(400).json({ error: 'Missing required fields: phoneNumber, name' });
                return;
            }

            // If messageOnly is true, require hangupMessage instead of systemInstructions
            if (messageOnly && !hangupMessage) {
                res.status(400).json({ error: 'hangupMessage is required when messageOnly is true' });
                return;
            }

            // If not messageOnly, require systemInstructions
            if (!messageOnly && !systemInstructions) {
                res.status(400).json({ error: 'systemInstructions is required for AI conversation mode' });
                return;
            }

            const config = await this.incomingConfigService.createConfig({
                phoneNumber,
                name,
                systemInstructions: systemInstructions || '',
                callInstructions: callInstructions || '',
                voice,
                enabled,
                messageOnly,
                hangupMessage
            });

            res.status(201).json(config);
        } catch (error: any) {
            console.error('[Voice Server] Error creating incoming config:', error);
            if (error.code === 11000) {
                res.status(409).json({ error: 'Configuration already exists for this phone number' });
            } else {
                res.status(500).json({ error: 'Failed to create configuration' });
            }
        }
    }

    private async handleUpdateIncomingConfig(req: express.Request, res: Response): Promise<void> {
        try {
            const { phoneNumber } = req.params;
            const updates = req.body;

            const config = await this.incomingConfigService.updateConfig(phoneNumber, updates);

            if (!config) {
                res.status(404).json({ error: 'Configuration not found' });
                return;
            }

            res.json(config);
        } catch (error) {
            console.error('[Voice Server] Error updating incoming config:', error);
            res.status(500).json({ error: 'Failed to update configuration' });
        }
    }

    private async handleDeleteIncomingConfig(req: express.Request, res: Response): Promise<void> {
        try {
            const { phoneNumber } = req.params;
            const deleted = await this.incomingConfigService.deleteConfig(phoneNumber);

            if (!deleted) {
                res.status(404).json({ error: 'Configuration not found' });
                return;
            }

            res.json({ success: true, message: 'Configuration deleted' });
        } catch (error) {
            console.error('[Voice Server] Error deleting incoming config:', error);
            res.status(500).json({ error: 'Failed to delete configuration' });
        }
    }

    // Context template handlers
    private async handleListContexts(req: express.Request, res: Response): Promise<void> {
        try {
            const contextType = req.query.type as 'incoming' | 'outgoing' | 'both' | undefined;
            const contexts = await this.contextService.getAllContexts(contextType);
            res.json(contexts);
        } catch (error) {
            console.error('[Voice Server] Error listing contexts:', error);
            res.status(500).json({ error: 'Failed to list contexts' });
        }
    }

    private async handleGetContext(req: express.Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const context = await this.contextService.getContextById(id);

            if (!context) {
                res.status(404).json({ error: 'Context not found' });
                return;
            }

            res.json(context);
        } catch (error) {
            console.error('[Voice Server] Error getting context:', error);
            res.status(500).json({ error: 'Failed to get context' });
        }
    }

    private async handleCreateContext(req: express.Request, res: Response): Promise<void> {
        try {
            const { name, description, systemInstructions, exampleCallInstructions, contextType } = req.body;

            if (!name || !systemInstructions || !contextType) {
                res.status(400).json({ error: 'Missing required fields: name, systemInstructions, contextType' });
                return;
            }

            const context = await this.contextService.createContext({
                name,
                description,
                systemInstructions,
                exampleCallInstructions: exampleCallInstructions || '',
                contextType
            });

            res.status(201).json(context);
        } catch (error) {
            console.error('[Voice Server] Error creating context:', error);
            res.status(500).json({ error: 'Failed to create context' });
        }
    }

    private async handleUpdateContext(req: express.Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const updates = req.body;

            const context = await this.contextService.updateContext(id, updates);

            if (!context) {
                res.status(404).json({ error: 'Context not found' });
                return;
            }

            res.json(context);
        } catch (error) {
            console.error('[Voice Server] Error updating context:', error);
            res.status(500).json({ error: 'Failed to update context' });
        }
    }

    private async handleDeleteContext(req: express.Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const deleted = await this.contextService.deleteContext(id);

            if (!deleted) {
                res.status(404).json({ error: 'Context not found' });
                return;
            }

            res.json({ success: true, message: 'Context deleted' });
        } catch (error) {
            console.error('[Voice Server] Error deleting context:', error);
            res.status(500).json({ error: 'Failed to delete context' });
        }
    }

    // Incoming call webhook handlers
    private async handleIncomingCall(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] Incoming call webhook');
        console.log('[Voice Server] From:', req.body.From);
        console.log('[Voice Server] To:', req.body.To);

        const fromNumber = req.body.From;
        const toNumber = req.body.To;

        // Production Safety Control: Check concurrent incoming call limit
        if (!this.callStateService.canAcceptIncomingCall()) {
            const stats = {
                totalCalls: this.callStateService.getActiveCallCount(),
                outgoingCalls: this.callStateService.getOutgoingCallCount(),
                incomingCalls: this.callStateService.getIncomingCallCount()
            };
            console.log('[Voice Server] ⚠️  Incoming call rejected - limit reached', stats);
            const twiml = new VoiceResponse();
            twiml.say('Sorry, we are currently at maximum capacity. Please try again later.');
            twiml.hangup();
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twiml.toString());
            return;
        }

        // Look up configuration for this phone number
        const config = await this.incomingConfigService.getConfigByNumber(toNumber);

        if (!config) {
            console.log('[Voice Server] No configuration found for', toNumber);
            const twiml = new VoiceResponse();
            twiml.say('Sorry, this number is not configured to receive calls.');
            twiml.hangup();
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twiml.toString());
            return;
        }

        console.log('[Voice Server] Using configuration:', config.name);

        const twiml = new VoiceResponse();

        // Check if this is a message-only configuration
        if (config.messageOnly) {
            console.log('[Voice Server] Message-only mode - playing hangup message');
            const message = config.hangupMessage || 'Thank you for calling.';
            twiml.say({ voice: config.voice }, message);
            twiml.hangup();
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twiml.toString());
            return;
        }

        // Normal AI conversation mode
        const connect = twiml.connect();

        const stream = connect.stream({
            url: `${this.callbackUrl.replace('https://', 'wss://')}/call/connection-incoming/${DYNAMIC_API_SECRET}`,
        });

        stream.parameter({ name: 'fromNumber', value: fromNumber });
        stream.parameter({ name: 'toNumber', value: toNumber });
        stream.parameter({ name: 'configName', value: config.name });
        stream.parameter({ name: 'systemInstructions', value: config.systemInstructions });
        stream.parameter({ name: 'callInstructions', value: config.callInstructions });
        stream.parameter({ name: 'voice', value: config.voice });

        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
    }

    private handleIncomingConnection(ws: WebSocket, req: express.Request): void {
        console.log('[Voice Server] Incoming WebSocket connection /call/connection-incoming/:secret');
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

        console.log('[Voice Server] Creating session for inbound call');
        this.sessionManager.createSession(ws, CallType.INBOUND);
    }

    private async handleSendSmsApi(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] POST /api/sms/send');

        try {
            const { toNumber, body, fromNumber } = req.body;

            if (!toNumber || !body) {
                res.status(400).json({ error: 'toNumber and body are required' });
                return;
            }

            const result = await this.twilioSmsService.sendSms(toNumber, body, fromNumber);

            res.json({
                status: 'success',
                messageSid: result.messageSid,
                twilioStatus: result.status
            });
        } catch (error: any) {
            console.error('[Voice Server] Error sending SMS:', error);
            res.status(500).json({ error: error.message || 'Failed to send SMS' });
        }
    }

    private async handleListMessages(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] GET /api/sms/messages');

        try {
            const smsStorageService = new (await import('../services/sms/storage.service.js')).SmsStorageService();

            const filters: any = {};

            if (req.query.direction) {
                filters.direction = req.query.direction;
            }
            if (req.query.fromNumber) {
                filters.fromNumber = req.query.fromNumber as string;
            }
            if (req.query.toNumber) {
                filters.toNumber = req.query.toNumber as string;
            }
            if (req.query.status) {
                filters.status = req.query.status;
            }
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate as string);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate as string);
            }
            if (req.query.limit) {
                filters.limit = parseInt(req.query.limit as string);
            }

            const messages = await smsStorageService.listSms(filters);

            res.json(messages);
        } catch (error: any) {
            console.error('[Voice Server] Error listing messages:', error);
            res.status(500).json({ error: error.message || 'Failed to list messages' });
        }
    }

    private async handleGetMessage(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] GET /api/sms/messages/:messageSid');

        try {
            const smsStorageService = new (await import('../services/sms/storage.service.js')).SmsStorageService();
            const message = await smsStorageService.getSms(req.params.messageSid);

            if (!message) {
                res.status(404).json({ error: 'Message not found' });
                return;
            }

            res.json(message);
        } catch (error: any) {
            console.error('[Voice Server] Error getting message:', error);
            res.status(500).json({ error: error.message || 'Failed to get message' });
        }
    }

    private async handleGetConversation(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] GET /api/sms/conversation');

        try {
            const { phoneNumber1, phoneNumber2, limit } = req.query;

            if (!phoneNumber1 || !phoneNumber2) {
                res.status(400).json({ error: 'phoneNumber1 and phoneNumber2 are required' });
                return;
            }

            const smsStorageService = new (await import('../services/sms/storage.service.js')).SmsStorageService();
            const messages = await smsStorageService.getConversation(
                phoneNumber1 as string,
                phoneNumber2 as string,
                limit ? parseInt(limit as string) : 100
            );

            res.json(messages);
        } catch (error: any) {
            console.error('[Voice Server] Error getting conversation:', error);
            res.status(500).json({ error: error.message || 'Failed to get conversation' });
        }
    }

    // Conversation Management Handlers

    private async handleCreateConversation(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] POST /api/conversations');

        try {
            const { participants, createdBy, name } = req.body;

            if (!participants || !Array.isArray(participants) || participants.length < 2) {
                res.status(400).json({ error: 'At least 2 participants are required' });
                return;
            }

            if (!createdBy) {
                res.status(400).json({ error: 'createdBy is required' });
                return;
            }

            const conversation = await this.conversationService.createConversation({
                participants,
                createdBy,
                name
            });

            if (!conversation) {
                res.status(500).json({ error: 'Failed to create conversation' });
                return;
            }

            res.json(conversation);
        } catch (error: any) {
            console.error('[Voice Server] Error creating conversation:', error);
            res.status(500).json({ error: error.message || 'Failed to create conversation' });
        }
    }

    private async handleListConversations(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] GET /api/conversations');

        try {
            const phoneNumber = req.query.phoneNumber as string;
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

            if (!phoneNumber) {
                res.status(400).json({ error: 'phoneNumber query parameter is required' });
                return;
            }

            const conversations = await this.conversationService.listConversations(phoneNumber, limit);
            res.json(conversations);
        } catch (error: any) {
            console.error('[Voice Server] Error listing conversations:', error);
            res.status(500).json({ error: error.message || 'Failed to list conversations' });
        }
    }

    private async handleGetConversationDetails(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] GET /api/conversations/:conversationId');

        try {
            const conversationId = req.params.conversationId;
            const conversation = await this.conversationService.getConversation(conversationId);

            if (!conversation) {
                res.status(404).json({ error: 'Conversation not found' });
                return;
            }

            res.json(conversation);
        } catch (error: any) {
            console.error('[Voice Server] Error getting conversation details:', error);
            res.status(500).json({ error: error.message || 'Failed to get conversation details' });
        }
    }

    private async handleGetConversationMessages(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] GET /api/conversations/:conversationId/messages');

        try {
            const conversationId = req.params.conversationId;
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

            const messages = await this.conversationService.getConversationMessages(conversationId, limit);
            res.json(messages);
        } catch (error: any) {
            console.error('[Voice Server] Error getting conversation messages:', error);
            res.status(500).json({ error: error.message || 'Failed to get conversation messages' });
        }
    }

    private async handleAddParticipant(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] POST /api/conversations/:conversationId/participants');

        try {
            const conversationId = req.params.conversationId;
            const { phoneNumber } = req.body;

            if (!phoneNumber) {
                res.status(400).json({ error: 'phoneNumber is required' });
                return;
            }

            const conversation = await this.conversationService.addParticipant(conversationId, phoneNumber);

            if (!conversation) {
                res.status(500).json({ error: 'Failed to add participant' });
                return;
            }

            res.json(conversation);
        } catch (error: any) {
            console.error('[Voice Server] Error adding participant:', error);
            res.status(500).json({ error: error.message || 'Failed to add participant' });
        }
    }

    private async handleRemoveParticipant(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] DELETE /api/conversations/:conversationId/participants/:phoneNumber');

        try {
            const conversationId = req.params.conversationId;
            const phoneNumber = req.params.phoneNumber;

            const conversation = await this.conversationService.removeParticipant(conversationId, phoneNumber);

            if (!conversation) {
                res.status(500).json({ error: 'Failed to remove participant' });
                return;
            }

            res.json(conversation);
        } catch (error: any) {
            console.error('[Voice Server] Error removing participant:', error);
            res.status(500).json({ error: error.message || 'Failed to remove participant' });
        }
    }

    private async handleUpdateGroupName(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] PUT /api/conversations/:conversationId/name');

        try {
            const conversationId = req.params.conversationId;
            const { name } = req.body;

            if (!name) {
                res.status(400).json({ error: 'name is required' });
                return;
            }

            const conversation = await this.conversationService.updateConversationName(conversationId, name);

            if (!conversation) {
                res.status(500).json({ error: 'Failed to update group name' });
                return;
            }

            res.json(conversation);
        } catch (error: any) {
            console.error('[Voice Server] Error updating group name:', error);
            res.status(500).json({ error: error.message || 'Failed to update group name' });
        }
    }

    private async handleSendGroupSms(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] POST /api/conversations/:conversationId/send');

        try {
            const conversationId = req.params.conversationId;
            const { body, fromNumber } = req.body;

            if (!body) {
                res.status(400).json({ error: 'body is required' });
                return;
            }

            if (!fromNumber) {
                res.status(400).json({ error: 'fromNumber is required' });
                return;
            }

            // Get conversation
            const conversation = await this.conversationService.getConversation(conversationId);

            if (!conversation) {
                res.status(404).json({ error: 'Conversation not found' });
                return;
            }

            // Send to all participants except sender
            const recipients = conversation.participants.filter(p => p !== fromNumber);
            const results = [];

            for (const recipient of recipients) {
                try {
                    const result = await this.twilioSmsService.sendSms(recipient, body, fromNumber);
                    results.push({
                        toNumber: recipient,
                        messageSid: result.messageSid,
                        status: 'sent'
                    });
                } catch (error: any) {
                    console.error(`[Voice Server] Error sending to ${recipient}:`, error);
                    results.push({
                        toNumber: recipient,
                        error: error.message,
                        status: 'failed'
                    });
                }
            }

            const successCount = results.filter(r => r.status === 'sent').length;
            res.json({
                status: 'success',
                recipientCount: recipients.length,
                successCount,
                failCount: recipients.length - successCount,
                results
            });
        } catch (error: any) {
            console.error('[Voice Server] Error sending group SMS:', error);
            res.status(500).json({ error: error.message || 'Failed to send group SMS' });
        }
    }

    private async handleIncomingSms(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] Incoming SMS webhook');
        console.log('[Voice Server] From:', req.body.From);
        console.log('[Voice Server] To:', req.body.To);
        console.log('[Voice Server] Body:', req.body.Body);

        try {
            await this.twilioSmsService.handleIncomingSms({
                MessageSid: req.body.MessageSid,
                From: req.body.From,
                To: req.body.To,
                Body: req.body.Body,
                NumMedia: req.body.NumMedia,
                MediaUrl0: req.body.MediaUrl0,
                MediaUrl1: req.body.MediaUrl1,
                MediaUrl2: req.body.MediaUrl2,
                MediaUrl3: req.body.MediaUrl3,
                MediaUrl4: req.body.MediaUrl4
            });

            // Return empty TwiML response
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        } catch (error) {
            console.error('[Voice Server] Error handling incoming SMS:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    private async handleSmsStatus(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] SMS status callback');
        console.log('[Voice Server] MessageSid:', req.body.MessageSid);
        console.log('[Voice Server] MessageStatus:', req.body.MessageStatus);

        try {
            await this.twilioSmsService.handleStatusCallback({
                MessageSid: req.body.MessageSid,
                MessageStatus: req.body.MessageStatus,
                ErrorCode: req.body.ErrorCode,
                ErrorMessage: req.body.ErrorMessage
            });

            // Return success
            res.status(200).send('OK');
        } catch (error) {
            console.error('[Voice Server] Error handling SMS status callback:', error);
            res.status(500).json({ error: 'Internal server error' });
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
