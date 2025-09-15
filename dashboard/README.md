# 📊 Phony Dashboard

A production-ready React dashboard built with Material UI for comprehensive real-time call monitoring, agent management, and supervisor intervention capabilities.

## 🌟 Features

- **Real-time Call Monitoring** - Live transcript display with timestamps
- **Multi-tenant Support** - Tenant-scoped call and agent management
- **Supervisor Controls** - Text override, DTMF, call transfer, and termination
- **Agent Management** - Create, configure, and manage AI agents
- **Call Analytics** - Historical call data and performance metrics
- **WebSocket Integration** - Real-time event streaming
- **Responsive Design** - Mobile and desktop friendly interface

## 🚀 Quick Start

### Development Setup

The dashboard is automatically served by the FastAPI backend at `/dashboard/`. No separate server is needed.

```bash
# Start the main application
docker-compose up -d backend redis

# Or run directly
uvicorn backend.main:app --port 24187 --reload
```

### Production Setup

```bash
# Build frontend assets
cd frontend && npm run build

# Deploy with Docker
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 🌐 Dashboard URLs

### Main Dashboard
- **Development**: `http://localhost:24187/dashboard/`
- **Production**: `https://phony.yourdomain.com/dashboard/`

### Live Call Monitor
- **URL Pattern**: `/dashboard/index.html?callSid=<CALL_SID>`
- **Example**: `http://localhost:24187/dashboard/index.html?callSid=CA1234567890abcdef`

### Agent Management Dashboard
- **URL**: `/dashboard/agents.html`
- **Multi-tenant**: `/dashboard/agents.html?tenant=<TENANT_ID>`

## Configuration

- The dashboard establishes a WebSocket connection to `/events/ws?callSid=...` on the same host to receive real-time events.
- Override actions are sent to the backend via POST requests:
  - `/override/text` – `{ "callSid": "CA...", "text": "hello" }`
  - `/override/dtmf` – `{ "callSid": "CA...", "digit": "1" }`
  - `/override/end` – `{ "callSid": "CA..." }`
  - `/override/transfer` – `{ "callSid": "CA...", "number": "+15551234567" }`
  - `/override/clarification` – `{ "callSid": "CA...", "response": "text" }`

## UI Components

- **Transcript View** – Scrollable log of caller transcripts, assistant replies, commands and supervisor actions with timestamps.
- **Manual Speak Input** – Text box to send a typed message to the caller.
- **DTMF Pad** – Buttons 0-9, `*`, `#` for sending DTMF digits.
- **Call Control Buttons** – `End Call` and `Transfer` buttons for ending or transferring the call.
- **Clarification Prompt** – Displayed when the AI requests supervisor input.

Supervisor actions are appended to the transcript area immediately when triggered.

## 🛠️ Frontend Architecture

### Technology Stack
- **React 18** - Modern React with functional components and hooks
- **Material-UI (MUI)** - Production-ready React components
- **TypeScript** - Type safety and enhanced development experience
- **WebSocket API** - Real-time communication with backend
- **Axios** - HTTP client for API requests

### Project Structure
```
frontend/
├── src/
│   ├── components/
│   │   ├── CallMonitor.tsx    # Live call monitoring interface
│   │   ├── AgentManager.tsx   # Agent configuration dashboard
│   │   ├── TenantDashboard.tsx # Multi-tenant management
│   │   └── Common/            # Shared components
│   ├── hooks/
│   │   ├── useWebSocket.ts    # WebSocket connection management
│   │   ├── useCallData.ts     # Call data state management
│   │   └── useAgents.ts       # Agent management hooks
│   ├── services/
│   │   ├── api.ts            # API client configuration
│   │   └── websocket.ts      # WebSocket service
│   └── types/
│       ├── call.ts           # Call-related type definitions
│       ├── agent.ts          # Agent type definitions
│       └── tenant.ts         # Multi-tenant type definitions
├── public/
│   ├── index.html           # Main call monitoring page
│   └── agents.html          # Agent management page
└── package.json
```

### Development Commands
```bash
# Install dependencies
cd frontend && npm install

# Start development server
npm start

# Build for production
npm run build

# Run tests
npm test

# Type checking
npm run type-check
```

## 🔧 Configuration Options

### Environment Variables
```bash
# Frontend configuration (optional)
REACT_APP_API_BASE_URL=http://localhost:24187
REACT_APP_WS_BASE_URL=ws://localhost:24187
REACT_APP_TENANT_MODE=enabled
```

### WebSocket Configuration
The dashboard automatically connects to the WebSocket endpoint with the following configuration:
```javascript
const wsUrl = `${wsBaseUrl}/events/ws?callSid=${callSid}&tenant=${tenantId}`;
```

### API Integration
All API calls are automatically authenticated and tenant-scoped when applicable:
```javascript
// Example: Create new agent
const response = await api.post('/agents', {
  name: 'Customer Support',
  tenant_id: tenantId,
  personality: 'professional'
});
```

## 📱 Mobile Responsiveness

The dashboard is fully responsive and optimized for:
- **Desktop** - Full feature set with multi-panel layout
- **Tablet** - Adaptive layout with collapsible sidebars
- **Mobile** - Single-column layout with touch-friendly controls

## 🔐 Security Features

- **Tenant Isolation** - All data is scoped to appropriate tenants
- **API Authentication** - Secure API communication
- **Input Validation** - Client-side and server-side validation
- **CSP Headers** - Content Security Policy protection
- **XSS Protection** - Built-in React XSS prevention
