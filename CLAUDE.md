# Phony - Voice AI Agent

## Overview
Phony is a Python-based voice AI agent that bridges Twilio phone calls with OpenAI's Realtime API to enable natural AI-powered phone conversations. It supports both inbound and outbound calls with real-time transcription, AI responses, and supervisor oversight capabilities.

## External Documentation & Resources

### Twilio ConversationRelay
- **Main Documentation**: https://www.twilio.com/docs/voice/conversationrelay
- **Onboarding Guide**: https://www.twilio.com/docs/voice/conversationrelay/onboarding
- **WebSocket Messages**: https://www.twilio.com/docs/voice/conversationrelay/websocket-messages
- **Voice Configuration**: https://www.twilio.com/docs/voice/conversationrelay/voice-configuration
- **Best Practices**: https://www.twilio.com/docs/voice/conversationrelay/best-practices
- **TwiML Reference**: https://www.twilio.com/docs/voice/twiml/connect/conversationrelay
- **Integration Tutorial**: https://twilio.com/en-us/blog/integrate-openai-twilio-voice-using-conversationrelay
- **Sample Implementation**: https://github.com/deshartman/simple-conversation-relay

### OpenAI Realtime API
- **API Documentation**: https://platform.openai.com/docs/guides/realtime
- **Model Documentation**: https://platform.openai.com/docs/models/gpt-4o-realtime-preview
- **Realtime API Announcement**: https://openai.com/index/introducing-the-realtime-api/
- **GPT-Realtime Updates**: https://openai.com/index/introducing-gpt-realtime/

### Additional Resources
- **Twilio API Reference**: https://www.twilio.com/docs/voice/api
- **FastAPI Documentation**: https://fastapi.tiangolo.com
- **WebSockets Guide**: https://websockets.readthedocs.io
- **ngrok Documentation**: https://ngrok.com/docs

## Architecture
The system consists of three main components:
- **Backend API** (FastAPI) - Handles WebSocket connections, call routing, and OpenAI integration
- **Dashboard** (React) - Real-time call monitoring and supervisor intervention interface  
- **Scripts** - Utilities for setup, testing, and making calls

## Quick Start

### Prerequisites
- Python 3.9+
- [Twilio account](https://www.twilio.com/try-twilio) with phone number
- [OpenAI API key](https://platform.openai.com/api-keys) with Realtime API access
- Public URL for webhooks (e.g., [ngrok](https://ngrok.com) for local testing)

### Port Configuration
The application runs on a single port by default:
- **24187**: FastAPI backend and dashboard UI
- **6379**: Redis cache (Docker only)

The port can be configured in the `.env` file.

### Setup
1. Run setup script: `./scripts/setup.sh`
2. Configure `.env` with credentials (see Environment Variables section)
3. Set up Twilio: `python scripts/setup_twilio.py`
4. Expose local server: `ngrok http 24187`
5. Start backend: `./start.sh` or `uvicorn backend.main:app --port 24187 --reload`
6. Make a call: `python scripts/make_call.py +15551234567`

### Starting the Application

**Option 1: Using the start script (recommended)**
```bash
./start.sh
```

**Option 2: Direct uvicorn**
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 24187 --reload
```

**Option 3: Docker Compose**
```bash
docker-compose up
```

## Project Structure

```
phony/
├── backend/              # Core application
│   ├── main.py          # FastAPI entry point
│   ├── relay_ws.py      # Twilio WebSocket handler
│   ├── openai_ws.py     # OpenAI Realtime API bridge
│   ├── override_api.py  # Supervisor intervention endpoints
│   ├── events.py        # Event streaming system
│   ├── commands.py      # LLM command parser
│   ├── logging.py       # Structured logging
│   └── twiml.py         # TwiML response generation
├── dashboard/           # Web UI for call supervision
│   ├── index.html      # React dashboard (CDN-based)
│   └── README.md       # Dashboard documentation
├── scripts/            # Utility scripts
│   ├── setup.sh        # Environment setup
│   ├── setup_twilio.py # Twilio configuration helper
│   ├── make_call.py    # Outbound call initiator
│   └── llm_duet_demo.py # LLM-to-LLM conversation demo
├── tests/              # Test suite
│   ├── unit/          # Unit tests
│   ├── integration/   # Integration tests
│   └── system/        # System tests
├── docs/              # Additional documentation
├── start.sh           # Application startup script
├── docker-compose.yml # Docker deployment config
├── Dockerfile        # Container definition
├── requirements.txt  # Python dependencies
├── .env              # Environment configuration (create from .env.example)
├── .env.example     # Environment template
├── CLAUDE.md        # This documentation file
└── API_COMPLIANCE_REPORT.md # API compliance analysis
```

## Key Features

### Call Handling
- **Outbound Calls**: Initiated via `scripts/make_call.py` or Twilio API
- **Inbound Calls**: Webhook at `/receive_call` handles incoming calls
- **WebSocket Relay**: Real-time audio streaming between Twilio and OpenAI

### LLM Commands
The AI can execute special commands embedded in responses:
- `[[press:digits]]` - Send DTMF tones
- `[[transfer:number]]` - Transfer call to another number
- `[[end_call]]` - Terminate the call
- `[[request_user:prompt]]` - Request supervisor clarification

### Supervisor Dashboard
- **Real-time Monitoring**: View live transcripts and AI responses
- **Manual Override**: Send custom text or DTMF digits
- **Call Control**: End or transfer calls
- **Clarification**: Respond to AI requests for additional information

### Event Streaming
WebSocket endpoint at `/events/ws?callSid=...` streams:
- Caller transcripts
- Assistant responses
- Executed commands
- Supervisor interventions
- Latency metrics

## API Endpoints

### Twilio Webhooks
- `POST /start_call` - Returns ConversationRelay TwiML for outbound calls
- `POST /receive_call` - Returns ConversationRelay TwiML for inbound calls
- `WS /relay/ws` - WebSocket handler for Twilio ConversationRelay

### Supervisor Controls
- `POST /override/text` - Send text to caller
- `POST /override/dtmf` - Send DTMF digit
- `POST /override/end` - End call
- `POST /override/transfer` - Transfer call
- `POST /override/clarification` - Respond to AI query

### Monitoring
- `WS /events/ws` - Real-time event stream
- `GET /healthz` - Health check with uptime and active calls

## Environment Variables

### Required Variables
```bash
# Twilio Configuration
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # From Twilio Console
TWILIO_AUTH_TOKEN=your_auth_token_here                  # From Twilio Console
TWILIO_PHONE_NUMBER=+15551234567                        # Your Twilio phone number

# OpenAI Configuration
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxx            # From OpenAI Platform

# Application Host
HOST=your-domain.ngrok-free.app                         # Public URL (no https://)

# Port Configuration
PORT=24187                                               # Application port (API + Dashboard)
```

### Optional Variables
```bash
# OpenAI Settings
OPENAI_VOICE=alloy              # Voice options: alloy, echo, fable, onyx, nova, shimmer
OPENAI_MODEL=gpt-4o-realtime-preview  # Model to use
SYSTEM_PROMPT=You are a helpful phone assistant  # Custom system prompt

# Supervisor Features
REQUIRE_SUPERVISOR_FEEDBACK=false  # Set to "true" for approval before AI responses

# Call Settings
TRANSFER_NUMBER=+15559999999    # Default transfer number if not specified

# Debug Settings
PHONY_DEBUG=0                   # Set to 1 for verbose logging
```

### Voice Options
- **alloy**: Default, neutral balanced tone
- **echo**: Male voice
- **fable**: British accent
- **onyx**: Deep male voice
- **nova**: Female voice
- **shimmer**: Female voice

## Docker Deployment

Build and run with Docker Compose:
```bash
docker-compose build
docker-compose up
```

Services:
- Application (API + Dashboard) on `http://localhost:24187`
- Dashboard UI at `http://localhost:24187/dashboard/`
- Redis cache on `localhost:6379`

## Nginx Configuration

For production deployment behind Nginx, proxy to port **24187**:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Application proxy (API + Dashboard)
    location / {
        proxy_pass http://127.0.0.1:24187;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support for /relay/ws and /events/ws
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

**Important Nginx considerations:**
- The application runs on port **24187** (serves both API and dashboard)
- Dashboard is accessible at `/dashboard/`
- WebSocket endpoints require special headers for `/relay/ws` and `/events/ws`
- Set appropriate timeouts for long-lived WebSocket connections

## Testing

The test suite uses [pytest](https://docs.pytest.org) and includes:
- Unit tests for individual components
- Integration tests for API endpoints
- System tests for end-to-end flows

Run tests:
```bash
pytest tests/
```

## Development Workflow

1. **Local Development**:
   - Use `uvicorn --reload` for auto-reloading
   - Expose with ngrok for Twilio webhooks
   - Monitor logs in `call.log`

2. **Making Changes**:
   - Backend logic in `backend/` package
   - Dashboard UI in `dashboard/index.html`
   - Test with `scripts/make_call.py`

3. **Debugging**:
   - Set `PHONY_DEBUG=1` for verbose logging
   - Check WebSocket connections in browser DevTools
   - Monitor event stream at `/events/ws`

## Common Operations

### Make an Outbound Call
```bash
python scripts/make_call.py +15551234567
```

### Configure Twilio Phone Number
```bash
python scripts/setup_twilio.py
```

### Run LLM-to-LLM Demo
```bash
python scripts/llm_duet_demo.py
```

### Monitor Active Calls
Open dashboard: `http://localhost:24187/dashboard/index.html?callSid=CA...`

## Architecture Notes

- **WebSocket Bridge**: `relay_ws.py` connects Twilio to `openai_ws.py`
- **Event System**: Pub/sub pattern for real-time updates
- **Command Parser**: Detects and executes LLM commands
- **Session Management**: Tracks active calls in `ACTIVE_SESSIONS`
- **Logging**: Structured JSON logs for analysis

## Security Considerations

- Never commit `.env` file with credentials
- Use HTTPS in production (ngrok provides this for testing)
- Validate webhook signatures from Twilio
- Sanitize supervisor inputs before sending to caller
- Rate limit API endpoints to prevent abuse

## Troubleshooting

- **No audio**: Check OpenAI API key has [Realtime API access](https://platform.openai.com/docs/guides/realtime)
- **Webhook errors**: Verify ngrok URL in [Twilio console](https://console.twilio.com)
- **Connection drops**: Check WebSocket timeout settings
- **High latency**: Monitor metrics in event stream
- **Port conflicts**: Ensure port 24187 is available or change in `.env`
- **ngrok issues**: Use `ngrok http 24187` (not 8000) for the correct port

## API Pricing & Limits

### OpenAI Realtime API
- **Text Input**: $5 per 1M tokens
- **Text Output**: $20 per 1M tokens  
- **Audio Input**: $100 per 1M tokens (~$0.06/minute)
- **Audio Output**: $200 per 1M tokens (~$0.24/minute)
- See [OpenAI Pricing](https://openai.com/pricing) for current rates

### Twilio Voice
- **Phone Numbers**: Starting at $1/month
- **Inbound Calls**: $0.0085/minute
- **Outbound Calls**: Starting at $0.013/minute
- See [Twilio Pricing](https://www.twilio.com/voice/pricing) for details