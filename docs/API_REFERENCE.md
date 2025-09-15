# 🔌 API Reference

Complete API documentation for the Phony Voice AI Agent Deployment System.

## Base URL

```
Production: https://phony.pushbuild.com
Development: http://localhost:24187
```

## Authentication

All API endpoints require authentication via API key:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
     https://api.example.com/agents
```

## Endpoints

### Health Check

#### GET /healthz
Check system health status.

**Response:**
```json
{
  "status": "ok",
  "uptime": 1195,
  "activeCalls": 0
}
```

---

### Agent Management

#### GET /api/agents
List all agents.

**Query Parameters:**
- `tenant_id` (optional): Filter by tenant
- `status` (optional): Filter by status (active, inactive)
- `type` (optional): Filter by type (inbound, outbound)

**Response:**
```json
[
  {
    "id": "agent_123",
    "name": "Customer Support Agent",
    "type": "inbound",
    "phone_number": "+15551234567",
    "system_prompt": "You are a helpful assistant...",
    "voice": "alloy",
    "status": "active",
    "created_at": "2024-01-01T00:00:00Z",
    "total_calls": 45,
    "total_minutes": 320
  }
]
```

#### POST /api/agents
Create a new agent.

**Request Body:**
```json
{
  "name": "Sales Agent",
  "type": "outbound",
  "system_prompt": "You are a sales representative...",
  "voice": "nova",
  "context_data": {
    "department": "sales",
    "region": "west"
  }
}
```

**Response:**
```json
{
  "id": "agent_456",
  "name": "Sales Agent",
  "type": "outbound",
  "status": "active",
  "created_at": "2024-01-01T00:00:00Z"
}
```

#### PUT /api/agents/{agent_id}
Update an existing agent.

**Request Body:**
```json
{
  "name": "Updated Agent Name",
  "system_prompt": "Updated prompt...",
  "context_data": {
    "department": "support"
  }
}
```

#### DELETE /api/agents/{agent_id}
Delete an agent.

**Response:**
```json
{
  "message": "Agent deleted successfully"
}
```

---

### Multi-tenant Management

#### POST /tenants
Create a new tenant.

**Request Body:**
```json
{
  "name": "Acme Corporation",
  "subdomain": "acme",
  "max_agents": 50,
  "max_concurrent_calls": 200,
  "billing_email": "billing@acme.com"
}
```

**Response:**
```json
{
  "id": "tenant_123",
  "name": "Acme Corporation",
  "subdomain": "acme",
  "status": "trial",
  "created_at": "2024-01-01T12:00:00Z",
  "limits": {
    "max_agents": 50,
    "max_concurrent_calls": 200
  }
}
```

#### GET /tenants
List all tenants (admin only).

#### GET /tenants/{tenant_id}
Get tenant details.

#### PATCH /tenants/{tenant_id}
Update tenant settings.

**Request Body:**
```json
{
  "max_agents": 100,
  "status": "active"
}
```

---

### Phone Number Management

#### GET /api/phone-numbers/available
List available phone numbers.

**Response:**
```json
[
  {
    "phone_number": "+15551234567",
    "twilio_sid": "PN123456",
    "friendly_name": "Support Line",
    "capabilities": ["voice", "sms"],
    "status": "available"
  }
]
```

#### POST /api/phone-numbers/{phone_number}/assign
Assign a phone number to an agent.

**Request Body:**
```json
{
  "agent_id": "agent_123"
}
```

**Response:**
```json
{
  "message": "Phone number assigned successfully",
  "agent_id": "agent_123",
  "phone_number": "+15551234567"
}
```

#### POST /api/phone-numbers/{phone_number}/release
Release a phone number from an agent.

**Response:**
```json
{
  "message": "Phone number released successfully"
}
```

---

### Call Management

#### GET /api/calls/active
Get all active calls.

**Response:**
```json
[
  {
    "id": "session_123",
    "call_sid": "CA123456",
    "agent_id": "agent_123",
    "from_number": "+15559999999",
    "to_number": "+15551234567",
    "direction": "inbound",
    "status": "active",
    "started_at": "2024-01-01T12:00:00Z",
    "duration_seconds": 120,
    "context": {
      "customer_name": "John Doe",
      "issue_type": "billing"
    }
  }
]
```

#### GET /api/calls/history
Get call history.

**Query Parameters:**
- `agent_id` (optional): Filter by agent
- `start_date` (optional): Start date (ISO 8601)
- `end_date` (optional): End date (ISO 8601)
- `limit` (optional): Number of results (default: 100)
- `offset` (optional): Pagination offset

**Response:**
```json
{
  "calls": [
    {
      "id": "session_456",
      "call_sid": "CA789012",
      "agent_id": "agent_123",
      "duration_seconds": 240,
      "status": "completed",
      "started_at": "2024-01-01T10:00:00Z",
      "ended_at": "2024-01-01T10:04:00Z",
      "cost": 0.052
    }
  ],
  "total": 150,
  "limit": 100,
  "offset": 0
}
```

#### POST /api/agents/{agent_id}/call
Initiate an outbound call.

**Request Body:**
```json
{
  "to_number": "+15559876543",
  "context": {
    "customer_id": "CUST_789",
    "call_purpose": "follow_up"
  }
}
```

**Response:**
```json
{
  "call_sid": "CA345678",
  "status": "queued",
  "message": "Call initiated successfully"
}
```

#### PUT /api/calls/{call_sid}/context
Update call context during an active call.

**Request Body:**
```json
{
  "context": {
    "notes": "Customer reported issue with login",
    "resolution_status": "in_progress",
    "priority": "high"
  }
}
```

**Response:**
```json
{
  "message": "Context updated successfully",
  "call_sid": "CA123456"
}
```

---

### Supervisor Controls

#### POST /api/override/text
Send text to the caller during an active call.

**Request Body:**
```json
{
  "call_sid": "CA123456",
  "text": "Let me transfer you to our specialist."
}
```

#### POST /api/override/dtmf
Send DTMF digits during a call.

**Request Body:**
```json
{
  "call_sid": "CA123456",
  "digit": "1"
}
```

#### POST /api/override/transfer
Transfer a call to another number.

**Request Body:**
```json
{
  "call_sid": "CA123456",
  "target": "+15551111111"
}
```

#### POST /api/override/end
End an active call.

**Request Body:**
```json
{
  "call_sid": "CA123456"
}
```

---

### Analytics

#### GET /api/analytics/summary
Get analytics summary.

**Query Parameters:**
- `period` (optional): Time period (day, week, month, year)
- `tenant_id` (optional): Filter by tenant

**Response:**
```json
{
  "total_agents": 5,
  "total_calls": 850,
  "total_minutes": 3200,
  "average_call_duration": 226,
  "success_rate": 0.92,
  "busiest_hour": 14,
  "top_agents": [
    {
      "agent_id": "agent_123",
      "name": "Customer Support Agent",
      "calls": 245,
      "minutes": 980
    }
  ]
}
```

#### GET /api/analytics/agents/{agent_id}
Get analytics for a specific agent.

**Response:**
```json
{
  "agent_id": "agent_123",
  "name": "Customer Support Agent",
  "total_calls": 245,
  "total_minutes": 980,
  "average_call_duration": 240,
  "success_rate": 0.94,
  "hourly_distribution": {
    "9": 15,
    "10": 25,
    "11": 30,
    "12": 20
  },
  "daily_trend": [
    {
      "date": "2024-01-01",
      "calls": 45,
      "minutes": 180
    }
  ]
}
```

---

### WebSocket Endpoints

#### WS /relay/ws
Twilio ConversationRelay WebSocket connection.

**Connection URL:**
```
wss://phony.pushbuild.com/relay/ws
```

#### WS /events/ws
Real-time event stream for monitoring.

**Connection URL:**
```
wss://phony.pushbuild.com/events/ws?call_sid=CA123456
```

**Event Types:**
- `call.started`
- `call.ended`
- `call.updated`
- `transcript.partial`
- `transcript.final`
- `context.updated`
- `error`

---

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid or missing API key |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Resource already exists |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

## Rate Limiting

- **Default limit**: 1000 requests per hour
- **Burst limit**: 50 requests per minute
- **WebSocket connections**: 10 concurrent per API key

## Examples

### Create Agent and Assign Phone Number

```bash
# Create agent
AGENT_ID=$(curl -X POST https://api.example.com/agents \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Support Agent",
    "type": "inbound",
    "system_prompt": "You are a helpful support agent",
    "voice": "alloy"
  }' | jq -r '.id')

# Assign phone number
curl -X POST https://api.example.com/phone-numbers/+15551234567/assign \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\": \"$AGENT_ID\"}"
```

### Monitor Active Calls

```javascript
const ws = new WebSocket('wss://api.example.com/events/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch(data.type) {
    case 'call.started':
      console.log('Call started:', data.call_sid);
      break;
    case 'transcript.partial':
      console.log('Transcript:', data.text);
      break;
    case 'call.ended':
      console.log('Call ended, duration:', data.duration);
      break;
  }
};
```

---

*API Version: 1.0.0*
*Last Updated: December 2024*