import { MCPToolCallResponse, MCPResourceReadResponse } from './types.js';

/**
 * Create a successful tool response
 */
export function createToolResponse(data: any): MCPToolCallResponse {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify(data, null, 2)
        }]
    };
}

/**
 * Create an error tool response
 */
export function createToolError(error: string, details?: any): MCPToolCallResponse {
    const errorData = {
        error,
        ...(details && { details })
    };

    return {
        content: [{
            type: 'text',
            text: JSON.stringify(errorData, null, 2)
        }],
        isError: true
    };
}

/**
 * Create a successful resource response
 */
export function createResourceResponse(uri: string, data: any, mimeType = 'application/json'): MCPResourceReadResponse {
    return {
        contents: [{
            uri,
            mimeType,
            text: JSON.stringify(data, null, 2)
        }]
    };
}

/**
 * Parse resource URI
 * Examples:
 *   call://CA123 -> { scheme: 'call', path: 'CA123' }
 *   call://CA123/transcript -> { scheme: 'call', path: 'CA123/transcript' }
 */
export function parseResourceURI(uri: string): { scheme: string; path: string } {
    const match = uri.match(/^([a-z]+):\/\/(.+)$/);
    if (!match) {
        throw new Error(`Invalid resource URI: ${uri}`);
    }

    return {
        scheme: match[1],
        path: match[2]
    };
}

/**
 * Validate required arguments
 */
export function validateArgs(args: Record<string, any>, required: string[]): void {
    const missing = required.filter(key => !args[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required arguments: ${missing.join(', ')}`);
    }
}

/**
 * Sanitize phone number to E.164 format
 */
export function sanitizePhoneNumber(phone: string): string {
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');

    // If it doesn't start with +, add it
    if (!phone.startsWith('+')) {
        return `+${digits}`;
    }

    return phone;
}
