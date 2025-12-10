import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, validateArgs } from '../utils.js';
import { ContextService } from '../../services/database/context.service.js';

/**
 * Context Template Tools
 */

export const contextsToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_list_contexts',
        description: 'List saved context templates for reusable call configurations',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description: 'Filter by context type',
                    enum: ['incoming', 'outgoing', 'both']
                }
            }
        }
    },
    {
        name: 'phony_get_context',
        description: 'Get a specific context template by ID',
        inputSchema: {
            type: 'object',
            properties: {
                contextId: {
                    type: 'string',
                    description: 'Context ID (MongoDB ObjectId)'
                }
            },
            required: ['contextId']
        }
    },
    {
        name: 'phony_create_context',
        description: 'Create a new reusable context template',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Context name'
                },
                description: {
                    type: 'string',
                    description: 'Optional description of what this context is for'
                },
                systemInstructions: {
                    type: 'string',
                    description: 'System instructions defining AI behavior'
                },
                exampleCallInstructions: {
                    type: 'string',
                    description: 'Example call-specific instructions'
                },
                contextType: {
                    type: 'string',
                    description: 'Where this context can be used',
                    enum: ['incoming', 'outgoing', 'both']
                }
            },
            required: ['name', 'systemInstructions', 'contextType']
        }
    },
    {
        name: 'phony_update_context',
        description: 'Update an existing context template',
        inputSchema: {
            type: 'object',
            properties: {
                contextId: {
                    type: 'string',
                    description: 'Context ID to update'
                },
                name: {
                    type: 'string',
                    description: 'New name'
                },
                description: {
                    type: 'string',
                    description: 'New description'
                },
                systemInstructions: {
                    type: 'string',
                    description: 'New system instructions'
                },
                exampleCallInstructions: {
                    type: 'string',
                    description: 'New example instructions'
                },
                contextType: {
                    type: 'string',
                    description: 'New context type',
                    enum: ['incoming', 'outgoing', 'both']
                }
            },
            required: ['contextId']
        }
    },
    {
        name: 'phony_delete_context',
        description: 'Delete a context template',
        inputSchema: {
            type: 'object',
            properties: {
                contextId: {
                    type: 'string',
                    description: 'Context ID to delete'
                }
            },
            required: ['contextId']
        }
    }
];

/**
 * Create tool handlers
 */
export function createContextsToolHandlers(
    contextService: ContextService
): Record<string, MCPToolHandler> {
    return {
        phony_list_contexts: async (args) => {
            try {
                let contexts = await contextService.getAllContexts();

                // Apply type filter
                if (args.type) {
                    contexts = contexts.filter(ctx =>
                        ctx.contextType === args.type || ctx.contextType === 'both'
                    );
                }

                return createToolResponse({
                    contexts: contexts.map(ctx => ({
                        _id: ctx._id,
                        name: ctx.name,
                        description: ctx.description,
                        systemInstructions: ctx.systemInstructions,
                        exampleCallInstructions: ctx.exampleCallInstructions,
                        contextType: ctx.contextType,
                        createdAt: ctx.createdAt,
                        updatedAt: ctx.updatedAt
                    })),
                    total: contexts.length
                });
            } catch (error: any) {
                return createToolError('Failed to list contexts', { message: error.message });
            }
        },

        phony_get_context: async (args) => {
            try {
                validateArgs(args, ['contextId']);

                const context = await contextService.getContextById(args.contextId);

                if (!context) {
                    return createToolError(`Context not found: ${args.contextId}`);
                }

                return createToolResponse({
                    context: {
                        _id: context._id,
                        name: context.name,
                        description: context.description,
                        systemInstructions: context.systemInstructions,
                        exampleCallInstructions: context.exampleCallInstructions,
                        contextType: context.contextType,
                        createdAt: context.createdAt,
                        updatedAt: context.updatedAt
                    }
                });
            } catch (error: any) {
                return createToolError('Failed to get context', { message: error.message });
            }
        },

        phony_create_context: async (args) => {
            try {
                validateArgs(args, ['name', 'systemInstructions', 'contextType']);

                const context = await contextService.createContext({
                    name: args.name,
                    description: args.description,
                    systemInstructions: args.systemInstructions,
                    exampleCallInstructions: args.exampleCallInstructions,
                    contextType: args.contextType
                });

                return createToolResponse({
                    context: {
                        _id: context._id,
                        name: context.name,
                        description: context.description,
                        systemInstructions: context.systemInstructions,
                        exampleCallInstructions: context.exampleCallInstructions,
                        contextType: context.contextType,
                        createdAt: context.createdAt,
                        updatedAt: context.updatedAt
                    },
                    message: `Context template '${context.name}' created`
                });
            } catch (error: any) {
                return createToolError('Failed to create context', { message: error.message });
            }
        },

        phony_update_context: async (args) => {
            try {
                validateArgs(args, ['contextId']);

                // Build update object
                const updates: any = {};
                if (args.name !== undefined) updates.name = args.name;
                if (args.description !== undefined) updates.description = args.description;
                if (args.systemInstructions !== undefined) updates.systemInstructions = args.systemInstructions;
                if (args.exampleCallInstructions !== undefined) updates.exampleCallInstructions = args.exampleCallInstructions;
                if (args.contextType !== undefined) updates.contextType = args.contextType;

                if (Object.keys(updates).length === 0) {
                    return createToolError('No fields provided to update');
                }

                const context = await contextService.updateContext(args.contextId, updates);

                if (!context) {
                    return createToolError(`Context not found: ${args.contextId}`);
                }

                return createToolResponse({
                    context: {
                        _id: context._id,
                        name: context.name,
                        description: context.description,
                        systemInstructions: context.systemInstructions,
                        exampleCallInstructions: context.exampleCallInstructions,
                        contextType: context.contextType,
                        createdAt: context.createdAt,
                        updatedAt: context.updatedAt
                    },
                    message: `Context '${context.name}' updated`
                });
            } catch (error: any) {
                return createToolError('Failed to update context', { message: error.message });
            }
        },

        phony_delete_context: async (args) => {
            try {
                validateArgs(args, ['contextId']);

                const success = await contextService.deleteContext(args.contextId);

                if (!success) {
                    return createToolError(`Context not found: ${args.contextId}`);
                }

                return createToolResponse({
                    success: true,
                    message: `Context deleted: ${args.contextId}`
                });
            } catch (error: any) {
                return createToolError('Failed to delete context', { message: error.message });
            }
        }
    };
}
