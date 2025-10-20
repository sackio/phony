import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TwilioCallService } from '../services/twilio/call.service.js';
import axios from 'axios';

export class VoiceCallMcpServer {
    private server: McpServer;
    private twilioCallService: TwilioCallService;
    private twilioCallbackUrl: string;
    private apiBaseUrl: string;

    constructor(twilioCallService: TwilioCallService, twilioCallbackUrl: string, apiBaseUrl: string = 'http://localhost:3004') {
        this.twilioCallbackUrl = twilioCallbackUrl;
        this.twilioCallService = twilioCallService;
        this.apiBaseUrl = apiBaseUrl;

        this.server = new McpServer({
            name: 'Voice Call MCP Server',
            version: '1.0.0',
            description: 'MCP server for managing voice calls, context templates, and incoming call handlers via Twilio'
        });

        this.registerTools();
        this.registerResources();
        this.registerPrompts();
    }

    private registerTools(): void {
        // ============ OUTBOUND CALLS ============
        this.server.tool(
            'trigger-call',
            'Trigger an outbound phone call via Twilio',
            {
                toNumber: z.string().describe('The phone number to call (E.164 format)'),
                systemInstructions: z.string().describe('System instructions defining the AI agent\'s role and behavior'),
                callInstructions: z.string().describe('Specific instructions for this particular call'),
                voice: z.string().optional().describe('Voice to use (sage, alloy, echo, shimmer, verse, etc.). Default: sage'),
                fromNumber: z.string().optional().describe('The Twilio phone number to call FROM (E.164 format). If not specified, uses the default TWILIO_NUMBER.')
            },
            async ({ toNumber, systemInstructions, callInstructions, voice, fromNumber }) => {
                try {
                    const requestBody: any = {
                        To: toNumber,
                        systemInstructions,
                        callInstructions,
                        voice: voice || 'sage'
                    };

                    if (fromNumber) {
                        requestBody.fromNumber = fromNumber;
                    }

                    const response = await axios.post(`${this.apiBaseUrl}/api/calls/create?apiSecret=${process.env.API_SECRET}`, requestBody);

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Call created successfully',
                                callSid: response.data.callSid,
                                callStatus: response.data.status
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to trigger call: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        // ============ CALL HISTORY & MANAGEMENT ============
        this.server.tool(
            'list-calls',
            'List and filter call history (active and completed calls)',
            {
                callType: z.enum(['inbound', 'outbound']).optional().describe('Filter by call type'),
                status: z.enum(['initiated', 'in-progress', 'completed', 'failed']).optional().describe('Filter by call status'),
                fromNumber: z.string().optional().describe('Filter by caller phone number'),
                toNumber: z.string().optional().describe('Filter by recipient phone number'),
                startDate: z.string().optional().describe('Filter calls starting from this date (ISO format: YYYY-MM-DD)'),
                endDate: z.string().optional().describe('Filter calls ending before this date (ISO format: YYYY-MM-DD)'),
                limit: z.number().optional().describe('Maximum number of calls to return (default: 100)')
            },
            async ({ callType, status, fromNumber, toNumber, startDate, endDate, limit }) => {
                try {
                    // Build query parameters
                    const params = new URLSearchParams();
                    if (callType) params.append('callType', callType);
                    if (status) params.append('status', status);
                    if (fromNumber) params.append('fromNumber', fromNumber);
                    if (toNumber) params.append('toNumber', toNumber);
                    if (startDate) params.append('startDate', startDate);
                    if (endDate) params.append('endDate', endDate);
                    if (limit) params.append('limit', limit.toString());

                    const response = await axios.get(`${this.apiBaseUrl}/api/calls?${params.toString()}`);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                count: response.data.length,
                                calls: response.data
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to list calls: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'get-call-transcript',
            'Get the current transcript and details of a specific call',
            {
                callSid: z.string().describe('The Twilio call SID to retrieve')
            },
            async ({ callSid }) => {
                try {
                    const response = await axios.get(`${this.apiBaseUrl}/api/calls/${callSid}`);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                call: response.data
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to get call: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'get-call-events',
            'Get detailed event logs (Twilio and OpenAI events) for a specific call',
            {
                callSid: z.string().describe('The Twilio call SID to retrieve events for'),
                eventSource: z.enum(['twilio', 'openai', 'both']).optional().describe('Which event source to retrieve (default: both)'),
                eventType: z.string().optional().describe('Filter by specific event type (e.g., "connected", "speech.started")')
            },
            async ({ callSid, eventSource = 'both', eventType }) => {
                try {
                    const response = await axios.get(`${this.apiBaseUrl}/api/calls/${callSid}`);
                    const call = response.data;

                    // Extract events based on source filter
                    let twilioEvents = eventSource === 'both' || eventSource === 'twilio' ? call.twilioEvents || [] : [];
                    let openaiEvents = eventSource === 'both' || eventSource === 'openai' ? call.openaiEvents || [] : [];

                    // Apply event type filter if specified
                    if (eventType) {
                        twilioEvents = twilioEvents.filter((e: any) => e.type === eventType);
                        openaiEvents = openaiEvents.filter((e: any) => e.type === eventType);
                    }

                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                callSid: call.callSid,
                                callStatus: call.status,
                                twilioEvents: {
                                    count: twilioEvents.length,
                                    events: twilioEvents
                                },
                                openaiEvents: {
                                    count: openaiEvents.length,
                                    events: openaiEvents
                                }
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to get call events: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'hold-call',
            'Place an active call on hold',
            {
                callSid: z.string().describe('The call SID to place on hold')
            },
            async ({ callSid }) => {
                try {
                    const response = await axios.post(`${this.apiBaseUrl}/api/calls/${callSid}/hold`);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Call placed on hold',
                                callStatus: response.data.status
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to hold call: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'resume-call',
            'Resume a call that is on hold',
            {
                callSid: z.string().describe('The call SID to resume')
            },
            async ({ callSid }) => {
                try {
                    const response = await axios.post(`${this.apiBaseUrl}/api/calls/${callSid}/resume`);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Call resumed',
                                callStatus: response.data.status
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to resume call: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'hangup-call',
            'Hangup an active call',
            {
                callSid: z.string().describe('The call SID to hangup')
            },
            async ({ callSid }) => {
                try {
                    const response = await axios.post(`${this.apiBaseUrl}/api/calls/${callSid}/hangup`);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Call ended',
                                callStatus: response.data.status
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to hangup call: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'inject-context',
            'Inject additional context or instructions into an active call',
            {
                callSid: z.string().describe('The call SID to inject context into'),
                context: z.string().describe('The context or instructions to inject')
            },
            async ({ callSid, context }) => {
                try {
                    const response = await axios.post(`${this.apiBaseUrl}/api/calls/${callSid}/inject-context`, {
                        context
                    });
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Context injected successfully'
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to inject context: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        // ============ CONTEXT TEMPLATES ============
        this.server.tool(
            'list-contexts',
            'List all context templates',
            {
                type: z.enum(['incoming', 'outgoing', 'both']).optional().describe('Filter by context type')
            },
            async ({ type }) => {
                try {
                    const url = type ? `${this.apiBaseUrl}/api/contexts?type=${type}` : `${this.apiBaseUrl}/api/contexts`;
                    const response = await axios.get(url);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                contexts: response.data
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to list contexts: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'get-context',
            'Get a specific context template by ID',
            {
                contextId: z.string().describe('The context ID to retrieve')
            },
            async ({ contextId }) => {
                try {
                    const response = await axios.get(`${this.apiBaseUrl}/api/contexts/${contextId}`);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                context: response.data
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to get context: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'create-context',
            'Create a new context template',
            {
                name: z.string().describe('Name of the context template'),
                description: z.string().optional().describe('Description of what this context is for'),
                systemInstructions: z.string().describe('System instructions defining AI behavior'),
                exampleCallInstructions: z.string().optional().describe('Example call instructions'),
                contextType: z.enum(['incoming', 'outgoing', 'both']).describe('Whether context is for incoming, outgoing, or both call types')
            },
            async ({ name, description, systemInstructions, exampleCallInstructions, contextType }) => {
                try {
                    const response = await axios.post(`${this.apiBaseUrl}/api/contexts`, {
                        name,
                        description,
                        systemInstructions,
                        exampleCallInstructions,
                        contextType
                    });
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Context created successfully',
                                context: response.data
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to create context: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'update-context',
            'Update an existing context template',
            {
                contextId: z.string().describe('The context ID to update'),
                name: z.string().optional().describe('New name for the context'),
                description: z.string().optional().describe('New description'),
                systemInstructions: z.string().optional().describe('New system instructions'),
                exampleCallInstructions: z.string().optional().describe('New example call instructions'),
                contextType: z.enum(['incoming', 'outgoing', 'both']).optional().describe('New context type')
            },
            async ({ contextId, name, description, systemInstructions, exampleCallInstructions, contextType }) => {
                try {
                    const updates: any = {};
                    if (name !== undefined) updates.name = name;
                    if (description !== undefined) updates.description = description;
                    if (systemInstructions !== undefined) updates.systemInstructions = systemInstructions;
                    if (exampleCallInstructions !== undefined) updates.exampleCallInstructions = exampleCallInstructions;
                    if (contextType !== undefined) updates.contextType = contextType;

                    const response = await axios.put(`${this.apiBaseUrl}/api/contexts/${contextId}`, updates);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Context updated successfully',
                                context: response.data
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to update context: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'delete-context',
            'Delete a context template',
            {
                contextId: z.string().describe('The context ID to delete')
            },
            async ({ contextId }) => {
                try {
                    await axios.delete(`${this.apiBaseUrl}/api/contexts/${contextId}`);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Context deleted successfully'
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to delete context: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        // ============ INCOMING CALL HANDLERS ============
        this.server.tool(
            'list-available-numbers',
            'List all available Twilio phone numbers that can be configured',
            {},
            async () => {
                try {
                    const response = await axios.get(`${this.apiBaseUrl}/api/incoming-configs/available-numbers`);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                numbers: response.data
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to list available numbers: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'list-incoming-configs',
            'List all incoming call handler configurations',
            {},
            async () => {
                try {
                    const response = await axios.get(`${this.apiBaseUrl}/api/incoming-configs`);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                configs: response.data
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to list incoming configs: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'create-incoming-handler',
            'Create a new incoming call handler for a phone number',
            {
                phoneNumber: z.string().describe('The phone number to configure (E.164 format)'),
                name: z.string().describe('Friendly name for this configuration'),
                systemInstructions: z.string().optional().describe('System instructions for AI conversation (required if messageOnly is false)'),
                callInstructions: z.string().optional().describe('Call instructions for incoming calls'),
                voice: z.string().optional().describe('Voice to use (default: sage)'),
                enabled: z.boolean().optional().describe('Whether this handler is enabled (default: true)'),
                messageOnly: z.boolean().optional().describe('If true, just play hangupMessage and hang up (no AI conversation). Default: false'),
                hangupMessage: z.string().optional().describe('Message to play before hanging up (required if messageOnly is true)')
            },
            async ({ phoneNumber, name, systemInstructions, callInstructions, voice, enabled, messageOnly, hangupMessage }) => {
                try {
                    const response = await axios.post(`${this.apiBaseUrl}/api/incoming-configs`, {
                        phoneNumber,
                        name,
                        systemInstructions: systemInstructions || '',
                        callInstructions: callInstructions || '',
                        voice: voice || 'sage',
                        enabled: enabled !== undefined ? enabled : true,
                        messageOnly: messageOnly || false,
                        hangupMessage: hangupMessage || undefined
                    });
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: `Incoming handler created successfully${messageOnly ? ' (message-only mode)' : ''}`,
                                config: response.data
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to create incoming handler: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'update-incoming-handler',
            'Update an existing incoming call handler',
            {
                phoneNumber: z.string().describe('The phone number to update'),
                name: z.string().optional().describe('New friendly name'),
                systemInstructions: z.string().optional().describe('New system instructions'),
                callInstructions: z.string().optional().describe('New call instructions'),
                voice: z.string().optional().describe('New voice'),
                enabled: z.boolean().optional().describe('Enable or disable this handler'),
                messageOnly: z.boolean().optional().describe('Switch to message-only mode (true) or AI conversation mode (false)'),
                hangupMessage: z.string().optional().describe('New hangup message for message-only mode')
            },
            async ({ phoneNumber, name, systemInstructions, callInstructions, voice, enabled, messageOnly, hangupMessage }) => {
                try {
                    const updates: any = {};
                    if (name !== undefined) updates.name = name;
                    if (systemInstructions !== undefined) updates.systemInstructions = systemInstructions;
                    if (callInstructions !== undefined) updates.callInstructions = callInstructions;
                    if (voice !== undefined) updates.voice = voice;
                    if (enabled !== undefined) updates.enabled = enabled;
                    if (messageOnly !== undefined) updates.messageOnly = messageOnly;
                    if (hangupMessage !== undefined) updates.hangupMessage = hangupMessage;

                    const response = await axios.put(`${this.apiBaseUrl}/api/incoming-configs/${encodeURIComponent(phoneNumber)}`, updates);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Incoming handler updated successfully',
                                config: response.data
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to update incoming handler: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );

        this.server.tool(
            'delete-incoming-handler',
            'Delete an incoming call handler',
            {
                phoneNumber: z.string().describe('The phone number to remove handler from')
            },
            async ({ phoneNumber }) => {
                try {
                    await axios.delete(`${this.apiBaseUrl}/api/incoming-configs/${encodeURIComponent(phoneNumber)}`);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'success',
                                message: 'Incoming handler deleted successfully'
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                status: 'error',
                                message: `Failed to delete incoming handler: ${errorMessage}`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }
        );
    }

    private registerResources(): void {
        this.server.resource(
            'get-latest-call',
            new ResourceTemplate('call://transcriptions', { list: undefined }),
            async () => {
                // TODO: get call transcription
                return {
                    contents: [{
                        text: JSON.stringify({
                            transcription: '{}',
                            status: 'completed',
                        }),
                        uri: 'call://transcriptions/latest',
                        mimeType: 'application/json'
                    }]
                };
            }
        );
    }

    private registerPrompts(): void {
        this.server.prompt(
            'make-restaurant-reservation',
            'Create a prompt for making a restaurant reservation by phone',
            {
                restaurantNumber: z.string().describe('The phone number of the restaurant'),
                peopleNumber: z.string().describe('The number of people in the party'),
                date: z.string().describe('Date of the reservation'),
                time: z.string().describe('Preferred time for the reservation')
            },
            ({ restaurantNumber, peopleNumber, date, time }) => {
                return {
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `You are calling a restaurant to book a table for ${peopleNumber} people on ${date} at ${time}. Call the restaurant at ${restaurantNumber} from ${process.env.TWILIO_NUMBER}.`
                        }
                    }]
                };
            }
        );
    }

    public async start(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }
}
