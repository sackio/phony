# API Documentation

Phony provides comprehensive REST APIs, WebSocket endpoints, and webhook handlers for integrating voice AI capabilities into your applications.

## API Overview

```{mermaid}
graph TB
    subgraph "Client Applications"
        Dashboard[Dashboard UI]
        Mobile[Mobile Apps]
        External[External Systems]
    end
    
    subgraph "Phony API Layer"
        REST[REST Endpoints]
        WS[WebSocket APIs]
        Webhooks[Twilio Webhooks]
    end
    
    subgraph "Core Services"
        Backend[FastAPI Backend]
        Redis[(Redis Cache)]
        MongoDB[(MongoDB)]
    end
    
    subgraph "External APIs"
        Twilio[Twilio API]
        OpenAI[OpenAI Realtime]
    end
    
    Dashboard --> REST
    Mobile --> REST
    External --> REST
    Dashboard --> WS
    Twilio --> Webhooks
    
    REST --> Backend
    WS --> Backend
    Webhooks --> Backend
    
    Backend --> Redis
    Backend --> MongoDB
    Backend --> Twilio
    Backend --> OpenAI
    
    style REST fill:#e8f5e9
    style WS fill:#e3f2fd
    style Webhooks fill:#fff3e0
```

## Base URL

```
Production: https://phony.pushbuild.com
Development: http://localhost:24187
```

## Authentication

Phony uses API key authentication for most endpoints:

```http
Authorization: Bearer your-api-key-here
```

```{admonition} Getting API Keys
:class: note

API keys are managed per tenant. Contact your system administrator or use the dashboard to generate keys.
```

## Quick Reference

```{list-table} Endpoint Categories
:header-rows: 1
:widths: 25 25 50

* - Category
  - Base Path
  - Description
* - **Call Management**
  - `/agents/`
  - Agent CRUD and configuration
* - **Supervisor Controls**
  - `/override/`
  - Real-time call intervention
* - **Tenant Management**
  - `/tenants/`
  - Multi-tenant operations
* - **WebSocket Events**
  - `/events/ws`
  - Real-time event streaming
* - **Twilio Integration**
  - `/start_call`, `/receive_call`
  - Webhook handlers
* - **Health & Status**
  - `/healthz`
  - System monitoring
```

## Core Endpoints

### Health Check

```{tab-set}

:::{tab-item} Request
```http
GET /healthz
```
:::

:::{tab-item} Response
```json
{
    "status": "ok",
    "uptime": 3600,
    "activeCalls": 5
}
```
:::

:::{tab-item} cURL
```bash
curl -X GET http://localhost:24187/healthz
```
:::

```

### Agent Management

#### Create Agent

```{tab-set}

:::{tab-item} Request
```http
POST /agents/
Content-Type: application/json
Authorization: Bearer your-api-key

{
    "name": "Customer Service Bot",
    "system_prompt": "You are a helpful customer service representative",
    "voice": "alloy",
    "model": "gpt-4o-realtime-preview",
    "greeting_message": "Hello! How can I help you today?",
    "phone_numbers": ["+15551234567"],
    "is_active": true
}
```
:::

:::{tab-item} Response
```json
{
    "id": "agent_123",
    "name": "Customer Service Bot",
    "tenant_id": "tenant_abc",
    "system_prompt": "You are a helpful customer service representative",
    "voice": "alloy",
    "model": "gpt-4o-realtime-preview",
    "greeting_message": "Hello! How can I help you today?",
    "phone_numbers": ["+15551234567"],
    "is_active": true,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
}
```
:::

:::{tab-item} Python
```python
import requests

response = requests.post(
    "http://localhost:24187/agents/",
    headers={
        "Authorization": "Bearer your-api-key",
        "Content-Type": "application/json"
    },
    json={
        "name": "Customer Service Bot",
        "system_prompt": "You are a helpful customer service representative",
        "voice": "alloy",
        "greeting_message": "Hello! How can I help you today?",
        "phone_numbers": ["+15551234567"]
    }
)
print(response.json())
```
:::

```

#### List Agents

```{tab-set}

:::{tab-item} Request
```http
GET /agents/?limit=10&offset=0&is_active=true
Authorization: Bearer your-api-key
```
:::

:::{tab-item} Response
```json
{
    "agents": [
        {
            "id": "agent_123",
            "name": "Customer Service Bot",
            "system_prompt": "You are a helpful customer service representative",
            "voice": "alloy",
            "phone_numbers": ["+15551234567"],
            "is_active": true,
            "created_at": "2024-01-15T10:30:00Z"
        }
    ],
    "total": 1,
    "limit": 10,
    "offset": 0
}
```
:::

```

### Supervisor Controls

#### Send Text to Caller

```{tab-set}

:::{tab-item} Request
```http
POST /override/text
Content-Type: application/json

{
    "callSid": "CA123456789",
    "text": "I'm going to transfer you to a human agent"
}
```
:::

:::{tab-item} Response
```json
{
    "success": true,
    "message": "Text sent successfully"
}
```
:::

```

#### Transfer Call

```{tab-set}

:::{tab-item} Request
```http
POST /override/transfer
Content-Type: application/json

{
    "callSid": "CA123456789",
    "target": "+15551234567"
}
```
:::

:::{tab-item} Response
```json
{
    "success": true,
    "message": "Call transferred successfully"
}
```
:::

```

## WebSocket APIs

### Real-time Events

Connect to call events in real-time:

```{tab-set}

:::{tab-item} JavaScript
```javascript
const ws = new WebSocket('ws://localhost:24187/events/ws?callSid=CA123456789');

ws.onmessage = function(event) {
    const data = JSON.parse(event.data);
    console.log('Event received:', data);
};

ws.onopen = function() {
    console.log('Connected to event stream');
};
```
:::

:::{tab-item} Python
```python
import websocket
import json

def on_message(ws, message):
    data = json.loads(message)
    print("Event received:", data)

def on_open(ws):
    print("Connected to event stream")

ws = websocket.WebSocketApp(
    "ws://localhost:24187/events/ws?callSid=CA123456789",
    on_message=on_message,
    on_open=on_open
)
ws.run_forever()
```
:::

```

### Event Types

```{list-table} WebSocket Events
:header-rows: 1

* - Event Type
  - Description
  - Data Fields
* - `call.started`
  - Call session initiated
  - `callSid`, `from`, `to`, `timestamp`
* - `speech.detected`
  - Speech recognition result
  - `text`, `speaker`, `confidence`
* - `ai.response`
  - AI generated response
  - `text`, `audio_url`, `model`
* - `call.ended`
  - Call session terminated
  - `callSid`, `duration`, `reason`
* - `error.occurred`
  - System or call error
  - `error_type`, `message`, `code`
```

## Webhook Endpoints

### Twilio Call Webhooks

#### Inbound Calls

```http
POST /receive_call
Content-Type: application/x-www-form-urlencoded
X-Twilio-Signature: signature_hash

CallSid=CA123456789&From=%2B15551234567&To=%2B15559876543
```

#### Outbound Calls

```http
POST /start_call
Content-Type: application/x-www-form-urlencoded
X-Twilio-Signature: signature_hash

CallSid=CA123456789&From=%2B15559876543&To=%2B15551234567
```

### Webhook Validation

Phony validates all Twilio webhooks using signature verification:

```python
def validate_twilio_request(request: Request, form_data: dict = None) -> bool:
    """Validate Twilio webhook signature for security."""
    if not request_validator:
        return True  # Skip in development
    
    signature = request.headers.get('X-Twilio-Signature', '')
    url = str(request.url)
    params = form_data or {}
    
    return request_validator.validate(url, params, signature)
```

## Error Handling

### HTTP Status Codes

```{list-table} Status Codes
:header-rows: 1

* - Code
  - Status
  - Description
* - 200
  - OK
  - Successful request
* - 201
  - Created
  - Resource created
* - 400
  - Bad Request
  - Invalid parameters
* - 401
  - Unauthorized
  - Missing/invalid API key
* - 403
  - Forbidden
  - Access denied
* - 404
  - Not Found
  - Resource not found
* - 422
  - Unprocessable Entity
  - Validation error
* - 500
  - Internal Server Error
  - Server error
```

### Error Response Format

```json
{
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "Invalid phone number format",
        "details": {
            "field": "phone_numbers",
            "value": "invalid-number"
        }
    }
}
```

## Rate Limiting

```{list-table} Rate Limits
:header-rows: 1

* - Endpoint Category
  - Limit
  - Window
* - **Agent Management**
  - 100 requests
  - per minute
* - **Supervisor Controls**
  - 500 requests
  - per minute
* - **WebSocket Connections**
  - 50 concurrent
  - per API key
* - **Webhook Endpoints**
  - 1000 requests
  - per minute
```

## SDK Examples

### Python SDK

```python
from phony_client import PhonyClient

# Initialize client
client = PhonyClient(
    base_url="http://localhost:24187",
    api_key="your-api-key"
)

# Create an agent
agent = client.agents.create(
    name="Support Bot",
    system_prompt="You are a technical support agent",
    voice="echo",
    phone_numbers=["+15551234567"]
)

# Make a call
call = client.calls.create(
    agent_id=agent.id,
    to_number="+15559876543",
    scenario="customer_support"
)

# Monitor call events
for event in client.events.stream(call.call_sid):
    print(f"Event: {event.type} - {event.data}")
```

### JavaScript SDK

```javascript
import { PhonyClient } from 'phony-client';

// Initialize client
const client = new PhonyClient({
    baseUrl: 'http://localhost:24187',
    apiKey: 'your-api-key'
});

// Create an agent
const agent = await client.agents.create({
    name: 'Support Bot',
    systemPrompt: 'You are a technical support agent',
    voice: 'echo',
    phoneNumbers: ['+15551234567']
});

// Listen for events
client.events.subscribe(callSid, (event) => {
    console.log('Event received:', event);
});
```

## Advanced Features

### Custom Instructions

Use advanced prompting techniques:

```json
{
    "system_prompt": "You are Sarah, a professional customer service representative.\n\nPersonality: Friendly but professional, patient, solution-oriented.\n\nGuidelines:\n- Always introduce yourself as Sarah\n- Ask clarifying questions\n- Provide step-by-step solutions\n- Use positive language\n- Transfer to human if unable to help\n\nCommands:\n- [[transfer:+15551234567]] - Transfer to human agent\n- [[end_call]] - End the conversation\n- [[press:1]] - Send DTMF digit",
    "temperature": 0.7,
    "max_tokens": 150
}
```

### Multi-Language Support

```json
{
    "system_prompt": "You are a multilingual customer service agent. Detect the caller's language and respond accordingly.",
    "supported_languages": ["en", "es", "fr", "de"],
    "voice": "alloy",
    "language_detection": true
}
```

## Next Steps

```{panels}
:container: +full-width
:column: col-lg-4 px-2 py-2
:card:

**📋 REST Endpoints**
^^^
Complete reference for all REST API endpoints

[View REST API](rest-endpoints)
---

**🔌 WebSocket Guide**
^^^
Real-time communication and event streaming

[WebSocket Docs](websocket)
---

**📞 Twilio Integration**
^^^
Webhook configuration and call handling

[Twilio Webhooks](twilio-webhooks)
```