# Dashboard UI Overview

The Phony dashboard provides a comprehensive web interface for monitoring voice AI agents, managing calls, and controlling conversations in real-time.

```{admonition} Dashboard Access
:class: info

**URL**: `http://localhost:24187/dashboard/`  
**Authentication**: No authentication required in development  
**Browser Requirements**: Modern browsers with WebSocket support
```

## Interface Layout

```{mermaid}
graph TB
    subgraph "Dashboard Layout"
        Header[Header Navigation]
        Sidebar[Agent Sidebar]
        Main[Main Content Area]
        Footer[Status Footer]
    end
    
    subgraph "Main Content Sections"
        CallMonitor[Call Monitoring]
        AgentMgmt[Agent Management] 
        Controls[Supervisor Controls]
        Analytics[Analytics Panel]
    end
    
    Header --> Main
    Sidebar --> Main
    Main --> CallMonitor
    Main --> AgentMgmt
    Main --> Controls
    Main --> Analytics
    
    style Header fill:#e3f2fd
    style Sidebar fill:#e8f5e9
    style Main fill:#fff3e0
    style Footer fill:#fce4ec
```

## Key Features

### 🔴 Real-time Call Monitoring

- **Active Calls**: View all ongoing conversations
- **Live Transcription**: Real-time speech-to-text display
- **AI Responses**: Monitor AI-generated replies
- **Call Metrics**: Duration, quality scores, status

### 👥 Agent Management

- **Agent List**: View and manage all AI agents
- **Configuration**: Edit system prompts, voices, and settings  
- **Phone Numbers**: Assign numbers to specific agents
- **Performance**: Track agent success rates and usage

### 🎛️ Supervisor Controls

- **Text Injection**: Send text for AI to speak
- **Call Transfer**: Route calls to human agents
- **DTMF Tones**: Send touch-tone digits
- **Emergency Stop**: Immediately end calls

### 📊 Analytics Dashboard

- **Call Volume**: Daily/weekly/monthly statistics
- **Success Rates**: Completion and satisfaction metrics
- **Cost Tracking**: Usage-based billing information
- **Performance Trends**: Historical analysis

## Getting Started

### 1. Access the Dashboard

```bash
# Ensure Phony is running
docker-compose up -d backend redis mongodb

# Open in browser
open http://localhost:24187/dashboard/
```

### 2. Initial Setup

1. **Configure Agents**: Create your first AI agent
2. **Assign Phone Numbers**: Connect Twilio numbers to agents
3. **Test Calls**: Use built-in test tools
4. **Monitor Activity**: Watch real-time events

### 3. Navigation

```{list-table} Navigation Menu
:header-rows: 1
:widths: 20 30 50

* - Section
  - Icon
  - Purpose
* - **Home**
  - 🏠
  - Overview and quick stats
* - **Agents**
  - 🤖
  - Manage AI agents and configurations
* - **Calls**
  - 📞
  - Active and historical call monitoring
* - **Analytics**
  - 📊
  - Performance metrics and reports
* - **Settings**
  - ⚙️
  - System configuration
```

## Dashboard Components

### Call Status Indicators

```{list-table} Status Colors
:header-rows: 1

* - Status
  - Color
  - Meaning
* - **Active**
  - 🟢 Green
  - Call in progress
* - **Ringing**
  - 🟡 Yellow
  - Call connecting
* - **Ended**
  - ⚪ Gray
  - Call completed normally
* - **Failed**
  - 🔴 Red
  - Call failed or error
* - **Transferred**
  - 🔵 Blue
  - Transferred to human
```

### Real-time Events

The dashboard displays live events as they occur:

```javascript
// Example event data structure
{
    "event": "speech.detected",
    "callSid": "CA123456789",
    "timestamp": "2024-01-15T10:30:00Z",
    "data": {
        "text": "Hello, how can I help you?",
        "speaker": "human",
        "confidence": 0.95,
        "duration": 2.3
    }
}
```

### Interactive Controls

#### Text Injection Panel

```html
<!-- Example control interface -->
<div class="supervisor-controls">
    <textarea placeholder="Enter text for AI to speak..."></textarea>
    <button onclick="sendText()">Send Text</button>
    <button onclick="transferCall()">Transfer</button>
    <button onclick="endCall()">End Call</button>
</div>
```

## Advanced Features

### Multi-Tenant View

For multi-tenant deployments:

- **Tenant Switching**: Toggle between different tenants
- **Isolated Data**: Each tenant sees only their data
- **Role-based Access**: Different permission levels
- **Custom Branding**: Tenant-specific themes

### WebSocket Integration

The dashboard uses WebSockets for real-time updates:

```javascript
// Connect to event stream
const ws = new WebSocket('ws://localhost:24187/events/ws?callSid=CA123');

ws.onmessage = function(event) {
    const data = JSON.parse(event.data);
    updateCallDisplay(data);
};
```

### Responsive Design

The dashboard adapts to different screen sizes:

- **Desktop**: Full feature set with multi-column layout
- **Tablet**: Condensed view with essential controls
- **Mobile**: Single-column, touch-optimized interface

## Troubleshooting

### Common Issues

#### Dashboard Won't Load

```bash
# Check if backend is running
curl http://localhost:24187/healthz

# Check browser console for errors
# Ensure no ad blockers are interfering
```

#### Real-time Updates Not Working

```bash
# Verify WebSocket connection
# Check firewall/proxy settings
# Test with different browser
```

#### Missing Call Data

```bash
# Verify MongoDB connection
docker-compose logs mongodb

# Check Redis cache
docker-compose logs redis
```

### Browser Compatibility

```{list-table} Supported Browsers
:header-rows: 1

* - Browser
  - Minimum Version
  - Notes
* - **Chrome**
  - 80+
  - Recommended
* - **Firefox** 
  - 75+
  - Full support
* - **Safari**
  - 13+
  - WebSocket limitations
* - **Edge**
  - 80+
  - Chromium-based
```

## Customization

### Theme Configuration

```css
/* Custom dashboard themes */
:root {
    --primary-color: #2196F3;
    --secondary-color: #4CAF50;
    --background-color: #f5f5f5;
    --text-color: #333333;
}
```

### Adding Custom Widgets

```javascript
// Example custom widget
class CallVolumeWidget {
    constructor(container) {
        this.container = container;
        this.render();
    }
    
    render() {
        // Custom widget implementation
    }
}
```

## Next Steps

```{panels}
:container: +full-width
:column: col-lg-4 px-2 py-2
:card:

**📞 Call Monitoring**
^^^
Learn to monitor active calls and view transcriptions

[Call Monitoring Guide](call-monitoring)
---

**🤖 Agent Management**
^^^
Create and configure AI agents with custom personalities

[Agent Management](agent-management)
---

**🎛️ Supervisor Controls**
^^^
Use real-time intervention tools to control calls

[Supervisor Controls](supervisor-controls)
```

---

```{note}
The dashboard is continuously updated with new features. Check the [changelog](../reference/changelog) for the latest updates.
```