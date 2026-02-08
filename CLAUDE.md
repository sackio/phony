# Phony - Claude Context

## Project Overview

**Location**: `/mnt/nas/data/code/forks/phony`

This is a Model Context Protocol (MCP) server that enables Claude and other AI assistants to initiate and manage real-time voice calls and SMS messaging using:
- **Twilio** for telephony and SMS infrastructure
- **ElevenLabs Conversational AI** for AI-powered voice conversations (with per-call voice selection and DTMF support)
- **MongoDB** for persistent storage of call transcripts and SMS messages
- **Nginx** for public webhook access

## Architecture

### Three Concurrent Services

1. **MCP Server** (stdio transport)
   - Exposes tools, prompts, and resources to Claude
   - Defined in: `src/servers/mcp.server.ts`
   - Uses `@modelcontextprotocol/sdk` v1.8.0

2. **Voice Server** (Express + WebSocket)
   - Handles Twilio webhook callbacks for calls and SMS
   - Port: 3004 (configurable via PORT env var)
   - Defined in: `src/servers/voice.server.ts`
   - Call Endpoints:
     - `POST /call/outgoing` - Twilio webhook handler
     - `WebSocket /call/connection-outgoing/:secret` - Media stream connection
   - SMS Endpoints:
     - `POST /sms/incoming` - Incoming SMS webhook
     - `POST /sms/status` - SMS status callback webhook
     - `POST /api/sms/send` - Send SMS API
     - `GET /api/sms/messages` - List messages API
     - `GET /api/sms/messages/:messageSid` - Get message details API
     - `GET /api/sms/conversation` - Get conversation history API

3. **Nginx Reverse Proxy** (external)
   - Provides public URL for Twilio webhooks via PUBLIC_URL env var
   - Must be configured to proxy `/call/` requests to port 3004
   - Protected by dynamic API secret

### Entry Point

`src/start-all.ts` - Initializes MCP server and Voice server

## MCP Interface

### Tools

**Call Management Tools:**

**phony_create_call**
- Initiates an outbound phone call via Twilio
- Supports OpenAI (default) or ElevenLabs voice providers
- Parameters:
  - `toNumber` (string, required): Phone number in E.164 format (e.g., +11234567890)
  - `systemInstructions` (string, required): Base system instructions for the AI
  - `callInstructions` (string, required): Specific instructions for this call
  - `provider` (enum, optional): Voice provider - 'openai' (default) or 'elevenlabs'
  - `voice` (string, optional): OpenAI voice (alloy, echo, fable, onyx, nova, shimmer)
  - `elevenLabsAgentId` (string, optional): ElevenLabs agent ID (uses default if not specified)
  - `elevenLabsVoiceId` (string, optional): ElevenLabs voice ID
- Returns: `{ callSid, status, provider, message }`

**SMS Messaging Tools:**

**phony_send_sms**
- Send an SMS text message to a phone number
- Parameters:
  - `toNumber` (string, required): Recipient phone number in E.164 format
  - `body` (string, required): The text message to send (max 1600 characters)
  - `fromNumber` (string, optional): Sender phone number (defaults to TWILIO_NUMBER)
- Returns: `{ status, message, data: { messageSid, status, toNumber, fromNumber, body, sentAt } }`

**phony_list_messages**
- List SMS message history with optional filtering
- Parameters:
  - `direction` (enum, optional): "inbound" or "outbound"
  - `fromNumber` (string, optional): Filter by sender phone number
  - `toNumber` (string, optional): Filter by recipient phone number
  - `status` (enum, optional): Filter by message status
  - `startDate` (string, optional): Filter messages after this date (ISO format)
  - `endDate` (string, optional): Filter messages before this date (ISO format)
  - `limit` (number, optional): Maximum number of messages to return (default: 100, max: 200)
- Returns: `{ status, message, data: { count, messages: [...] } }`

**phony_get_message**
- Get detailed information about a specific SMS message
- Parameters:
  - `messageSid` (string, required): Twilio message SID
- Returns: `{ status, message, data: { messageSid, fromNumber, toNumber, direction, body, status, ... } }`

**phony_get_conversation**
- Get all SMS messages between two phone numbers (conversation history)
- Parameters:
  - `phoneNumber1` (string, required): First phone number in E.164 format
  - `phoneNumber2` (string, required): Second phone number in E.164 format
  - `limit` (number, optional): Maximum number of messages to return (default: 100)
- Returns: `{ status, message, data: { phoneNumber1, phoneNumber2, messageCount, conversation: [...] } }`

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
                                    AudioService (µ-law → PCM conversion)
                                           ↓
                                    ElevenLabsWsService
                                           ↓
                                    ElevenLabs Conversational AI
                                           ↓
                                    ElevenLabsEventService
                                           ↓
                                    TwilioWsService → Twilio → Phone
```

### DTMF Flow (In-Band)
```
ElevenLabs agent calls send_dtmf tool
        ↓
ElevenLabsCallHandler.onToolCall()
        ↓
generateDtmfSequence() → µ-law audio tones
        ↓
TwilioWsService.sendAudio() → injected into media stream
        ↓
Phone hears DTMF tones (call stays connected)
```

**Audio Format**: µ-law (g711_ulaw) 8kHz
- Twilio uses µ-law natively
- ElevenLabs: Converts µ-law → PCM 16kHz for input, agent outputs PCM 16kHz → converted to µ-law
- DTMF: Generated as in-band µ-law audio tones via `audio.service.ts`

## Key Components

### Services

**ElevenLabs Services** (`src/services/elevenlabs/`)
- `ws.service.ts` - WebSocket connection to ElevenLabs Conversational AI
- `event.service.ts` - Processes ElevenLabs events (transcripts, audio, interruptions)
- `audio.service.ts` - Audio format conversion (µ-law ↔ PCM) and in-band DTMF tone generation

**Twilio Services** (`src/services/twilio/`)
- `call.service.ts` - Twilio API operations (makeCall, startRecording, endCall)
- `ws.service.ts` - Handles Twilio media stream WebSocket
- `event.service.ts` - Processes Twilio media stream events
- `sms.service.ts` - SMS sending and webhook handling (sendSms, handleIncomingSms, handleStatusCallback)

**SMS Services** (`src/services/sms/`)
- `storage.service.ts` - MongoDB operations for SMS messages (saveSms, getSms, listSms, getConversation, updateSmsStatus)

**Session Management**
- `src/handlers/call.handler.ts` - ICallHandler interface
- `src/handlers/elevenlabs.handler.ts` - ElevenLabsCallHandler (handles voice, DTMF client tools, context injection)
- `src/services/session-manager.service.ts` - Manages concurrent call sessions
- `src/services/context.service.ts` - Provider-agnostic call context setup
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
MONGODB_URL=mongodb://localhost:27017/phony  # MongoDB connection string
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
    "phony": {
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

After config, restart Claude Desktop. If connected, "Phony" appears in 🔨 menu.

## Nginx Configuration

The server requires nginx (or similar reverse proxy) to be configured to forward Twilio webhook requests. Add this location block to your nginx config:

```nginx
# Phony - Twilio webhooks and WebSocket - no auth required
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

### Voice Calls

1. **Simple notification call**:
   > "Can you call +1-123-456-7890 and let them know I'll be 15 minutes late?"

2. **Restaurant reservation (multilingual)**:
   > "Please call Delicious Restaurant at +1-123-456-7890 and make a reservation for 4 people tonight at 7:30 PM. Please speak in German."

3. **Appointment rescheduling**:
   > "Call Expert Dental NYC (+1-123-456-7899) and reschedule my Monday appointment to next Friday between 4–6pm."

### SMS Messaging

1. **Send appointment reminder**:
   > "Send a text message to +1-123-456-7890 reminding them about their appointment tomorrow at 2 PM."

2. **Follow-up after call**:
   > "Send an SMS to +1-123-456-7890 with the reference number REF-12345 and a summary of our conversation."

3. **Check message history**:
   > "Show me all SMS messages I sent to +1-123-456-7890 in the last week."

4. **View conversation**:
   > "Get the full SMS conversation history between my number and +1-123-456-7890."

5. **Check message status**:
   > "What's the delivery status of message SM1234567890abcdef?"

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

### Voice Calls
- ✅ Outbound phone calls via Twilio
- ✅ Real-time audio with GPT-4o Realtime model (OpenAI provider)
- ✅ ElevenLabs Conversational AI support (alternative provider)
- ✅ Natural two-way conversations
- ✅ Multilingual support (language switching mid-call)
- ✅ Pre-built prompts (restaurant reservations)
- ✅ Optional call recording
- ✅ Conversation history tracking
- ✅ Interrupt handling (user can interrupt AI)
- ✅ Goodbye detection (automatic call termination)
- ✅ Multiple concurrent call sessions
- ✅ DTMF tone sending (AI agent can autonomously navigate IVR menus via send_dtmf client tool)
- ✅ Context injection mid-call (both providers)

### SMS Messaging
- ✅ Send SMS messages via Twilio
- ✅ Receive incoming SMS messages
- ✅ Automatic status tracking (queued, sent, delivered, failed)
- ✅ Persistent MongoDB storage for all messages
- ✅ Conversation history between phone numbers
- ✅ Message filtering (by direction, status, date range, phone numbers)
- ✅ MMS support (multimedia messages with media URLs)
- ✅ Webhook handling for incoming messages and status updates
- ✅ Character count tracking (SMS segments)
- ✅ Frontend UI for sending/viewing messages

### Infrastructure
- ✅ Nginx reverse proxy support for public URL
- ✅ Secure credential handling
- ✅ MongoDB persistence for calls and SMS
- ✅ Frontend React UI for call and SMS management

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

## Voice Provider Comparison

| Feature | OpenAI (default) | ElevenLabs |
|---------|-----------------|------------|
| Cost per minute | ~$0.30 | ~$0.08-0.10 |
| Latency | Low | Low |
| Audio format | µ-law native | PCM (converted) |
| Voice customization | 6 voices | Agent-level config |
| Context injection | ✅ | ✅ (contextual_update) |

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
| AI Voice (OpenAI) | openai | 4.85.1 |
| AI Voice (ElevenLabs) | Custom WebSocket | v1 |
| Reverse Proxy | nginx | (external) |
| HTTP Server | express + express-ws | Latest |
| Validation | zod | 3.22.4 |

## Limitations & TODO

**Current Limitations**:
- ⚠️ Inbound calls require configuration via incoming call handlers
- ❌ Transcription retrieval incomplete (TODO in `mcp.server.ts`)
- ❌ Basic call recording (via Twilio API only)

**Recently Implemented**:
- ✅ SMS messaging (send, receive, history, conversation tracking)
- ✅ MongoDB persistence for SMS messages
- ✅ Frontend UI for SMS management
- ✅ Comprehensive test coverage for SMS functionality

**Planned Improvements** (from README):
- Support for multiple AI models
- Improved latency and response times
- Enhanced error handling
- More conversation templates
- Call monitoring and analytics
- Advanced SMS features (scheduled messages, templates, bulk sending)

## Cost Considerations

- **Twilio**:
  - Per-minute charges for phone calls (varies by destination)
  - Per-message charges for SMS (varies by destination country)
  - Per-message charges for MMS (multimedia messages)
- **OpenAI**: GPT-4o Realtime API charges per second of audio
- **MongoDB**: Database storage costs (if using cloud hosting)
- **Nginx**: No cost (self-hosted)
- **Call recording**: Additional Twilio storage costs

**Recommendation**: Set up billing alerts in Twilio and OpenAI accounts. Monitor MongoDB storage usage for SMS history.

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
- Remote: `https://github.com/lukaskai/phony.git`
