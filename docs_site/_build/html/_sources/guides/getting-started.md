# 🚀 Getting Started

This guide will help you set up and run Phony Voice AI Agent on your local machine or production environment. Follow these steps to make your first AI phone call.

## 📋 Prerequisites

Before you begin, ensure you have the following:

### Required Software
- **Docker & Docker Compose**: [Install Docker](https://docs.docker.com/get-docker/)
- **Python 3.9+**: For running scripts directly (optional)
- **Git**: For cloning the repository

### Required Accounts & API Keys
- **OpenAI API Key**: [Get API key](https://platform.openai.com/api-keys) with Realtime API access
- **Twilio Account**: [Sign up for Twilio](https://www.twilio.com/try-twilio) with phone number
- **Public URL**: For webhooks (production) or [ngrok](https://ngrok.com) (development)

## 🔧 Installation

### 1. Clone the Repository
```bash
git clone https://github.com/sackio/phony.git
cd phony
```

### 2. Environment Configuration
Copy the environment templates:
```bash
cp .env.example .env
cp .envrc.example .envrc
```

Edit `.env` with your credentials:
```bash
nano .env
```

Required environment variables:
```bash
# Twilio Configuration
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+15551234567

# OpenAI Configuration
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxx

# Application Settings
HOST=your-domain.com  # or xxx.ngrok-free.app for development
PORT=24187
```

Optional configuration:
```bash
OPENAI_VOICE=alloy                      # Voice selection
OPENAI_MODEL=gpt-4o-realtime-preview    # Model selection
SYSTEM_PROMPT=You are a helpful assistant
PHONY_DEBUG=0                           # Debug logging (0 or 1)
```

### 3. Enable direnv (Optional but Recommended)
```bash
# Allow direnv to load environment variables
direnv allow .
```

## 🐳 Docker Setup

### Start Core Services
```bash
# Start backend, Redis, and MongoDB
docker-compose up -d backend redis mongodb

# Verify services are running
docker-compose ps
```

Expected output:
```
    Name                   Command               State                         Ports                   
-------------------------------------------------------------------------------------------------------
phony-backend   uvicorn backend.main:app ...   Up (healthy)   0.0.0.0:24187->8000/tcp
phony-redis     docker-entrypoint.sh redis ... Up             0.0.0.0:6380->6379/tcp  
phony-mongodb   docker-entrypoint.sh mongod    Up             0.0.0.0:27017->27017/tcp
```

### Health Check
Verify the system is healthy:
```bash
curl http://localhost:24187/healthz
```

Expected response:
```json
{
  "status": "ok",
  "uptime": 42,
  "activeCalls": 0
}
```

## 📞 Phone Number Setup

### Configure Twilio Phone Number
Run the interactive setup script:
```bash
docker-compose run --rm demo python3 scripts/setup_twilio.py
```

This script will:
1. List your existing Twilio phone numbers
2. Offer to purchase a new number if needed
3. Configure webhook URLs for the selected number
4. Test the webhook configuration

### Manual Webhook Configuration
If you prefer manual setup, configure these webhooks in your [Twilio Console](https://console.twilio.com/):

```
Voice Configuration:
- Webhook URL: https://your-domain.com/receive_call
- HTTP Method: POST
```

## 🎯 Make Your First Call

### Option 1: AI Calls Human (Outbound)
```bash
# Start the interactive demo
docker-compose --profile human run --rm human-demo

# Select: 1 (AI calls human)
# Confirm consent: yes
# Enter phone number: +1234567890
# Choose scenario: 1-4
```

Available scenarios:
1. **Customer Service Inquiry** - Professional business questions
2. **Survey/Feedback Request** - Brief 2-3 question surveys  
3. **Appointment Scheduling** - Booking and availability checks
4. **Friendly Check-in** - Casual conversation and wellness

### Option 2: Human Calls AI (Inbound)
```bash
# Start personality selector
docker-compose --profile human run --rm human-demo

# Select: 2 (Human calls AI)
# Choose personality: 1-5
# Call the number: +1 (857) 816-7225
```

Available personalities:
1. **Professional Assistant** - Business helper and support
2. **Customer Service Rep** - Technical support specialist
3. **Appointment Scheduler** - Booking coordinator
4. **Information Hotline** - General information assistant
5. **Survey Conductor** - Feedback collection specialist

## 📊 Monitor Your Call

### Access the Dashboard
Open your browser and navigate to:
```
http://localhost:24187/dashboard/index.html?callSid={CALL_SID}
```

The dashboard provides:
- **Real-time transcript** - See the conversation as it happens
- **Supervisor controls** - Send messages, DTMF digits, or end calls
- **Call metrics** - Duration, quality, sentiment analysis
- **Event stream** - Live WebSocket updates

![Dashboard Screenshot](/_static/images/dashboard-main.png)

## 🧪 Run Tests

### Complete Test Suite
Verify your installation with the comprehensive test suite:
```bash
# Human demo logic tests (8 tests)
docker-compose run --rm demo python3 scripts/test_human_demo_suite.py

# Edge case tests (6 test categories)
docker-compose run --rm demo python3 scripts/test_edge_cases.py

# WebSocket connectivity test
docker-compose run --rm demo python3 scripts/test_websocket_fix.py
```

Expected result: **78/78 tests passing (100% coverage)**

### Test Categories Covered
1. **Phone Formatting** - 10 format variations
2. **Malicious Input** - 12 security tests
3. **Concurrent Calls** - 11 concurrency tests
4. **Environment Variables** - 9 edge cases
5. **Unicode Support** - 9 language tests
6. **Performance** - 4 stress tests

## 🎨 Available AI Voices

Choose from 6 OpenAI voices by setting `OPENAI_VOICE` in `.env`:

```{list-table} Voice Options
:header-rows: 1
:widths: 20 20 60

* - Voice
  - Gender
  - Description
* - **alloy**
  - Neutral
  - Balanced and professional (default)
* - **echo** 
  - Male
  - Clear and articulate
* - **fable**
  - Female
  - British accent, warm tone
* - **onyx**
  - Male
  - Deep and authoritative
* - **nova**
  - Female
  - Friendly and conversational
* - **shimmer**
  - Female
  - Energetic and enthusiastic
```

## 🔧 Troubleshooting

### Common Issues

**Service won't start**
```bash
# Check port availability
lsof -i :24187
lsof -i :6380
lsof -i :27017

# Restart Docker services
docker-compose down
docker-compose up -d backend redis mongodb
```

**No audio on calls**
- Verify OpenAI API key has Realtime API access
- Check WebSocket connection in backend logs:
```bash
docker-compose logs backend | grep -i websocket
```

**Webhook errors**
- Ensure your public URL is accessible from the internet
- For development, use ngrok:
```bash
ngrok http 24187
# Update HOST in .env with the ngrok URL
```

**Dashboard not loading**
- Verify backend is healthy: `curl http://localhost:24187/healthz`
- Check browser console for JavaScript errors
- Ensure all Docker services are running: `docker-compose ps`

### Debug Mode
Enable verbose logging:
```bash
# In .env file
PHONY_DEBUG=1

# Restart backend
docker-compose restart backend

# View logs
docker-compose logs -f backend
```

### Log Files
- **Backend logs**: `docker-compose logs backend`
- **Call logs**: Available through dashboard or API
- **Test results**: Generated as `*test_results*.json`

## 🚀 Next Steps

### Customize Your AI Agent
1. **Modify system prompt** - Edit `SYSTEM_PROMPT` in `.env`
2. **Change voice** - Update `OPENAI_VOICE` setting
3. **Add custom commands** - See {doc}`../tutorials/custom-agent`

### Explore Advanced Features
- **Multi-tenant setup** - {doc}`../features/multi-tenant-architecture`
- **Production deployment** - {doc}`../tutorials/deployment-guide`
- **API integration** - {doc}`../api/index`

### Development Resources
- **Full API reference** - {doc}`../api/endpoints`
- **WebSocket events** - {doc}`../api/websockets`
- **UI dashboard guide** - {doc}`../ui-guide/dashboard-overview`

## 💡 Quick Tips

```{admonition} Pro Tips
:class: tip

1. **Use ngrok for development** - Easy webhook testing without server setup
2. **Monitor call quality** - Check dashboard metrics for latency and audio quality
3. **Test different scenarios** - Each personality handles different use cases
4. **Enable debug logging** - Helpful for troubleshooting WebSocket issues
5. **Save conversation transcripts** - Available through the dashboard and API
```

## 📞 Get Help

- **Documentation Issues**: [GitHub Issues](https://github.com/sackio/phony/issues)
- **Live Demo**: Call +1 (857) 816-7225
- **Technical Support**: {doc}`troubleshooting`

---

*Next: {doc}`configuration` - Advanced configuration options*