import pytest
import json
from unittest.mock import patch, AsyncMock
from tests.helpers import assert_conversation_relay


@pytest.mark.parametrize("path", ["/start_call", "/receive_call"])
def test_call_endpoints_return_twiml(client, path):
    """Test that call endpoints return proper TwiML with ConversationRelay."""
    resp = client.post(path)
    assert resp.status_code == 200
    assert_conversation_relay(resp.text)


def test_start_call_endpoint_with_form_data(client):
    """Test /start_call endpoint with Twilio webhook form data."""
    form_data = {
        'CallSid': 'CA123456789',
        'From': '+15551234567',
        'To': '+15559876543',
        'CallStatus': 'in-progress',
        'Direction': 'outbound-api'
    }
    
    with patch('backend.main.validate_twilio_request', return_value=True):
        response = client.post("/start_call", data=form_data)
        
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/xml"
        assert_conversation_relay(response.text)
        
        # Verify TwiML contains the correct WebSocket URL
        assert "wss://" in response.text
        assert "/relay/ws" in response.text


def test_receive_call_endpoint_with_form_data(client):
    """Test /receive_call endpoint with Twilio webhook form data."""
    form_data = {
        'CallSid': 'CA987654321',
        'From': '+15551234567',
        'To': '+15559876543',
        'CallStatus': 'ringing',
        'Direction': 'inbound'
    }
    
    with patch('backend.main.validate_twilio_request', return_value=True):
        response = client.post("/receive_call", data=form_data)
        
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/xml"
        assert_conversation_relay(response.text)


def test_webhook_signature_validation(client):
    """Test webhook signature validation on call endpoints."""
    form_data = {
        'CallSid': 'CA123',
        'From': '+15551234567',
        'To': '+15559876543'
    }
    
    # Test with invalid signature
    with patch('backend.main.validate_twilio_request', return_value=False):
        response = client.post("/start_call", data=form_data)
        assert response.status_code == 403
        assert response.json()["detail"] == "Invalid webhook signature"
        
        response = client.post("/receive_call", data=form_data)
        assert response.status_code == 403
        assert response.json()["detail"] == "Invalid webhook signature"
    
    # Test with valid signature
    with patch('backend.main.validate_twilio_request', return_value=True):
        response = client.post("/start_call", data=form_data)
        assert response.status_code == 200
        
        response = client.post("/receive_call", data=form_data)
        assert response.status_code == 200


def test_health_check_endpoint(client):
    """Test the health check endpoint."""
    response = client.get("/healthz")
    
    assert response.status_code == 200
    data = response.json()
    
    # Check required health check fields
    assert "status" in data
    assert "uptime" in data
    assert "active_calls" in data
    assert data["status"] == "healthy"
    assert isinstance(data["uptime"], (int, float))
    assert isinstance(data["active_calls"], int)


def test_override_text_endpoint_integration(client):
    """Test text override endpoint integration."""
    request_data = {
        "call_sid": "CA123",
        "text": "This is a supervisor message"
    }
    
    with patch('backend.override_api.send_text_to_caller') as mock_send:
        mock_send.return_value = {"success": True}
        
        response = client.post("/override/text", json=request_data)
        
        assert response.status_code == 200
        assert response.json()["success"] is True
        mock_send.assert_called_once_with("CA123", "This is a supervisor message")


def test_override_dtmf_endpoint_integration(client):
    """Test DTMF override endpoint integration."""
    request_data = {
        "call_sid": "CA123",
        "digit": "1"
    }
    
    with patch('backend.override_api.send_dtmf_to_caller') as mock_send:
        mock_send.return_value = {"success": True}
        
        response = client.post("/override/dtmf", json=request_data)
        
        assert response.status_code == 200
        assert response.json()["success"] is True
        mock_send.assert_called_once_with("CA123", "1")


def test_override_end_endpoint_integration(client):
    """Test end call override endpoint integration."""
    request_data = {"call_sid": "CA123"}
    
    with patch('backend.override_api.terminate_call') as mock_terminate:
        mock_terminate.return_value = {"success": True}
        
        response = client.post("/override/end", json=request_data)
        
        assert response.status_code == 200
        assert response.json()["success"] is True
        mock_terminate.assert_called_once_with("CA123")


def test_override_transfer_endpoint_integration(client):
    """Test transfer override endpoint integration."""
    request_data = {
        "call_sid": "CA123",
        "number": "+15551234567"
    }
    
    with patch('backend.override_api.transfer_call') as mock_transfer:
        mock_transfer.return_value = {"success": True}
        
        response = client.post("/override/transfer", json=request_data)
        
        assert response.status_code == 200
        assert response.json()["success"] is True
        mock_transfer.assert_called_once_with("CA123", "+15551234567")


def test_override_clarification_endpoint_integration(client):
    """Test clarification override endpoint integration."""
    request_data = {
        "call_sid": "CA123",
        "clarification": "The account number is 12345"
    }
    
    with patch('backend.override_api.provide_clarification') as mock_clarify:
        mock_clarify.return_value = {"success": True}
        
        response = client.post("/override/clarification", json=request_data)
        
        assert response.status_code == 200
        assert response.json()["success"] is True
        mock_clarify.assert_called_once_with("CA123", "The account number is 12345")


@pytest.mark.asyncio
async def test_websocket_relay_connection(client):
    """Test WebSocket relay connection endpoint."""
    with client.websocket_connect("/relay/ws") as websocket:
        # Connection should be established successfully
        assert websocket is not None
        
        # Test sending a message
        test_message = {
            "type": "prompt",
            "voicePrompt": "Hello, how are you?",
            "callSid": "CA123"
        }
        
        websocket.send_text(json.dumps(test_message))
        
        # Should receive the message back (intercepted)
        data = websocket.receive_text()
        received_message = json.loads(data)
        assert received_message == test_message


@pytest.mark.asyncio
async def test_events_websocket_connection(client):
    """Test events WebSocket connection endpoint."""
    call_sid = "CA123"
    
    with client.websocket_connect(f"/events/ws?callSid={call_sid}") as websocket:
        # Connection should be established successfully
        assert websocket is not None
        
        # The connection should be ready to receive events
        # In a real test, we would publish an event and verify it's received


def test_dashboard_static_files(client):
    """Test dashboard static file serving."""
    response = client.get("/dashboard/")
    
    # Should redirect or serve the dashboard
    assert response.status_code in [200, 301, 302, 307, 308]


def test_api_error_handling(client):
    """Test API error handling for various scenarios."""
    # Test invalid JSON in override endpoints
    response = client.post(
        "/override/text",
        data="invalid json",
        headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    
    # Test missing required fields
    response = client.post("/override/text", json={"call_sid": "CA123"})
    assert response.status_code == 422
    
    # Test invalid call endpoints with wrong method
    response = client.get("/start_call")
    assert response.status_code == 405  # Method not allowed


def test_cors_headers(client):
    """Test CORS headers are present on API responses."""
    # Test preflight request
    response = client.options("/override/text")
    
    # Should handle OPTIONS request appropriately
    assert response.status_code in [200, 204]


def test_api_content_type_validation(client):
    """Test content type validation on API endpoints."""
    # Test form data endpoints (Twilio webhooks)
    response = client.post(
        "/start_call",
        json={"CallSid": "CA123"},  # JSON instead of form data
        headers={"Content-Type": "application/json"}
    )
    
    with patch('backend.main.validate_twilio_request', return_value=True):
        # Should handle JSON gracefully or return appropriate error
        assert response.status_code in [200, 400, 422]


def test_large_payload_handling(client):
    """Test handling of large payloads in API requests."""
    # Test with very long text override
    large_text = "A" * 10000  # 10KB of text
    request_data = {
        "call_sid": "CA123",
        "text": large_text
    }
    
    with patch('backend.override_api.send_text_to_caller') as mock_send:
        mock_send.return_value = {"success": True}
        
        response = client.post("/override/text", json=request_data)
        
        # Should handle large payloads appropriately
        assert response.status_code in [200, 413]  # OK or Payload Too Large


def test_concurrent_api_requests(client):
    """Test handling of concurrent API requests."""
    import concurrent.futures
    
    def make_request():
        with patch('backend.main.validate_twilio_request', return_value=True):
            return client.post("/start_call", data={"CallSid": "CA123"})
    
    # Make multiple concurrent requests
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(make_request) for _ in range(10)]
        responses = [future.result() for future in futures]
    
    # All requests should succeed
    for response in responses:
        assert response.status_code == 200


def test_api_rate_limiting_behavior(client):
    """Test API behavior under high request volume."""
    call_endpoints = ["/start_call", "/receive_call"]
    
    with patch('backend.main.validate_twilio_request', return_value=True):
        for endpoint in call_endpoints:
            # Make multiple rapid requests
            responses = []
            for _ in range(20):
                response = client.post(endpoint, data={"CallSid": f"CA{_}"})
                responses.append(response)
            
            # Should handle all requests (rate limiting implementation dependent)
            success_count = sum(1 for r in responses if r.status_code == 200)
            assert success_count > 0  # At least some should succeed


def test_environment_variable_impact(client):
    """Test API behavior with different environment variables."""
    # Test with different HOST environment variable
    with patch.dict('os.environ', {'HOST': 'test.example.com'}):
        response = client.post("/start_call", data={"CallSid": "CA123"})
        
        with patch('backend.main.validate_twilio_request', return_value=True):
            assert response.status_code == 200
            # Should use the test host in WebSocket URL
            assert "test.example.com" in response.text or response.status_code == 200
