import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { Response as ExpressResponse } from 'express';
import { IncomingMessage, ServerResponse } from 'http';

import { ToolRegistry } from './tools/index.js';
import { ResourceRegistry } from './resources/index.js';
import { promptDefinitions, getPromptHandler } from './prompts/index.js';

import { CallTranscriptService } from '../services/database/call-transcript.service.js';
import { IncomingConfigService } from '../services/database/incoming-config.service.js';
import { ContextService } from '../services/database/context.service.js';
import { TwilioCallService } from '../services/twilio/call.service.js';
import { SessionManagerService } from '../services/session-manager.service.js';

/**
 * MCP SSE Transport Manager
 * Handles Server-Sent Events connections for MCP protocol
 */
export class MCPSSEManager {
    private toolRegistry: ToolRegistry;
    private resourceRegistry: ResourceRegistry;
    private transports: Map<string, SSEServerTransport> = new Map();

    constructor(
        transcriptService: CallTranscriptService,
        incomingConfigService: IncomingConfigService,
        contextService: ContextService,
        twilioService: TwilioCallService,
        sessionManager: SessionManagerService
    ) {
        // Initialize registries
        this.toolRegistry = new ToolRegistry(
            transcriptService,
            incomingConfigService,
            contextService,
            twilioService,
            sessionManager
        );

        this.resourceRegistry = new ResourceRegistry(
            transcriptService,
            incomingConfigService,
            contextService,
            twilioService
        );
    }

    /**
     * Create an MCP Server instance with all tools, resources, and prompts registered
     */
    private createMCPServer(): Server {
        const server = new Server(
            {
                name: 'phony',
                version: '1.0.0'
            },
            {
                capabilities: {
                    tools: {},
                    resources: {},
                    prompts: {}
                }
            }
        );

        // Register tools/list handler
        server.setRequestHandler(ListToolsRequestSchema, async () => {
            const tools = this.toolRegistry.getDefinitions();
            return {
                tools: tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema
                }))
            };
        });

        // Register tools/call handler
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            const handler = this.toolRegistry.getHandler(name);

            if (!handler) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ error: `Tool not found: ${name}` })
                    }],
                    isError: true
                };
            }

            try {
                const result = await handler(args || {});
                return result;
            } catch (error: any) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ error: error.message || 'Tool execution failed' })
                    }],
                    isError: true
                };
            }
        });

        // Register resources/list handler
        server.setRequestHandler(ListResourcesRequestSchema, async () => {
            const resources = this.resourceRegistry.getDefinitions();
            return {
                resources: resources.map(resource => ({
                    uri: resource.uri,
                    name: resource.name,
                    description: resource.description,
                    mimeType: resource.mimeType
                }))
            };
        });

        // Register resources/read handler
        server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const { uri } = request.params;

            try {
                const result = await this.resourceRegistry.readResource(uri);
                return result;
            } catch (error: any) {
                return {
                    contents: [{
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify({ error: error.message || 'Resource read failed' })
                    }]
                };
            }
        });

        // Register prompts/list handler
        server.setRequestHandler(ListPromptsRequestSchema, async () => {
            return {
                prompts: promptDefinitions.map(prompt => ({
                    name: prompt.name,
                    description: prompt.description,
                    arguments: prompt.arguments
                }))
            };
        });

        // Register prompts/get handler
        server.setRequestHandler(GetPromptRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            const handler = getPromptHandler(name);

            if (!handler) {
                throw new Error(`Prompt not found: ${name}`);
            }

            const result = await handler(args || {});
            return result;
        });

        return server;
    }

    /**
     * Handle SSE connection (GET /mcp/sse)
     * This establishes the Server-Sent Events stream
     */
    async handleSSEConnection(res: ExpressResponse): Promise<void> {
        console.log('[MCP SSE] New SSE connection request');

        // Cast Express response to Node.js ServerResponse for SSEServerTransport
        const nodeRes = res as unknown as ServerResponse;

        // Create SSE transport - the endpoint is the relative path for POST messages
        const transport = new SSEServerTransport('/mcp/messages', nodeRes);
        const sessionId = transport.sessionId;

        console.log(`[MCP SSE] Created transport with sessionId: ${sessionId}`);

        // Store transport for message routing
        this.transports.set(sessionId, transport);

        // Clean up on connection close
        res.on('close', () => {
            console.log(`[MCP SSE] Connection closed for sessionId: ${sessionId}`);
            this.transports.delete(sessionId);
        });

        // Create and connect MCP server for this session
        const server = this.createMCPServer();

        try {
            await server.connect(transport);
            console.log(`[MCP SSE] Server connected for sessionId: ${sessionId}`);
        } catch (error) {
            console.error('[MCP SSE] Failed to connect server:', error);
            this.transports.delete(sessionId);
            throw error;
        }
    }

    /**
     * Handle POST message (POST /mcp/messages)
     * Routes incoming JSON-RPC messages to the correct SSE session
     */
    async handlePostMessage(
        sessionId: string,
        req: IncomingMessage,
        res: ServerResponse,
        body?: unknown
    ): Promise<boolean> {
        console.log(`[MCP SSE] POST message for sessionId: ${sessionId}`);

        const transport = this.transports.get(sessionId);

        if (!transport) {
            console.error(`[MCP SSE] No transport found for sessionId: ${sessionId}`);
            return false;
        }

        try {
            await transport.handlePostMessage(req, res, body);
            return true;
        } catch (error) {
            console.error('[MCP SSE] Error handling POST message:', error);
            throw error;
        }
    }

    /**
     * Check if a session exists
     */
    hasSession(sessionId: string): boolean {
        return this.transports.has(sessionId);
    }

    /**
     * Get active session count
     */
    getSessionCount(): number {
        return this.transports.size;
    }
}
