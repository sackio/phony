# MCP Architecture - Integrated Design

## Overview

The MCP layer is integrated directly into the existing voice server as additional HTTP endpoints. No separate service required.

## Architecture Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                    Voice Server (Port 3004)                    │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────┐       ┌──────────────────────┐      │
│  │   REST API Routes    │       │   MCP HTTP Routes    │      │
│  ├──────────────────────┤       ├──────────────────────┤      │
│  │ GET  /api/calls      │       │ POST /mcp/list-tools │      │
│  │ POST /api/calls/...  │       │ POST /mcp/call-tool  │      │
│  │ GET  /api/contexts   │       │ POST /mcp/list-res.. │      │
│  │ POST /api/contexts   │       │ POST /mcp/read-res.. │      │
│  │ GET  /api/incoming.. │       │ POST /mcp/list-pro.. │      │
│  │ POST /api/incoming.. │       │ GET  /.well-known/.. │      │
│  └──────────────────────┘       └──────────────────────┘      │
│            │                              │                    │
│            └──────────────┬───────────────┘                    │
│                           ▼                                    │
│  ┌────────────────────────────────────────────────────────┐   │
│  │            Shared Service Layer                        │   │
│  ├────────────────────────────────────────────────────────┤   │
│  │  • CallTranscriptService                               │   │
│  │  • IncomingConfigService                               │   │
│  │  • ContextService                                      │   │
│  │  • TwilioCallService                                   │   │
│  │  • CallStateService                                    │   │
│  │  • SocketService (WebSocket)                           │   │
│  └────────────────────────────────────────────────────────┘   │
│                           │                                    │
└───────────────────────────┼────────────────────────────────────┘
                            ▼
        ┌───────────────────────────────────────┐
        │      External Services                │
        ├───────────────────────────────────────┤
        │  • MongoDB (call history, configs)    │
        │  • Twilio API (phone calls)           │
        │  • OpenAI API (voice AI)              │
        └───────────────────────────────────────┘
```

## Request Flow Examples

### REST API Request (Existing)
```
Frontend → GET /api/calls → CallTranscriptService → MongoDB → Response
```

### MCP Tool Call (New)
```
MCP Client → POST /mcp/call-tool
           → phony_list_calls handler
           → CallTranscriptService
           → MongoDB
           → Response
```

### MCP Resource Read (New)
```
MCP Client → POST /mcp/read-resource
           → URI: call://CA123
           → CallTranscriptService.getCall(CA123)
           → MongoDB
           → Response
```

## Key Design Principles

### 1. **Single Codebase**
- One Express server
- One port (3004)
- Shared service layer
- No duplication

### 2. **Parallel Routes**
- REST API at `/api/*` (existing)
- MCP endpoints at `/mcp/*` (new)
- Both use same services
- Both return JSON

### 3. **Same Security Model**
- No authentication on either
- Same CORS configuration
- Same rate limiting
- Same logging

### 4. **MCP Tools = Service Wrappers**
Each MCP tool is a thin wrapper around existing services:

```typescript
// Example: phony_list_calls tool
async function handleListCalls(args) {
  // Just calls existing service
  const calls = await callTranscriptService.getRecentCalls(args.limit);
  return { calls };
}
```

### 5. **MCP Resources = Direct Data Access**
Resources provide URI-based access to data:

```typescript
// Example: call://CA123456
async function readCallResource(uri) {
  const callSid = uri.split('://')[1];
  return await callTranscriptService.getCall(callSid);
}
```

## Implementation Approach

### Phase 1: Foundation (1 hour)
- Install `@modelcontextprotocol/sdk`
- Create `/src/mcp/` directory structure
- Create `router.ts` with base MCP endpoints
- Register router in `voice.server.ts`

### Phase 2: Call Tools (1 hour)
- Implement 8 call management tools
- Each tool wraps existing service methods
- Add input validation and error handling

### Phase 3: Config Tools (30 min)
- Implement 5 incoming config tools
- Implement 5 context template tools
- Reuse existing service layer

### Phase 4: Debug Tools (30 min)
- Implement 3 debug/monitoring tools
- System status, event logs, instructions

### Phase 5: Resources (1 hour)
- Implement URI-based resource providers
- Call resources (9 patterns)
- Config resources (3 patterns)
- System resources (2 patterns)

### Phase 6: Prompts (30 min)
- Implement 3 workflow prompts
- Guided interactions for common tasks

### Phase 7: Testing (1 hour)
- Test each tool with cURL
- Test resource URIs
- Integration tests
- Documentation

**Total Estimated Time: 5.5 hours**

## File Organization

```
src/
├── servers/
│   └── voice.server.ts              # Add: this.app.use('/mcp', mcpRouter)
├── mcp/
│   ├── router.ts                    # Main MCP router (all endpoints)
│   ├── types.ts                     # MCP request/response types
│   ├── utils.ts                     # Helper functions
│   ├── tools/
│   │   ├── index.ts                 # Tool registry
│   │   ├── calls.tools.ts           # 8 call management tools
│   │   ├── incoming.tools.ts        # 5 incoming config tools
│   │   ├── contexts.tools.ts        # 5 context template tools
│   │   └── debug.tools.ts           # 3 debug tools
│   ├── resources/
│   │   ├── index.ts                 # Resource registry
│   │   ├── call.resources.ts        # call:// URIs
│   │   ├── config.resources.ts      # config:// URIs
│   │   └── system.resources.ts      # system:// URIs
│   └── prompts/
│       ├── index.ts                 # Prompt registry
│       └── workflows.prompts.ts     # 3 workflow prompts
```

## Service Dependencies

MCP tools will use these existing services:

```typescript
// Injected into MCP router
class MCPRouter {
  constructor(
    private callTranscriptService: CallTranscriptService,
    private incomingConfigService: IncomingConfigService,
    private contextService: ContextService,
    private twilioCallService: TwilioCallService,
    private callStateService: CallStateService,
    private socketService: SocketService
  ) {}
}
```

## Configuration

No additional environment variables needed. MCP endpoints use existing:
- `MONGODB_URI`
- `TWILIO_*` variables
- `OPENAI_*` variables

Optional addition:
```bash
MCP_ENABLED=true    # Feature flag to enable/disable MCP
```

## Deployment

No changes to Docker Compose required:
- Same container
- Same port mapping (3004:3004)
- Same environment variables
- Same health checks

Just rebuild and restart:
```bash
docker compose build
docker compose up -d
```

## Benefits of Integrated Approach

✅ **Simpler Architecture**
- One service to manage
- One port to expose
- One codebase to maintain

✅ **Code Reuse**
- Services used by both UI and MCP
- No duplication
- Single source of truth

✅ **Easier Development**
- No inter-service communication
- No network overhead
- Easier debugging

✅ **Better Performance**
- Direct service calls
- No HTTP round trips
- Shared connection pools

✅ **Consistent Behavior**
- Same business logic
- Same error handling
- Same logging

## MCP Client Configuration

Example for Claude Desktop:

```json
{
  "mcpServers": {
    "phony": {
      "url": "http://localhost:3004/mcp"
    }
  }
}
```

Or with HTTP transport:

```bash
# Start server normally
docker compose up -d

# MCP client connects to http://localhost:3004/mcp
```

## Monitoring

All MCP operations logged alongside REST API:
```
[MCP] Tool called: phony_create_call
[MCP] Tool result: { callSid: 'CA123...' }
[MCP] Resource read: call://CA123456
[API] GET /api/calls - 200 OK
```

Same log format, same log destination.

## Summary

The MCP layer is **not a separate service** - it's an **extension** of the existing API:
- Same server process
- Same port (3004)
- Same service layer
- Same security model
- Just additional HTTP routes at `/mcp/*`

This makes it simpler to implement, deploy, and maintain while providing full MCP functionality for AI agent integration.
