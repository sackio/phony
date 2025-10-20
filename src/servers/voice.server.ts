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

        // Initialize Twilio service
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        this.twilioCallService = new TwilioCallService(twilioClient);

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
        this.app.ws('/call/connection-outgoing/:secret', this.handleOutgoingConnection.bind(this));
        this.app.ws('/call/connection-incoming/:secret', this.handleIncomingConnection.bind(this));

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
                voice: voice,
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

    public start(): void {
        this.httpServer = this.app.listen(this.port);
        this.socketService.initialize(this.httpServer);
    }

    public getHttpServer(): HTTPServer | null {
        return this.httpServer;
    }
}
