# ✅ Docker Setup Complete!

## What's Running

Your Phony server is now running in Docker with MongoDB for transcript storage.

### Services

1. **phony-mongodb** - MongoDB 7 for storing call transcripts
   - Internal port: 27017 (not exposed to host)
   - Database: `phony`
   - Persistent data in Docker volume

2. **phony-server** - Phony Voice Call Server with UI
   - Port: 3004
   - Public URL: https://phony.pushbuild.com
   - MongoDB connected ✅

## Quick Commands

### View logs
```bash
# All services
docker compose logs -f

# Just voice-server
docker compose logs -f voice-server

# Just MongoDB
docker compose logs -f mongodb
```

### Restart services
```bash
# Restart everything
docker compose restart

# Restart just voice-server
docker compose restart voice-server
```

### Stop services
```bash
docker compose down
```

### Rebuild after code changes
```bash
docker compose up -d --build
```

## Access the Application

- **Web UI**: http://localhost:3004
- **Public URL**: https://phony.pushbuild.com

## View Call Transcripts

### Using MongoDB Shell
```bash
# Access MongoDB shell
docker compose exec mongodb mongosh phony

# In the mongo shell:
db.calls.find().pretty()              # View all calls
db.calls.find().sort({startedAt:-1})  # View recent calls
db.calls.findOne()                     # View one call with full transcript
```

### From Command Line
```bash
# View all calls
docker compose exec mongodb mongosh phony --eval "db.calls.find().pretty()"

# Count total calls
docker compose exec mongodb mongosh phony --eval "db.calls.countDocuments()"

# View most recent call
docker compose exec mongodb mongosh phony --eval "db.calls.find().sort({startedAt:-1}).limit(1).pretty()"
```

## How Call Transcripts are Saved

1. **When call starts**: Creates record with metadata (callSid, numbers, voice, context)
2. **During call**: Conversation messages are accumulated in memory
3. **When call ends**: Full transcript saved to MongoDB with:
   - Complete conversation history
   - Call duration
   - Timestamps
   - Voice used
   - Call status

### Example Call Record
```json
{
  "_id": "ObjectId(...)",
  "callSid": "CA1234...",
  "fromNumber": "+18578167225",
  "toNumber": "+13012379630",
  "callType": "outbound",
  "voice": "sage",
  "callContext": "You are a friendly AI assistant...",
  "conversationHistory": [
    {
      "role": "assistant",
      "content": "Hello! I'm Claude, an AI voice assistant...",
      "timestamp": "2025-10-12T22:31:15.000Z"
    },
    {
      "role": "user",
      "content": "Hi there!",
      "timestamp": "2025-10-12T22:31:18.000Z"
    }
  ],
  "startedAt": "2025-10-12T22:31:15.000Z",
  "endedAt": "2025-10-12T22:31:45.000Z",
  "duration": 30,
  "status": "completed"
}
```

## Maintenance

### Backup MongoDB Data
```bash
# Create backup
docker compose exec mongodb mongodump --out /data/backup
docker compose cp mongodb:/data/backup ./mongodb-backup

# Restore backup
docker compose cp ./mongodb-backup mongodb:/data/backup
docker compose exec mongodb mongorestore /data/backup
```

### Clear Old Call Data
```bash
# Delete calls older than 30 days
docker compose exec mongodb mongosh phony --eval '
  db.calls.deleteMany({
    startedAt: { $lt: new Date(Date.now() - 30*24*60*60*1000) }
  })
'
```

## Troubleshooting

### Container won't start
```bash
# Check logs
docker compose logs voice-server

# Rebuild
docker compose up -d --build
```

### MongoDB connection issues
```bash
# Test MongoDB
docker compose exec mongodb mongosh --eval "db.serverStatus().ok"

# Should output: 1
```

### Port already in use
```bash
# Check what's using port 3004
lsof -i :3004

# Stop conflicting process or change port in docker-compose.yml
```

## Development

To develop with hot reload, see [DOCKER.md](./DOCKER.md) for development setup instructions.

## More Information

- Full Docker documentation: [DOCKER.md](./DOCKER.md)
- Project README: [README.md](./README.md)

---

**Status**: ✅ MongoDB Connected | ✅ Server Running | ✅ Transcripts Saving
