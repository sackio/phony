# 🎭 Phony - Production-Ready Voice AI Agent

[![Tests](https://img.shields.io/badge/tests-78%20passing-brightgreen)](./ALL_TESTS_PASSING_REPORT.md)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](./docker-compose.yml)
[![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)](./COMPREHENSIVE_TEST_REPORT.md)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Phony is a production-ready voice AI agent that enables natural phone conversations between humans and AI. Built with **Twilio ConversationRelay** and **OpenAI Realtime API**, it supports both outbound and inbound calls with real-time transcription, AI responses, and supervisor oversight.

## 🌟 Key Features

- **🔄 Bidirectional Calling**: AI can call humans, and humans can call AI
- **🎯 Multiple AI Personalities**: 5 pre-configured personalities for different use cases
- **📊 Real-time Dashboard**: Live call monitoring and supervisor intervention
- **🔒 Safety Controls**: Consent validation and immediate call termination
- **🐳 Docker Ready**: Full containerization with Docker Compose
- **✅ 100% Test Coverage**: Comprehensive test suite with edge cases
- **🌐 Production Deployed**: Ready for enterprise use

## 📸 Screenshots

<details>
<summary>Dashboard Interface</summary>

The dashboard provides real-time call monitoring with:
- Live transcript display
- Message override capability
- DTMF keypad (0-9, *, #)
- Call control buttons (End, Transfer)

</details>

## 🚀 Quick Start

### Prerequisites

- Python 3.9+
- Docker & Docker Compose
- [Twilio Account](https://www.twilio.com/try-twilio) with phone number
- [OpenAI API Key](https://platform.openai.com/api-keys) with Realtime API access
- Public URL for webhooks (production) or [ngrok](https://ngrok.com) (development)

### 1. Clone & Setup Environment

```bash
# Clone repository
git clone https://github.com/yourusername/phony.git
cd phony

# Copy environment files
cp .env.example .env
cp .envrc.example .envrc

# Edit .env with your credentials
nano .env

# Allow direnv (optional but recommended)
direnv allow .
```

### 2. Start Services with Docker

```bash
# Start backend and Redis
docker-compose up -d backend redis

# Verify services are running
docker-compose ps

# Check health
curl http://localhost:24187/healthz
```

### 3. Configure Twilio Phone Number

```bash
# Interactive setup (purchases number if needed)
docker-compose run --rm demo python3 scripts/setup_twilio.py

# Or use existing number
docker-compose run --rm demo python3 scripts/configure_webhook.py
```

### 4. Make Your First Call

#### AI Calls Human (Outbound)
```bash
docker-compose --profile human run --rm human-demo
# Select: 1 (AI calls human)
# Confirm consent: yes
# Enter number: +1234567890
# Choose scenario: 1-4
```

#### Human Calls AI (Inbound)
```bash
docker-compose --profile human run --rm human-demo
# Select: 2 (Human calls AI)
# Choose personality: 1-5
# Call: +1 (857) 816-7225
```

### 5. Monitor Calls

Open dashboard: http://localhost:24187/dashboard/index.html?callSid={CALL_SID}

## 📞 Available Phone Numbers

| Number | Purpose | Status |
|--------|---------|--------|
| +1 (857) 816-7225 | Primary Demo | ✅ Active |
| +1 (978) 490-1657 | Secondary | ✅ Active |
| +1 (617) 300-0585 | BSack Direct | ✅ Active |
| +1 (617) 299-8887 | PushBuild Main | ✅ Active |

## 🤖 AI Personalities & Scenarios

### Inbound Personalities
1. **Professional Assistant** - Business helper and support
2. **Customer Service Rep** - Technical support specialist
3. **Appointment Scheduler** - Booking coordinator
4. **Information Hotline** - General information assistant
5. **Survey Conductor** - Feedback collection specialist

### Outbound Scenarios
1. **Customer Service Inquiry** - Professional business questions
2. **Survey/Feedback Request** - Brief 2-3 question surveys
3. **Appointment Scheduling** - Booking and availability checks
4. **Friendly Check-in** - Casual conversation and wellness

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     Twilio      │────▶│   FastAPI       │────▶│    OpenAI       │
│  Phone System   │◀────│    Backend      │◀────│  Realtime API   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   Dashboard     │
                        │   (React UI)    │
                        └─────────────────┘
```

## 📁 Project Structure

```
phony/
├── backend/                 # Core application
│   ├── main.py             # FastAPI entry point
│   ├── relay_ws.py         # Twilio WebSocket handler
│   ├── openai_ws.py        # OpenAI Realtime bridge
│   ├── override_api.py     # Supervisor controls
│   ├── events.py           # Event streaming
│   ├── commands.py         # LLM command parser
│   └── twiml.py           # TwiML generation
├── dashboard/              # Web UI
│   └── index.html         # React dashboard
├── scripts/               # Utilities
│   ├── setup_twilio.py    # Phone configuration
│   ├── make_call.py       # Outbound calls
│   ├── enhanced_llm_demo.py  # Demo suite
│   ├── docker_human_demo.py  # Docker demos
│   └── test_*.py          # Test suites
├── tests/                 # Test coverage
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   ├── system/           # System tests
│   └── e2e/              # End-to-end tests
├── docs/                  # Documentation
├── docker-compose.yml     # Container orchestration
├── Dockerfile            # Container definition
├── requirements.txt      # Python dependencies
├── .env.example         # Environment template
├── .envrc.example       # direnv template
└── README.md            # This file
```

## 🔧 Configuration

### Environment Variables

```bash
# Required
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+15551234567
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxx
HOST=your-domain.com  # or xxx.ngrok-free.app for dev

# Optional
PORT=24187                              # Default port
OPENAI_VOICE=alloy                      # Voice selection
OPENAI_MODEL=gpt-4o-realtime-preview    # Model selection
SYSTEM_PROMPT=You are a helpful assistant
REQUIRE_SUPERVISOR_FEEDBACK=false       # Approval mode
PHONY_DEBUG=0                           # Debug logging
```

### Voice Options
- `alloy` - Neutral, balanced (default)
- `echo` - Male voice
- `fable` - British accent
- `onyx` - Deep male voice
- `nova` - Female voice
- `shimmer` - Female voice

## 🧪 Testing

### Run All Tests
```bash
# Complete test suite
docker-compose run --rm demo python3 scripts/test_human_demo_suite.py
docker-compose run --rm demo python3 scripts/test_edge_cases.py

# Check results
cat ALL_TESTS_PASSING_REPORT.md
```

### Test Coverage
- **78 total tests** across all suites
- **100% pass rate** achieved
- **Edge cases** handled
- **Stress testing** validated

## 🐳 Docker Deployment

### Development
```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f backend

# Stop services
docker-compose down
```

### Production
```bash
# Build for production
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build

# Deploy with SSL/TLS
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 🎛️ Dashboard Features

### Real-time Monitoring
- **Live Transcript** - See conversation in real-time
- **Message Override** - Send custom text to caller
- **DTMF Control** - Send touch-tone digits
- **Call Management** - End or transfer calls
- **Event Stream** - WebSocket updates

### Access Dashboard
- Main: http://localhost:24187/dashboard/
- Live: http://localhost:24187/dashboard/index.html?callSid={CALL_SID}

## 🔌 API Endpoints

### Twilio Webhooks
- `POST /start_call` - Outbound call handler
- `POST /receive_call` - Inbound call handler
- `WS /relay/ws` - ConversationRelay WebSocket

### Supervisor Controls
- `POST /override/text` - Send text to caller
- `POST /override/dtmf` - Send DTMF digit
- `POST /override/end` - End call
- `POST /override/transfer` - Transfer call
- `POST /override/clarification` - Answer AI query

### Monitoring
- `WS /events/ws` - Real-time event stream
- `GET /healthz` - Health check

## 🎮 Interactive Commands

The AI can execute special commands:
- `[[press:digits]]` - Send DTMF tones
- `[[transfer:number]]` - Transfer call
- `[[end_call]]` - Terminate call
- `[[request_user:prompt]]` - Ask supervisor

## 📚 Documentation

- [CLAUDE.md](./CLAUDE.md) - Complete technical documentation
- [API_COMPLIANCE_REPORT.md](./API_COMPLIANCE_REPORT.md) - API compliance analysis
- [DOCKER_HUMAN_DEMO_USAGE.md](./DOCKER_HUMAN_DEMO_USAGE.md) - Demo instructions
- [ALL_TESTS_PASSING_REPORT.md](./ALL_TESTS_PASSING_REPORT.md) - Test results
- [docs/](./docs/) - Additional documentation

## 🚨 Troubleshooting

### Common Issues

**No audio on calls**
- Verify OpenAI API key has Realtime API access
- Check WebSocket connection in logs

**Webhook errors**
- Ensure ngrok/public URL is accessible
- Verify webhook URL in Twilio console
- Check PORT configuration (24187)

**Docker issues**
- Ensure port 24187 is available
- Redis uses port 6380 (not 6379)
- Run `docker-compose logs backend` for errors

## 🔐 Security & Safety

- **Consent Required** - Explicit consent for outbound calls
- **Call Recording** - Optional recording capability
- **Supervisor Override** - Manual intervention always available
- **Rate Limiting** - API endpoint protection
- **Input Validation** - Malicious input protection
- **Secure Storage** - Environment variables for secrets

## 💰 Pricing

### OpenAI Realtime API
- Text Input: $5/1M tokens
- Text Output: $20/1M tokens
- Audio Input: $100/1M tokens (~$0.06/min)
- Audio Output: $200/1M tokens (~$0.24/min)

### Twilio Voice
- Phone Numbers: From $1/month
- Inbound: $0.0085/minute
- Outbound: From $0.013/minute

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Run tests (`docker-compose run --rm demo python3 scripts/test_human_demo_suite.py`)
4. Commit changes (`git commit -m 'feat: add amazing feature'`)
5. Push branch (`git push origin feature/amazing`)
6. Open Pull Request

## 📝 License

This project is licensed under the MIT License - see [LICENSE](./LICENSE) file for details.

## 🙏 Acknowledgments

- [Twilio ConversationRelay](https://www.twilio.com/docs/voice/conversationrelay) for voice infrastructure
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) for AI conversation
- [FastAPI](https://fastapi.tiangolo.com) for backend framework
- [React](https://reactjs.org) for dashboard UI

## 📞 Support

- **Documentation**: [CLAUDE.md](./CLAUDE.md)
- **Issues**: [GitHub Issues](https://github.com/yourusername/phony/issues)
- **Demo Numbers**: +1 (857) 816-7225

---

Built with ❤️ by the Phony team | [Live Demo](https://phony.pushbuild.com) | [Documentation](./docs/)