# 🔌 Phony API Reference

Complete API documentation for the Phony Voice AI Agent system.

## Base URL

- **Development**: `http://localhost:24187`
- **Production**: `https://phony.pushbuild.com`

## Authentication

Currently, the API does not require authentication for internal endpoints. Twilio webhooks are validated using request signatures.

## Endpoints

### Health Check

#### GET /healthz

Check the health status of the backend service.

**Response**
```json
{
  "status": "ok",
  "uptime": 1234,
  "activeCalls": 0
}
```

**Status Codes**
- `200 OK` - Service is healthy
- `503 Service Unavailable` - Service is unhealthy

---

### Twilio Webhooks

#### POST /start_call

Handle outbound call initiation from Twilio.

**Headers**
- `X-Twilio-Signature` - Twilio request signature

**Request Body** (Form-encoded)
```
CallSid=CA123456789
From=+15551234567
To=+15559876543
CallStatus=in-progress
```

**Response** (TwiML)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="wss://phony.pushbuild.com/relay/ws" 
                       dtmfDetection="inband" 
                       interruptible="true" 
                       voice="alloy">
      <Parameter name="callSid" value="CA123456789"/>
    </ConversationRelay>
  </Connect>
</Response>
```

---

#### POST /receive_call

Handle inbound call reception from Twilio.

**Headers**
- `X-Twilio-Signature` - Twilio request signature

**Request Body** (Form-encoded)
```
CallSid=CA987654321
From=+15551234567
To=+18578167225
CallStatus=ringing
```

**Response** (TwiML)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="wss://phony.pushbuild.com/relay/ws" 
                       dtmfDetection="inband" 
                       interruptible="true" 
                       voice="alloy">
      <Parameter name="callSid" value="CA987654321"/>
    </ConversationRelay>
  </Connect>
</Response>
```

---

### WebSocket Endpoints

#### WS /relay/ws

Twilio ConversationRelay WebSocket connection.

**Connection Parameters**
- `callSid` - Twilio call identifier

**Incoming Messages** (from Twilio)
```json
{
  "event": "start",
  "callSid": "CA123",
  "from": "+15551234567",
  "to": "+15559876543"
}
```

```json
{
  "event": "media",
  "media": {
    "chunk": "base64_audio_data",
    "timestamp": 1234567890
  }
}
```

```json
{
  "event": "transcript",
  "transcript": {
    "text": "Hello, how are you?",
    "confidence": 0.98,
    "final": true
  }
}
```

**Outgoing Messages** (to Twilio)
```json
{
  "event": "media",
  "media": {
    "chunk": "base64_audio_data"
  }
}
```

```json
{
  "event": "clear"
}
```

```json
{
  "event": "dtmf",
  "dtmf": {
    "digit": "1"
  }
}
```

---

#### WS /events/ws

Real-time event stream for dashboard monitoring.

**Query Parameters**
- `callSid` (required) - Call identifier to monitor

**Event Messages**
```json
{
  "type": "transcript",
  "callSid": "CA123",
  "speaker": "caller",
  "text": "Hello",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

```json
{
  "type": "assistant_reply",
  "callSid": "CA123",
  "text": "Hi there! How can I help you?",
  "timestamp": "2024-01-01T00:00:01Z"
}
```

```json
{
  "type": "command_executed",
  "callSid": "CA123",
  "command": "press",
  "value": "1",
  "timestamp": "2024-01-01T00:00:02Z"
}
```

```json
{
  "type": "supervisor_override",
  "callSid": "CA123",
  "action": "text",
  "value": "Let me help you with that",
  "timestamp": "2024-01-01T00:00:03Z"
}
```

---

### Supervisor Control Endpoints

#### POST /override/text

Send custom text to the caller through the AI.

**Request Body**
```json
{
  "callSid": "CA123456789",
  "text": "Hello, this is a supervisor message"
}
```

**Response**
```json
{
  "status": "success",
  "message": "Text sent to caller"
}
```

**Status Codes**
- `200 OK` - Text sent successfully
- `404 Not Found` - Call session not found
- `400 Bad Request` - Invalid request body

---

#### POST /override/dtmf

Send DTMF digit to the call.

**Request Body**
```json
{
  "callSid": "CA123456789",
  "digit": "1"
}
```

**Response**
```json
{
  "status": "success",
  "message": "DTMF digit sent"
}
```

**Status Codes**
- `200 OK` - DTMF sent successfully
- `404 Not Found` - Call session not found
- `400 Bad Request` - Invalid digit (must be 0-9, *, or #)

---

#### POST /override/end

Terminate an active call.

**Request Body**
```json
{
  "callSid": "CA123456789"
}
```

**Response**
```json
{
  "status": "success",
  "message": "Call ended"
}
```

**Status Codes**
- `200 OK` - Call ended successfully
- `404 Not Found` - Call session not found

---

#### POST /override/transfer

Transfer the call to another phone number.

**Request Body**
```json
{
  "callSid": "CA123456789",
  "target": "+15559999999"
}
```

**Response**
```json
{
  "status": "success",
  "message": "Call transferred to +15559999999"
}
```

**Status Codes**
- `200 OK` - Transfer initiated successfully
- `404 Not Found` - Call session not found
- `400 Bad Request` - Invalid phone number

---

#### POST /override/clarification

Respond to an AI query for additional information.

**Request Body**
```json
{
  "callSid": "CA123456789",
  "response": "The customer's account number is 12345"
}
```

**Response**
```json
{
  "status": "success",
  "message": "Clarification sent to AI"
}
```

**Status Codes**
- `200 OK` - Clarification sent successfully
- `404 Not Found` - Call session not found
- `400 Bad Request` - No pending query for this call

---

### Dashboard Endpoints

#### GET /dashboard/

Serve the main dashboard HTML page.

**Response**
- Content-Type: `text/html`
- Returns the React dashboard application

---

#### GET /dashboard/index.html

Alias for `/dashboard/` endpoint.

**Query Parameters**
- `callSid` (optional) - Pre-populate with specific call ID

---

## Error Responses

All API errors follow a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "additional": "context"
    }
  }
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `CALL_NOT_FOUND` | The specified callSid does not exist |
| `INVALID_REQUEST` | Request body validation failed |
| `WEBSOCKET_ERROR` | WebSocket connection error |
| `OPENAI_ERROR` | OpenAI API error |
| `TWILIO_ERROR` | Twilio API error |
| `INTERNAL_ERROR` | Internal server error |

## Rate Limiting

Currently, there are no rate limits on the API endpoints. In production, consider implementing:
- 100 requests/minute for supervisor controls
- 1000 events/minute for WebSocket connections
- 10 concurrent calls maximum

## WebSocket Protocol

### Connection Lifecycle

1. **Connect**: Client connects to WebSocket endpoint
2. **Authenticate**: Send callSid in first message or query parameter
3. **Subscribe**: Automatically subscribed to events for that call
4. **Receive**: Real-time events streamed as JSON messages
5. **Disconnect**: Connection closed when call ends or client disconnects

### Heartbeat

WebSocket connections implement a heartbeat mechanism:
- Server sends `{"type": "ping"}` every 30 seconds
- Client should respond with `{"type": "pong"}`
- Connection times out after 60 seconds without activity

## LLM Command Protocol

The AI can embed special commands in its responses:

### Command Format
```
[[command:parameter]]
```

### Available Commands

| Command | Parameters | Example | Description |
|---------|------------|---------|-------------|
| `press` | digits | `[[press:123]]` | Send DTMF tones |
| `transfer` | phone_number | `[[transfer:+15551234567]]` | Transfer call |
| `end_call` | none | `[[end_call]]` | Terminate call |
| `request_user` | prompt | `[[request_user:What is the account number?]]` | Ask supervisor |

### Command Processing

1. Commands are extracted from AI responses
2. Text containing commands is not spoken to caller
3. Commands are executed sequentially
4. Events are emitted for each executed command

## Testing Endpoints

These endpoints are available in development mode only:

#### POST /test/simulate_call

Simulate a phone call for testing.

**Request Body**
```json
{
  "from": "+15551234567",
  "to": "+18578167225",
  "scenario": "customer_service"
}
```

---

## Metrics & Monitoring

### Latency Metrics

The system tracks and reports these latency metrics:

- `transcript_to_gpt_ms` - Time from transcript receipt to GPT request
- `gpt_first_token_ms` - Time until first token from GPT
- `first_audio_playback_ms` - Time until audio starts playing

### Call Metrics

- `call_duration_seconds` - Total call duration
- `transcript_count` - Number of transcripts processed
- `command_count` - Number of commands executed
- `override_count` - Number of supervisor interventions

---

## SDK Examples

### Python
```python
import requests
import websocket

# Make a call
response = requests.post(
    "http://localhost:24187/override/text",
    json={"callSid": "CA123", "text": "Hello"}
)

# Connect to event stream
ws = websocket.WebSocket()
ws.connect("ws://localhost:24187/events/ws?callSid=CA123")
while True:
    event = ws.recv()
    print(f"Event: {event}")
```

### JavaScript
```javascript
// Send DTMF
fetch('http://localhost:24187/override/dtmf', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({callSid: 'CA123', digit: '1'})
});

// Connect to event stream
const ws = new WebSocket('ws://localhost:24187/events/ws?callSid=CA123');
ws.onmessage = (event) => {
  console.log('Event:', JSON.parse(event.data));
};
```

### cURL
```bash
# Check health
curl http://localhost:24187/healthz

# Send text
curl -X POST http://localhost:24187/override/text \
  -H "Content-Type: application/json" \
  -d '{"callSid":"CA123","text":"Hello"}'

# End call
curl -X POST http://localhost:24187/override/end \
  -H "Content-Type: application/json" \
  -d '{"callSid":"CA123"}'
```

---

## Best Practices

1. **Always validate callSid** before performing operations
2. **Handle WebSocket disconnections** with exponential backoff
3. **Log all supervisor interventions** for audit trail
4. **Implement request timeouts** (30 seconds recommended)
5. **Use TLS in production** for all endpoints
6. **Validate Twilio signatures** on webhook endpoints
7. **Rate limit supervisor controls** to prevent abuse
8. **Monitor latency metrics** for performance optimization

---

*For implementation details, see [CLAUDE.md](./CLAUDE.md). For quick start, see [README.md](./README.md).*