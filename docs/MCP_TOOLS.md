# Voice Call MCP Server - Available Tools

The Voice Call MCP Server provides comprehensive tools for managing voice calls, context templates, and incoming call handlers via Twilio and OpenAI.

## Outbound Calls

### `trigger-call`
Trigger an outbound phone call via Twilio.

**Parameters:**
- `toNumber` (string, required): The phone number to call (E.164 format, e.g., +15551234567)
- `systemInstructions` (string, required): System instructions defining the AI agent's role and behavior
- `callInstructions` (string, required): Specific instructions for this particular call
- `voice` (string, optional): Voice to use (sage, alloy, echo, shimmer, verse, etc.). Default: sage
- `fromNumber` (string, optional): The Twilio phone number to call FROM (E.164 format). If not specified, uses the default TWILIO_NUMBER.

**Examples:**
```json
// Basic outbound call
{
  "toNumber": "+15551234567",
  "systemInstructions": "You are a friendly customer support agent helping with account inquiries.",
  "callInstructions": "Ask about the user's recent order and offer to help with any issues.",
  "voice": "sage"
}

// Outbound call from specific number
{
  "toNumber": "+15551234567",
  "fromNumber": "+14786065924",
  "systemInstructions": "You are calling to confirm an appointment.",
  "callInstructions": "Confirm the appointment scheduled for tomorrow at 2 PM.",
  "voice": "sage"
}
```

## Call History & Management

### `list-calls`
List and filter call history (active and completed calls).

**Parameters:**
- `callType` (enum, optional): Filter by call type - "inbound" or "outbound"
- `status` (enum, optional): Filter by call status - "initiated", "in-progress", "completed", or "failed"
- `fromNumber` (string, optional): Filter by caller phone number (E.164 format)
- `toNumber` (string, optional): Filter by recipient phone number (E.164 format)
- `startDate` (string, optional): Filter calls starting from this date (ISO format: YYYY-MM-DD)
- `endDate` (string, optional): Filter calls ending before this date (ISO format: YYYY-MM-DD)
- `limit` (number, optional): Maximum number of calls to return (default: 100)

**Examples:**
```json
// List all calls
{}

// List only completed outbound calls
{
  "callType": "outbound",
  "status": "completed"
}

// List calls from specific number in date range
{
  "fromNumber": "+15551234567",
  "startDate": "2025-10-01",
  "endDate": "2025-10-18",
  "limit": 50
}
```

### `get-call-transcript`
Get the current transcript and details of a specific call.

**Parameters:**
- `callSid` (string, required): The Twilio call SID to retrieve

**Example:**
```json
{
  "callSid": "CA1234567890abcdef1234567890abcdef"
}
```

### `get-call-events`
Get detailed event logs (Twilio and OpenAI events) for a specific call.

**Parameters:**
- `callSid` (string, required): The Twilio call SID to retrieve events for
- `eventSource` (enum, optional): Which event source to retrieve - "twilio", "openai", or "both" (default: both)
- `eventType` (string, optional): Filter by specific event type (e.g., "connected", "speech.started")

**Examples:**
```json
// Get all events for a call
{
  "callSid": "CA1234567890abcdef1234567890abcdef"
}

// Get only Twilio events
{
  "callSid": "CA1234567890abcdef1234567890abcdef",
  "eventSource": "twilio"
}

// Get specific event type across both sources
{
  "callSid": "CA1234567890abcdef1234567890abcdef",
  "eventSource": "both",
  "eventType": "speech.started"
}
```

### `hold-call`
Place an active call on hold.

**Parameters:**
- `callSid` (string, required): The call SID to place on hold

**Example:**
```json
{
  "callSid": "CA1234567890abcdef1234567890abcdef"
}
```

### `resume-call`
Resume a call that is on hold.

**Parameters:**
- `callSid` (string, required): The call SID to resume

**Example:**
```json
{
  "callSid": "CA1234567890abcdef1234567890abcdef"
}
```

### `hangup-call`
Hangup an active call.

**Parameters:**
- `callSid` (string, required): The call SID to hangup

**Example:**
```json
{
  "callSid": "CA1234567890abcdef1234567890abcdef"
}
```

### `inject-context`
Inject additional context or instructions into an active call.

**Parameters:**
- `callSid` (string, required): The call SID to inject context into
- `context` (string, required): The context or instructions to inject

**Example:**
```json
{
  "callSid": "CA1234567890abcdef1234567890abcdef",
  "context": "The customer just mentioned they're interested in premium features. Offer them a 20% discount."
}
```

## Context Templates

Context templates allow you to create reusable AI agent configurations for different scenarios.

### `list-contexts`
List all context templates.

**Parameters:**
- `type` (enum, optional): Filter by context type - "incoming", "outgoing", or "both"

**Example:**
```json
{
  "type": "outgoing"
}
```

### `get-context`
Get a specific context template by ID.

**Parameters:**
- `contextId` (string, required): The context ID to retrieve

**Example:**
```json
{
  "contextId": "507f1f77bcf86cd799439011"
}
```

### `create-context`
Create a new context template.

**Parameters:**
- `name` (string, required): Name of the context template
- `description` (string, optional): Description of what this context is for
- `systemInstructions` (string, required): System instructions defining AI behavior
- `exampleCallInstructions` (string, optional): Example call instructions
- `contextType` (enum, required): "incoming", "outgoing", or "both"

**Example:**
```json
{
  "name": "Customer Support Agent",
  "description": "Friendly support agent for handling customer inquiries",
  "systemInstructions": "You are a friendly and knowledgeable customer support agent. Listen carefully to customer issues and provide helpful solutions.",
  "exampleCallInstructions": "Help the customer with their account question.",
  "contextType": "both"
}
```

### `update-context`
Update an existing context template.

**Parameters:**
- `contextId` (string, required): The context ID to update
- `name` (string, optional): New name for the context
- `description` (string, optional): New description
- `systemInstructions` (string, optional): New system instructions
- `exampleCallInstructions` (string, optional): New example call instructions
- `contextType` (enum, optional): New context type - "incoming", "outgoing", or "both"

**Example:**
```json
{
  "contextId": "507f1f77bcf86cd799439011",
  "systemInstructions": "You are a highly empathetic customer support agent...",
  "voice": "alloy"
}
```

### `delete-context`
Delete a context template.

**Parameters:**
- `contextId` (string, required): The context ID to delete

**Example:**
```json
{
  "contextId": "507f1f77bcf86cd799439011"
}
```

## Incoming Call Handlers

Configure how your Twilio phone numbers handle incoming calls with AI agents.

### `list-available-numbers`
List all available Twilio phone numbers that can be configured.

**Parameters:** None

**Returns:** Array of available phone numbers with configuration status.

### `list-incoming-configs`
List all incoming call handler configurations.

**Parameters:** None

**Returns:** Array of configured incoming call handlers.

### `create-incoming-handler`
Create a new incoming call handler for a phone number.

**Two modes available:**
1. **AI Conversation Mode** (default): Full AI-powered conversation using OpenAI
2. **Message-Only Mode**: Just play a message and hang up (no AI conversation)

**Parameters:**
- `phoneNumber` (string, required): The phone number to configure (E.164 format)
- `name` (string, required): Friendly name for this configuration
- `systemInstructions` (string, optional): System instructions for AI conversation (required if messageOnly is false)
- `callInstructions` (string, optional): Call instructions for incoming calls
- `voice` (string, optional): Voice to use. Default: sage
- `enabled` (boolean, optional): Whether this handler is enabled. Default: true
- `messageOnly` (boolean, optional): If true, just play hangupMessage and hang up. Default: false
- `hangupMessage` (string, optional): Message to play before hanging up (required if messageOnly is true)

**Examples:**

```json
// AI Conversation Mode (full AI agent)
{
  "phoneNumber": "+15551234567",
  "name": "Main Support Line",
  "systemInstructions": "You are the main support line AI agent. Greet callers warmly and help with any questions.",
  "callInstructions": "Greet the caller and ask how you can help them today.",
  "voice": "sage",
  "enabled": true
}

// Message-Only Mode (simple announcement)
{
  "phoneNumber": "+15559876543",
  "name": "After Hours Line",
  "messageOnly": true,
  "hangupMessage": "Thank you for calling. Our office is currently closed. Please call back during business hours, Monday through Friday, 9 AM to 5 PM Eastern Time.",
  "voice": "sage",
  "enabled": true
}
```

### `update-incoming-handler`
Update an existing incoming call handler.

**Parameters:**
- `phoneNumber` (string, required): The phone number to update
- `name` (string, optional): New friendly name
- `systemInstructions` (string, optional): New system instructions
- `callInstructions` (string, optional): New call instructions
- `voice` (string, optional): New voice
- `enabled` (boolean, optional): Enable or disable this handler
- `messageOnly` (boolean, optional): Switch to message-only mode (true) or AI conversation mode (false)
- `hangupMessage` (string, optional): New hangup message for message-only mode

**Examples:**
```json
// Update AI conversation instructions
{
  "phoneNumber": "+15551234567",
  "systemInstructions": "Updated instructions...",
  "enabled": true
}

// Switch to message-only mode
{
  "phoneNumber": "+15551234567",
  "messageOnly": true,
  "hangupMessage": "We're closed for maintenance. Please try again tomorrow."
}

// Switch back to AI conversation mode
{
  "phoneNumber": "+15551234567",
  "messageOnly": false,
  "systemInstructions": "You are a helpful support agent..."
}
```

### `delete-incoming-handler`
Delete an incoming call handler.

**Parameters:**
- `phoneNumber` (string, required): The phone number to remove handler from

**Example:**
```json
{
  "phoneNumber": "+15551234567"
}
```

## Usage Examples

### Making a Call
```json
{
  "tool": "trigger-call",
  "parameters": {
    "toNumber": "+15551234567",
    "systemInstructions": "You are calling to confirm a restaurant reservation.",
    "callInstructions": "Confirm the reservation for 4 people at 7 PM tonight.",
    "voice": "sage"
  }
}
```

### Reviewing Call History
```json
// List all calls
{ "tool": "list-calls" }

// List only completed outbound calls from last week
{
  "tool": "list-calls",
  "parameters": {
    "callType": "outbound",
    "status": "completed",
    "startDate": "2025-10-11",
    "limit": 50
  }
}

// List calls to/from specific number
{
  "tool": "list-calls",
  "parameters": {
    "toNumber": "+15551234567"
  }
}

// Get full call details and transcript
{ "tool": "get-call-transcript", "parameters": { "callSid": "CA123..." } }

// Get only event logs for debugging
{ "tool": "get-call-events", "parameters": { "callSid": "CA123..." } }

// Get only Twilio events
{
  "tool": "get-call-events",
  "parameters": {
    "callSid": "CA123...",
    "eventSource": "twilio"
  }
}
```

### Managing Active Calls
```json
// Place on hold
{ "tool": "hold-call", "parameters": { "callSid": "CA123..." } }

// Inject context
{ "tool": "inject-context", "parameters": {
  "callSid": "CA123...",
  "context": "Customer mentioned they're interested in premium plan"
}}

// Resume call
{ "tool": "resume-call", "parameters": { "callSid": "CA123..." } }

// End call
{ "tool": "hangup-call", "parameters": { "callSid": "CA123..." } }
```

### Setting Up Incoming Calls
```json
// List available numbers
{ "tool": "list-available-numbers" }

// Create AI conversation handler
{
  "tool": "create-incoming-handler",
  "parameters": {
    "phoneNumber": "+15551234567",
    "name": "Customer Support",
    "systemInstructions": "You are a helpful customer support agent.",
    "callInstructions": "Greet the caller and offer assistance.",
    "voice": "sage"
  }
}

// Create message-only handler (no AI, just announcement)
{
  "tool": "create-incoming-handler",
  "parameters": {
    "phoneNumber": "+15559876543",
    "name": "After Hours Announcement",
    "messageOnly": true,
    "hangupMessage": "Thank you for calling. We're closed right now. Business hours are Monday through Friday, 9 AM to 5 PM.",
    "voice": "sage"
  }
}
```

## Available Voices

- `alloy` - Neutral and balanced
- `echo` - Clear and articulate
- `shimmer` - Warm and friendly
- `sage` - Professional and calm (default)
- `verse` - Expressive and dynamic
- `coral` - Bright and energetic

## Error Handling

All tools return a consistent response format:

**Success:**
```json
{
  "status": "success",
  "message": "Operation completed successfully",
  "data": { ... }
}
```

**Error:**
```json
{
  "status": "error",
  "message": "Description of what went wrong"
}
```

## Notes

- All phone numbers must be in E.164 format: `+[country code][number]`
- Call SIDs are provided when calls are created and can be retrieved via `list-active-calls`
- Context templates and incoming handlers are stored in MongoDB and persist across restarts
- The MCP server communicates with the Voice Server API running on port 3004
