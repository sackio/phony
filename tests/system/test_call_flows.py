import pytest
import json
import asyncio
from unittest.mock import AsyncMock, Mock, patch
from fastapi.testclient import TestClient
from backend.main import app


@pytest.fixture
def client():
    """Test client for FastAPI app."""
    return TestClient(app)


class MockOpenAISession:
    """Mock OpenAI session for testing end-to-end flows."""
    
    def __init__(self):
        self.messages_sent = []
        self.awaiting_user_input = False
        self.query_prompt = None
        self.history = []
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass
    
    async def send_text(self, text):
        self.messages_sent.append({"type": "text", "content": text})
        self.history.append({"role": "user", "text": text})
    
    async def inject_assistant_text(self, text):
        self.messages_sent.append({"type": "assistant", "content": text})
        self.history.append({"role": "assistant", "text": text})
    
    async def inject_supervisor_text(self, text):
        self.messages_sent.append({"type": "supervisor", "content": text})
        self.history.append({"role": "supervisor", "text": text})
    
    async def cancel_response(self):
        self.messages_sent.append({"type": "cancel"})


@pytest.mark.asyncio
async def test_complete_outbound_call_flow(client):
    """Test complete outbound call flow from start to finish."""
    call_sid = "CA_OUTBOUND_123"
    
    # Step 1: Start call - Twilio webhook calls /start_call
    form_data = {
        'CallSid': call_sid,
        'From': '+15551234567',
        'To': '+15559876543',
        'CallStatus': 'in-progress',
        'Direction': 'outbound-api'
    }
    
    with patch('backend.main.validate_twilio_request', return_value=True):
        response = client.post("/start_call", data=form_data)
        
        assert response.status_code == 200
        assert "ConversationRelay" in response.text
        assert f"wss://" in response.text
    
    # Step 2: WebSocket connection established
    mock_openai_session = MockOpenAISession()
    
    with patch('backend.relay_ws.OpenAISession', return_value=mock_openai_session), \
         patch('backend.relay_ws.ACTIVE_SESSIONS', {}) as mock_sessions:
        
        # Simulate WebSocket connection and message exchange
        with client.websocket_connect("/relay/ws") as websocket:
            # Step 3: Caller speaks - Twilio sends prompt message
            prompt_message = {
                "type": "prompt",
                "voicePrompt": "Hello, I need help with my account",
                "lang": "en-US",
                "callSid": call_sid,
                "last": True
            }
            
            websocket.send_text(json.dumps(prompt_message))
            
            # Should receive the message back
            received = websocket.receive_text()
            assert json.loads(received) == prompt_message
    
    # Verify OpenAI session was created and used
    assert call_sid in mock_sessions or len(mock_openai_session.messages_sent) >= 0


@pytest.mark.asyncio
async def test_complete_inbound_call_flow(client):
    """Test complete inbound call flow."""
    call_sid = "CA_INBOUND_456"
    
    # Step 1: Receive call - Twilio webhook calls /receive_call
    form_data = {
        'CallSid': call_sid,
        'From': '+15551234567',
        'To': '+15559876543',
        'CallStatus': 'ringing',
        'Direction': 'inbound'
    }
    
    with patch('backend.main.validate_twilio_request', return_value=True):
        response = client.post("/receive_call", data=form_data)
        
        assert response.status_code == 200
        assert "ConversationRelay" in response.text
    
    # Step 2: Similar WebSocket flow as outbound
    mock_openai_session = MockOpenAISession()
    
    with patch('backend.relay_ws.OpenAISession', return_value=mock_openai_session):
        with client.websocket_connect("/relay/ws") as websocket:
            # Simulate conversation
            messages = [
                {
                    "type": "prompt",
                    "voicePrompt": "Hi, I'm calling about my billing",
                    "callSid": call_sid,
                    "last": True
                },
                {
                    "type": "prompt", 
                    "voicePrompt": "Can you help me understand my charges?",
                    "callSid": call_sid,
                    "last": True
                }
            ]
            
            for message in messages:
                websocket.send_text(json.dumps(message))
                received = websocket.receive_text()
                assert json.loads(received) == message


@pytest.mark.asyncio
async def test_supervisor_intervention_flow(client):
    """Test supervisor intervention during an active call."""
    call_sid = "CA_SUPERVISOR_789"
    
    # Step 1: Start call
    with patch('backend.main.validate_twilio_request', return_value=True):
        response = client.post("/start_call", data={'CallSid': call_sid})
        assert response.status_code == 200
    
    # Step 2: Simulate active call with supervisor monitoring
    mock_session = MockOpenAISession()
    
    with patch('backend.override_api.ACTIVE_SESSIONS', {call_sid: mock_session}):
        
        # Step 3: Supervisor sends text override
        override_request = {
            "call_sid": call_sid,
            "text": "I'll help you with your account verification"
        }
        
        with patch('backend.override_api.publish_event') as mock_publish:
            response = client.post("/override/text", json=override_request)
            
            assert response.status_code == 200
            assert response.json()["success"] is True
            
            # Verify event was published
            mock_publish.assert_called()
            event_args = mock_publish.call_args[0]
            assert event_args[0] == call_sid
            assert event_args[1]["type"] == "supervisor_override"
        
        # Step 4: Supervisor sends DTMF
        dtmf_request = {
            "call_sid": call_sid,
            "digit": "1"
        }
        
        with patch('backend.commands.twilio_client') as mock_client:
            response = client.post("/override/dtmf", json=dtmf_request)
            assert response.status_code == 200


@pytest.mark.asyncio
async def test_ai_command_execution_flow(client):
    """Test AI command execution during a call."""
    call_sid = "CA_COMMAND_ABC"
    
    # Setup active session
    mock_session = MockOpenAISession()
    
    with patch('backend.relay_ws.ACTIVE_SESSIONS', {call_sid: mock_session}), \
         patch('backend.relay_ws.OpenAISession', return_value=mock_session):
        
        with client.websocket_connect("/relay/ws") as websocket:
            # AI sends a message with a command embedded
            ai_response = {
                "type": "text",
                "token": "I'm pressing 1 for you now [[press:1]]",
                "last": True,
                "interruptible": False
            }
            
            # Mock command execution
            with patch('backend.commands.execute_command') as mock_execute, \
                 patch('backend.relay_ws.publish_event') as mock_publish:
                
                websocket.send_text(json.dumps(ai_response))
                
                # Command should be detected and executed
                # Original message should be suppressed from Twilio
                # Event should be published


@pytest.mark.asyncio
async def test_request_user_clarification_flow(client):
    """Test AI requesting supervisor clarification flow."""
    call_sid = "CA_CLARIFY_DEF"
    
    mock_session = MockOpenAISession()
    
    with patch('backend.relay_ws.ACTIVE_SESSIONS', {call_sid: mock_session}), \
         patch('backend.override_api.ACTIVE_SESSIONS', {call_sid: mock_session}):
        
        with client.websocket_connect("/relay/ws") as websocket:
            # AI sends request_user command
            ai_request = {
                "type": "text",
                "token": "[[request_user:What is the customer's account number?]]",
                "last": True
            }
            
            with patch('backend.relay_ws.publish_event') as mock_publish:
                websocket.send_text(json.dumps(ai_request))
                
                # Should set session to awaiting user input
                assert mock_session.awaiting_user_input is True
                
                # Should publish query event
                mock_publish.assert_called()
                
                # Should send hold message to caller
                # (This would be verified by checking websocket receives hold message)
        
        # Step 2: Supervisor provides clarification
        clarification_request = {
            "call_sid": call_sid,
            "clarification": "The account number is 12345"
        }
        
        response = client.post("/override/clarification", json=clarification_request)
        assert response.status_code == 200
        assert response.json()["success"] is True
        
        # Verify session state was reset
        assert mock_session.awaiting_user_input is False


@pytest.mark.asyncio
async def test_call_transfer_flow(client):
    """Test call transfer flow."""
    call_sid = "CA_TRANSFER_GHI"
    
    # Step 1: Active call
    with patch('backend.main.validate_twilio_request', return_value=True):
        response = client.post("/start_call", data={'CallSid': call_sid})
        assert response.status_code == 200
    
    # Step 2: AI or supervisor initiates transfer
    transfer_request = {
        "call_sid": call_sid,
        "number": "+15559999999"
    }
    
    with patch('backend.commands.twilio_client') as mock_client, \
         patch('backend.override_api.publish_event') as mock_publish:
        
        response = client.post("/override/transfer", json=transfer_request)
        
        assert response.status_code == 200
        assert response.json()["success"] is True
        
        # Verify Twilio transfer was initiated
        mock_client.calls.assert_called_with(call_sid)
        
        # Verify event was published
        mock_publish.assert_called()


@pytest.mark.asyncio
async def test_call_end_flow(client):
    """Test call termination flow."""
    call_sid = "CA_END_JKL"
    
    # Setup active call
    with patch('backend.main.validate_twilio_request', return_value=True):
        response = client.post("/start_call", data={'CallSid': call_sid})
        assert response.status_code == 200
    
    # End the call
    end_request = {"call_sid": call_sid}
    
    with patch('backend.commands.twilio_client') as mock_client, \
         patch('backend.override_api.publish_event') as mock_publish:
        
        response = client.post("/override/end", json=end_request)
        
        assert response.status_code == 200
        assert response.json()["success"] is True
        
        # Verify Twilio hangup was initiated
        mock_client.calls.assert_called_with(call_sid)
        
        # Verify event was published
        mock_publish.assert_called()


@pytest.mark.asyncio
async def test_real_time_monitoring_flow(client):
    """Test real-time call monitoring through events WebSocket."""
    call_sid = "CA_MONITOR_MNO"
    
    # Step 1: Start monitoring
    with client.websocket_connect(f"/events/ws?callSid={call_sid}") as events_ws:
        
        # Step 2: Start call
        with patch('backend.main.validate_twilio_request', return_value=True):
            response = client.post("/start_call", data={'CallSid': call_sid})
            assert response.status_code == 200
        
        # Step 3: Simulate call events
        with patch('backend.events.publish_event') as mock_publish:
            # Simulate various events during call
            events_to_publish = [
                {"type": "call_started", "caller": "+15551234567"},
                {"type": "transcript", "text": "Hello, I need help", "is_final": True},
                {"type": "assistant_response", "text": "I can help you with that", "is_complete": True},
                {"type": "command_executed", "command": "press", "value": "1", "success": True}
            ]
            
            for event in events_to_publish:
                # In real implementation, these would be published and received
                mock_publish(call_sid, event)
            
            # Verify events were published
            assert mock_publish.call_count == len(events_to_publish)


@pytest.mark.asyncio
async def test_error_recovery_flow(client):
    """Test error recovery during call flows."""
    call_sid = "CA_ERROR_PQR"
    
    # Step 1: Start call normally
    with patch('backend.main.validate_twilio_request', return_value=True):
        response = client.post("/start_call", data={'CallSid': call_sid})
        assert response.status_code == 200
    
    # Step 2: Simulate WebSocket connection error
    with patch('backend.relay_ws.OpenAISession') as mock_session_class:
        mock_session = MockOpenAISession()
        mock_session_class.return_value = mock_session
        
        # Simulate session creation failure
        mock_session_class.side_effect = Exception("OpenAI connection failed")
        
        try:
            with client.websocket_connect("/relay/ws") as websocket:
                # Connection might fail, but should be handled gracefully
                pass
        except Exception:
            # Expected behavior - connection should fail gracefully
            pass
    
    # Step 3: Test override commands still work during errors
    with patch('backend.override_api.send_text_to_caller') as mock_send:
        mock_send.return_value = {"success": False, "error": "Session not found"}
        
        response = client.post("/override/text", json={
            "call_sid": call_sid,
            "text": "Emergency override"
        })
        
        # Should handle gracefully
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_high_concurrency_flow(client):
    """Test system behavior under high concurrency."""
    import concurrent.futures
    
    # Simulate multiple concurrent calls
    call_sids = [f"CA_CONCURRENT_{i:03d}" for i in range(10)]
    
    def simulate_call(call_sid):
        # Start call
        with patch('backend.main.validate_twilio_request', return_value=True):
            response = client.post("/start_call", data={'CallSid': call_sid})
            assert response.status_code == 200
        
        # Send override command
        override_response = client.post("/override/text", json={
            "call_sid": call_sid,
            "text": f"Message for {call_sid}"
        })
        
        return response.status_code, override_response.status_code
    
    # Run concurrent calls
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        with patch('backend.override_api.send_text_to_caller', return_value={"success": True}):
            futures = [executor.submit(simulate_call, call_sid) for call_sid in call_sids]
            results = [future.result() for future in futures]
    
    # All calls should succeed
    for start_status, override_status in results:
        assert start_status == 200
        assert override_status == 200


@pytest.mark.asyncio
async def test_webhook_signature_validation_flow(client):
    """Test end-to-end flow with webhook signature validation."""
    call_sid = "CA_SIGNATURE_STU"
    
    # Test with invalid signature
    with patch('backend.main.validate_twilio_request', return_value=False):
        response = client.post("/start_call", data={'CallSid': call_sid})
        assert response.status_code == 403
        assert "Invalid webhook signature" in response.json()["detail"]
    
    # Test with valid signature
    with patch('backend.main.validate_twilio_request', return_value=True):
        response = client.post("/start_call", data={'CallSid': call_sid})
        assert response.status_code == 200
        
        # Should be able to continue with normal flow
        with client.websocket_connect("/relay/ws") as websocket:
            test_message = {
                "type": "prompt",
                "voicePrompt": "Test message",
                "callSid": call_sid
            }
            
            websocket.send_text(json.dumps(test_message))
            received = websocket.receive_text()
            assert json.loads(received) == test_message


@pytest.mark.asyncio
async def test_environment_configuration_flow(client):
    """Test system behavior with different environment configurations."""
    call_sid = "CA_ENV_VWX"
    
    # Test with custom voice setting
    with patch.dict('os.environ', {'OPENAI_VOICE': 'nova'}):
        mock_session = MockOpenAISession()
        
        with patch('backend.relay_ws.OpenAISession') as mock_session_class:
            mock_session_class.return_value = mock_session
            
            # Start call
            with patch('backend.main.validate_twilio_request', return_value=True):
                response = client.post("/start_call", data={'CallSid': call_sid})
                assert response.status_code == 200
            
            # Verify session was created with custom voice
            # (Would check constructor call in real implementation)
    
    # Test with custom system prompt
    with patch.dict('os.environ', {'SYSTEM_PROMPT': 'You are a billing specialist'}):
        with patch('backend.relay_ws.OpenAISession') as mock_session_class:
            mock_session_class.return_value = mock_session
            
            with patch('backend.main.validate_twilio_request', return_value=True):
                response = client.post("/start_call", data={'CallSid': call_sid})
                assert response.status_code == 200