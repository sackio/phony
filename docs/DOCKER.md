# Docker Setup for Phony

This guide explains how to run Phony with MongoDB using Docker Compose.

## Prerequisites

- Docker Engine 20.10 or later
- Docker Compose V2

## Quick Start

1. **Ensure your `.env` file has all required variables**:
   ```bash
   # Required variables are already in .env:
   # - TWILIO_ACCOUNT_SID
   # - TWILIO_AUTH_TOKEN
   # - TWILIO_NUMBER
   # - OPENAI_API_KEY
   # - PUBLIC_URL
   # - API_SECRET
   ```

2. **Build and start the services**:
   ```bash
   docker compose up -d
   ```

3. **Check the logs**:
   ```bash
   docker compose logs -f
   ```

4. **Access the application**:
   - Web UI: http://localhost:3004
   - Public URL: https://phony.pushbuild.com (via nginx proxy)

## Services

### MongoDB
- **Container**: `phony-mongodb`
- **Port**: 27017
- **Database**: phony
- **Data**: Persisted in Docker volume `mongodb_data`

### Voice Server
- **Container**: `phony-server`
- **Port**: 3004
- **Dependencies**: MongoDB (waits for health check)

## Common Commands

### Start services
```bash
docker compose up -d
```

### Stop services
```bash
docker compose down
```

### View logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f voice-server
docker compose logs -f mongodb
```

### Rebuild after code changes
```bash
docker compose up -d --build
```

### Restart a service
```bash
docker compose restart voice-server
```

### Access MongoDB shell
```bash
docker compose exec mongodb mongosh phony
```

### View call transcripts in MongoDB
```bash
docker compose exec mongodb mongosh phony --eval "db.calls.find().pretty()"
```

## Stopping and Cleaning Up

### Stop and remove containers (keeps data)
```bash
docker compose down
```

### Stop and remove containers AND volumes (deletes all data)
```bash
docker compose down -v
```

## Development

For local development with hot reload, create a `docker-compose.override.yml` based on the example:

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
```

## Troubleshooting

### Port already in use
If port 3004 is already in use:
```bash
# Find process using the port
lsof -i :3004

# Kill existing process
pkill -f "node dist/start-all.cjs"

# Or change port in docker-compose.yml
ports:
  - "3005:3004"  # Map host port 3005 to container port 3004
```

### MongoDB connection issues
Check MongoDB health:
```bash
docker compose exec mongodb mongosh --eval "db.adminCommand('ping')"
```

### View MongoDB logs
```bash
docker compose logs mongodb
```

## Production Deployment

For production:

1. Update the `.env` file with production values
2. Set `RECORD_CALLS=true` if you want to record calls
3. Use a production-ready MongoDB setup with authentication:

```yaml
# Add to docker-compose.yml mongodb service
environment:
  MONGO_INITDB_ROOT_USERNAME: admin
  MONGO_INITDB_ROOT_PASSWORD: your-secure-password
  MONGO_INITDB_DATABASE: phony
```

4. Update the connection string:
```bash
MONGODB_URI=mongodb://admin:your-secure-password@mongodb:27017/phony?authSource=admin
```

## Data Backup

### Backup MongoDB data
```bash
docker compose exec mongodb mongodump --out /data/backup
docker compose cp mongodb:/data/backup ./backup
```

### Restore MongoDB data
```bash
docker compose cp ./backup mongodb:/data/backup
docker compose exec mongodb mongorestore /data/backup
```
