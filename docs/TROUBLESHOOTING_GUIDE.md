# 🚨 Phony Troubleshooting Guide

Complete troubleshooting guide for the Phony Voice AI Agent system. This guide covers common issues, solutions, and debugging techniques.

## 🔧 Quick Diagnostics

### System Health Check
```bash
# Check all services
docker-compose ps

# Check backend health
curl -s http://localhost:24187/healthz | jq

# View service logs
docker-compose logs backend
docker-compose logs mongodb
docker-compose logs redis
```

### Connectivity Tests
```bash
# Test WebSocket connection
curl --include \
     --no-buffer \
     --header "Connection: Upgrade" \
     --header "Upgrade: websocket" \
     --header "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
     --header "Sec-WebSocket-Version: 13" \
     http://localhost:24187/relay/ws

# Test MongoDB connection
docker-compose exec mongodb mongosh --eval "db.adminCommand('ping')"

# Test Redis connection
docker-compose exec redis redis-cli ping
```

## 🐛 Common Issues & Solutions

### 1. Service Startup Issues

#### Problem: Services fail to start
```bash
Error: Cannot start service backend: driver failed programming external connectivity
```

**Solution**:
```bash
# Check port conflicts
sudo lsof -i :24187
sudo lsof -i :27017
sudo lsof -i :6380

# Stop conflicting services
sudo systemctl stop mongodb
sudo systemctl stop redis

# Clean Docker state
docker-compose down -v
docker system prune -f

# Restart services
docker-compose up -d backend mongodb redis
```

#### Problem: Backend container exits immediately
```bash
backend_1 exited with code 1
```

**Solution**:
```bash
# Check environment variables
docker-compose run --rm backend env | grep -E '(TWILIO|OPENAI)'

# View detailed logs
docker-compose logs --tail=50 backend

# Fix missing environment variables
cp .env.example .env
# Edit .env with correct values

# Restart
docker-compose up -d backend
```

### 2. Database Connection Issues

#### Problem: MongoDB connection errors
```bash
pymongo.errors.ServerSelectionTimeoutError: [Errno 111] Connection refused
```

**Solution**:
```bash
# Check MongoDB service
docker-compose logs mongodb

# Reset MongoDB data
docker-compose down
docker volume rm phony_mongodb_data
docker-compose up -d mongodb

# Wait for MongoDB to initialize
sleep 30

# Start backend
docker-compose up -d backend
```

#### Problem: Redis connection errors
```bash
redis.exceptions.ConnectionError: Error 111 connecting to redis:6379
```

**Solution**:
```bash
# Check Redis service
docker-compose ps redis
docker-compose logs redis

# Reset Redis
docker-compose restart redis

# Check Redis connectivity
docker-compose exec redis redis-cli ping
```

### 3. Twilio Integration Issues

#### Problem: Webhook not receiving calls
```bash
11001 - Unable to create a webhook: URL is not valid
```

**Solution**:
```bash
# Check webhook URL
curl -X POST https://your-domain.com/receive_call \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "CallSid=CA123&From=%2B15551234567&To=%2B15551234567"

# Update webhook URL in Twilio console
python3 scripts/setup_twilio.py

# For development with ngrok
ngrok http 24187
# Update HOST in .env with ngrok URL
```

#### Problem: Authentication errors
```bash
HTTP 401 - Authenticate
```

**Solution**:
```bash
# Verify Twilio credentials
echo "Account SID: $TWILIO_ACCOUNT_SID"
echo "Auth Token length: ${#TWILIO_AUTH_TOKEN}"

# Test credentials
curl -X GET "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}.json" \
     -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}"

# Update credentials in .env
nano .env
docker-compose restart backend
```

### 4. OpenAI Integration Issues

#### Problem: OpenAI API errors
```bash
openai.error.AuthenticationError: Invalid API key provided
```

**Solution**:
```bash
# Check API key format
echo "Key format: ${OPENAI_API_KEY:0:7}...${OPENAI_API_KEY: -4}"

# Test API key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Check Realtime API access
curl https://api.openai.com/v1/realtime \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

#### Problem: Realtime API connection issues
```bash
websockets.exceptions.ConnectionClosedError: code = 1008
```

**Solution**:
```bash
# Check model availability
echo "Model: $OPENAI_MODEL"

# Verify Realtime API access
# Contact OpenAI support if needed

# Try alternative model
export OPENAI_MODEL=gpt-4o-realtime-preview-2024-10-01
docker-compose restart backend
```

### 5. Call Quality Issues

#### Problem: No audio during calls
**Symptoms**: Call connects but no voice

**Solution**:
```bash
# Check OpenAI voice configuration
echo "Voice: $OPENAI_VOICE"

# Test different voices
export OPENAI_VOICE=nova
docker-compose restart backend

# Check audio encoding
docker-compose logs backend | grep -i audio
```

#### Problem: Audio delays or drops
**Symptoms**: Choppy or delayed audio

**Solution**:
```bash
# Check system resources
docker stats phony-backend phony-redis phony-mongodb

# Increase container resources
# Edit docker-compose.yml:
# services:
#   backend:
#     mem_limit: 2g
#     cpus: '1.0'

# Check network latency
ping api.openai.com
ping api.twilio.com

# Optimize network settings
echo 'net.core.rmem_max = 16777216' >> /etc/sysctl.conf
sysctl -p
```

### 6. WebSocket Connection Issues

#### Problem: Dashboard not updating
**Symptoms**: Transcript not showing real-time updates

**Solution**:
```bash
# Test WebSocket endpoint
curl -i -N -H "Connection: Upgrade" \
     -H "Upgrade: websocket" \
     -H "Origin: http://localhost:24187" \
     -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" \
     -H "Sec-WebSocket-Version: 13" \
     "ws://localhost:24187/events/ws?callSid=TEST123"

# Check CORS settings
docker-compose logs backend | grep -i cors

# Clear browser cache
# Press F12 -> Network -> Disable cache -> Refresh
```

### 7. Multi-tenant Issues

#### Problem: Tenant isolation failures
**Symptoms**: Users seeing other tenants' data

**Solution**:
```bash
# Check tenant middleware
docker-compose logs backend | grep -i tenant

# Verify JWT tokens
export JWT_SECRET=$(openssl rand -hex 32)
echo "JWT_SECRET=$JWT_SECRET" >> .env
docker-compose restart backend

# Test tenant API
curl -X GET "http://localhost:24187/tenants" \
     -H "Authorization: Bearer YOUR_TOKEN"
```

## 📊 Performance Monitoring

### Resource Monitoring
```bash
# Container resource usage
docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"

# Backend-specific monitoring
docker-compose exec backend top
docker-compose exec backend df -h
```

### Call Monitoring
```bash
# Active calls
curl -s http://localhost:24187/healthz | jq .activeCalls

# Call history
curl -s http://localhost:24187/calls | jq '.[] | {id, status, duration}'

# Error rates
docker-compose logs backend | grep ERROR | wc -l
```

### Database Monitoring
```bash
# MongoDB status
docker-compose exec mongodb mongosh --eval "db.serverStatus()"

# Redis status
docker-compose exec redis redis-cli info stats
```

## 🔍 Debug Mode

### Enable Debug Logging
```bash
# Add to .env
echo "PHONY_DEBUG=1" >> .env
echo "PYTHONPATH=/app" >> .env

# Restart with debug logging
docker-compose restart backend

# View debug logs
docker-compose logs -f backend | grep DEBUG
```

### Verbose Testing
```bash
# Run tests with verbose output
docker-compose run --rm demo python3 -m pytest tests/ -v --tb=long

# Debug specific test
docker-compose run --rm demo python3 -m pytest tests/integration/test_api.py::test_health_check -vvv

# Enable test debugging
docker-compose run --rm demo python3 -c "
import logging
logging.basicConfig(level=logging.DEBUG)
import tests.integration.test_api as test_module
"
```

## 🆘 Emergency Procedures

### Complete System Reset
```bash
#!/bin/bash
echo "🚨 EMERGENCY SYSTEM RESET 🚨"
echo "This will destroy all data. Continue? (yes/no)"
read -r response
if [[ "$response" == "yes" ]]; then
    docker-compose down -v
    docker system prune -af --volumes
    docker volume prune -f
    docker-compose build --no-cache
    cp .env.example .env
    echo "✅ System reset complete. Update .env and run:"
    echo "docker-compose up -d"
fi
```

### Service Recovery
```bash
#!/bin/bash
# Quick service recovery script
echo "🔄 Attempting service recovery..."

# Stop all services
docker-compose down

# Check and fix permissions
sudo chown -R $(id -u):$(id -g) .

# Remove problematic containers
docker-compose rm -f

# Restart services one by one
echo "Starting MongoDB..."
docker-compose up -d mongodb
sleep 10

echo "Starting Redis..."
docker-compose up -d redis
sleep 5

echo "Starting Backend..."
docker-compose up -d backend
sleep 10

# Health check
curl -f http://localhost:24187/healthz && echo "✅ Recovery successful" || echo "❌ Recovery failed"
```

## 📞 Support Resources

### Log Collection
```bash
#!/bin/bash
# Collect logs for support
LOG_DIR="phony-logs-$(date +%Y%m%d-%H%M%S)"
mkdir "$LOG_DIR"

# System info
docker --version > "$LOG_DIR/system-info.txt"
docker-compose --version >> "$LOG_DIR/system-info.txt"
uname -a >> "$LOG_DIR/system-info.txt"

# Service logs
docker-compose logs backend > "$LOG_DIR/backend.log"
docker-compose logs mongodb > "$LOG_DIR/mongodb.log"
docker-compose logs redis > "$LOG_DIR/redis.log"

# Configuration (sanitized)
cp docker-compose.yml "$LOG_DIR/"
cp .env.example "$LOG_DIR/"

# Container status
docker-compose ps > "$LOG_DIR/container-status.txt"

# Create archive
tar -czf "$LOG_DIR.tar.gz" "$LOG_DIR"
echo "Logs collected in: $LOG_DIR.tar.gz"
```

### Contact Support
- **GitHub Issues**: https://github.com/sackio/phony/issues
- **Documentation**: [CLAUDE.md](../CLAUDE.md)
- **Demo Number**: +1 (857) 816-7225

---

**Remember**: Always backup your data before attempting fixes, and test changes in a development environment first.