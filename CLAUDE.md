# Voice Call MCP Server - Claude Context

## Project Overview

**Location**: `/mnt/nas/data/code/forks/voice-call-mcp-server`

This is a Model Context Protocol (MCP) server that enables Claude and other AI assistants to initiate and manage real-time voice calls using:
- **Twilio** for telephony infrastructure
- **OpenAI GPT-4o Realtime API** for AI-powered voice conversations
- **Ngrok** for public webhook access

## Architecture

### Three Concurrent Services

1. **MCP Server** (stdio transport)
   - Exposes tools, prompts, and resources to Claude
   - Defined in: `src/servers/mcp.server.ts`
   - Uses `@modelcontextprotocol/sdk` v1.8.0

2. **Voice Server** (Express + WebSocket)
   - Handles Twilio webhook callbacks
   - Port: 3004 (configurable via PORT env var)
   - Defined in: `src/servers/voice.server.ts`
   - Endpoints:
     - `POST /call/outgoing` - Twilio webhook handler
     - `WebSocket /call/connection-outgoing/:secret` - Media stream connection

3. **Nginx Reverse Proxy** (external)
   - Provides public URL for Twilio webhooks via PUBLIC_URL env var
   - Must be configured to proxy `/call/` requests to port 3004
   - Protected by dynamic API secret

### Entry Point

`src/start-all.ts` - Initializes MCP server and Voice server

## MCP Interface

### Tools

**trigger-call**
- Initiates an outbound phone call via Twilio
- Parameters:
  - `toNumber` (string): Phone number in E.164 format (e.g., +11234567890)
  - `callContext` (string): Instructions for the AI during the call
- Returns: `{ status, message, callSid }`

### Prompts

**make-restaurant-reservation**
- Pre-built prompt for restaurant reservations
- Parameters: `restaurantNumber`, `peopleNumber`, `date`, `time`
- Generates structured request for Claude

### Resources

**get-latest-call**
- URI: `call://transcriptions`
- Status: TODO (not fully implemented)
- Intended to retrieve call transcriptions

## Audio Flow

```
Phone Caller → Twilio → WebSocket → TwilioWsService
                                           ↓
                                    OpenAIWsService
                                           ↓
                                    GPT-4o Realtime API
                                           ↓
                                    OpenAIEventService
                                           ↓
                                    TwilioWsService → Twilio → Phone
```

**Audio Format**: µ-law (g711_ulaw) 8kHz
**Voice**: "sage" (configurable in `src/config/constants.ts`)
**Temperature**: 0.6

## Key Components

### Services

**OpenAI Services** (`src/services/openai/`)
- `ws.service.ts` - WebSocket connection to OpenAI Realtime API
- `event.service.ts` - Processes OpenAI events (transcriptions, audio deltas)
- `context.service.ts` - Manages conversation context

**Twilio Services** (`src/services/twilio/`)
- `call.service.ts` - Twilio API operations (makeCall, startRecording, endCall)
- `ws.service.ts` - Handles Twilio media stream WebSocket
- `event.service.ts` - Processes Twilio media stream events

**Session Management**
- `src/handlers/openai.handler.ts` - OpenAICallHandler and CallSessionManager
- `src/services/session-manager.service.ts` - Manages concurrent call sessions
- Each call gets isolated CallState instance

**Public URL Configuration**
- Server uses PUBLIC_URL environment variable instead of ngrok
- Nginx reverse proxy handles external access to Twilio webhooks
- Configuration in `getPublicUrl()` function in `src/start-all.ts`

### State Management

**CallState** (`src/types.ts`)
- Call identifiers: `streamSid`, `callSid`
- Phone numbers: `fromNumber`, `toNumber`
- Context: `callContext`, `initialMessage`
- Conversation: `conversationHistory[]`
- Timing/media tracking: `latestMediaTimestamp`, `responseStartTimestampTwilio`

### Configuration

**Constants** (`src/config/constants.ts`)
- `VOICE = 'sage'`
- `SHOW_TIMING_MATH = false`
- `RECORD_CALLS` - from env var
- `GOODBYE_PHRASES` - triggers call termination
- `DYNAMIC_API_SECRET` - randomly generated on startup

**Prompts** (`src/config/prompts.ts`)
- `generateOutboundCallContext()` - System prompt template
- Emphasizes: concise, friendly, customer role, goal-oriented

## Environment Variables

Required:
```bash
PUBLIC_URL=https://your-domain.com  # Public URL for Twilio callbacks
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_NUMBER=your_e164_number  # e.g., +11234567890
OPENAI_API_KEY=your_openai_api_key
```

Optional:
```bash
PORT=3004  # Default: 3004
OPENAI_WEBSOCKET_URL=wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview
RECORD_CALLS=true  # Enable call recording
```

See `.env.example` for template.

## Build & Run

```bash
# Install dependencies
npm install

# Development (hot reload)
npm run start-all  # Uses tsx

# Build
npm run build  # Outputs to dist/start-all.cjs

# Production
npm run start  # Runs dist/start-all.cjs

# Clean
npm run clean
```

**Requirements**: Node.js >= 22

## Claude Desktop Integration

Add to `claude_desktop_config.json`:

**macOS**: `~/Library/Application Support/Claude/`
**Windows**: `%APPDATA%\Claude\`

```json
{
  "mcpServers": {
    "voice-call": {
      "command": "node",
      "args": ["/absolute/path/to/dist/start-all.cjs"],
      "env": {
        "PUBLIC_URL": "https://your-domain.com",
        "TWILIO_ACCOUNT_SID": "your_account_sid",
        "TWILIO_AUTH_TOKEN": "your_auth_token",
        "TWILIO_NUMBER": "+11234567890",
        "OPENAI_API_KEY": "your_openai_api_key"
      }
    }
  }
}
```

After config, restart Claude Desktop. If connected, "Voice Call" appears in 🔨 menu.

## Nginx Configuration

The server requires nginx (or similar reverse proxy) to be configured to forward Twilio webhook requests. Add this location block to your nginx config:

```nginx
# Voice Call MCP Server - Twilio webhooks and WebSocket - no auth required
location /call/ {
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Host $http_host;
    proxy_set_header X-NginX-Proxy true;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 600s;
    proxy_connect_timeout 600s;
    proxy_send_timeout 600s;
    proxy_pass http://localhost:3004;
}
```

**Important**: This location must not require authentication as Twilio needs direct access to these endpoints.

## Usage Examples

1. **Simple notification call**:
   > "Can you call +1-123-456-7890 and let them know I'll be 15 minutes late?"

2. **Restaurant reservation (multilingual)**:
   > "Please call Delicious Restaurant at +1-123-456-7890 and make a reservation for 4 people tonight at 7:30 PM. Please speak in German."

3. **Appointment rescheduling**:
   > "Call Expert Dental NYC (+1-123-456-7899) and reschedule my Monday appointment to next Friday between 4–6pm."

## Event Processing

### OpenAI Events

**Key events** (`src/services/openai/event.service.ts`):
- `conversation.item.input_audio_transcription.completed` - User speech transcribed
- `response.audio_transcript.done` - Assistant speech transcribed
- `response.audio.delta` - Audio chunks to stream to Twilio
- `input_audio_buffer.speech_started` - User interrupted → truncate AI response

### Twilio Events

**Media stream events** (`src/services/twilio/event.service.ts`):
- `connected` - WebSocket established
- `start` - Call started, extract metadata (callSid, streamSid)
- `media` - Audio payload from caller (base64 encoded)
- `stop` - Call ended

## Features

- ✅ Outbound phone calls via Twilio
- ✅ Real-time audio with GPT-4o Realtime model
- ✅ Natural two-way conversations
- ✅ Multilingual support (language switching mid-call)
- ✅ Pre-built prompts (restaurant reservations)
- ✅ Nginx reverse proxy support for public URL
- ✅ Secure credential handling
- ✅ Optional call recording
- ✅ Conversation history tracking
- ✅ Interrupt handling (user can interrupt AI)
- ✅ Goodbye detection (automatic call termination)
- ✅ Multiple concurrent call sessions

## Security

- **Dynamic API Secret**: Generated on startup (24-char random string)
- **Secret validation**: All webhook/WebSocket endpoints validate `DYNAMIC_API_SECRET`
- **HTTPS/WSS**: Nginx provides secure tunnel with SSL/TLS
- **No sensitive logging**: Credentials never logged
- **Environment-based config**: No hardcoded secrets
- **Graceful shutdown**: Proper cleanup on SIGINT

**Note**: Ensure nginx configuration allows Twilio webhook access while protecting other endpoints.

## Error Handling

### Common Issues

1. **"Phone number must be in E.164 format"**
   - Ensure number starts with `+` and country code

2. **"Invalid credentials"**
   - Verify `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` from [Twilio Console](https://console.twilio.com)

3. **"OpenAI API error"**
   - Check `OPENAI_API_KEY` and account credits

4. **"PUBLIC_URL environment variable is required"**
   - Set `PUBLIC_URL` to your public domain (e.g., `https://your-domain.com`)
   - Ensure nginx is properly configured to forward `/call/` requests to port 3004

5. **"OpenAI Realtime voice detection issues"**
   - Voice encoding problem, try different receiver phone

### Resilience

- **Port conflict**: Auto-retries every 15 seconds (see `scheduleServerRetry()`)
- **WebSocket errors**: Logged to console with context
- **Graceful shutdown**: 5-second delay before closing WebSockets after call ends
- **Nginx failover**: Server can run without public access for testing/development

## Technology Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Runtime | Node.js | >= 22 |
| Language | TypeScript | 5.4.2 |
| Module System | ESM | (type: "module") |
| Build Tool | tsup | 8.0.2 |
| Package Manager | pnpm | 10.7.0 |
| MCP SDK | @modelcontextprotocol/sdk | 1.8.0 |
| Telephony | twilio | 5.0.1 |
| AI Voice | openai | 4.85.1 |
| Reverse Proxy | nginx | (external) |
| HTTP Server | express + express-ws | Latest |
| Validation | zod | 3.22.4 |

## Limitations & TODO

**Current Limitations**:
- ❌ Only outbound calls (no inbound)
- ❌ Transcription retrieval incomplete (TODO in `mcp.server.ts`)
- ❌ Basic call recording (via Twilio API only)
- ❌ No persistent conversation storage

**Planned Improvements** (from README):
- Support for multiple AI models
- Database integration for conversation history
- Improved latency and response times
- Enhanced error handling
- More conversation templates
- Call monitoring and analytics

## Cost Considerations

- **Twilio**: Per-minute charges for phone calls (varies by destination)
- **OpenAI**: GPT-4o Realtime API charges per second of audio
- **Nginx**: No cost (self-hosted)
- **Call recording**: Additional Twilio storage costs

**Recommendation**: Set up billing alerts in Twilio and OpenAI accounts.

## Development Tips

### Debugging

- Set `SHOW_TIMING_MATH = true` in `src/config/constants.ts` for timing logs
- Events logged based on `LOG_EVENT_TYPES` filter
- Check `conversationHistory` in CallState for full transcript

### Adding New Prompts

1. Register in `src/servers/mcp.server.ts` using `this.server.prompt()`
2. Define parameters with Zod schema
3. Return structured message for Claude

### Modifying AI Behavior

- Edit `src/config/prompts.ts` → `generateOutboundCallContext()`
- Adjust temperature in `src/handlers/openai.handler.ts` (default: 0.6)
- Change voice in `src/config/constants.ts` (default: "sage")

## Project Origin

Originally created by [Popcorn](https://careers.popcorn.space) team.
Licensed under MIT License.

## Recent Changes

- 2cbe661: Setting up conversation context properly
- Recent focus on improving context management and README documentation

---

**Git Info**:
- Branch: `main`
- Status: Clean (no uncommitted changes)
- Remote: `https://github.com/lukaskai/voice-call-mcp-server.git`
