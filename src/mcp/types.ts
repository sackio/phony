/**
 * MCP Protocol Types
 */

export interface MCPToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

export interface MCPToolCallRequest {
    name: string;
    arguments?: Record<string, any>;
}

export interface MCPToolCallResponse {
    content: Array<{
        type: 'text';
        text: string;
    }>;
    isError?: boolean;
}

export interface MCPResourceDefinition {
    uri: string;
    name: string;
    description: string;
    mimeType?: string;
}

export interface MCPResourceReadRequest {
    uri: string;
}

export interface MCPResourceReadResponse {
    contents: Array<{
        uri: string;
        mimeType: string;
        text?: string;
    }>;
}

export interface MCPPromptDefinition {
    name: string;
    description: string;
    arguments?: Array<{
        name: string;
        description: string;
        required?: boolean;
    }>;
}

export interface MCPPromptExecuteRequest {
    name: string;
    arguments?: Record<string, string>;
}

export interface MCPPromptExecuteResponse {
    messages: Array<{
        role: 'user' | 'assistant';
        content: {
            type: 'text';
            text: string;
        };
    }>;
}

/**
 * Tool Handler Type
 */
export type MCPToolHandler = (args: Record<string, any>) => Promise<any>;

/**
 * Resource Handler Type
 */
export type MCPResourceHandler = (uri: string) => Promise<any>;

/**
 * Prompt Handler Type
 */
export type MCPPromptHandler = (args: Record<string, string>) => Promise<MCPPromptExecuteResponse>;
