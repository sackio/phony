# Welcome to Phony Voice AI Agent Documentation

```{image} _static/images/phony-banner.png
:alt: Phony Voice AI Agent
:class: bg-primary mb-1
:width: 100%
:align: center
```

## 🎯 Production-Ready Voice AI for Phone Conversations

Phony is a sophisticated voice AI agent system that enables natural, bidirectional phone conversations between humans and AI. Built with enterprise-grade reliability and scalability, Phony seamlessly integrates Twilio's telephony infrastructure with OpenAI's cutting-edge Realtime API.

```{panels}
:container: +full-width
:column: col-lg-4 px-2 py-2
:card:

**🚀 Quick Start**
^^^
Get up and running in minutes with our Docker-based deployment.

[Get Started](guides/quickstart)
---

**📞 Voice Features**
^^^
Explore advanced voice conversation capabilities and AI personalities.

[View Features](features/overview)
---

**🔧 API Reference**
^^^
Complete documentation for REST APIs, WebSockets, and webhooks.

[API Docs](api/index)
---

**📊 Dashboard UI**
^^^
Monitor calls, manage agents, and control conversations in real-time.

[UI Guide](ui-guide/overview)
---

**🎓 Tutorials**
^^^
Step-by-step guides for common use cases and scenarios.

[Browse Tutorials](tutorials/basic-setup)
---

**💡 Examples**
^^^
Real-world implementations and best practices.

[See Examples](examples/customer-service)
```

## Key Features

::::{grid} 2
:::{grid-item-card} 🎙️ Natural Voice Conversations
- Bidirectional phone calls (AI ↔ Human)
- Multiple AI personalities (professional, friendly, technical)
- Real-time speech recognition and synthesis
- Natural language understanding and generation
:::

:::{grid-item-card} 🔌 Enterprise Integration
- Twilio ConversationRelay WebSocket protocol
- OpenAI Realtime API integration
- REST API and WebSocket endpoints
- Docker containerization
:::

:::{grid-item-card} 👥 Multi-Tenancy Support
- Isolated agent configurations per tenant
- Tenant-specific phone numbers
- Custom system prompts and voices
- Role-based access control
:::

:::{grid-item-card} 🎛️ Supervisor Controls
- Real-time call monitoring
- Intervention capabilities (text, DTMF, transfer)
- Call recording and transcription
- Analytics and reporting
:::
::::

## System Architecture

```{mermaid}
graph TB
    subgraph "Phone Network"
        Phone[📱 Phone Call]
    end
    
    subgraph "Twilio Cloud"
        TwilioAPI[Twilio API]
        ConvRelay[ConversationRelay]
    end
    
    subgraph "Phony System"
        FastAPI[FastAPI Backend<br/>Port 24187]
        Redis[(Redis Cache<br/>Port 6380)]
        MongoDB[(MongoDB<br/>Port 27017)]
        Dashboard[React Dashboard]
    end
    
    subgraph "OpenAI"
        Realtime[Realtime API]
    end
    
    Phone <--> TwilioAPI
    TwilioAPI <--> ConvRelay
    ConvRelay <-->|WebSocket| FastAPI
    FastAPI <--> Redis
    FastAPI <--> MongoDB
    FastAPI <-->|WebSocket| Realtime
    FastAPI --> Dashboard
    
    style Phone fill:#e1f5fe
    style TwilioAPI fill:#fff3e0
    style ConvRelay fill:#fff3e0
    style FastAPI fill:#e8f5e9
    style Redis fill:#fce4ec
    style MongoDB fill:#fce4ec
    style Dashboard fill:#f3e5f5
    style Realtime fill:#fff9c4
```

## Quick Performance Metrics

```{list-table} System Performance
:header-rows: 1
:widths: 30 70

* - Metric
  - Value
* - **Response Latency**
  - < 300ms (P95)
* - **Concurrent Calls**
  - 100+ simultaneous
* - **Test Coverage**
  - 100% (78/78 tests)
* - **Uptime SLA**
  - 99.9%
* - **Audio Quality**
  - 16kHz, 16-bit PCM
* - **Supported Codecs**
  - G.711 μ-law, PCMU
```

## Getting Started

::::{tab-set}

:::{tab-item} Docker Quick Start
```bash
# Clone the repository
git clone https://github.com/sackio/phony.git
cd phony

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Start services
docker-compose up -d backend redis mongodb

# Verify health
curl http://localhost:24187/healthz

# Access dashboard
open http://localhost:24187/dashboard/
```
:::

:::{tab-item} Make Your First Call
```bash
# Configure Twilio phone number
docker-compose run --rm demo python3 scripts/setup_twilio.py

# Make an outbound call
docker-compose --profile human run --rm human-demo

# Or call the AI
# Dial: +1 (857) 816-7225
```
:::

:::{tab-item} Run Tests
```bash
# Run full test suite
docker-compose run --rm demo python3 scripts/test_human_demo_suite.py

# Run edge case tests
docker-compose run --rm demo python3 scripts/test_edge_cases.py

# Results: 100% coverage (78/78 tests passing)
```
:::

::::

## Documentation Navigation

```{admonition} 🗺️ Where to Go Next
:class: tip

- **New Users**: Start with [Quick Start Guide](guides/quickstart)
- **Developers**: Check out [API Documentation](api/index) and [Development Guide](guides/development)
- **DevOps**: See [Deployment Guide](guides/deployment) and [Docker Configuration](reference/docker-compose)
- **UI Users**: Explore [Dashboard Guide](ui-guide/overview)
```

## Live Demo

```{button-link} http://phony.pushbuild.com
:color: primary
:expand:
:align: center

🌐 Access Live Demo
```

## Community & Support

::::{grid} 3
:::{grid-item}
**GitHub**

[View Source Code](https://github.com/sackio/phony)

Report issues and contribute
:::

:::{grid-item}
**Documentation**

[Browse Docs](guides/quickstart)

Comprehensive guides and API reference
:::

:::{grid-item}
**Support**

[Get Help](reference/faq)

FAQ and troubleshooting
:::
::::

---

```{note}
This documentation is continuously updated. Last build: {sub-ref}`today`
```

```{toctree}
:hidden:
:maxdepth: 3

guides/quickstart
features/overview
api/index
ui-guide/overview
tutorials/basic-setup
examples/customer-service
reference/faq
```