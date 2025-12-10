import { MCPResourceDefinition, MCPResourceHandler } from '../types.js';
import { CallTranscriptService } from '../../services/database/call-transcript.service.js';
import { IncomingConfigService } from '../../services/database/incoming-config.service.js';
import { ContextService } from '../../services/database/context.service.js';
import { TwilioCallService } from '../../services/twilio/call.service.js';

import { callResourceDefinitions, createCallResourceHandler } from './call.resources.js';
import { configResourceDefinitions, createConfigResourceHandler } from './config.resources.js';
import { systemResourceDefinitions, createSystemResourceHandler } from './system.resources.js';

/**
 * Resource Registry
 * Combines all resource definitions and handlers
 */

export class ResourceRegistry {
    private definitions: MCPResourceDefinition[];
    private callHandler: MCPResourceHandler;
    private configHandler: MCPResourceHandler;
    private systemHandler: MCPResourceHandler;

    constructor(
        transcriptService: CallTranscriptService,
        incomingConfigService: IncomingConfigService,
        contextService: ContextService,
        twilioService: TwilioCallService
    ) {
        // Combine all resource definitions
        this.definitions = [
            ...callResourceDefinitions,
            ...configResourceDefinitions,
            ...systemResourceDefinitions
        ];

        // Create resource handlers
        this.callHandler = createCallResourceHandler(transcriptService);
        this.configHandler = createConfigResourceHandler(incomingConfigService, contextService, twilioService);
        this.systemHandler = createSystemResourceHandler(transcriptService, incomingConfigService, contextService);
    }

    /**
     * Get all resource definitions
     */
    public getDefinitions(): MCPResourceDefinition[] {
        return this.definitions;
    }

    /**
     * Read a resource by URI
     */
    public async readResource(uri: string): Promise<any> {
        // Route to appropriate handler based on URI scheme
        if (uri.startsWith('call://')) {
            return await this.callHandler(uri);
        }

        if (uri.startsWith('config://') || uri.startsWith('context://')) {
            return await this.configHandler(uri);
        }

        if (uri.startsWith('system://')) {
            return await this.systemHandler(uri);
        }

        throw new Error(`Unknown resource URI scheme: ${uri}`);
    }

    /**
     * Get resource count
     */
    public getResourceCount(): number {
        return this.definitions.length;
    }
}
