import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { CallTranscriptService } from '../../services/database/call-transcript.service.js';
import { IncomingConfigService } from '../../services/database/incoming-config.service.js';
import { ContextService } from '../../services/database/context.service.js';
import { WebhookConfigService } from '../../services/database/webhook-config.service.js';
import { WebhookDispatcher } from '../../services/webhook-dispatcher.service.js';
import { TwilioCallService } from '../../services/twilio/call.service.js';
import { SessionManagerService } from '../../services/session-manager.service.js';

import { callToolsDefinitions, createCallToolHandlers } from './calls.tools.js';
import { incomingToolsDefinitions, createIncomingToolHandlers } from './incoming.tools.js';
import { contextsToolsDefinitions, createContextsToolHandlers } from './contexts.tools.js';
import { debugToolsDefinitions, createDebugToolHandlers } from './debug.tools.js';
import { smsToolsDefinitions, createSmsToolHandlers } from './sms.tools.js';
import { webhookToolsDefinitions, createWebhookToolHandlers } from './webhook.tools.js';
import { voicemailToolsDefinitions, createVoicemailToolHandlers } from './voicemail.tools.js';
import { tagsToolsDefinitions, createTagsToolHandlers } from './tags.tools.js';

/**
 * Tool Registry
 * Combines all tool definitions and handlers
 */

export class ToolRegistry {
    private definitions: MCPToolDefinition[];
    private handlers: Map<string, MCPToolHandler>;

    constructor(
        transcriptService: CallTranscriptService,
        incomingConfigService: IncomingConfigService,
        contextService: ContextService,
        twilioService: TwilioCallService,
        sessionManager: SessionManagerService
    ) {
        // Combine all tool definitions
        this.definitions = [
            ...callToolsDefinitions,
            ...incomingToolsDefinitions,
            ...contextsToolsDefinitions,
            ...debugToolsDefinitions,
            ...smsToolsDefinitions,
            ...webhookToolsDefinitions,
            ...voicemailToolsDefinitions,
            ...tagsToolsDefinitions
        ];

        // Webhook config service + dispatcher are self-contained (no external deps);
        // construct them here rather than thread through the registry args.
        const webhookService = new WebhookConfigService();
        const webhookDispatcher = new WebhookDispatcher();

        // Create all tool handlers
        const callHandlers = createCallToolHandlers(transcriptService, twilioService, sessionManager);
        const incomingHandlers = createIncomingToolHandlers(incomingConfigService, twilioService);
        const contextsHandlers = createContextsToolHandlers(contextService);
        const debugHandlers = createDebugToolHandlers(transcriptService, incomingConfigService, contextService);
        const smsHandlers = createSmsToolHandlers();
        const webhookHandlers = createWebhookToolHandlers(webhookService, webhookDispatcher);
        const voicemailHandlers = createVoicemailToolHandlers();
        const tagsHandlers = createTagsToolHandlers();

        // Combine into map
        this.handlers = new Map([
            ...Object.entries(callHandlers),
            ...Object.entries(incomingHandlers),
            ...Object.entries(contextsHandlers),
            ...Object.entries(debugHandlers),
            ...Object.entries(smsHandlers),
            ...Object.entries(webhookHandlers),
            ...Object.entries(voicemailHandlers),
            ...Object.entries(tagsHandlers)
        ]);
    }

    /**
     * Get all tool definitions
     */
    public getDefinitions(): MCPToolDefinition[] {
        return this.definitions;
    }

    /**
     * Get a specific tool handler
     */
    public getHandler(name: string): MCPToolHandler | undefined {
        return this.handlers.get(name);
    }

    /**
     * Check if a tool exists
     */
    public hasTool(name: string): boolean {
        return this.handlers.has(name);
    }

    /**
     * Get tool count
     */
    public getToolCount(): number {
        return this.definitions.length;
    }
}
