# Voice Call MCP Server - Implementation Plan

## Overview

This MCP server will expose all voice call system functionality via HTTP-based Model Context Protocol. It will provide tools for call management, configuration, and monitoring.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│         Voice Server (Port: 3004)                   │
├─────────────────────────────────────────────────────┤
│  REST API          │  MCP Endpoints                 │
│  /api/calls        │  /.well-known/mcp-info         │
│  /api/contexts     │  /mcp/list-tools               │
│  /api/incoming     │  /mcp/call-tool                │
│                    │  /mcp/list-resources           │
│                    │  /mcp/read-resource            │
│                    │  /mcp/list-prompts             │
└────────────────────┴────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────┐
│  Shared Services & Database Layer                   │
│  - CallTranscriptService                            │
│  - IncomingConfigService                            │
│  - ContextService                                   │
│  - TwilioCallService                                │
│  - MongoDB                                          │
└─────────────────────────────────────────────────────┘
```

MCP endpoints are added to the existing Express server, using the same service layer that powers the UI.

## MCP Tools Organization

### 1. **Call Management Tools** (8 tools)

#### `phony_create_call`
Create an outbound call
```typescript
Input: {
  toNumber: string;           // Phone number to call (E.164 format)
  systemInstructions: string; // Base AI instructions
  callInstructions: string;   // Call-specific instructions
  voice?: string;             // OpenAI voice (default: 'alloy')
}
Output: {
  callSid: string;
  status: string;
  message: string;
}
```

#### `phony_list_calls`
List all call history with optional filtering
```typescript
Input: {
  limit?: number;             // Max results (default: 50)
  status?: string;            // Filter by status
  callType?: 'inbound' | 'outbound'; // Filter by type
}
Output: {
  calls: Call[];
  total: number;
}
```

#### `phony_get_call`
Get detailed call information including transcript and events
```typescript
Input: {
  callSid: string;
}
Output: {
  call: Call;                 // Full call object with all data
}
```

#### `phony_hold_call`
Put an active call on hold
```typescript
Input: {
  callSid: string;
}
Output: {
  success: boolean;
  status: string;
}
```

#### `phony_resume_call`
Resume a call that's on hold
```typescript
Input: {
  callSid: string;
}
Output: {
  success: boolean;
  status: string;
}
```

#### `phony_hangup_call`
End an active call
```typescript
Input: {
  callSid: string;
}
Output: {
  success: boolean;
  message: string;
}
```

#### `phony_inject_context`
Inject instructions/context into an active call
```typescript
Input: {
  callSid: string;
  context: string;            // Instructions to inject
}
Output: {
  success: boolean;
  message: string;
}
```

#### `phony_get_call_transcript`
Get real-time transcript for an active call
```typescript
Input: {
  callSid: string;
}
Output: {
  messages: ConversationMessage[];
  status: string;
}
```

### 2. **Incoming Configuration Tools** (5 tools)

#### `phony_list_available_numbers`
List all Twilio phone numbers and their configuration status
```typescript
Input: {}
Output: {
  numbers: AvailableNumber[];
}
```

#### `phony_list_incoming_configs`
List all configured incoming call handlers
```typescript
Input: {}
Output: {
  configs: IncomingConfig[];
}
```

#### `phony_create_incoming_config`
Configure a phone number for incoming calls
```typescript
Input: {
  phoneNumber: string;
  name: string;
  systemInstructions: string;
  callInstructions: string;
  voice?: string;
  enabled?: boolean;
}
Output: {
  config: IncomingConfig;
}
```

#### `phony_update_incoming_config`
Update an existing incoming configuration
```typescript
Input: {
  phoneNumber: string;
  name?: string;
  systemInstructions?: string;
  callInstructions?: string;
  voice?: string;
  enabled?: boolean;
}
Output: {
  config: IncomingConfig;
}
```

#### `phony_delete_incoming_config`
Remove incoming call configuration
```typescript
Input: {
  phoneNumber: string;
}
Output: {
  success: boolean;
  message: string;
}
```

### 3. **Context Template Tools** (5 tools)

#### `phony_list_contexts`
List saved context templates
```typescript
Input: {
  type?: 'incoming' | 'outgoing' | 'both'; // Filter by type
}
Output: {
  contexts: Context[];
}
```

#### `phony_get_context`
Get a specific context template
```typescript
Input: {
  contextId: string;
}
Output: {
  context: Context;
}
```

#### `phony_create_context`
Create a new reusable context template
```typescript
Input: {
  name: string;
  description?: string;
  systemInstructions: string;
  exampleCallInstructions?: string;
  contextType: 'incoming' | 'outgoing' | 'both';
}
Output: {
  context: Context;
}
```

#### `phony_update_context`
Update an existing context template
```typescript
Input: {
  contextId: string;
  name?: string;
  description?: string;
  systemInstructions?: string;
  exampleCallInstructions?: string;
  contextType?: 'incoming' | 'outgoing' | 'both';
}
Output: {
  context: Context;
}
```

#### `phony_delete_context`
Delete a context template
```typescript
Input: {
  contextId: string;
}
Output: {
  success: boolean;
  message: string;
}
```

### 4. **Debug & Monitoring Tools** (3 tools)

#### `phony_get_call_events`
Get detailed event logs for debugging
```typescript
Input: {
  callSid: string;
  eventType?: 'twilio' | 'openai' | 'all'; // Filter events
}
Output: {
  twilioEvents?: TwilioEvent[];
  openaiEvents?: OpenAIEvent[];
  eventCounts: {
    twilio: number;
    openai: number;
  };
}
```

#### `phony_get_call_instructions`
Get the instructions used for a call
```typescript
Input: {
  callSid: string;
}
Output: {
  systemInstructions: string;
  callInstructions?: string;
  callContext: string;        // Combined context sent to OpenAI
}
```

#### `phony_get_system_status`
Get system health and statistics
```typescript
Input: {}
Output: {
  activeCalls: number;
  totalCalls: number;
  configuredNumbers: number;
  savedContexts: number;
  mongodbConnected: boolean;
}
```

## MCP Resources

Resources provide read-only access to data using URI patterns.

### Call Resources

```
call://list                          - List all calls
call://list?status=active            - Filter by status
call://list?type=outbound            - Filter by type
call://{callSid}                     - Get specific call details
call://{callSid}/transcript          - Get call transcript
call://{callSid}/events              - Get call events
call://{callSid}/events/twilio       - Get Twilio events only
call://{callSid}/events/openai       - Get OpenAI events only
call://{callSid}/instructions        - Get call instructions
```

### Configuration Resources

```
config://incoming/list               - List all incoming configs
config://incoming/{phoneNumber}      - Get specific config
config://numbers/available           - List available numbers
```

### Context Resources

```
context://list                       - List all contexts
context://list?type=outgoing         - Filter by type
context://{contextId}                - Get specific context
```

### System Resources

```
system://status                      - System health status
system://stats                       - System statistics
```

## MCP Prompts

Prompts provide guided workflows for common tasks.

### `make_call`
Guide user through creating an outbound call
- Prompts for phone number
- Helps select or create context
- Provides call-specific instructions
- Executes call and returns callSid

### `setup_incoming_number`
Guide user through configuring incoming calls
- Lists available numbers
- Helps create context for incoming calls
- Configures the phone number

### `monitor_call`
Monitor an active call with options to inject context or end
- Shows real-time transcript
- Provides options for hold/resume/hangup
- Allows context injection

## Implementation Plan

### File Structure

```
src/
├── servers/
│   └── voice.server.ts         # Existing server, add MCP routes
├── mcp/
│   ├── router.ts               # MCP Express router
│   ├── tools/
│   │   ├── index.ts            # Tool registry
│   │   ├── calls.tools.ts      # Call management tools
│   │   ├── incoming.tools.ts   # Incoming config tools
│   │   ├── contexts.tools.ts   # Context template tools
│   │   └── debug.tools.ts      # Debug/monitoring tools
│   ├── resources/
│   │   ├── index.ts            # Resource registry
│   │   ├── call.resources.ts   # Call resources
│   │   ├── config.resources.ts # Config resources
│   │   └── system.resources.ts # System resources
│   ├── prompts/
│   │   ├── index.ts            # Prompt registry
│   │   └── workflows.prompts.ts # Workflow prompts
│   ├── types.ts                # MCP-specific types
│   └── utils.ts                # Helper functions
└── package.json                # Add @modelcontextprotocol/sdk
```

### Dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.0.0"
}
```

### Integration with Existing Server

Add MCP router to `src/servers/voice.server.ts`:

```typescript
import { mcpRouter } from '../mcp/router.js';

// In setupRoutes():
this.app.use('/mcp', mcpRouter);
```

### MCP Endpoints

The following endpoints will be added to the existing server:

- `GET /.well-known/mcp-info` - MCP discovery endpoint
- `POST /mcp/list-tools` - List all available tools
- `POST /mcp/call-tool` - Execute a tool
- `POST /mcp/list-resources` - List available resources
- `POST /mcp/read-resource` - Read a resource by URI
- `POST /mcp/list-prompts` - List workflow prompts
- `POST /mcp/execute-prompt` - Execute a workflow prompt

All endpoints available on existing port **3004**

## Usage Examples

### Creating a Call (via MCP)

```typescript
// Using MCP tool
const result = await mcp.callTool('phony_create_call', {
  toNumber: '+12125551234',
  systemInstructions: 'You are a friendly assistant...',
  callInstructions: 'Call John about the project update...',
  voice: 'alloy'
});
// Returns: { callSid: 'CA...', status: 'initiated' }
```

### Reading Call Data (via MCP Resource)

```typescript
// Using MCP resource
const call = await mcp.readResource('call://CA123456789');
// Returns full call object with transcript and events
```

### Monitoring Active Calls (via MCP Prompt)

```typescript
// Using MCP prompt
await mcp.executePrompt('monitor_call', {
  callSid: 'CA123456789'
});
// Returns guided interface for monitoring
```

## Benefits of MCP Layer

1. **AI Agent Integration**: LLMs can directly manage calls through natural language
2. **Automation**: Easy to build workflows that combine multiple operations
3. **Standardized API**: MCP protocol provides consistent interface
4. **Type Safety**: Full TypeScript schemas for all operations
5. **Resource Access**: Efficient read-only data access via URIs
6. **Composability**: Tools can be chained for complex workflows
7. **No Auth Overhead**: Simplified for internal/trusted use

## Security Considerations

Since no auth is required:
- MCP endpoints share same security model as REST API
- Both accessible on port 3004
- Consider adding environment flag to enable/disable MCP endpoints
- Log all MCP operations for audit trail
- Same CORS and rate limiting as existing API

## Testing Strategy

1. **Unit Tests**: Test each tool handler independently
2. **Integration Tests**: Test MCP server against voice server
3. **Resource Tests**: Verify URI patterns and data retrieval
4. **Prompt Tests**: Test workflow prompts end-to-end
5. **Load Tests**: Ensure MCP layer doesn't add significant overhead

## Next Steps

1. Create MCP server file structure
2. Implement tool handlers for call management
3. Add resource providers for data access
4. Create workflow prompts
5. Add to Docker Compose
6. Write comprehensive documentation
7. Create example usage scripts

## Tool Name Prefix Rationale

All tools use `phony_` prefix to:
- Avoid naming conflicts with other MCP servers
- Clearly identify tools belonging to this system
- Follow MCP best practices for tool naming
- Make tool discovery easier in multi-server environments
