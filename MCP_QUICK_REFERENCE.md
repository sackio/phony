# Phony Voice Call MCP Server - Quick Reference

## Server Details
- **Protocol**: HTTP MCP
- **Port**: 3004 (same as REST API)
- **Base URL**: `http://localhost:3004`
- **MCP Endpoints**: `/mcp/*`
- **Authentication**: None (internal use only)

## Tool Categories

### 📞 Call Management (8 tools)

| Tool | Purpose | Key Inputs |
|------|---------|------------|
| `phony_create_call` | Create outbound call | toNumber, systemInstructions, callInstructions |
| `phony_list_calls` | List call history | limit, status, callType (optional) |
| `phony_get_call` | Get call details + events | callSid |
| `phony_hold_call` | Put call on hold | callSid |
| `phony_resume_call` | Resume held call | callSid |
| `phony_hangup_call` | End active call | callSid |
| `phony_inject_context` | Send mid-call instructions | callSid, context |
| `phony_get_call_transcript` | Get conversation messages | callSid |

### 📱 Incoming Configuration (5 tools)

| Tool | Purpose | Key Inputs |
|------|---------|------------|
| `phony_list_available_numbers` | Show Twilio numbers | - |
| `phony_list_incoming_configs` | List configured numbers | - |
| `phony_create_incoming_config` | Setup incoming handler | phoneNumber, name, instructions |
| `phony_update_incoming_config` | Modify configuration | phoneNumber, fields to update |
| `phony_delete_incoming_config` | Remove configuration | phoneNumber |

### 📋 Context Templates (5 tools)

| Tool | Purpose | Key Inputs |
|------|---------|------------|
| `phony_list_contexts` | List saved templates | type (optional) |
| `phony_get_context` | Get template details | contextId |
| `phony_create_context` | Create reusable template | name, systemInstructions, contextType |
| `phony_update_context` | Modify template | contextId, fields to update |
| `phony_delete_context` | Remove template | contextId |

### 🔍 Debug & Monitoring (3 tools)

| Tool | Purpose | Key Inputs |
|------|---------|------------|
| `phony_get_call_events` | Get Twilio/OpenAI events | callSid, eventType (optional) |
| `phony_get_call_instructions` | Get call prompts used | callSid |
| `phony_get_system_status` | System health check | - |

**Total: 21 Tools**

---

## Resource URIs

### 📞 Calls
```
call://list                       # All calls
call://list?status=active         # Filter by status
call://list?type=outbound         # Filter by type
call://{callSid}                  # Specific call
call://{callSid}/transcript       # Conversation
call://{callSid}/events           # All events
call://{callSid}/events/twilio    # Twilio only
call://{callSid}/events/openai    # OpenAI only
call://{callSid}/instructions     # Prompts used
```

### ⚙️ Configuration
```
config://incoming/list            # All configs
config://incoming/{phoneNumber}   # Specific config
config://numbers/available        # Twilio numbers
```

### 📋 Contexts
```
context://list                    # All contexts
context://list?type=outgoing      # Filter by type
context://{contextId}             # Specific context
```

### 🖥️ System
```
system://status                   # Health status
system://stats                    # Statistics
```

---

## Workflow Prompts

### `make_call`
**Guided outbound call creation**
- Interactive phone number input
- Context selection or creation
- Call-specific instructions
- Initiates call and returns callSid

### `setup_incoming_number`
**Configure incoming call handling**
- Lists available Twilio numbers
- Guides context creation
- Configures phone number

### `monitor_call`
**Real-time call monitoring**
- Shows live transcript
- Provides control options (hold/resume/hangup)
- Allows context injection

---

## Common Usage Patterns

### Pattern 1: Make a Call
```
1. phony_list_contexts (type: 'outgoing')     → Pick context
2. phony_create_call                          → Start call
3. phony_get_call (poll for status)           → Monitor
4. phony_get_call_transcript                  → View conversation
```

### Pattern 2: Setup Incoming Number
```
1. phony_list_available_numbers               → See numbers
2. phony_create_context (type: 'incoming')    → Create context
3. phony_create_incoming_config               → Configure number
```

### Pattern 3: Monitor Active Call
```
1. phony_list_calls (status: 'active')        → Find active calls
2. phony_get_call_transcript (loop)           → Watch transcript
3. phony_inject_context (if needed)           → Adjust behavior
4. phony_hangup_call (when done)              → End call
```

### Pattern 4: Debug a Call
```
1. phony_get_call                             → Full details
2. phony_get_call_instructions                → See prompts used
3. phony_get_call_events                      → Review event logs
```

---

## Data Types

### Call Object
```typescript
{
  _id: string;
  callSid: string;
  fromNumber: string;
  toNumber: string;
  callType: 'inbound' | 'outbound';
  voice: string;
  conversationHistory: ConversationMessage[];
  twilioEvents?: TwilioEvent[];
  openaiEvents?: OpenAIEvent[];
  systemInstructions?: string;
  callInstructions?: string;
  status: 'initiated' | 'in-progress' | 'completed' | 'failed' | 'on_hold';
  startedAt: string;
  endedAt?: string;
  duration?: number;
}
```

### IncomingConfig Object
```typescript
{
  phoneNumber: string;
  name: string;
  systemInstructions: string;
  callInstructions: string;
  voice: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Context Object
```typescript
{
  _id: string;
  name: string;
  description?: string;
  systemInstructions: string;
  exampleCallInstructions?: string;
  contextType: 'incoming' | 'outgoing' | 'both';
  createdAt: string;
  updatedAt: string;
}
```

---

## Voice Options

Available OpenAI Realtime API voices:
- `alloy` (default) - Neutral, balanced
- `echo` - Warm, engaging
- `fable` - Expressive, animated
- `onyx` - Deep, authoritative
- `nova` - Warm, friendly
- `shimmer` - Soft, gentle

---

## Status Values

### Call Status
- `initiated` - Call being set up
- `in-progress` - Call active
- `on_hold` - Call paused
- `completed` - Call ended normally
- `failed` - Call error

### Event Types (Twilio)
- `start` - Call stream started
- `media` - Audio data
- `mark` - Playback marker
- `stop` - Call stream ended

### Event Types (OpenAI)
- `session.created` - Session initialized
- `conversation.item.input_audio_transcription.completed` - User spoke
- `response.audio_transcript.done` - AI response complete
- `response.audio.delta` - AI audio chunk
- `error` - API error

---

## Error Handling

All tools return errors in this format:
```typescript
{
  error: string;        // Error message
  code?: string;        // Error code (if applicable)
  details?: any;        // Additional context
}
```

Common error scenarios:
- Call not found: `callSid` doesn't exist
- Call not active: Trying to control completed call
- Number not available: Phone number already configured externally
- Validation error: Invalid input parameters

---

## Performance Considerations

- **Polling**: When monitoring active calls, poll every 2-5 seconds
- **Event Logs**: Can be large (100+ events per call), filter by type if needed
- **Transcript**: Real-time updates via polling or use WebSocket separately
- **List Calls**: Default limit is 50, increase if needed for reporting

---

## Security Notes

⚠️ **No Authentication**
- MCP endpoints share same security as REST API
- No additional auth layer for MCP
- Only expose on internal network
- Do not expose port 3004 publicly without auth
- All operations are logged

🔒 **Recommended Setup**
- Use Docker internal networking
- Run behind VPN or firewall
- Consider adding API key middleware for production
- Monitor access logs
- Same CORS and rate limiting as existing API

---

## Integration Examples

### With Claude Desktop
```json
{
  "mcpServers": {
    "phony": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": {
        "VOICE_SERVER_URL": "http://localhost:3004"
      }
    }
  }
}
```

### With Python
```python
from mcp import ClientSession
import asyncio

async def make_call():
    async with ClientSession("http://localhost:3005") as session:
        result = await session.call_tool("phony_create_call", {
            "toNumber": "+12125551234",
            "systemInstructions": "You are a helpful assistant...",
            "callInstructions": "Call about project status"
        })
        print(f"Call SID: {result['callSid']}")

asyncio.run(make_call())
```

### With cURL
```bash
# List tools
curl -X POST http://localhost:3004/mcp/list-tools \
  -H "Content-Type: application/json" \
  -d '{}'

# Create a call
curl -X POST http://localhost:3004/mcp/call-tool \
  -H "Content-Type: application/json" \
  -d '{
    "name": "phony_create_call",
    "arguments": {
      "toNumber": "+12125551234",
      "systemInstructions": "You are helpful...",
      "callInstructions": "Call about project"
    }
  }'

# Read resource
curl -X POST http://localhost:3004/mcp/read-resource \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "call://CA123456789"
  }'
```

---

## Troubleshooting

### MCP Endpoints Return 404
- Verify server is running on port 3004
- Check MCP router is registered in voice.server.ts
- Review server logs for startup errors

### Tools Return Errors
- Check MongoDB is connected
- Review tool input parameters
- Verify service layer is accessible
- Check server logs for detailed errors

### Resource URIs Don't Work
- Ensure URI format is exact (case-sensitive)
- Check resource exists in database
- Verify resource provider is registered
- Use POST /mcp/list-resources to see available URIs

### Calls Fail to Connect
- Check Twilio credentials in environment variables
- Verify phone numbers are in E.164 format (+12125551234)
- Review Twilio webhook configuration
- Check server logs for Twilio errors
