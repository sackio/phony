import express, { Request, Response } from 'express';
import { IncomingMessage, ServerResponse } from 'http';
import { ToolRegistry } from './tools/index.js';
import { ResourceRegistry } from './resources/index.js';
import { promptDefinitions, getPromptHandler } from './prompts/index.js';
import { MCPToolCallRequest, MCPResourceReadRequest, MCPPromptExecuteRequest } from './types.js';
import { createToolError } from './utils.js';
import { MCPSSEManager } from './sse-transport.js';

import { CallTranscriptService } from '../services/database/call-transcript.service.js';
import { IncomingConfigService } from '../services/database/incoming-config.service.js';
import { ContextService } from '../services/database/context.service.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { SessionManagerService } from '../services/session-manager.service.js';

/**
 * MCP HTTP Router
 * Implements Model Context Protocol endpoints with JSON-RPC 2.0 and SSE transport support
 */

export function createMCPRouter(
    transcriptService: CallTranscriptService,
    incomingConfigService: IncomingConfigService,
    contextService: ContextService,
    twilioService: TwilioCallService,
    sessionManager: SessionManagerService
): express.Router {
    const router = express.Router();

    // Initialize registries
    const toolRegistry = new ToolRegistry(
        transcriptService,
        incomingConfigService,
        contextService,
        twilioService,
        sessionManager
    );

    const resourceRegistry = new ResourceRegistry(
        transcriptService,
        incomingConfigService,
        contextService,
        twilioService
    );

    // Initialize SSE Manager for MCP HTTP transport
    const sseManager = new MCPSSEManager(
        transcriptService,
        incomingConfigService,
        contextService,
        twilioService,
        sessionManager
    );

    /**
     * GET /mcp/sse - Server-Sent Events endpoint for MCP HTTP transport
     * This establishes the SSE connection that Claude Code uses
     */
    router.get('/sse', async (req: Request, res: Response) => {
        console.log('[MCP] SSE connection requested');

        try {
            await sseManager.handleSSEConnection(res);
        } catch (error: any) {
            console.error('[MCP] SSE connection error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to establish SSE connection' });
            }
        }
    });

    /**
     * POST /mcp/messages - Message endpoint for MCP HTTP transport
     * Claude Code posts JSON-RPC messages here
     */
    router.post('/messages', async (req: Request, res: Response) => {
        const sessionId = req.query.sessionId as string;
        console.log(`[MCP] POST message received for session: ${sessionId}`);

        if (!sessionId) {
            res.status(400).json({ error: 'Missing sessionId query parameter' });
            return;
        }

        if (!sseManager.hasSession(sessionId)) {
            res.status(404).json({ error: `No active session found for sessionId: ${sessionId}` });
            return;
        }

        try {
            // Cast Express req/res to Node.js types for SSEServerTransport
            const nodeReq = req as unknown as IncomingMessage;
            const nodeRes = res as unknown as ServerResponse;

            const success = await sseManager.handlePostMessage(sessionId, nodeReq, nodeRes, req.body);

            if (!success) {
                res.status(500).json({ error: 'Failed to process message' });
            }
            // Note: handlePostMessage sends the response itself (202 Accepted)
        } catch (error: any) {
            console.error('[MCP] POST message error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message || 'Internal server error' });
            }
        }
    });

    /**
     * POST /mcp/rpc - JSON-RPC 2.0 MCP endpoint
     * Standard MCP HTTP transport protocol
     */
    router.post('/rpc', async (req: Request, res: Response) => {
        try {
            const { jsonrpc, method, params, id } = req.body;
            console.log(`[MCP JSON-RPC] ${method}`, params ? JSON.stringify(params).substring(0, 100) : '');

            // Validate JSON-RPC format
            if (jsonrpc !== '2.0') {
                return res.status(400).json({
                    jsonrpc: '2.0',
                    error: { code: -32600, message: 'Invalid Request: must be JSON-RPC 2.0' },
                    id
                });
            }

            let result: any;

            switch (method) {
                case 'initialize':
                    result = {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {},
                            resources: {},
                            prompts: {}
                        },
                        serverInfo: {
                            name: 'phony',
                            version: '1.0.0'
                        }
                    };
                    break;

                case 'initialized':
                    result = {};
                    break;

                case 'ping':
                    result = {};
                    break;

                case 'tools/list':
                    result = { tools: toolRegistry.getDefinitions() };
                    break;

                case 'tools/call':
                    const toolHandler = toolRegistry.getHandler(params?.name);
                    if (!toolHandler) {
                        return res.json({
                            jsonrpc: '2.0',
                            error: { code: -32602, message: `Tool not found: ${params?.name}` },
                            id
                        });
                    }
                    result = await toolHandler(params?.arguments || {});
                    break;

                case 'resources/list':
                    result = { resources: resourceRegistry.getDefinitions() };
                    break;

                case 'resources/read':
                    result = await resourceRegistry.readResource(params?.uri);
                    break;

                case 'prompts/list':
                    result = { prompts: promptDefinitions };
                    break;

                case 'prompts/get':
                    const promptHandler = getPromptHandler(params?.name);
                    if (!promptHandler) {
                        return res.json({
                            jsonrpc: '2.0',
                            error: { code: -32602, message: `Prompt not found: ${params?.name}` },
                            id
                        });
                    }
                    result = await promptHandler(params?.arguments || {});
                    break;

                default:
                    return res.json({
                        jsonrpc: '2.0',
                        error: { code: -32601, message: `Method not found: ${method}` },
                        id
                    });
            }

            res.json({
                jsonrpc: '2.0',
                result,
                id
            });
        } catch (error: any) {
            console.error('[MCP JSON-RPC] Error:', error);
            res.json({
                jsonrpc: '2.0',
                error: { code: -32603, message: error.message || 'Internal error' },
                id: req.body?.id
            });
        }
    });

    // JSON-RPC handler function for reuse
    const handleJsonRpc = async (req: Request, res: Response) => {
        try {
            const { jsonrpc, method, params, id } = req.body;

            // If not JSON-RPC, return 404 for root path
            if (!jsonrpc || !method) {
                return res.status(404).json({ error: 'Not found. Use POST with JSON-RPC 2.0 format.' });
            }

            console.log(`[MCP JSON-RPC] ${method}`, params ? JSON.stringify(params).substring(0, 100) : '');

            if (jsonrpc !== '2.0') {
                return res.status(400).json({
                    jsonrpc: '2.0',
                    error: { code: -32600, message: 'Invalid Request: must be JSON-RPC 2.0' },
                    id
                });
            }

            let result: any;

            switch (method) {
                case 'initialize':
                    result = {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {},
                            resources: {},
                            prompts: {}
                        },
                        serverInfo: {
                            name: 'phony',
                            version: '1.0.0'
                        }
                    };
                    break;

                case 'initialized':
                case 'ping':
                    result = {};
                    break;

                case 'tools/list':
                    result = { tools: toolRegistry.getDefinitions() };
                    break;

                case 'tools/call':
                    const toolHandler = toolRegistry.getHandler(params?.name);
                    if (!toolHandler) {
                        return res.json({
                            jsonrpc: '2.0',
                            error: { code: -32602, message: `Tool not found: ${params?.name}` },
                            id
                        });
                    }
                    result = await toolHandler(params?.arguments || {});
                    break;

                case 'resources/list':
                    result = { resources: resourceRegistry.getDefinitions() };
                    break;

                case 'resources/read':
                    result = await resourceRegistry.readResource(params?.uri);
                    break;

                case 'prompts/list':
                    result = { prompts: promptDefinitions };
                    break;

                case 'prompts/get':
                    const promptHandler = getPromptHandler(params?.name);
                    if (!promptHandler) {
                        return res.json({
                            jsonrpc: '2.0',
                            error: { code: -32602, message: `Prompt not found: ${params?.name}` },
                            id
                        });
                    }
                    result = await promptHandler(params?.arguments || {});
                    break;

                default:
                    return res.json({
                        jsonrpc: '2.0',
                        error: { code: -32601, message: `Method not found: ${method}` },
                        id
                    });
            }

            res.json({
                jsonrpc: '2.0',
                result,
                id
            });
        } catch (error: any) {
            console.error('[MCP JSON-RPC] Error:', error);
            res.json({
                jsonrpc: '2.0',
                error: { code: -32603, message: error.message || 'Internal error' },
                id: req.body?.id
            });
        }
    };

    /**
     * POST /mcp/ - Root JSON-RPC endpoint (for Claude Code compatibility)
     */
    router.post('/', handleJsonRpc);

    /**
     * POST /mcp/list-tools
     * List all available tools (legacy REST endpoint)
     */
    router.post('/list-tools', (req: Request, res: Response) => {
        try {
            console.log('[MCP] list-tools request');

            const tools = toolRegistry.getDefinitions();

            res.json({
                tools
            });
        } catch (error: any) {
            console.error('[MCP] Error listing tools:', error);
            res.status(500).json({
                error: 'Failed to list tools',
                message: error.message
            });
        }
    });

    /**
     * POST /mcp/call-tool
     * Execute a tool
     */
    router.post('/call-tool', async (req: Request, res: Response) => {
        try {
            const request: MCPToolCallRequest = req.body;
            console.log(`[MCP] call-tool: ${request.name}`, request.arguments);

            const handler = toolRegistry.getHandler(request.name);

            if (!handler) {
                return res.status(404).json(
                    createToolError(`Tool not found: ${request.name}`)
                );
            }

            const result = await handler(request.arguments || {});

            res.json(result);
        } catch (error: any) {
            console.error('[MCP] Error calling tool:', error);
            res.status(500).json(
                createToolError('Tool execution failed', { message: error.message })
            );
        }
    });

    /**
     * POST /mcp/list-resources
     * List all available resources
     */
    router.post('/list-resources', (req: Request, res: Response) => {
        try {
            console.log('[MCP] list-resources request');

            const resources = resourceRegistry.getDefinitions();

            res.json({
                resources
            });
        } catch (error: any) {
            console.error('[MCP] Error listing resources:', error);
            res.status(500).json({
                error: 'Failed to list resources',
                message: error.message
            });
        }
    });

    /**
     * POST /mcp/read-resource
     * Read a resource by URI
     */
    router.post('/read-resource', async (req: Request, res: Response) => {
        try {
            const request: MCPResourceReadRequest = req.body;
            console.log(`[MCP] read-resource: ${request.uri}`);

            const result = await resourceRegistry.readResource(request.uri);

            res.json(result);
        } catch (error: any) {
            console.error('[MCP] Error reading resource:', error);
            res.status(500).json({
                error: 'Failed to read resource',
                message: error.message,
                uri: req.body.uri
            });
        }
    });

    /**
     * POST /mcp/list-prompts
     * List all available prompts
     */
    router.post('/list-prompts', (req: Request, res: Response) => {
        try {
            console.log('[MCP] list-prompts request');

            res.json({
                prompts: promptDefinitions
            });
        } catch (error: any) {
            console.error('[MCP] Error listing prompts:', error);
            res.status(500).json({
                error: 'Failed to list prompts',
                message: error.message
            });
        }
    });

    /**
     * POST /mcp/execute-prompt
     * Execute a workflow prompt
     */
    router.post('/execute-prompt', async (req: Request, res: Response) => {
        try {
            const request: MCPPromptExecuteRequest = req.body;
            console.log(`[MCP] execute-prompt: ${request.name}`, request.arguments);

            const handler = getPromptHandler(request.name);

            if (!handler) {
                return res.status(404).json({
                    error: `Prompt not found: ${request.name}`
                });
            }

            const result = await handler(request.arguments || {});

            res.json(result);
        } catch (error: any) {
            console.error('[MCP] Error executing prompt:', error);
            res.status(500).json({
                error: 'Prompt execution failed',
                message: error.message
            });
        }
    });

    return router;
}
