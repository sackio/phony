# 🐳 Docker Human Call Demo - Usage Guide

## ✅ Complete Implementation

I've built comprehensive human call demo functionality that runs entirely in Docker Compose as requested!

---

## 🚀 Quick Start Commands

### **Start Backend Services:**
```bash
docker-compose up -d backend redis
```

### **Run Human Call Demo:**
```bash
# Interactive human call demo
docker-compose --profile human run --rm human-demo
```

### **Alternative Demo Commands:**
```bash
# Full enhanced demo (requires backend modules)
docker-compose run --rm demo python3 scripts/enhanced_llm_demo.py

# Simple Docker-compatible demo
docker-compose run --rm demo python3 scripts/docker_human_demo.py
```

---

## 📞 Demo Modes Available

### **Mode 1: AI Calls Human (Outbound)**
```bash
docker-compose --profile human run --rm human-demo
# Select: 1
# Confirm consent: yes  
# Enter number: +1234567890
# Choose scenario: 1-4
# Monitor: http://localhost:24187/dashboard/
```

**AI Scenarios:**
1. **Customer Service Inquiry** - Professional business questions
2. **Survey/Feedback Request** - Brief 2-3 question survey
3. **Appointment Scheduling** - Booking and availability checks  
4. **Friendly Check-in** - Casual conversation

### **Mode 2: Human Calls AI (Inbound)**
```bash
docker-compose --profile human run --rm human-demo
# Select: 2
# Choose AI personality: 1-5
# Call: +1 (857) 816-7225
# Monitor: http://localhost:24187/dashboard/
```

**AI Personalities:**
1. **Professional Assistant** - Business helper
2. **Customer Service Rep** - Tech support
3. **Appointment Scheduler** - Booking coordinator
4. **Information Hotline** - General info assistant
5. **Survey Conductor** - Feedback collector

---

## 🎛️ Live Monitoring & Control

**Dashboard URLs:**
- **Main:** http://localhost:24187/dashboard/
- **Live Monitor:** http://localhost:24187/dashboard/index.html?callSid={CALL_SID}
- **Health Check:** http://localhost:24187/healthz

**Control Features:**
- 📝 **Real-time transcript** - See conversation live
- 💬 **Message override** - Send text for AI to speak
- 📞 **Call control** - End or transfer calls
- 🔢 **DTMF tones** - Send touch-tone digits
- ⚠️ **Emergency stop** - Immediate call termination

---

## 🔧 Docker Services

| Service | Purpose | Command |
|---------|---------|---------|
| `backend` | FastAPI server | `docker-compose up -d backend` |
| `redis` | Session storage | `docker-compose up -d redis` |
| `human-demo` | Human call interface | `--profile human run human-demo` |
| `demo` | Full demo suite | `run demo` |
| `twilio-setup` | Phone configuration | `--profile setup run twilio-setup` |

---

## 📱 Your Phone Numbers

**Primary AI Number:** **+1 (857) 816-7225**
- ✅ Configured for inbound calls
- ✅ Webhook: https://phony.pushbuild.com/receive_call
- ✅ Ready for human conversations

**Additional Numbers Available:**
- +1 (978) 490-1657
- +1 (617) 300-0585 (BSack Direct)
- +1 (617) 299-8887 (PushBuild Main)

---

## ⚠️ Safety & Ethics

**For Outbound Calls:**
- ✅ **Explicit consent required** before calling anyone
- ⏱️ **Brief conversations** - AI keeps calls short
- 🆔 **AI identification** - Will identify as AI if asked
- 📊 **Live supervision** - Monitor and control via dashboard
- 🛑 **Immediate termination** - End call if requested

**For Inbound Calls:**
- 📞 **Clear AI identification** available
- 🤖 **Professional behavior** with selected personality
- 📋 **Conversation logging** for quality assurance
- 🎛️ **Supervisor override** capabilities

---

## 🧪 Testing Commands

**Test Backend Health:**
```bash
curl http://localhost:24187/healthz
```

**Test Dashboard:**
```bash
# Open in browser
http://localhost:24187/dashboard/
```

**Test Phone Configuration:**
```bash
docker-compose --profile setup run --rm twilio-setup
```

---

## 🎉 Complete Workflow Examples

### **Example 1: AI Calls Customer Service**
```bash
# Start services
docker-compose up -d backend redis

# Run human call demo
docker-compose --profile human run --rm human-demo
# Select: 1 (AI calls human)
# Consent: yes
# Number: +15551234567  
# Scenario: 1 (Customer Service)
# Confirm: yes

# Monitor live at: http://localhost:24187/dashboard/
```

### **Example 2: Human Calls AI Assistant**
```bash
# Start services  
docker-compose up -d backend redis

# Run human call demo
docker-compose --profile human run --rm human-demo
# Select: 2 (Human calls AI)
# Personality: 1 (Professional Assistant)

# Call: +1 (857) 816-7225
# Have conversation with AI
# Monitor: http://localhost:24187/dashboard/
```

---

## 🔍 Troubleshooting

**Port Issues:**
- Redis runs on 6380 (not 6379) to avoid conflicts
- Backend runs on 24187
- Use `docker-compose down` to clean up

**Phone Issues:**
- Verify webhook: https://phony.pushbuild.com/receive_call
- Check Twilio console for number status
- Test with `curl http://localhost:24187/healthz`

**Demo Issues:**
- Ensure backend is running: `docker-compose ps`
- Check logs: `docker-compose logs backend`
- Use interactive mode: `docker-compose run --rm -it human-demo`

---

**🎭 Your Docker-based human call demo system is ready for production use!**

All functionality runs in containers with proper service orchestration, live monitoring, and comprehensive safety measures.