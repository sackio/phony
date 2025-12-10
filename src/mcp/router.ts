import express, { Request, Response } from 'express';
import { ToolRegistry } from './tools/index.js';
import { ResourceRegistry } from './resources/index.js';
import { promptDefinitions, getPromptHandler } from './prompts/index.js';
import { MCPToolCallRequest, MCPResourceReadRequest, MCPPromptExecuteRequest } from './types.js';
import { createToolError } from './utils.js';

import { CallTranscriptService } from '../services/database/call-transcript.service.js';
import { IncomingConfigService } from '../services/database/incoming-config.service.js';
import { ContextService } from '../services/database/context.service.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { SessionManagerService } from '../services/session-manager.service.js';

/**
 * MCP HTTP Router
 * Implements Model Context Protocol endpoints
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

    /**
     * POST /mcp/list-tools
     * List all available tools
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
