# Customer Service Bot Example

This example demonstrates how to build a comprehensive customer service bot using Phony that can handle common support scenarios, escalate to humans when needed, and maintain context throughout conversations.

## Overview

Our customer service bot will:

- Handle common inquiries (account info, billing, technical support)
- Escalate complex issues to human agents
- Collect customer information
- Provide order status updates
- Process simple account changes

## Agent Configuration

### Basic Setup

```python
import requests

# Customer service agent configuration
agent_config = {
    "name": "Customer Service Agent",
    "system_prompt": """You are Sarah, a professional customer service representative for TechCorp, a technology company.

PERSONALITY: Friendly, patient, professional, solution-oriented
CAPABILITIES: Account lookup, billing assistance, basic technical support, order tracking

CONVERSATION FLOW:
1. Greet customer warmly and introduce yourself
2. Ask how you can help them today
3. Listen carefully to their concern
4. Ask clarifying questions if needed
5. Provide step-by-step solutions
6. Confirm resolution or escalate if necessary

ESCALATION TRIGGERS:
- Customer requests refund > $500
- Technical issues requiring advanced troubleshooting
- Account security concerns
- Customer expresses significant frustration
- Any legal or compliance matters

COMMANDS AVAILABLE:
- [[transfer:+15551234567]] - Transfer to human agent
- [[end_call]] - End conversation politely
- [[press:1234]] - Navigate phone menus
- [[request_user:Please provide order number]] - Ask supervisor for information

EXAMPLE INTERACTIONS:
Customer: "I can't log into my account"
You: "I'm sorry to hear you're having trouble logging in. Let me help you with that. Can you tell me what happens when you try to log in? Do you get an error message?"

Customer: "I want to cancel my service"
You: "I understand you're considering canceling your service. I'd be happy to help you with that or see if there's another way we can address your concerns. May I ask what's prompting this decision?"

Always maintain a helpful, professional tone and focus on solving the customer's problem.""",
    
    "voice": "alloy",
    "model": "gpt-4o-realtime-preview",
    "greeting_message": "Hello! This is Sarah from TechCorp customer service. How can I help you today?",
    "phone_numbers": ["+15551234567"],
    "is_active": True
}

# Create the agent
response = requests.post(
    "http://localhost:24187/agents/",
    headers={"Content-Type": "application/json"},
    json=agent_config
)

agent = response.json()
print(f"Created agent: {agent['id']}")
```

## Advanced Configuration

### Multi-Skill Agent

```python
advanced_config = {
    "name": "Advanced Customer Service Agent",
    "system_prompt": """You are Alex, a senior customer service representative with expertise in multiple areas.

DEPARTMENTS YOU CAN HANDLE:
🔧 TECHNICAL SUPPORT
- Password resets and account access
- Basic troubleshooting for software/hardware
- Configuration guidance
- Connection issues

💳 BILLING & ACCOUNTS
- Billing inquiries and disputes
- Payment processing
- Account changes (address, phone, email)
- Service upgrades/downgrades

📦 ORDER MANAGEMENT  
- Order status and tracking
- Shipping information
- Simple changes (address, delivery date)
- Return/exchange initiation

⚖️ ESCALATION REQUIRED FOR:
- Refunds over $500
- Legal threats or compliance issues
- Account security breaches
- Complex technical problems requiring specialist
- Abusive or threatening behavior

CONVERSATION TECHNIQUES:
1. Active listening - acknowledge customer concerns
2. Empathy statements - "I understand how frustrating this must be"
3. Solution-focused - always try to help before escalating
4. Clear communication - use simple, non-technical language
5. Follow-up - ensure customer is satisfied with resolution

SAMPLE SCRIPTS:

BILLING ISSUE:
Customer: "My bill is wrong this month"
You: "I'm sorry to hear there's an issue with your bill. I'd be happy to review that with you right away. Can you tell me what specifically looks incorrect? I have your account pulled up here."

TECHNICAL ISSUE:
Customer: "Your app keeps crashing"
You: "I apologize for the trouble with our app. Let me help you resolve this. What device are you using, and when did you first notice this issue? Also, have you tried restarting the app recently?"

COMPLEX ESCALATION:
Customer: "I've been overcharged for 6 months and nobody will help me!"
You: "I sincerely apologize for this ongoing issue and the frustration it's caused. This definitely needs immediate attention from a specialist who can do a thorough account review. Let me transfer you to our billing resolution team right now. [[transfer:+15551234568]]"

Remember: Your goal is to resolve issues efficiently while maintaining excellent customer satisfaction.""",
    
    "voice": "nova",  # Warmer, more conversational voice
    "greeting_message": "Hi there! I'm Alex from customer service. I'm here to help with any questions about your account, billing, orders, or technical issues. What can I do for you today?",
    "phone_numbers": ["+15551234567"],
    "is_active": True
}
```

## Call Flow Examples

### Scenario 1: Password Reset

```mermaid
graph TD
    A[Customer calls] --> B[Greeting & Introduction]
    B --> C[Customer: "Can't log in"]
    C --> D[Verify identity]
    D --> E[Determine issue type]
    E --> F{Password or Account?}
    F -->|Password| G[Guide through reset process]
    F -->|Account locked| H[Unlock account]
    G --> I[Confirm successful login]
    H --> I
    I --> J[Offer additional help]
    J --> K[End call positively]
    
    style A fill:#e3f2fd
    style K fill:#e8f5e9
```

### Scenario 2: Billing Dispute

```mermaid
graph TD
    A[Customer calls] --> B[Greeting & Introduction]
    B --> C[Customer: "Bill is wrong"]
    C --> D[Show empathy]
    D --> E[Request account details]
    E --> F[Review billing history]
    F --> G{Simple fix?}
    G -->|Yes| H[Apply correction]
    G -->|No| I[Escalate to billing specialist]
    H --> J[Confirm satisfaction]
    I --> K[Transfer with context]
    J --> L[End call]
    K --> L
    
    style A fill:#e3f2fd
    style L fill:#e8f5e9
```

## Testing the Configuration

### Test Script

```python
import time
import requests
import websocket
import json

def test_customer_service_bot():
    """Test the customer service bot with various scenarios."""
    
    # Test scenarios
    scenarios = [
        {
            "name": "Password Reset",
            "customer_message": "I can't log into my account",
            "expected_keywords": ["password", "reset", "email", "help"]
        },
        {
            "name": "Billing Inquiry", 
            "customer_message": "My bill seems too high this month",
            "expected_keywords": ["bill", "review", "account", "charges"]
        },
        {
            "name": "Order Status",
            "customer_message": "Where is my order? I placed it a week ago",
            "expected_keywords": ["order", "tracking", "status", "number"]
        },
        {
            "name": "Cancellation Request",
            "customer_message": "I want to cancel my service",
            "expected_keywords": ["cancel", "concerns", "reason", "help"]
        }
    ]
    
    print("🧪 Testing Customer Service Bot Scenarios")
    print("=" * 50)
    
    for scenario in scenarios:
        print(f"\n📋 Testing: {scenario['name']}")
        print(f"Customer input: {scenario['customer_message']}")
        
        # In a real test, you would simulate the conversation
        # For demonstration, we'll show the expected flow
        print("✅ Expected AI response should include:")
        for keyword in scenario['expected_keywords']:
            print(f"   • {keyword}")
        
        time.sleep(1)  # Simulate processing time
    
    print("\n🎉 All scenarios tested successfully!")

# Run the tests
if __name__ == "__main__":
    test_customer_service_bot()
```

## Monitoring and Analytics

### Dashboard Metrics

Track these key performance indicators:

```python
def get_customer_service_metrics(agent_id):
    """Get performance metrics for customer service agent."""
    
    metrics = {
        "calls_handled": 0,
        "avg_call_duration": 0,
        "resolution_rate": 0,
        "escalation_rate": 0,
        "customer_satisfaction": 0,
        "top_issues": [],
        "peak_hours": []
    }
    
    # Example metrics calculation
    # In practice, this would query your database
    
    return metrics

# Example usage
metrics = get_customer_service_metrics("agent_123")
print(f"Resolution rate: {metrics['resolution_rate']}%")
print(f"Escalation rate: {metrics['escalation_rate']}%")
```

### Real-time Monitoring

```javascript
// Dashboard widget for monitoring customer service calls
class CustomerServiceMonitor {
    constructor() {
        this.ws = new WebSocket('ws://localhost:24187/events/ws');
        this.setupEventHandlers();
    }
    
    setupEventHandlers() {
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            switch(data.event) {
                case 'call.started':
                    this.handleCallStart(data);
                    break;
                case 'speech.detected':
                    this.handleSpeech(data);
                    break;
                case 'escalation.requested':
                    this.handleEscalation(data);
                    break;
                case 'call.resolved':
                    this.handleResolution(data);
                    break;
            }
        };
    }
    
    handleEscalation(data) {
        // Alert supervisors about escalation
        this.showAlert(`Call ${data.callSid} needs human agent`);
        this.notifyAvailableAgents();
    }
}
```

## Integration Examples

### CRM Integration

```python
class CRMIntegration:
    """Integrate with CRM system for customer data."""
    
    def __init__(self, crm_api_key):
        self.api_key = crm_api_key
        self.base_url = "https://api.crm-system.com/v1"
    
    def lookup_customer(self, phone_number):
        """Look up customer by phone number."""
        response = requests.get(
            f"{self.base_url}/customers",
            params={"phone": phone_number},
            headers={"Authorization": f"Bearer {self.api_key}"}
        )
        return response.json()
    
    def create_support_ticket(self, customer_id, issue_description, priority="normal"):
        """Create a support ticket."""
        ticket_data = {
            "customer_id": customer_id,
            "subject": "Phone support request",
            "description": issue_description,
            "priority": priority,
            "source": "phone_ai"
        }
        
        response = requests.post(
            f"{self.base_url}/tickets",
            json=ticket_data,
            headers={"Authorization": f"Bearer {self.api_key}"}
        )
        return response.json()

# Usage example
crm = CRMIntegration("your-crm-api-key")
customer = crm.lookup_customer("+15551234567")
```

### Knowledge Base Integration

```python
class KnowledgeBaseIntegration:
    """Integrate with knowledge base for automated answers."""
    
    def __init__(self, kb_api_key):
        self.api_key = kb_api_key
        self.base_url = "https://api.knowledge-base.com/v1"
    
    def search_articles(self, query, category=None):
        """Search knowledge base articles."""
        params = {"q": query, "limit": 5}
        if category:
            params["category"] = category
            
        response = requests.get(
            f"{self.base_url}/search",
            params=params,
            headers={"Authorization": f"Bearer {self.api_key}"}
        )
        return response.json()
    
    def get_article_content(self, article_id):
        """Get full content of a specific article."""
        response = requests.get(
            f"{self.base_url}/articles/{article_id}",
            headers={"Authorization": f"Bearer {self.api_key}"}
        )
        return response.json()

# Usage in AI prompt
kb = KnowledgeBaseIntegration("your-kb-api-key")
articles = kb.search_articles("password reset")
```

## Best Practices

### Conversation Management

1. **Start with empathy**: Always acknowledge customer concerns
2. **Ask clarifying questions**: Ensure you understand the issue
3. **Provide step-by-step guidance**: Break down solutions
4. **Confirm understanding**: Make sure customer follows along
5. **Escalate appropriately**: Know when human help is needed

### Quality Assurance

```python
def quality_check(call_transcript):
    """Automated quality assessment of customer service calls."""
    
    quality_metrics = {
        "greeting_used": False,
        "empathy_shown": False,
        "solution_provided": False,
        "escalation_appropriate": False,
        "professional_tone": False
    }
    
    # Analyze transcript for quality indicators
    transcript_lower = call_transcript.lower()
    
    # Check for proper greeting
    greeting_phrases = ["hello", "hi", "good morning", "good afternoon"]
    quality_metrics["greeting_used"] = any(phrase in transcript_lower for phrase in greeting_phrases)
    
    # Check for empathy
    empathy_phrases = ["sorry", "understand", "frustrating", "apologize"]
    quality_metrics["empathy_shown"] = any(phrase in transcript_lower for phrase in empathy_phrases)
    
    return quality_metrics
```

## Deployment

### Production Configuration

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  customer-service-bot:
    build: .
    environment:
      - AGENT_TYPE=customer_service
      - SYSTEM_PROMPT_FILE=/app/prompts/customer_service.txt
      - ESCALATION_PHONE=+15551234568
      - CRM_API_KEY=${CRM_API_KEY}
      - KB_API_KEY=${KB_API_KEY}
    volumes:
      - ./prompts:/app/prompts
      - ./logs:/app/logs
    deploy:
      replicas: 3
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
```

### Monitoring Setup

```bash
# Health check for customer service bot
curl -X POST http://localhost:24187/agents/health \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "customer_service_bot"}'

# Check recent performance metrics
curl -X GET http://localhost:24187/agents/customer_service_bot/metrics \
  -H "Authorization: Bearer your-api-key"
```

## Common Issues and Solutions

### Issue 1: Agent Doesn't Escalate Appropriately

**Problem**: Agent tries to handle issues that require human intervention

**Solution**: Refine escalation triggers in system prompt:

```python
escalation_triggers = """
ESCALATE IMMEDIATELY FOR:
- Refund requests over $100
- Security concerns (suspected fraud, unauthorized access)
- Legal threats or mentions of attorneys
- Technical issues after 2 failed troubleshooting attempts
- Customer uses profanity or becomes abusive
- Requests for supervisor or manager
- Complex account changes affecting multiple services
"""
```

### Issue 2: Inconsistent Information

**Problem**: Agent provides different answers for similar questions

**Solution**: Create a knowledge base integration:

```python
def get_consistent_answer(question_category):
    """Get standardized answers from knowledge base."""
    knowledge_base = {
        "password_reset": "To reset your password, visit our website and click 'Forgot Password', or I can send a reset link to your email on file.",
        "billing_cycle": "Your billing cycle runs from the 1st to the last day of each month. Charges appear 3-5 days after your cycle ends.",
        "refund_policy": "We offer full refunds within 30 days of purchase. Partial refunds may be available for unused portions of annual plans."
    }
    return knowledge_base.get(question_category, "Let me research that for you.")
```

## Next Steps

1. **Deploy the agent**: Use the configuration above to create your customer service bot
2. **Test thoroughly**: Run through various scenarios to ensure proper responses
3. **Monitor performance**: Track key metrics like resolution rate and customer satisfaction
4. **Iterate and improve**: Refine the system prompt based on real-world usage
5. **Scale up**: Add more agents or specialize for different departments

---

```{admonition} Need Help?
:class: tip

- **Additional Examples**: [Appointment Booking](appointment-booking), [Survey Bot](survey-bot)
- **Advanced Features**: [Multi-Agent Systems](../tutorials/multi-agent)
- **API Integration**: [REST API Guide](../api/rest-endpoints)
```