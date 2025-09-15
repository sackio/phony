# Quick Start Guide

Get Phony up and running in just a few minutes with this streamlined setup process.

## Prerequisites

```{list-table} System Requirements
:header-rows: 1

* - Component
  - Requirement
  - Notes
* - **Docker**
  - 20.10+
  - For containerization
* - **Docker Compose**
  - 2.0+
  - Service orchestration
* - **RAM**
  - 4GB minimum
  - 8GB recommended
* - **Storage**
  - 5GB available
  - For containers and data
* - **Network**
  - Internet access
  - For Twilio/OpenAI APIs
```

## Step 1: Clone Repository

```bash
git clone https://github.com/sackio/phony.git
cd phony
```

## Step 2: Configure Environment

### Create Environment File

```bash
cp .env.example .env
```

### Edit Required Settings

Open `.env` and configure these essential variables:

```bash
# Twilio Configuration (Required)
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890

# OpenAI Configuration (Required)
OPENAI_API_KEY=your_openai_api_key_here

# Application Settings (Optional)
HOST=localhost
PORT=24187
SYSTEM_PROMPT="You are a helpful assistant"
```

```{admonition} Getting API Keys
:class: tip

**Twilio Account**: Sign up at [twilio.com](https://twilio.com)
- Purchase a phone number with voice capabilities
- Find your Account SID and Auth Token in console

**OpenAI API Key**: Get one at [platform.openai.com](https://platform.openai.com)  
- Ensure you have Realtime API access
- Check your usage limits and billing
```

## Step 3: Start Services

### Basic Setup

```bash
# Start core services
docker-compose up -d backend redis mongodb

# Verify services are running
docker-compose ps
```

Expected output:
```
NAME               COMMAND                  SERVICE             STATUS              PORTS
phony-backend      "python backend/main.py"  backend             running             0.0.0.0:24187->8000/tcp
phony-redis        "docker-entrypoint.s…"    redis               running             0.0.0.0:6380->6379/tcp  
phony-mongodb      "docker-entrypoint.s…"    mongodb             running             0.0.0.0:27017->27017/tcp
```

### Verify Installation

```bash
# Health check
curl http://localhost:24187/healthz

# Expected response: {"status": "healthy"}
```

## Step 4: Configure Twilio Webhook

Set up your Twilio phone number to connect to Phony:

```bash
# Auto-configure webhooks
docker-compose run --rm demo python3 scripts/setup_twilio.py

# Manual configuration (alternative)
# Set voice webhook URL in Twilio Console to:
# https://your-domain.com/receive_call
```

## Step 5: Test Your Setup

### Option A: Make an Outbound Call

```bash
# Launch interactive demo
docker-compose --profile human run --rm human-demo

# Follow prompts:
# 1. Select "AI calls human" 
# 2. Consent: yes
# 3. Enter your phone number
# 4. Choose a scenario
```

### Option B: Receive an Inbound Call

```bash
# Configure AI personality
docker-compose --profile human run --rm human-demo

# Follow prompts:
# 1. Select "Human calls AI"
# 2. Choose personality (1-5)
# 3. Call the number: +1 (857) 816-7225
```

## Step 6: Access Dashboard

Open your browser and navigate to:

```
http://localhost:24187/dashboard/
```

The dashboard provides:
- Real-time call monitoring  
- Agent management interface
- Supervisor controls
- Analytics and reports

## Common Issues & Solutions

### Services Won't Start

```bash
# Check Docker is running
docker version

# Check port availability
lsof -i :24187
lsof -i :6380
lsof -i :27017

# View service logs
docker-compose logs backend
```

### API Keys Not Working

```bash
# Test Twilio credentials
docker-compose run --rm demo python3 -c "
from twilio.rest import Client
import os
client = Client(os.getenv('TWILIO_ACCOUNT_SID'), os.getenv('TWILIO_AUTH_TOKEN'))
print('Twilio connected:', client.api.account.sid)
"

# Test OpenAI key
docker-compose run --rm demo python3 -c "
import openai
import os
openai.api_key = os.getenv('OPENAI_API_KEY')
print('OpenAI connected')
"
```

### Webhook Configuration Failed

```bash
# Manual webhook setup
# In Twilio Console:
# 1. Go to Phone Numbers > Manage > Active numbers
# 2. Click your number
# 3. Set Voice Webhook to: https://your-domain.com/receive_call
# 4. Set HTTP method to: POST
```

## Performance Testing

### Run Test Suite

```bash
# Complete test suite (100% coverage)
docker-compose run --rm demo python3 scripts/test_human_demo_suite.py

# Edge cases and security tests
docker-compose run --rm demo python3 scripts/test_edge_cases.py

# Expected result: All tests passing
```

### Load Testing

```bash
# Concurrent call simulation
docker-compose run --rm demo python3 -c "
import asyncio
from scripts.test_edge_cases import test_concurrent_calls
asyncio.run(test_concurrent_calls())
"
```

## Next Steps

```{panels}
:container: +full-width
:column: col-lg-6 px-2 py-2
:card:

**🎛️ Explore Dashboard**
^^^
Learn to monitor calls and manage agents through the web interface.

[Dashboard Guide](../ui-guide/overview)
---

**🔌 Integrate APIs** 
^^^
Connect your applications using REST and WebSocket APIs.

[API Documentation](../api/index)
---

**🎓 Follow Tutorials**
^^^
Build common scenarios like customer service and appointment booking.

[View Tutorials](../tutorials/basic-setup)
---

**🚀 Deploy to Production**
^^^
Scale your deployment with advanced configuration and monitoring.

[Deployment Guide](deployment)
```

## Configuration Reference

### Full Environment Variables

```{code-block} bash
:caption: Complete .env file
:linenos:

# Twilio Settings
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...

# OpenAI Settings  
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-realtime-preview
OPENAI_VOICE=alloy

# Application
HOST=localhost
PORT=24187
SYSTEM_PROMPT=You are a helpful assistant

# Optional Features
REQUIRE_SUPERVISOR_FEEDBACK=false
PHONY_DEBUG=0

# Database (Docker defaults)
MONGODB_URL=mongodb://mongodb:27017
REDIS_URL=redis://redis:6379
```

### Voice Options

```{list-table} Available Voices
:header-rows: 1

* - Voice
  - Characteristics  
  - Best For
* - **alloy**
  - Balanced, professional
  - Business calls
* - **echo**
  - Clear, authoritative  
  - Technical support
* - **fable**
  - Warm, storytelling
  - Healthcare, education
* - **onyx**
  - Confident, persuasive
  - Sales, marketing
* - **nova**
  - Friendly, conversational
  - Customer service
* - **shimmer**
  - Energetic, upbeat
  - Entertainment, youth
```

---

```{admonition} Need Help?
:class: note

- **Issues**: [GitHub Issues](https://github.com/sackio/phony/issues)
- **Discussions**: [GitHub Discussions](https://github.com/sackio/phony/discussions)
- **FAQ**: [Frequently Asked Questions](../reference/faq)
```