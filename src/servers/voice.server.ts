import dotenv from 'dotenv';
import express, { Response } from 'express';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import ExpressWs from 'express-ws';
import { WebSocket } from 'ws';
import path from 'path';
import twilio from 'twilio';
import { Server as HTTPServer } from 'http';
import { CallType, SmsDirection, SmsStatus } from '../types.js';
import { DYNAMIC_API_SECRET, ENABLE_TEST_RECEIVER, DEFAULT_INCOMING_CALL_MESSAGE, DEFAULT_INCOMING_CALL_VOICE, SMS_PROXY_TARGET_NUMBERS, SMS_PROXY_ENABLED } from '../config/constants.js';
import { CreateSessionOptions, CallSessionManager } from '../services/session-manager.service.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { TwilioSmsService } from '../services/twilio/sms.service.js';
import { TwilioConversationsService } from '../services/twilio/conversations.service.js';
import { ConversationService } from '../services/sms/conversation.service.js';
import { SocketService } from '../services/socket.service.js';
import { CallEventPushService } from '../services/call-event-push.service.js';
import { CallStateService } from '../services/call-state.service.js';
import { IncomingConfigService } from '../services/database/incoming-config.service.js';
import { ContextService } from '../services/database/context.service.js';
import { CallTranscriptService } from '../services/database/call-transcript.service.js';
import { SessionManagerService } from '../services/session-manager.service.js';
import { createMCPRouter } from '../mcp/router.js';
import { VoicemailService } from '../services/voicemail/voicemail.service.js';
import { TempMediaService } from '../services/temp-media.service.js';
import { WebhookDispatcher } from '../services/webhook-dispatcher.service.js';
dotenv.config();

export class VoiceServer {
    private app: express.Application & { ws: any };
    private port: number;
    private sessionManager: CallSessionManager;
    private callbackUrl: string;
    private twilioCallService: TwilioCallService;
    private twilioSmsService: TwilioSmsService;
    private twilioConversationsService: TwilioConversationsService;
    private conversationService: ConversationService;
    private httpServer: HTTPServer | null = null;
    private socketService: SocketService;
    private callStateService: CallStateService;
    private incomingConfigService: IncomingConfigService;
    private contextService: ContextService;
    private transcriptService: CallTranscriptService;
    private voicemailService: VoicemailService;
    private tempMediaService: TempMediaService;
    private webhookDispatcher: WebhookDispatcher;

    constructor(callbackUrl: string, sessionManager: CallSessionManager, transcriptService: CallTranscriptService) {
        this.callbackUrl = callbackUrl;
        this.port = parseInt(process.env.PORT || '3004');
        this.app = ExpressWs(express()).app;
        this.sessionManager = sessionManager;
        this.transcriptService = transcriptService;

        // Initialize Twilio services
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        this.twilioCallService = new TwilioCallService(twilioClient);
        this.twilioConversationsService = new TwilioConversationsService(twilioClient);
        this.twilioSmsService = new TwilioSmsService(twilioClient, this.twilioConversationsService);

        // Initialize SMS and conversation services
        this.conversationService = new ConversationService();

        // Initialize Socket.IO and CallState services
        this.socketService = SocketService.getInstance();
        this.callStateService = CallStateService.getInstance();
        this.incomingConfigService = new IncomingConfigService();
        this.contextService = new ContextService();
        this.voicemailService = new VoicemailService();
        this.tempMediaService = new TempMediaService();
        this.tempMediaService.startCleanup();
        this.webhookDispatcher = new WebhookDispatcher();

        this.configureMiddleware();
        this.setupRoutes();
    }

    private configureMiddleware(): void {
        // Capture the raw JSON body on every request — needed for HMAC verification
        // of the ElevenLabs post-call webhook (signature is over the raw bytes).
        this.app.use(express.json({
            verify: (req, _res, buf) => {
                (req as any).rawBody = buf?.toString('utf8') ?? '';
            },
        }));
        this.app.use(express.urlencoded({ extended: false }));

        // Serve public directory for audio files (hold messages, etc.)
        const publicPath = path.join(process.cwd(), 'public');
        console.log('[Voice Server] Serving public files from:', publicPath);
        this.app.use('/audio', express.static(path.join(publicPath, 'audio')));

        // Serve temp media files (for base64 → public URL MMS support)
        this.app.use('/media/temp', express.static('/tmp/phony-media'));
        // A missing media file must 404, not fall through to the SPA shell —
        // a 200 text/html response silently corrupts naive `curl -o x.jpg` saves
        this.app.use('/media/temp', (_req: express.Request, res: express.Response) => {
            res.status(404).json({ error: 'Media file not found (expired, or lost to a container rebuild before /tmp/phony-media was volume-backed)' });
        });

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

        // Test mode route - for internal testing without consuming voice-provider credits
        if (ENABLE_TEST_RECEIVER) {
            this.app.post('/call/test-receiver', this.handleTestReceiver.bind(this));
            console.log('[Voice Server] Test receiver endpoint enabled at /call/test-receiver');
        }

        // SMS webhook routes
        this.app.post('/sms/incoming', this.handleIncomingSms.bind(this));
        this.app.post('/sms/status', this.handleSmsStatus.bind(this));

        // Voicemail webhook routes
        this.app.post('/voicemail/recording', this.handleVoicemailRecording.bind(this));
        this.app.post('/voicemail/transcription', this.handleVoicemailTranscription.bind(this));
        this.app.post('/call/status', this.handleCallStatus.bind(this));

        // Twilio Conversations webhook (for saving group MMS messages to MongoDB)
        this.app.post('/conversations/webhook', this.handleConversationsWebhook.bind(this));

        // ElevenLabs native integration webhooks (Phase 2 — hybrid outbound)
        // Personalization: ElevenLabs hits this during dial to fetch dynamic
        //   conversation_initiation_client_data for INBOUND calls.
        // Post-call: ElevenLabs hits this after the call ends with the
        //   transcript / call_initiation_failure event.
        // Both routes need raw body for HMAC validation, so register them with
        //   express.json verify hook elsewhere if needed. For now the post-call
        //   handler captures the raw body via req.rawBody (set in middleware).
        this.app.post('/elevenlabs/personalization', this.handleElevenLabsPersonalization.bind(this));
        this.app.post('/elevenlabs/post-call', this.handleElevenLabsPostCall.bind(this));

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
        const fromNumber = req.query.fromNumber?.toString() || req.body.fromNumber || req.body.From;
        const elevenLabsAgentId = req.query.elevenLabsAgentId?.toString() || req.body.elevenLabsAgentId;
        const elevenLabsVoiceId = req.query.elevenLabsVoiceId?.toString() || req.body.elevenLabsVoiceId;

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
            console.log('[Voice Server] Creating call from:', callerNumber, 'to:', toNumber);
            const twilioCallSid = await this.twilioCallService.makeCall(
                this.callbackUrl,
                toNumber,
                systemInstructions,
                callInstructions,
                fromNumber,
                elevenLabsAgentId,
                elevenLabsVoiceId
            );

            // Store call state (will be created in MongoDB when websocket connects)
            this.callStateService.addCall(twilioCallSid, {
                callSid: twilioCallSid,
                twilioCallSid: twilioCallSid,
                toNumber: toNumber,
                fromNumber: callerNumber,
                callType: 'outgoing',
                voiceProvider: 'elevenlabs',
                elevenLabsAgentId: elevenLabsAgentId,
                elevenLabsVoiceId: elevenLabsVoiceId,
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
                provider: 'elevenlabs',
                message: 'Call created successfully using elevenlabs provider'
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
        const elevenLabsAgentId = req.query.elevenLabsAgentId?.toString() || '';
        const elevenLabsVoiceId = req.query.elevenLabsVoiceId?.toString() || '';
        const dtmfScript = req.query.dtmfScript?.toString() || '';

        console.log('[Voice Server] Creating outgoing call via ElevenLabs');

        const twiml = new VoiceResponse();
        const connect = twiml.connect();

        const wsUrl = `${this.callbackUrl.replace('https://', 'wss://')}/call/connection-outgoing/${apiSecret}`;

        const stream = connect.stream({
            url: wsUrl,
        });

        stream.parameter({ name: 'fromNumber', value: fromNumber });
        stream.parameter({ name: 'toNumber', value: toNumber });
        stream.parameter({ name: 'systemInstructions', value: systemInstructions });
        stream.parameter({ name: 'callInstructions', value: callInstructions });
        if (elevenLabsAgentId) {
            stream.parameter({ name: 'elevenLabsAgentId', value: elevenLabsAgentId });
        }
        if (elevenLabsVoiceId) {
            stream.parameter({ name: 'elevenLabsVoiceId', value: elevenLabsVoiceId });
        }
        if (dtmfScript) {
            stream.parameter({ name: 'dtmfScript', value: dtmfScript });
        }

        // Hang up when the stream ends (prevents falling through to voicemail)
        twiml.hangup();

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

        console.log('[Voice Server] Creating hold loop');

        // Create TwiML for hold with music
        const twiml = new VoiceResponse();

        // Play hold music continuously
        twiml.play({ loop: 0 }, 'http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3');

        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
    }

    /**
     * Test receiver endpoint - answers call and stays on line for limited duration
     * This is for internal testing without consuming voice-provider credits
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
        console.log('[Voice Server] Incoming WebSocket connection /call/connection-outgoing');
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

        console.log('[Voice Server] Creating ElevenLabs session for outbound call');

        // ElevenLabs agent/voice IDs come from stream custom parameters (in the start event)
        const options: CreateSessionOptions = {};

        this.sessionManager.createSession(ws, CallType.OUTBOUND, options);
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
            await this.twilioCallService.getTwilioClient()
                .calls(call.twilioCallSid)
                .update({
                    twiml: `<Response><Say voice="Polly.Matthew">Sorry, one moment please.</Say><Play loop="10">http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3</Play></Response>`
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

                    // Inject context into the ElevenLabs session
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

            // Only inject into active session if call is NOT on hold
            if (call.status === 'on_hold') {
                console.log('[Voice Server] Call is on hold - context saved to history but not sent to AI yet');

                // Save updated conversation history to database so it's available on resume
                const conversationHistory = call.conversationHistory || [];
                await this.transcriptService.updateConversationHistory(callSid, conversationHistory);
                console.log(`[Voice Server] Saved ${conversationHistory.length} messages (including context) to database`);

                res.json({ status: 'success', message: 'Context saved (call on hold - will be applied on resume)' });
                return;
            }

            // Inject context into the ElevenLabs session (for active calls)
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
            const {
                phoneNumber, name, systemInstructions, callInstructions, voice, enabled,
                messageOnly, hangupMessage,
                voicemailEnabled, voicemailGreeting, voicemailMaxLength
            } = req.body;

            if (!phoneNumber || !name) {
                res.status(400).json({ error: 'Missing required fields: phoneNumber, name' });
                return;
            }

            // If messageOnly is true, require hangupMessage instead of systemInstructions
            if (messageOnly && !hangupMessage) {
                res.status(400).json({ error: 'hangupMessage is required when messageOnly is true' });
                return;
            }

            // If not messageOnly and not voicemailEnabled, require systemInstructions (AI mode)
            if (!messageOnly && !voicemailEnabled && !systemInstructions) {
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
                hangupMessage,
                voicemailEnabled,
                voicemailGreeting,
                voicemailMaxLength
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
        const callSid = req.body.CallSid;

        // Persist a call record at entry so EVERY inbound call is audited,
        // not just those that reach the AI handler. Idempotent upsert.
        if (callSid) {
            this.transcriptService
                .saveInboundCallEntry({ callSid, fromNumber, toNumber })
                .catch(err => console.error('[Voice Server] Inbound call entry save failed:', err));
        }

        // Fire call.incoming webhook event.
        if (callSid) {
            this.webhookDispatcher.dispatch('call.incoming', {
                call_sid: callSid,
                from: fromNumber,
                to: toNumber,
                direction: 'inbound',
            }, { eventId: `phony-call-incoming-${callSid}` })
                .catch(e => console.error('[Voice Server] call.incoming dispatch error:', e));
        }

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
            // Default behavior: Play SMS redirect message and hang up
            console.log('[Voice Server] No configuration found for', toNumber, '- playing SMS redirect message');
            const twiml = new VoiceResponse();
            twiml.say({ voice: DEFAULT_INCOMING_CALL_VOICE as any }, DEFAULT_INCOMING_CALL_MESSAGE);
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

        // Check if voicemail mode is enabled
        if (config.voicemailEnabled) {
            console.log('[Voice Server] Voicemail mode - recording message');
            const greeting = config.voicemailGreeting || 'Please leave a message after the beep.';
            const maxLength = config.voicemailMaxLength || 120;

            twiml.say({ voice: config.voice }, greeting);
            twiml.record({
                maxLength: maxLength,
                transcribe: true,
                transcribeCallback: `${this.callbackUrl}/voicemail/transcription?apiSecret=${DYNAMIC_API_SECRET}`,
                recordingStatusCallback: `${this.callbackUrl}/voicemail/recording?apiSecret=${DYNAMIC_API_SECRET}&fromNumber=${encodeURIComponent(fromNumber)}&toNumber=${encodeURIComponent(toNumber)}`,
                recordingStatusCallbackEvent: ['completed'],
                playBeep: true,
                finishOnKey: '#'
            });
            twiml.say({ voice: config.voice }, 'Thank you for your message. Goodbye.');
            twiml.hangup();

            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twiml.toString());
            return;
        }

        // Normal AI conversation mode
        const connect = twiml.connect();

        // Get ElevenLabs config
        const elevenLabsAgentId = config.elevenLabsAgentId || '';
        const elevenLabsVoiceId = config.elevenLabsVoiceId || '';

        let wsUrl = `${this.callbackUrl.replace('https://', 'wss://')}/call/connection-incoming/${DYNAMIC_API_SECRET}`;
        if (elevenLabsAgentId) {
            wsUrl += `?elevenLabsAgentId=${encodeURIComponent(elevenLabsAgentId)}`;
            if (elevenLabsVoiceId) {
                wsUrl += `&elevenLabsVoiceId=${encodeURIComponent(elevenLabsVoiceId)}`;
            }
        } else if (elevenLabsVoiceId) {
            wsUrl += `?elevenLabsVoiceId=${encodeURIComponent(elevenLabsVoiceId)}`;
        }

        const stream = connect.stream({
            url: wsUrl,
        });

        stream.parameter({ name: 'fromNumber', value: fromNumber });
        stream.parameter({ name: 'toNumber', value: toNumber });
        stream.parameter({ name: 'configName', value: config.name });
        stream.parameter({ name: 'systemInstructions', value: config.systemInstructions });
        stream.parameter({ name: 'callInstructions', value: config.callInstructions });
        if (elevenLabsAgentId) {
            stream.parameter({ name: 'elevenLabsAgentId', value: elevenLabsAgentId });
        }
        if (elevenLabsVoiceId) {
            stream.parameter({ name: 'elevenLabsVoiceId', value: elevenLabsVoiceId });
        }

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

        const elevenLabsAgentId = req.query.elevenLabsAgentId?.toString();
        const elevenLabsVoiceId = req.query.elevenLabsVoiceId?.toString();

        console.log('[Voice Server] Creating ElevenLabs session for inbound call');

        const options: CreateSessionOptions = {
            elevenLabsAgentId,
            elevenLabsVoiceId
        };

        this.sessionManager.createSession(ws, CallType.INBOUND, options);
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

    /**
     * Handle voicemail recording completion callback from Twilio
     */
    private async handleVoicemailRecording(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] Voicemail recording callback');
        console.log('[Voice Server] Recording body:', JSON.stringify(req.body, null, 2));

        // Verify API secret
        const apiSecret = req.query.apiSecret?.toString();
        if (apiSecret !== DYNAMIC_API_SECRET) {
            console.log('[Voice Server] 401: Unauthorized - Invalid or missing API secret');
            res.status(401).json({ error: 'Unauthorized: Invalid or missing API secret' });
            return;
        }

        try {
            const {
                CallSid,
                RecordingSid,
                RecordingUrl,
                RecordingDuration
            } = req.body;

            // Get phone numbers from query params (passed in the callback URL)
            const fromNumber = req.query.fromNumber?.toString() || '';
            const toNumber = req.query.toNumber?.toString() || '';

            console.log(`[Voice Server] Voicemail recorded: ${RecordingSid}`);
            console.log(`[Voice Server] From: ${fromNumber}, To: ${toNumber}`);
            console.log(`[Voice Server] Duration: ${RecordingDuration}s`);
            console.log(`[Voice Server] URL: ${RecordingUrl}`);

            // Create voicemail record in database
            await this.voicemailService.createVoicemail({
                callSid: CallSid,
                recordingSid: RecordingSid,
                fromNumber,
                toNumber,
                duration: parseInt(RecordingDuration) || 0,
                recordingUrl: RecordingUrl
            });

            const duration = parseInt(RecordingDuration) || 0;

            // Mark the call record (saved at /call/incoming entry) as completed
            // with the voicemail's recording duration.
            if (CallSid) {
                this.transcriptService
                    .markCallCompleted(CallSid, 'completed', duration)
                    .catch(err => console.error('[Voice Server] markCallCompleted failed:', err));
            }

            // Fire voicemail.received webhook event.
            this.webhookDispatcher.dispatch('voicemail.received', {
                recording_sid: RecordingSid,
                call_sid: CallSid,
                from: fromNumber,
                to: toNumber,
                duration_sec: duration,
                recording_url: RecordingUrl,
                transcription_status: 'pending',
            }, { eventId: `phony-vm-recv-${RecordingSid}` })
                .catch(e => console.error('[Voice Server] voicemail.received dispatch error:', e));

            const notifBody = `New voicemail from ${fromNumber} on ${toNumber} (${duration}s). Transcription pending...`;
            if (SMS_PROXY_ENABLED && fromNumber) {
                for (const target of SMS_PROXY_TARGET_NUMBERS) {
                    try {
                        await this.twilioSmsService.sendSms(target, notifBody, process.env.TWILIO_NUMBER, undefined, { skipNotification: true });
                    } catch (err) {
                        console.error(`[Voice Server] Voicemail notification to ${target} failed:`, err);
                    }
                }
            }

            res.status(200).send('OK');
        } catch (error) {
            console.error('[Voice Server] Error handling voicemail recording:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Call status callback from Twilio — fires on terminal call states
     * (completed / busy / no-answer / canceled / failed). Updates the call
     * record persisted at /call/incoming entry with duration + final status.
     *
     * Wire via TwiML `statusCallback` / IncomingPhoneNumber statusCallback
     * pointing at `${PUBLIC_URL}/call/status`. Authorization is via callSid
     * existence in our DB — Twilio doesn't sign these like auth-secret webhooks,
     * so we only accept status updates for callSids we already know about.
     */
    private async handleCallStatus(req: express.Request, res: Response): Promise<void> {
        res.status(200).send('OK'); // always ack fast
        const {
            CallSid,
            CallStatus,
            CallDuration,
            ErrorMessage,
        } = req.body;
        if (!CallSid || !CallStatus) return;

        const duration = CallDuration ? parseInt(CallDuration) : undefined;
        const terminal = ['completed', 'busy', 'no-answer', 'canceled', 'failed'];
        if (!terminal.includes(CallStatus)) return;

        const status = CallStatus === 'completed' ? 'completed' : 'failed';
        const err = CallStatus !== 'completed' ? `Twilio status: ${CallStatus}${ErrorMessage ? ` — ${ErrorMessage}` : ''}` : undefined;
        try {
            await this.transcriptService.markCallCompleted(CallSid, status, duration, err);
            console.log(`[Voice Server] /call/status ${CallSid} → ${CallStatus}${duration ? ` (${duration}s)` : ''}`);
        } catch (error) {
            console.error('[Voice Server] Error in /call/status:', error);
        }

        // Final flush + terminal event for the live-call push stream. Must run
        // even if markCallCompleted threw above: a controlling agent that never
        // receives call.ended is left waiting on a call that is already over,
        // which is worse than not having subscribed at all.
        await CallEventPushService.getInstance()
            .end(CallSid, { twilio_status: CallStatus, duration_seconds: duration ?? null, error: err ?? null })
            .catch((e: unknown) => console.error('[Voice Server] call push end failed:', e));

        // Look up the persisted record for from/to + direction. Fall back to
        // unknowns; webhook receivers should tolerate nulls there.
        const CallModel = (await import('../models/call.model.js')).CallModel;
        const callRecord = await CallModel.findOne({ callSid: CallSid }).lean().catch(() => null) as any;

        if (CallStatus === 'completed') {
            this.webhookDispatcher.dispatch('call.ended', {
                call_sid: CallSid,
                from: callRecord?.fromNumber ?? null,
                to: callRecord?.toNumber ?? null,
                direction: callRecord?.callType === 'outgoing' ? 'outbound' : 'inbound',
                duration_sec: duration ?? 0,
                ended_at: new Date().toISOString(),
                recording_url: callRecord?.recordingUrl ?? null,
            }, { eventId: `phony-call-ended-${CallSid}` })
                .catch(e => console.error('[Voice Server] call.ended dispatch error:', e));
        } else {
            this.webhookDispatcher.dispatch('call.failed', {
                call_sid: CallSid,
                from: callRecord?.fromNumber ?? null,
                to: callRecord?.toNumber ?? null,
                direction: callRecord?.callType === 'outgoing' ? 'outbound' : 'inbound',
                reason: CallStatus,
                error_message: ErrorMessage ?? null,
            }, { eventId: `phony-call-failed-${CallSid}-${CallStatus}` })
                .catch(e => console.error('[Voice Server] call.failed dispatch error:', e));
        }
    }

    /**
     * Handle voicemail transcription callback from Twilio
     */
    private async handleVoicemailTranscription(req: express.Request, res: Response): Promise<void> {
        console.log('[Voice Server] Voicemail transcription callback');
        console.log('[Voice Server] Transcription body:', JSON.stringify(req.body, null, 2));

        // Verify API secret
        const apiSecret = req.query.apiSecret?.toString();
        if (apiSecret !== DYNAMIC_API_SECRET) {
            console.log('[Voice Server] 401: Unauthorized - Invalid or missing API secret');
            res.status(401).json({ error: 'Unauthorized: Invalid or missing API secret' });
            return;
        }

        try {
            const {
                RecordingSid,
                TranscriptionSid,
                TranscriptionText,
                TranscriptionStatus
            } = req.body;

            console.log(`[Voice Server] Transcription for recording: ${RecordingSid}`);
            console.log(`[Voice Server] Status: ${TranscriptionStatus}`);
            console.log(`[Voice Server] Text: ${TranscriptionText}`);

            if (TranscriptionStatus === 'completed' && TranscriptionText) {
                // Update voicemail with transcription
                await this.voicemailService.updateTranscription(
                    RecordingSid,
                    TranscriptionText,
                    TranscriptionSid
                );
                console.log(`[Voice Server] Voicemail transcription saved for ${RecordingSid}`);

                const voicemail = await this.voicemailService.getVoicemail(RecordingSid);
                const vmFrom = voicemail?.fromNumber || 'unknown';

                // Fire voicemail.transcribed webhook event.
                this.webhookDispatcher.dispatch('voicemail.transcribed', {
                    recording_sid: RecordingSid,
                    call_sid: voicemail?.callSid ?? null,
                    from: voicemail?.fromNumber ?? null,
                    to: voicemail?.toNumber ?? null,
                    transcription: TranscriptionText,
                    duration_sec: voicemail?.duration ?? 0,
                }, { eventId: `phony-vm-trans-${RecordingSid}` })
                    .catch(e => console.error('[Voice Server] voicemail.transcribed dispatch error:', e));
                const preview = TranscriptionText.length > 1400 ? TranscriptionText.substring(0, 1400) + '...' : TranscriptionText;
                const transcriptBody = `Voicemail from ${vmFrom}: "${preview}"`;
                if (SMS_PROXY_ENABLED && vmFrom !== 'unknown') {
                    for (const target of SMS_PROXY_TARGET_NUMBERS) {
                        try {
                            await this.twilioSmsService.sendSms(target, transcriptBody, process.env.TWILIO_NUMBER, undefined, { skipNotification: true });
                        } catch (err) {
                            console.error(`[Voice Server] Transcription SMS to ${target} failed:`, err);
                        }
                    }
                }
            } else if (TranscriptionStatus === 'failed') {
                // Mark transcription as failed
                await this.voicemailService.markTranscriptionFailed(
                    RecordingSid,
                    'Twilio transcription failed'
                );
                console.log(`[Voice Server] Voicemail transcription failed for ${RecordingSid}`);

                const failedVm = await this.voicemailService.getVoicemail(RecordingSid);
                const failedFrom = failedVm?.fromNumber || 'unknown';
                const failBody = `Voicemail from ${failedFrom} (transcription failed - check recording)`;
                if (SMS_PROXY_ENABLED && failedFrom !== 'unknown') {
                    for (const target of SMS_PROXY_TARGET_NUMBERS) {
                        try {
                            await this.twilioSmsService.sendSms(target, failBody, process.env.TWILIO_NUMBER, undefined, { skipNotification: true });
                        } catch (err) {
                            console.error(`[Voice Server] Failure SMS to ${target} failed:`, err);
                        }
                    }
                }
            }

            res.status(200).send('OK');
        } catch (error) {
            console.error('[Voice Server] Error handling voicemail transcription:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Twilio Conversations webhook.
     *
     *   onConversationAdded     → register group + allocate slug + notify Ben/Laura
     *   onConversationRemoved   → drop the local GroupConversation row + free the slug
     *   onParticipantAdded      → update externals + notify about join
     *   onParticipantRemoved    → update externals + notify about leave
     *   onMessageAdded          → fan out 1-on-1 SMS to proxy targets (unless
     *                             the message was authored by Phony itself)
     *
     * We respond 200 OK fast and do real work async so Twilio doesn't retry.
     */
    private async handleConversationsWebhook(req: express.Request, res: Response): Promise<void> {
        const {
            EventType,
            ConversationSid,
            MessageSid,
            Author,
            Body,
            Media,
            FriendlyName,
        } = req.body;
        const bindingAddress = req.body['MessagingBinding.Address'] || req.body.MessagingBindingAddress;
        const bindingProjected = req.body['MessagingBinding.ProjectedAddress'] || req.body.MessagingBindingProjectedAddress;

        console.log(`[Conv Webhook] ${EventType} conv=${ConversationSid} author=${Author || '-'} binding=${bindingAddress || bindingProjected || '-'}`);
        res.status(200).send('OK');

        if (!ConversationSid) return;

        try {
            if (EventType === 'onConversationAdded') {
                await this.onGroupConversationCreated(ConversationSid, FriendlyName);
                return;
            }

            if (EventType === 'onConversationRemoved') {
                await this.onGroupConversationRemoved(ConversationSid);
                return;
            }

            if (EventType === 'onParticipantAdded') {
                await this.onGroupParticipantAdded(ConversationSid, bindingAddress, bindingProjected);
                return;
            }

            if (EventType === 'onParticipantRemoved') {
                await this.onGroupParticipantRemoved(ConversationSid, bindingAddress, bindingProjected);
                return;
            }

            if (EventType === 'onMessageAdded') {
                // Twilio Conversations post-event webhook sends `Media` as a
                // JSON-encoded array of objects: [{Sid, ContentType, Filename, Size, ...}].
                // We rehost each to a stable URL under /media/temp/permanent/.
                const mediaUrls = await this.ingestConversationMedia(ConversationSid, Media);
                await this.onGroupMessageAdded(ConversationSid, MessageSid, Author, Body, mediaUrls);
            }
        } catch (error) {
            console.error('[Conv Webhook] Async error:', error);
        }
    }

    /**
     * Parse the `Media` payload from a Conversations onMessageAdded webhook,
     * fetch each media resource from Twilio MCS, persist locally, and return
     * durable public URLs suitable for storage in SmsModel.mediaUrls.
     *
     * Returns an empty array on no media, malformed payload, or if every
     * individual fetch fails (errors are logged but don't fail the whole
     * webhook — the text body still saves).
     */
    private async ingestConversationMedia(conversationSid: string, mediaField: unknown): Promise<string[]> {
        if (!mediaField) return [];
        let items: Array<{ Sid?: string; ContentType?: string; Filename?: string }> = [];
        try {
            if (typeof mediaField === 'string') {
                const parsed = JSON.parse(mediaField);
                if (Array.isArray(parsed)) items = parsed;
            } else if (Array.isArray(mediaField)) {
                items = mediaField as any[];
            }
        } catch (err) {
            console.error('[Conv Webhook] Malformed Media payload:', err);
            return [];
        }
        if (items.length === 0) return [];

        let chatServiceSid: string;
        try {
            chatServiceSid = await this.twilioConversationsService.getChatServiceSid(conversationSid);
        } catch (err: any) {
            console.error(`[Conv Webhook] Cannot resolve chatServiceSid for ${conversationSid}:`, err.message);
            return [];
        }

        const urls: string[] = [];
        for (const item of items) {
            if (!item.Sid) continue;
            try {
                const url = await this.tempMediaService.saveFromTwilioMedia(
                    item.Sid,
                    item.ContentType || 'application/octet-stream',
                    item.Filename,
                    process.env.TWILIO_ACCOUNT_SID!,
                    process.env.TWILIO_AUTH_TOKEN!,
                    chatServiceSid,
                );
                urls.push(url);
                console.log(`[Conv Webhook] Ingested media ${item.Sid} (${item.ContentType || '?'}) → ${url}`);
            } catch (err: any) {
                console.error(`[Conv Webhook] Failed to ingest media ${item.Sid}:`, err.message);
            }
        }
        return urls;
    }

    private async onGroupConversationCreated(conversationSid: string, friendlyName?: string): Promise<void> {
        // Ensure Phony is a projectedAddress participant (idempotent).
        const twilioNumber = process.env.TWILIO_NUMBER!;
        try {
            await this.twilioConversationsService.ensureSystemParticipant(conversationSid, twilioNumber);
        } catch (err: any) {
            console.error(`[Conv Webhook] ensureSystemParticipant failed:`, err.message);
        }

        let externals: string[] = [];
        try {
            externals = await this.twilioConversationsService.getExternalAddresses(conversationSid);
        } catch (err) {
            console.error(`[Conv Webhook] getExternalAddresses failed:`, err);
        }

        const { slug, isNew } = await this.twilioSmsService.registerGroup(
            conversationSid,
            twilioNumber,
            externals,
            friendlyName
        );
        if (!isNew) return;

        // Fire conversation.created webhook event.
        this.webhookDispatcher.dispatch('conversation.created', {
            conversation_sid: conversationSid,
            slug,
            friendly_name: friendlyName ?? null,
            twilio_number: twilioNumber,
            external_participants: externals,
        }, { eventId: `phony-conv-created-${conversationSid}` })
            .catch(e => console.error('[Voice Server] conversation.created dispatch error:', e));

        const externalsSet = new Set(externals);
        const participantList = externals.length ? externals.join(', ') : '(no externals yet)';
        const intro = `📥 New group {${slug}} — ${participantList}\n---\nReply in thread: {${slug}}: msg`;
        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            if (externalsSet.has(target)) continue; // already in group; not duplicative noise
            this.twilioSmsService
                .sendSms(target, intro, twilioNumber, undefined, { skipNotification: true })
                .catch(err => console.error(`[Conv Webhook] Group intro to ${target} failed:`, err));
        }
    }

    private async onGroupParticipantAdded(conversationSid: string, address?: string, projected?: string): Promise<void> {
        if (projected) return; // the Phony system participant — not interesting
        if (!address) return;

        const twilioNumber = process.env.TWILIO_NUMBER!;
        const externals = await this.twilioConversationsService.getExternalAddresses(conversationSid).catch(() => [] as string[]);
        const { slug } = await this.twilioSmsService.registerGroup(conversationSid, twilioNumber, externals);

        // Fire conversation.participant_added webhook event.
        this.webhookDispatcher.dispatch('conversation.participant_added', {
            conversation_sid: conversationSid,
            slug,
            address,
        }).catch(e => console.error('[Voice Server] conversation.participant_added dispatch error:', e));

        const externalsSet = new Set(externals);
        const note = `👥 {${slug}} joined: ${address}`;
        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            if (target === address) continue;
            if (externalsSet.has(target)) continue; // already in group; they see joins natively
            this.twilioSmsService
                .sendSms(target, note, twilioNumber, undefined, { skipNotification: true })
                .catch(err => console.error(`[Conv Webhook] Join note to ${target} failed:`, err));
        }
    }

    private async onGroupConversationRemoved(conversationSid: string): Promise<void> {
        const slug = TwilioSmsService.getGroupSlug(conversationSid);
        await this.twilioSmsService.unregisterGroup(conversationSid);

        // Fire conversation.removed webhook event (even if no slug was registered).
        this.webhookDispatcher.dispatch('conversation.removed', {
            conversation_sid: conversationSid,
            slug: slug ?? null,
        }, { eventId: `phony-conv-removed-${conversationSid}` })
            .catch(e => console.error('[Voice Server] conversation.removed dispatch error:', e));

        if (!slug) return;

        const twilioNumber = process.env.TWILIO_NUMBER!;
        const note = `🗑️ Group {${slug}} was removed.`;
        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            this.twilioSmsService
                .sendSms(target, note, twilioNumber, undefined, { skipNotification: true })
                .catch(err => console.error(`[Conv Webhook] Removal note to ${target} failed:`, err));
        }
    }

    private async onGroupParticipantRemoved(conversationSid: string, address?: string, projected?: string): Promise<void> {
        if (projected) return; // Phony system participant leaving — shouldn't happen but not interesting
        if (!address) return;

        const twilioNumber = process.env.TWILIO_NUMBER!;
        // Refresh the group's external list from Twilio (participant is already gone at this point)
        const externals = await this.twilioConversationsService.getExternalAddresses(conversationSid).catch(() => [] as string[]);
        await this.twilioSmsService.updateGroupExternals(conversationSid, externals);

        const slug = TwilioSmsService.getGroupSlug(conversationSid);

        // Fire conversation.participant_removed webhook event.
        this.webhookDispatcher.dispatch('conversation.participant_removed', {
            conversation_sid: conversationSid,
            slug: slug ?? null,
            address,
        }).catch(e => console.error('[Voice Server] conversation.participant_removed dispatch error:', e));

        if (!slug) return;

        const externalsSet = new Set(externals);
        const note = `👥 {${slug}} left: ${address}`;
        for (const target of SMS_PROXY_TARGET_NUMBERS) {
            if (target === address) continue;
            if (externalsSet.has(target)) continue; // still in group; they see leaves natively
            this.twilioSmsService
                .sendSms(target, note, twilioNumber, undefined, { skipNotification: true })
                .catch(err => console.error(`[Conv Webhook] Leave note to ${target} failed:`, err));
        }
    }

    private async onGroupMessageAdded(
        conversationSid: string,
        messageSid: string | undefined,
        author: string | undefined,
        body: string | undefined,
        mediaUrls: string[]
    ): Promise<void> {
        if (!author) return;
        await this.twilioSmsService.processInboundGroupMessage(
            conversationSid,
            messageSid,
            author,
            body || '',
            mediaUrls,
        );
    }

    /**
     * Personalization webhook for the ElevenLabs native Twilio integration.
     *
     * ElevenLabs hits this URL during the Twilio dialing period (before audio
     * connects). The response body becomes the conversation_initiation_client_data,
     * letting us inject per-caller dynamic variables and override the agent's
     * prompt / first message / voice based on which Phony number was called.
     *
     * Request body: { caller_id, agent_id, called_number, call_sid }
     * Response body: conversation_initiation_client_data (see ElevenLabs docs)
     *
     * If there's no IncomingConfig for the called number, we return a minimal
     * response — ElevenLabs falls back to the agent defaults.
     */
    private async handleElevenLabsPersonalization(req: express.Request, res: Response): Promise<void> {
        const { caller_id, agent_id, called_number, call_sid } = req.body || {};
        console.log(`[EL Personalization] caller=${caller_id} agent=${agent_id} called=${called_number} call_sid=${call_sid}`);

        const baseResponse: any = {
            type: 'conversation_initiation_client_data',
            dynamic_variables: {
                caller_id: caller_id || '',
                called_number: called_number || '',
                call_sid: call_sid || '',
                source: 'phony',
            },
        };

        try {
            if (!called_number) {
                res.json(baseResponse);
                return;
            }

            const cfg = await this.incomingConfigService.getConfigByNumber(called_number);
            if (!cfg) {
                console.log(`[EL Personalization] No IncomingConfig for ${called_number}; returning base response`);
                res.json(baseResponse);
                return;
            }

            const override: any = { agent: {} };
            if (cfg.systemInstructions) override.agent.prompt = { prompt: cfg.systemInstructions };
            if (cfg.callInstructions) override.agent.first_message = cfg.callInstructions;
            // We deliberately don't override TTS voice here — the agent's
            // configured voice + the per-call override at make-call time win.

            baseResponse.conversation_config_override = override;
            res.json(baseResponse);
            console.log(`[EL Personalization] Returned override for ${called_number} (config "${cfg.name}")`);
        } catch (error) {
            console.error('[EL Personalization] Error:', error);
            // Always return *something* — failing here would block the call entirely
            res.json(baseResponse);
        }
    }

    /**
     * Post-call webhook for the ElevenLabs native Twilio integration.
     *
     * ElevenLabs hits this URL after a call ends. Body is one of:
     *   - { type: "post_call_transcription", data: { ...full transcript, metadata... } }
     *   - { type: "call_initiation_failure", data: { ...reason, callSid... } }
     *
     * Body is signed with HMAC-SHA256 using ELEVENLABS_POSTCALL_WEBHOOK_SECRET.
     * Header `ElevenLabs-Signature` carries `t=<unix_ts>,v0=<hex_signature>`.
     * Verify or 401.
     *
     * We extract the conversation_id + callSid, link back to the Call row,
     * save the full transcript, and mark the call completed/failed.
     */
    private async handleElevenLabsPostCall(req: express.Request, res: Response): Promise<void> {
        const rawBody = (req as any).rawBody ?? JSON.stringify(req.body ?? {});
        const signature = req.headers['elevenlabs-signature'] || req.headers['x-elevenlabs-signature'];

        const { ELEVENLABS_POSTCALL_WEBHOOK_SECRET } = await import('../config/constants.js');
        if (ELEVENLABS_POSTCALL_WEBHOOK_SECRET) {
            const verified = this.verifyElevenLabsSignature(
                rawBody,
                typeof signature === 'string' ? signature : '',
                ELEVENLABS_POSTCALL_WEBHOOK_SECRET,
            );
            if (!verified) {
                console.warn('[EL Post-call] Invalid signature — rejecting');
                res.status(401).json({ error: 'invalid signature' });
                return;
            }
        } else {
            console.warn('[EL Post-call] No webhook secret configured — accepting unverified body');
        }

        // Ack fast — process async so ElevenLabs doesn't retry.
        res.status(200).json({ ok: true });

        try {
            const eventType = req.body?.type;
            const data = req.body?.data ?? {};
            const conversationId = data.conversation_id ?? data.conversationId;
            const callSid = data.callSid ?? data.call_sid;

            console.log(`[EL Post-call] event=${eventType} conv=${conversationId} call=${callSid}`);

            const { CallModel } = await import('../models/call.model.js');
            const callDoc = await CallModel.findOne(
                conversationId
                    ? { elevenLabsConversationId: conversationId }
                    : (callSid ? { callSid } : {})
            );

            if (eventType === 'post_call_transcription' || eventType === 'transcription') {
                const transcript = this.extractTranscriptFromPostCall(data);
                const durationSec = data.metadata?.call_duration_secs ?? data.duration_seconds ?? data.duration ?? 0;
                const endedAt = data.metadata?.accepted_at ? new Date(data.metadata.accepted_at * 1000) : new Date();

                if (callDoc) {
                    callDoc.conversationHistory = transcript;
                    callDoc.endedAt = endedAt;
                    callDoc.duration = durationSec;
                    callDoc.status = 'completed';
                    if (!callDoc.elevenLabsConversationId && conversationId) callDoc.elevenLabsConversationId = conversationId;
                    await callDoc.save();
                    console.log(`[EL Post-call] Saved transcript to call ${callDoc.callSid} (${transcript.length} turns, ${durationSec}s)`);
                } else {
                    console.warn(`[EL Post-call] No Call row found for conv=${conversationId} call=${callSid}; transcript not persisted`);
                }
            } else if (eventType === 'call_initiation_failure' || eventType === 'post_call_failure') {
                const reason = data.failure_reason ?? data.reason ?? 'unknown';
                if (callDoc) {
                    callDoc.status = 'failed';
                    callDoc.errorMessage = `ElevenLabs: ${reason}`;
                    await callDoc.save();
                }
                console.error(`[EL Post-call] Call failure: ${reason}`);
            } else {
                console.log(`[EL Post-call] Unhandled event type: ${eventType}`);
            }
        } catch (error) {
            console.error('[EL Post-call] Processing error:', error);
        }
    }

    /**
     * Verify HMAC-SHA256 signature on the post-call webhook body.
     * Format follows the Stripe-style `t=<unix_ts>,v0=<hex>` convention.
     * Returns true if valid, false otherwise.
     */
    private verifyElevenLabsSignature(rawBody: string, headerValue: string, secret: string): boolean {
        if (!headerValue) return false;
        const parts = Object.fromEntries(
            headerValue.split(',').map(p => p.trim().split('=', 2)) as [string, string][]
        );
        const ts = parts.t;
        const sig = parts.v0;
        if (!ts || !sig) return false;

        // Reject signatures older than 30 minutes to limit replay window
        const tsNum = parseInt(ts, 10);
        if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 1800) {
            console.warn(`[EL Post-call] Signature timestamp too old or invalid: t=${ts}`);
            return false;
        }

        // ElevenLabs signs `<ts>.<rawBody>` with HMAC-SHA256, using the secret
        // string AS-IS (including the `wsec_` prefix — empirically verified
        // 2026-06-05). Format: `t=<unix_ts>,v0=<hex_signature>`, Stripe-style.
        const { createHmac, timingSafeEqual } = require('node:crypto') as typeof import('node:crypto');
        const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
        try {
            return sig.length === expected.length
                && timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
        } catch {
            return false;
        }
    }

    /**
     * Pull the conversation history out of ElevenLabs' post-call transcript shape.
     * Tries the common field names; falls back to an empty array.
     */
    private extractTranscriptFromPostCall(data: any): Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: Date }> {
        const turns = data?.transcript ?? data?.conversation?.transcript ?? data?.messages ?? [];
        if (!Array.isArray(turns)) return [];
        return turns
            .map((t: any) => {
                const rawRole = t.role ?? t.speaker ?? t.from ?? '';
                const role: 'user' | 'assistant' | 'system' =
                    rawRole === 'user' ? 'user'
                    : rawRole === 'agent' || rawRole === 'assistant' ? 'assistant'
                    : 'system';
                const content = t.message ?? t.text ?? t.content ?? '';
                const tsRaw = t.time_in_call_secs ?? t.timestamp ?? t.created_at;
                let timestamp = new Date();
                if (typeof tsRaw === 'number') timestamp = new Date(tsRaw < 1e12 ? tsRaw * 1000 : tsRaw);
                else if (typeof tsRaw === 'string') timestamp = new Date(tsRaw);
                return { role, content, timestamp };
            })
            .filter((m: any) => m.content);
    }

    public start(): void {
        this.httpServer = this.app.listen(this.port);
        this.socketService.initialize(this.httpServer);

        // Load SMS proxy state (codes + slugs) from DB after server starts
        this.twilioSmsService.loadProxyState().catch(err =>
            console.error('[Voice Server] Failed to load SMS proxy state:', err)
        );

        // Twilio webhook drift check (one-shot, on boot). Loudly warns if any
        // IncomingPhoneNumber has a voice/status/sms URL that doesn't point at
        // Phony — catches "silent intercept" hijacks like the ElevenLabs Phase 0
        // import on June 5, 2026 that rewrote +18575550111's voiceUrl and
        // routed 4 days of inbound to the agent before drift was noticed.
        // Daily cron complement: scripts/check-twilio-webhooks.ts
        this.runStartupWebhookAudit().catch(err =>
            console.error('[Voice Server] Webhook audit failed:', err?.message ?? err)
        );
    }

    private async runStartupWebhookAudit(): Promise<void> {
        const { TwilioWebhookAuditService } = await import('../services/twilio/webhook-audit.service.js');
        const publicUrl = process.env.PUBLIC_URL || '';
        if (!publicUrl) {
            console.warn('[Voice Server] PUBLIC_URL not set — skipping webhook audit');
            return;
        }
        const client = this.twilioCallService.getTwilioClient();
        const audit = new TwilioWebhookAuditService(client, publicUrl);
        const result = await audit.audit();
        const report = TwilioWebhookAuditService.formatReport(result);

        if (result.ok) {
            console.log('[Voice Server] ' + report.split('\n')[0]); // single-line confirmation
        } else {
            // Loud, multi-line — survives log scanning, prefixed for grep.
            console.error('====== TWILIO WEBHOOK DRIFT DETECTED ======');
            console.error(report);
            console.error('===========================================');
            console.error('Action: fix the Twilio IncomingPhoneNumber config (or update PUBLIC_URL).');
        }
    }

    public getHttpServer(): HTTPServer | null {
        return this.httpServer;
    }
}
