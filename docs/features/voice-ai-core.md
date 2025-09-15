# 🎙️ Voice AI Core Features

Phony's voice AI core provides the foundation for natural, human-like phone conversations powered by OpenAI's Realtime API and advanced voice processing capabilities.

## 🔄 Bidirectional Communication

### Inbound Calls (Human → AI)
- **Automatic routing** to appropriate AI agents based on phone number
- **Multi-personality support** with 5 pre-configured personalities
- **Real-time response** with sub-300ms latency
- **Context awareness** maintaining conversation state

### Outbound Calls (AI → Human)
- **Proactive outreach** for appointments, surveys, follow-ups
- **Consent management** with explicit permission validation
- **Scenario-based calling** with 4 pre-configured scenarios
- **Custom context injection** for personalized conversations

## 🤖 AI Agent Architecture

### Agent Types
```{list-table} Agent Configuration
:header-rows: 1
:widths: 25 25 50

* - Type
  - Purpose
  - Use Cases
* - **Inbound Agents**
  - Handle incoming calls
  - Customer service, support, information
* - **Outbound Agents**
  - Make proactive calls
  - Sales, surveys, reminders, follow-ups
* - **Hybrid Agents**
  - Both directions
  - Flexible business workflows
```

### Agent Components
Each AI agent consists of:

- **System Prompt**: Core personality and instructions
- **Voice Selection**: One of 6 OpenAI voices (alloy, echo, fable, onyx, nova, shimmer)
- **Context Data**: Business-specific information and state
- **Phone Numbers**: Assigned Twilio numbers for inbound routing
- **Greeting Message**: Initial response for inbound calls

## 🎯 AI Personalities

Phony includes 5 pre-configured personalities optimized for different use cases:

### 1. Professional Assistant
```yaml
Voice: alloy
Personality: Formal, efficient, business-focused
Ideal for: Customer service, technical support, business inquiries
Greeting: "Hello! This is your professional assistant. How may I help you today?"
```

### 2. Customer Service Representative
```yaml
Voice: echo
Personality: Knowledgeable, patient, problem-solving oriented
Ideal for: Technical support, issue resolution, troubleshooting
Greeting: "Hi there! I'm here to help resolve any issues you might have."
```

### 3. Appointment Scheduler
```yaml
Voice: nova
Personality: Organized, friendly, detail-oriented
Ideal for: Booking coordination, scheduling, calendar management
Greeting: "Good day! I'm your scheduling assistant. Let's find the perfect time."
```

### 4. Information Hotline
```yaml
Voice: fable
Personality: Knowledgeable, clear, helpful
Ideal for: General inquiries, FAQ responses, information lookup
Greeting: "Welcome to our information hotline! What can I help you find today?"
```

### 5. Survey Conductor
```yaml
Voice: shimmer
Personality: Enthusiastic, engaging, research-focused
Ideal for: Feedback collection, market research, customer surveys
Greeting: "Hi! I'd love to get your feedback. This will just take a couple minutes."
```

## 🎵 Voice Processing Pipeline

### Speech Recognition
```mermaid
graph LR
    Audio[Audio Stream] --> STT[Speech-to-Text]
    STT --> VAD[Voice Activity Detection]
    VAD --> Processing[Text Processing]
    Processing --> Intent[Intent Recognition]
```

### Response Generation
```mermaid
graph LR
    Intent[Intent Recognition] --> LLM[Language Model]
    LLM --> Context[Context Integration]
    Context --> TTS[Text-to-Speech]
    TTS --> Audio[Audio Stream]
```

### Advanced Features
- **Voice Activity Detection (VAD)**: Automatic turn-taking
- **Interrupt Handling**: Natural conversation flow
- **Emotion Recognition**: Sentiment-aware responses
- **Background Noise Filtering**: Clear audio processing

## 🔧 LLM Command System

The AI can execute special commands during conversations for enhanced functionality:

### Available Commands
```{list-table} LLM Commands
:header-rows: 1
:widths: 30 70

* - Command
  - Description
* - `[[press:digits]]`
  - Send DTMF tones to caller (0-9, *, #)
* - `[[transfer:number]]`
  - Transfer call to another number and end session
* - `[[end_call]]`
  - Terminate the call immediately
* - `[[request_user:prompt]]`
  - Pause and ask supervisor for guidance
```

### Command Examples
```python
# AI response with DTMF command
"I'll connect you to our billing department. [[press:2]]"

# AI response with transfer command  
"Let me transfer you to a specialist. [[transfer:+15551234567]]"

# AI response requesting supervisor help
"This is a complex issue. [[request_user:Customer needs advanced technical support]]"

# AI ending call naturally
"Thank you for calling! Have a great day. [[end_call]]"
```

### Command Processing
1. **Detection**: Server-side parsing of command tokens
2. **Validation**: Security checks and permission verification
3. **Execution**: Real-time action during active calls
4. **Logging**: Complete audit trail of all commands

## 🧠 Context Management

### Dynamic Context Updates
- **Real-time editing**: Update agent context during active calls
- **Session persistence**: Maintain context throughout conversation
- **Context injection**: Add business-specific data on-demand
- **Multi-layered context**: System, agent, session, and call-specific data

### Context Structure
```json
{
  "system_context": {
    "business_hours": "9 AM - 6 PM EST",
    "company_name": "Acme Corporation",
    "support_email": "help@acme.com"
  },
  "agent_context": {
    "department": "customer_service",
    "expertise": ["billing", "technical_support"],
    "escalation_number": "+15551234567"
  },
  "session_context": {
    "customer_id": "CUST_12345",
    "previous_calls": 2,
    "last_issue": "billing_inquiry"
  },
  "call_context": {
    "priority": "high",
    "notes": "Customer reporting login issues",
    "resolution_status": "in_progress"
  }
}
```

## 🔊 Voice Customization

### OpenAI Voice Options
```{list-table} Voice Characteristics
:header-rows: 1
:widths: 15 15 20 50

* - Voice
  - Gender
  - Accent
  - Best For
* - **alloy**
  - Neutral
  - American
  - Professional, balanced conversations
* - **echo**
  - Male
  - American
  - Technical support, authority
* - **fable**
  - Female
  - British
  - Information services, elegance
* - **onyx**
  - Male
  - American
  - Deep voice, sales, leadership
* - **nova**
  - Female
  - American
  - Friendly, healthcare, education
* - **shimmer**
  - Female
  - American
  - Energetic, sales, marketing
```

### Voice Configuration
```python
# Agent voice configuration
{
    "voice": "nova",
    "voice_settings": {
        "speed": 1.0,        # 0.5 - 2.0
        "pitch": 0.0,        # -1.0 to 1.0
        "emotion": "neutral", # neutral, happy, sad, excited
        "style": "conversational" # formal, conversational, friendly
    }
}
```

## 📊 Performance Metrics

### Response Latency
- **P50**: < 180ms (median response time)
- **P95**: < 300ms (95th percentile)
- **P99**: < 500ms (99th percentile)
- **Target**: Sub-200ms for natural conversation

### Audio Quality
- **Sample Rate**: 16kHz
- **Bit Depth**: 16-bit PCM
- **Codec**: G.711 μ-law, PCMU
- **Latency**: < 150ms end-to-end

### Accuracy Metrics
- **Speech Recognition**: 97% accuracy (clean audio)
- **Intent Recognition**: 94% accuracy 
- **Response Relevance**: 89% human evaluation score
- **Conversation Flow**: 91% completion rate

## 🔒 Safety & Compliance

### Content Safety
- **Real-time moderation**: Inappropriate content filtering
- **Bias detection**: Fair and inclusive responses
- **Privacy protection**: PII redaction and handling
- **Compliance**: GDPR, CCPA, HIPAA considerations

### Call Safety Features
- **Consent validation**: Required for outbound calls
- **Emergency termination**: Immediate call end capability
- **Supervisor override**: Human intervention at any time
- **Call recording**: Optional with proper consent

### Quality Assurance
- **Conversation monitoring**: Real-time quality checks
- **Automated scoring**: Response quality metrics
- **Human review**: Sample conversation evaluation
- **Continuous improvement**: ML-based optimization

## 🚀 Advanced Capabilities

### Multi-Language Support
- **Language detection**: Automatic identification
- **Dynamic switching**: Mid-conversation language changes
- **Localization**: Region-specific responses
- **Cultural adaptation**: Context-aware cultural sensitivity

### Integration Features
- **CRM connectivity**: Real-time customer data access
- **API webhooks**: Event-driven integrations
- **Custom actions**: Business-specific commands
- **Third-party services**: External system integration

### Scalability
- **Concurrent calls**: 100+ simultaneous conversations
- **Load balancing**: Automatic traffic distribution
- **Auto-scaling**: Dynamic resource allocation
- **Geographic distribution**: Multi-region deployment

## 🔧 Configuration Examples

### Basic Agent Setup
```python
{
    "name": "Customer Service Agent",
    "type": "inbound",
    "voice": "alloy",
    "system_prompt": "You are a helpful customer service representative for Acme Corp. Be professional, empathetic, and solution-oriented.",
    "greeting_message": "Hello! Thank you for calling Acme Corp. How can I help you today?",
    "phone_numbers": ["+18578167225"],
    "context_data": {
        "company_name": "Acme Corp",
        "business_hours": "9 AM - 6 PM EST",
        "support_email": "support@acme.com",
        "escalation_number": "+15551234567"
    }
}
```

### Advanced Agent Configuration
```python
{
    "name": "Technical Support Specialist",
    "type": "inbound",
    "voice": "echo",
    "system_prompt": "You are a senior technical support engineer with expertise in software troubleshooting. Use technical language appropriately but explain complex concepts clearly.",
    "voice_settings": {
        "speed": 0.9,
        "emotion": "confident"
    },
    "max_call_duration": 1800, # 30 minutes
    "transfer_rules": {
        "escalation_keywords": ["manager", "supervisor", "complaint"],
        "escalation_number": "+15551234567"
    },
    "context_data": {
        "expertise_areas": ["API", "authentication", "billing", "integrations"],
        "knowledge_base": "https://docs.acme.com",
        "ticket_system": "https://support.acme.com"
    }
}
```

## 💡 Best Practices

### Prompt Engineering
- **Clear instructions**: Specific behavioral guidelines
- **Context boundaries**: Define scope and limitations
- **Error handling**: How to respond to unclear inputs
- **Personality consistency**: Maintain character throughout

### Voice Selection
- **Match purpose**: Professional vs. friendly vs. authoritative
- **Target audience**: Consider demographics and preferences
- **Brand alignment**: Voice should match company personality
- **A/B testing**: Compare effectiveness across voices

### Context Management
- **Relevant data**: Include only necessary information
- **Regular updates**: Keep context current and accurate
- **Privacy compliance**: Handle sensitive data appropriately
- **Performance impact**: Balance context richness with speed

---

*Next: {doc}`real-time-dashboard` - Explore dashboard monitoring features*