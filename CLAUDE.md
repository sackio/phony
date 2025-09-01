# Phony - Voice AI Agent - Complete Technical Documentation

## 🤖 AI Agent Instructions

This document provides comprehensive technical documentation for AI agents working with the Phony Voice AI system. When working on this codebase, follow these guidelines and use the provided information to understand the system architecture, make changes, and run tests.

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Quick Start for AI Agents](#quick-start-for-ai-agents)
3. [Architecture & Components](#architecture--components)
4. [Environment Setup](#environment-setup)
5. [Docker Operations](#docker-operations)
6. [Testing Instructions](#testing-instructions)
7. [API Documentation](#api-documentation)
8. [Common Tasks](#common-tasks)
9. [Troubleshooting Guide](#troubleshooting-guide)
10. [External Resources](#external-resources)

## System Overview

Phony is a production-ready voice AI agent system that enables bidirectional phone conversations between humans and AI using:
- **Twilio ConversationRelay** for phone infrastructure
- **OpenAI Realtime API** for AI conversation
- **FastAPI** backend on port 24187
- **Redis** cache on port 6380 (Docker)
- **React** dashboard for monitoring

### Current Configuration
- **Primary Phone**: +1 (857) 816-7225 (Twilio)
- **Production Host**: phony.pushbuild.com
- **GitHub Repository**: github.com/sackio/phony
- **Test Coverage**: 100% (78/78 tests passing)

## Quick Start for AI Agents

### Essential Commands
```bash
# Start services
docker-compose up -d backend redis

# Run tests
docker-compose run --rm demo python3 scripts/test_human_demo_suite.py
docker-compose run --rm demo python3 scripts/test_edge_cases.py

# Run human call demo
docker-compose --profile human run --rm human-demo

# Check health
curl http://localhost:24187/healthz

# View logs
docker-compose logs -f backend

# Stop everything
docker-compose down
```

### File Locations
- **Main config**: `.env` (credentials)
- **Docker config**: `docker-compose.yml`
- **Backend code**: `backend/` directory
- **Test suites**: `scripts/test_*.py`
- **Demos**: `scripts/*_demo.py`
- **Dashboard**: `dashboard/index.html`

## Architecture & Components

### System Flow
```
Phone Call → Twilio → WebSocket → FastAPI Backend → OpenAI Realtime API
                                        ↓
                                   Dashboard UI
```

### Core Components

#### Backend (`backend/` directory)
- `main.py` - FastAPI application entry point
- `relay_ws.py` - Twilio ConversationRelay WebSocket handler
- `openai_ws.py` - OpenAI Realtime API integration
- `override_api.py` - Supervisor intervention endpoints
- `events.py` - Real-time event streaming
- `commands.py` - LLM command parser
- `twiml.py` - TwiML response generation
- `logging.py` - Structured JSON logging

#### Scripts (`scripts/` directory)
- `setup_twilio.py` - Configure Twilio phone numbers
- `make_call.py` - Initiate outbound calls
- `enhanced_llm_demo.py` - Complete demo suite
- `docker_human_demo.py` - Docker-compatible demos
- `test_human_demo_suite.py` - Main test suite
- `test_edge_cases.py` - Edge case testing

#### Tests (`tests/` directory)
- `unit/` - Unit tests for individual components
- `integration/` - API integration tests
- `system/` - End-to-end system tests
- `e2e/` - Playwright browser tests

## Environment Setup

### Required Environment Variables
```bash
# Twilio Configuration
TWILIO_ACCOUNT_SID=AC4adc0ce78df3d4e73ed3eab1fdd2acbb
TWILIO_AUTH_TOKEN=<auth_token>
TWILIO_PHONE_NUMBER=+18578167225

# OpenAI Configuration
OPENAI_API_KEY=<your_api_key>

# Application Settings
HOST=phony.pushbuild.com
PORT=24187
```

### Optional Variables
```bash
OPENAI_VOICE=alloy              # Voice: alloy, echo, fable, onyx, nova, shimmer
OPENAI_MODEL=gpt-4o-realtime-preview
SYSTEM_PROMPT=You are a helpful assistant
REQUIRE_SUPERVISOR_FEEDBACK=false
PHONY_DEBUG=0                    # Set to 1 for verbose logging
```

### Setup Instructions
1. Copy environment templates:
   ```bash
   cp .env.example .env
   cp .envrc.example .envrc
   ```

2. Configure credentials in `.env`

3. Enable direnv (optional):
   ```bash
   direnv allow .
   ```

## Docker Operations

### Service Management
```bash
# Start all services
docker-compose up -d

# Start specific services
docker-compose up -d backend redis

# View service status
docker-compose ps

# Rebuild after changes
docker-compose build

# Clean everything
docker-compose down -v
```

### Docker Services
| Service | Port | Purpose |
|---------|------|---------|
| backend | 24187 | FastAPI + Dashboard |
| redis | 6380 | Session storage |
| demo | - | Test runner |
| human-demo | - | Interactive demos |

### Docker Profiles
- `human` - Human call demos
- `setup` - Twilio configuration

## Testing Instructions

### Run All Tests
```bash
# Human demo logic tests (8 tests)
docker-compose run --rm demo python3 scripts/test_human_demo_suite.py

# Edge case tests (6 test categories)
docker-compose run --rm demo python3 scripts/test_edge_cases.py

# WebSocket connectivity test
docker-compose run --rm demo python3 scripts/test_websocket_fix.py
```

### Test Coverage Areas
1. **Phone Formatting** - 10 format variations
2. **Malicious Input** - 12 security tests
3. **Concurrent Calls** - 11 concurrency tests
4. **Environment Variables** - 9 edge cases
5. **Unicode Support** - 9 language tests
6. **Performance** - 4 stress tests

### Running Demos

#### AI Calls Human (Outbound)
```bash
docker-compose --profile human run --rm human-demo
# Select: 1
# Consent: yes
# Phone: +1234567890
# Scenario: 1-4
```

#### Human Calls AI (Inbound)
```bash
docker-compose --profile human run --rm human-demo
# Select: 2
# Personality: 1-5
# Call: +18578167225
```

## API Documentation

### Twilio Webhooks
- `POST /start_call` - Handle outbound calls
- `POST /receive_call` - Handle inbound calls
- `WS /relay/ws` - ConversationRelay WebSocket

### Supervisor Controls
- `POST /override/text` - Send text to caller
  ```json
  {"callSid": "CA123", "text": "Hello"}
  ```

- `POST /override/dtmf` - Send DTMF digit
  ```json
  {"callSid": "CA123", "digit": "1"}
  ```

- `POST /override/end` - End call
  ```json
  {"callSid": "CA123"}
  ```

- `POST /override/transfer` - Transfer call
  ```json
  {"callSid": "CA123", "target": "+15551234567"}
  ```

### Monitoring Endpoints
- `WS /events/ws?callSid=CA123` - Event stream
- `GET /healthz` - Health check
- `GET /dashboard/` - Web UI

### LLM Commands
The AI can execute these commands in responses:
- `[[press:digits]]` - Send DTMF tones
- `[[transfer:number]]` - Transfer to number
- `[[end_call]]` - Terminate call
- `[[request_user:prompt]]` - Ask supervisor

## Common Tasks

### Adding a New API Endpoint
1. Add route to `backend/main.py`
2. Implement logic in appropriate module
3. Add test in `tests/integration/`
4. Update API documentation

### Modifying AI Behavior
1. Edit `SYSTEM_PROMPT` in `.env`
2. Modify `backend/openai_ws.py` for session config
3. Test with `scripts/enhanced_llm_demo.py`

### Adding Test Coverage
1. Create test file in `scripts/test_*.py`
2. Follow pattern from `test_human_demo_suite.py`
3. Run with Docker: `docker-compose run --rm demo python3 scripts/test_new.py`

### Updating Dependencies
1. Edit `requirements.txt`
2. Rebuild Docker: `docker-compose build`
3. Test all functionality

## Troubleshooting Guide

### Common Issues & Solutions

#### WebSocket Connection Failed
```bash
# Check backend is running
docker-compose ps
curl http://localhost:24187/healthz

# Check logs for errors
docker-compose logs backend | grep ERROR
```

#### Phone Number Not Working
```bash
# Verify webhook configuration
docker-compose run --rm demo python3 scripts/setup_twilio.py

# Check Twilio credentials
grep TWILIO .env
```

#### Tests Failing
```bash
# Clean and restart
docker-compose down -v
docker-compose up -d backend redis
docker-compose run --rm demo python3 scripts/test_human_demo_suite.py
```

#### Port Conflicts
```bash
# Check what's using port 24187
lsof -i :24187

# Check Redis port 6380
lsof -i :6380
```

### Debug Mode
Enable verbose logging:
```bash
export PHONY_DEBUG=1
docker-compose up backend
```

### Log Locations
- Backend logs: `docker-compose logs backend`
- Call logs: `call.log` file
- Test results: `*test_results*.json`

## External Resources

### Twilio Documentation
- [ConversationRelay Guide](https://www.twilio.com/docs/voice/conversationrelay)
- [WebSocket Messages](https://www.twilio.com/docs/voice/conversationrelay/websocket-messages)
- [TwiML Reference](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay)
- [Integration Tutorial](https://twilio.com/en-us/blog/integrate-openai-twilio-voice-using-conversationrelay)

### OpenAI Documentation
- [Realtime API Guide](https://platform.openai.com/docs/guides/realtime)
- [Model Documentation](https://platform.openai.com/docs/models/gpt-4o-realtime-preview)
- [API Pricing](https://openai.com/pricing)

### Framework Documentation
- [FastAPI](https://fastapi.tiangolo.com)
- [Docker Compose](https://docs.docker.com/compose/)
- [WebSockets](https://websockets.readthedocs.io)
- [ngrok](https://ngrok.com/docs)

## Important Notes for AI Agents

### When Making Changes
1. **Always run tests** after modifications
2. **Never commit** `.env` or `.envrc` files
3. **Update documentation** when adding features
4. **Follow existing patterns** in the codebase
5. **Use Docker** for all operations

### Code Style Guidelines
- Use type hints in Python code
- Follow PEP 8 conventions
- Add docstrings to functions
- Keep functions under 50 lines
- Use meaningful variable names

### Testing Requirements
- All new features need tests
- Edge cases must be covered
- Tests must run in Docker
- Aim for 100% coverage

### Security Considerations
- Never log sensitive data (tokens, keys)
- Validate all user inputs
- Use environment variables for secrets
- Implement rate limiting on APIs
- Require consent for outbound calls

## Project Status

### Current Metrics
- **Test Coverage**: 100% (78/78 tests)
- **Code Quality**: Production ready
- **Docker Support**: Full containerization
- **Documentation**: Comprehensive
- **Phone Numbers**: 4 configured
- **AI Personalities**: 5 available
- **Conversation Scenarios**: 4 defined

### Recent Updates
- Added bidirectional calling (AI↔Human)
- Implemented comprehensive test suite
- Fixed WebSocket compatibility issues
- Added edge case handling
- Created Docker demos
- Updated to single port (24187)

### Known Limitations
- WebSocket library version constraints
- Playwright requires MCP for full testing
- External network required for Twilio
- OpenAI Realtime API in preview

---

## Quick Reference Card

```bash
# Start everything
docker-compose up -d backend redis

# Run tests
docker-compose run --rm demo python3 scripts/test_human_demo_suite.py

# Make outbound call
docker-compose --profile human run --rm human-demo

# Check health
curl http://localhost:24187/healthz

# View logs
docker-compose logs -f backend

# Stop everything
docker-compose down
```

**Dashboard**: http://localhost:24187/dashboard/
**Health**: http://localhost:24187/healthz
**Phone**: +1 (857) 816-7225

---

*This documentation is designed for AI agents. For human-readable documentation, see [README.md](./README.md)*