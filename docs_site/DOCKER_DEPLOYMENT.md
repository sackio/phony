# 🐳 Docker Deployment Guide

Complete guide for deploying Phony using Docker and Docker Compose.

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- 4GB RAM minimum
- 10GB disk space

## Quick Start

```bash
# Clone repository
git clone https://github.com/sackio/phony.git
cd phony

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start all services
docker-compose up -d

# Check health
curl http://localhost:24187/healthz
```

## Docker Services

### Service Architecture

```yaml
services:
  backend:     # FastAPI application (port 24187)
  mongodb:     # Database (port 27017)
  redis:       # Cache & sessions (port 6380)
  frontend:    # React dashboard (port 3000)
  nginx:       # Reverse proxy (port 80/443)
```

### Backend Service

```yaml
backend:
  build: .
  ports:
    - "24187:8000"
  environment:
    - MONGODB_URL=mongodb://mongodb:27017/phony
    - REDIS_URL=redis://redis:6379
  depends_on:
    - mongodb
    - redis
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/healthz"]
    interval: 30s
    timeout: 10s
    retries: 3
```

### Database Services

```yaml
mongodb:
  image: mongo:6.0
  ports:
    - "27017:27017"
  volumes:
    - mongo_data:/data/db
  environment:
    - MONGO_INITDB_ROOT_USERNAME=admin
    - MONGO_INITDB_ROOT_PASSWORD=secure_password

redis:
  image: redis:7-alpine
  ports:
    - "6380:6379"
  volumes:
    - redis_data:/data
  command: redis-server --appendonly yes
```

## Deployment Commands

### Basic Operations

```bash
# Start all services
docker-compose up -d

# Start specific services
docker-compose up -d backend redis

# View logs
docker-compose logs -f backend

# Stop services
docker-compose stop

# Remove containers
docker-compose down

# Remove everything including volumes
docker-compose down -v
```

### Building Images

```bash
# Build all images
docker-compose build

# Build specific service
docker-compose build backend

# Build without cache
docker-compose build --no-cache

# Build with custom tag
docker build -t phony:latest .
```

### Service Management

```bash
# Restart service
docker-compose restart backend

# Scale service
docker-compose up -d --scale backend=3

# Execute command in container
docker-compose exec backend bash

# View running containers
docker-compose ps

# Check service health
docker-compose ps | grep healthy
```

## Production Configuration

### docker-compose.prod.yml

```yaml
version: '3.8'

services:
  backend:
    image: phony:latest
    restart: always
    ports:
      - "127.0.0.1:24187:8000"
    environment:
      - ENVIRONMENT=production
      - LOG_LEVEL=info
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M

  mongodb:
    image: mongo:6.0
    restart: always
    volumes:
      - /data/mongodb:/data/db
    command: mongod --auth --bind_ip_all
    deploy:
      resources:
        limits:
          memory: 2G

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - /data/redis:/data
    command: redis-server --requirepass ${REDIS_PASSWORD}
    deploy:
      resources:
        limits:
          memory: 512M

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - /etc/letsencrypt:/etc/letsencrypt
    depends_on:
      - backend
```

### Environment Variables

```bash
# .env.production
ENVIRONMENT=production
DEBUG=false
LOG_LEVEL=info

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
API_WORKERS=4

# Database
MONGODB_URL=mongodb://admin:password@mongodb:27017/phony?authSource=admin
MONGODB_DATABASE=phony

# Redis
REDIS_URL=redis://:password@redis:6379/0

# Twilio
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+15551234567

# OpenAI
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4o-realtime-preview

# Security
SECRET_KEY=your_secret_key
API_KEY=your_api_key
CORS_ORIGINS=https://yourdomain.com
```

## Volumes & Persistence

### Volume Configuration

```yaml
volumes:
  mongo_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/mongodb
  
  redis_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/redis
```

### Backup Strategy

```bash
# Backup MongoDB
docker-compose exec mongodb mongodump --out /backup
docker cp phony_mongodb_1:/backup ./mongo_backup

# Backup Redis
docker-compose exec redis redis-cli BGSAVE
docker cp phony_redis_1:/data/dump.rdb ./redis_backup.rdb

# Automated backup script
#!/bin/bash
BACKUP_DIR="/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p $BACKUP_DIR

# MongoDB
docker-compose exec -T mongodb mongodump --archive > "$BACKUP_DIR/mongodb.archive"

# Redis
docker-compose exec -T redis redis-cli --rdb "$BACKUP_DIR/redis.rdb"

# Compress
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"
```

## Networking

### Custom Network

```yaml
networks:
  phony_network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

### Service Discovery

```yaml
services:
  backend:
    networks:
      phony_network:
        aliases:
          - api.phony.local
```

## Health Checks

### Service Health Checks

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/healthz"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

### Monitoring Script

```bash
#!/bin/bash
# check_health.sh

check_service() {
  local service=$1
  local url=$2
  
  if curl -f -s "$url" > /dev/null; then
    echo "✅ $service is healthy"
  else
    echo "❌ $service is unhealthy"
    exit 1
  fi
}

check_service "Backend" "http://localhost:24187/healthz"
check_service "MongoDB" "mongodb://localhost:27017"
check_service "Redis" "redis://localhost:6380"
```

## Scaling

### Horizontal Scaling

```bash
# Scale backend service
docker-compose up -d --scale backend=3

# With load balancer
docker-compose -f docker-compose.yml \
               -f docker-compose.lb.yml \
               up -d --scale backend=3
```

### Load Balancer Configuration

```yaml
# docker-compose.lb.yml
services:
  haproxy:
    image: haproxy:2.8
    ports:
      - "80:80"
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg
    depends_on:
      - backend
```

## Troubleshooting

### Common Issues

#### Container won't start
```bash
# Check logs
docker-compose logs backend

# Inspect container
docker-compose ps
docker inspect phony_backend_1
```

#### Database connection issues
```bash
# Test MongoDB connection
docker-compose exec backend python -c "
from pymongo import MongoClient
client = MongoClient('mongodb://mongodb:27017/')
print(client.server_info())
"

# Test Redis connection
docker-compose exec backend python -c "
import redis
r = redis.from_url('redis://redis:6379')
print(r.ping())
"
```

#### Port conflicts
```bash
# Check ports in use
netstat -tulpn | grep -E '24187|27017|6380'

# Change ports in docker-compose.yml
ports:
  - "24188:8000"  # Changed from 24187
```

### Debug Mode

```bash
# Run in foreground with debug
DEBUG=1 docker-compose up

# Interactive shell
docker-compose run --rm backend bash

# Execute Python shell
docker-compose exec backend python
```

## Security Best Practices

1. **Use secrets management**
   ```yaml
   secrets:
     db_password:
       external: true
   ```

2. **Limit network exposure**
   ```yaml
   ports:
     - "127.0.0.1:24187:8000"  # Local only
   ```

3. **Run as non-root user**
   ```dockerfile
   USER app:app
   ```

4. **Enable security options**
   ```yaml
   security_opt:
     - no-new-privileges:true
   ```

5. **Resource limits**
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '1'
         memory: 1G
   ```

## Monitoring

### Prometheus Integration

```yaml
services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
```

### Grafana Dashboard

```yaml
services:
  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Deploy to Production
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Build and push Docker image
        run: |
          docker build -t phony:${{ github.sha }} .
          docker tag phony:${{ github.sha }} phony:latest
          docker push phony:latest
      
      - name: Deploy to server
        run: |
          ssh deploy@server "cd /app && docker-compose pull && docker-compose up -d"
```

---

*Docker Version: 20.10+*
*Compose Version: 2.0+*
*Last Updated: December 2024*