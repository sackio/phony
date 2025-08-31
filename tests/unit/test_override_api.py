import pytest
import json
from unittest.mock import AsyncMock, Mock, patch
from fastapi.testclient import TestClient
from backend.main import app
from backend.override_api import (
    TextOverrideRequest,
    DTMFOverrideRequest,
    TransferRequest,
    ClarificationRequest
)


@pytest.fixture
def client():
    """Test client for FastAPI app."""
    return TestClient(app)


def test_text_override_request_model():
    """Test TextOverrideRequest model validation."""
    # Valid request
    valid_request = TextOverrideRequest(
        call_sid="CA123",
        text="Hello, this is a supervisor message"
    )
    assert valid_request.call_sid == "CA123"
    assert valid_request.text == "Hello, this is a supervisor message"
    
    # Test with empty text should be valid
    empty_text_request = TextOverrideRequest(call_sid="CA123", text="")
    assert empty_text_request.text == ""


def test_dtmf_override_request_model():
    """Test DTMFOverrideRequest model validation."""
    # Valid single digit
    valid_request = DTMFOverrideRequest(call_sid="CA123", digit="1")
    assert valid_request.call_sid == "CA123"
    assert valid_request.digit == "1"
    
    # Valid special characters
    star_request = DTMFOverrideRequest(call_sid="CA123", digit="*")
    assert star_request.digit == "*"
    
    hash_request = DTMFOverrideRequest(call_sid="CA123", digit="#")
    assert hash_request.digit == "#"


def test_transfer_request_model():
    """Test TransferRequest model validation."""
    # Valid phone number
    valid_request = TransferRequest(
        call_sid="CA123",
        number="+15551234567"
    )
    assert valid_request.call_sid == "CA123"
    assert valid_request.number == "+15551234567"
    
    # Test with different number formats
    formats_to_test = [
        "+1-555-123-4567",
        "15551234567",
        "+1 (555) 123-4567"
    ]
    
    for number_format in formats_to_test:
        request = TransferRequest(call_sid="CA123", number=number_format)
        assert request.number == number_format


def test_clarification_request_model():
    """Test ClarificationRequest model validation."""
    # Valid request
    valid_request = ClarificationRequest(
        call_sid="CA123",
        clarification="The customer's account number is 12345"
    )
    assert valid_request.call_sid == "CA123"
    assert valid_request.clarification == "The customer's account number is 12345"


@pytest.mark.asyncio
async def test_send_text_override_endpoint(client):
    """Test POST /override/text endpoint."""
    request_data = {
        "call_sid": "CA123",
        "text": "This is a supervisor override message"
    }
    
    with patch('backend.override_api.send_text_to_caller') as mock_send_text:
        mock_send_text.return_value = {"success": True}
        
        response = client.post("/override/text", json=request_data)
        
        assert response.status_code == 200
        assert response.json() == {"success": True}
        
        mock_send_text.assert_called_once_with("CA123", "This is a supervisor override message")


@pytest.mark.asyncio 
async def test_send_dtmf_override_endpoint(client):
    """Test POST /override/dtmf endpoint."""
    request_data = {
        "call_sid": "CA123",
        "digit": "1"
    }
    
    with patch('backend.override_api.send_dtmf_to_caller') as mock_send_dtmf:
        mock_send_dtmf.return_value = {"success": True}
        
        response = client.post("/override/dtmf", json=request_data)
        
        assert response.status_code == 200
        assert response.json() == {"success": True}
        
        mock_send_dtmf.assert_called_once_with("CA123", "1")


@pytest.mark.asyncio
async def test_end_call_override_endpoint(client):
    """Test POST /override/end endpoint."""
    request_data = {"call_sid": "CA123"}
    
    with patch('backend.override_api.terminate_call') as mock_terminate:
        mock_terminate.return_value = {"success": True}
        
        response = client.post("/override/end", json=request_data)
        
        assert response.status_code == 200
        assert response.json() == {"success": True}
        
        mock_terminate.assert_called_once_with("CA123")


@pytest.mark.asyncio
async def test_transfer_call_endpoint(client):
    """Test POST /override/transfer endpoint."""
    request_data = {
        "call_sid": "CA123",
        "number": "+15551234567"
    }
    
    with patch('backend.override_api.transfer_call') as mock_transfer:
        mock_transfer.return_value = {"success": True}
        
        response = client.post("/override/transfer", json=request_data)
        
        assert response.status_code == 200
        assert response.json() == {"success": True}
        
        mock_transfer.assert_called_once_with("CA123", "+15551234567")


@pytest.mark.asyncio
async def test_send_clarification_endpoint(client):
    """Test POST /override/clarification endpoint."""
    request_data = {
        "call_sid": "CA123",
        "clarification": "The account number is 12345"
    }
    
    with patch('backend.override_api.provide_clarification') as mock_clarify:
        mock_clarify.return_value = {"success": True}
        
        response = client.post("/override/clarification", json=request_data)
        
        assert response.status_code == 200
        assert response.json() == {"success": True}
        
        mock_clarify.assert_called_once_with("CA123", "The account number is 12345")


def test_invalid_request_data(client):
    """Test endpoints with invalid request data."""
    # Test text endpoint with missing call_sid
    invalid_text_request = {"text": "Hello"}
    response = client.post("/override/text", json=invalid_text_request)
    assert response.status_code == 422  # Validation error
    
    # Test dtmf endpoint with missing digit
    invalid_dtmf_request = {"call_sid": "CA123"}
    response = client.post("/override/dtmf", json=invalid_dtmf_request)
    assert response.status_code == 422
    
    # Test transfer endpoint with missing number
    invalid_transfer_request = {"call_sid": "CA123"}
    response = client.post("/override/transfer", json=invalid_transfer_request)
    assert response.status_code == 422


def test_empty_request_body(client):
    """Test endpoints with empty request body."""
    endpoints = [
        "/override/text",
        "/override/dtmf", 
        "/override/end",
        "/override/transfer",
        "/override/clarification"
    ]
    
    for endpoint in endpoints:
        response = client.post(endpoint, json={})
        assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_send_text_to_caller_function():
    """Test the send_text_to_caller function directly."""
    call_sid = "CA123"
    text = "Supervisor message"
    
    # Mock the WebSocket sending
    mock_ws = AsyncMock()
    
    with patch('backend.override_api.ACTIVE_SESSIONS', {call_sid: mock_ws}):
        with patch('backend.override_api.publish_event') as mock_publish:
            from backend.override_api import send_text_to_caller
            
            result = await send_text_to_caller(call_sid, text)
            
            assert result["success"] is True
            mock_publish.assert_called()
            
            # Verify the event was published
            call_args = mock_publish.call_args[0]
            assert call_args[0] == call_sid
            assert call_args[1]["type"] == "supervisor_override"


@pytest.mark.asyncio
async def test_send_dtmf_to_caller_function():
    """Test the send_dtmf_to_caller function directly."""
    call_sid = "CA123"
    digit = "1"
    
    with patch('backend.override_api.send_dtmf_digit') as mock_send_dtmf:
        with patch('backend.override_api.publish_event') as mock_publish:
            from backend.override_api import send_dtmf_to_caller
            
            result = await send_dtmf_to_caller(call_sid, digit)
            
            assert result["success"] is True
            mock_send_dtmf.assert_called_once_with(call_sid, digit)
            mock_publish.assert_called()


@pytest.mark.asyncio
async def test_terminate_call_function():
    """Test the terminate_call function directly."""
    call_sid = "CA123"
    
    with patch('backend.override_api.end_call') as mock_end_call:
        with patch('backend.override_api.publish_event') as mock_publish:
            from backend.override_api import terminate_call
            
            result = await terminate_call(call_sid)
            
            assert result["success"] is True
            mock_end_call.assert_called_once_with(call_sid)
            mock_publish.assert_called()


@pytest.mark.asyncio
async def test_transfer_call_function():
    """Test the transfer_call function directly."""
    call_sid = "CA123"
    number = "+15551234567"
    
    with patch('backend.override_api.initiate_transfer') as mock_transfer:
        with patch('backend.override_api.publish_event') as mock_publish:
            from backend.override_api import transfer_call
            
            result = await transfer_call(call_sid, number)
            
            assert result["success"] is True
            mock_transfer.assert_called_once_with(call_sid, number)
            mock_publish.assert_called()


@pytest.mark.asyncio
async def test_provide_clarification_function():
    """Test the provide_clarification function directly."""
    call_sid = "CA123"
    clarification = "The account number is 12345"
    
    mock_session = Mock()
    mock_session.awaiting_user_input = True
    mock_session.query_prompt = "What is the account number?"
    mock_session.inject_supervisor_text = AsyncMock()
    
    with patch('backend.override_api.ACTIVE_SESSIONS', {call_sid: mock_session}):
        with patch('backend.override_api.publish_event') as mock_publish:
            from backend.override_api import provide_clarification
            
            result = await provide_clarification(call_sid, clarification)
            
            assert result["success"] is True
            mock_session.inject_supervisor_text.assert_called_once_with(clarification)
            mock_publish.assert_called()
            
            # Verify session state was reset
            assert mock_session.awaiting_user_input is False
            assert mock_session.query_prompt is None


@pytest.mark.asyncio
async def test_function_error_handling():
    """Test error handling in override functions."""
    call_sid = "CA123"
    
    # Test send_text_to_caller with no active session
    with patch('backend.override_api.ACTIVE_SESSIONS', {}):
        from backend.override_api import send_text_to_caller
        
        result = await send_text_to_caller(call_sid, "test")
        assert result["success"] is False
        assert "error" in result
    
    # Test provide_clarification with session not awaiting input
    mock_session = Mock()
    mock_session.awaiting_user_input = False
    
    with patch('backend.override_api.ACTIVE_SESSIONS', {call_sid: mock_session}):
        from backend.override_api import provide_clarification
        
        result = await provide_clarification(call_sid, "clarification")
        assert result["success"] is False
        assert "not awaiting" in result["error"]


def test_request_model_with_special_characters():
    """Test request models with special characters and edge cases."""
    # Test text with special characters
    text_request = TextOverrideRequest(
        call_sid="CA123",
        text="Hello! This message has émojis 🎉 and special chars: @#$%^&*()"
    )
    assert "émojis 🎉" in text_request.text
    
    # Test very long text
    long_text = "A" * 1000
    long_text_request = TextOverrideRequest(call_sid="CA123", text=long_text)
    assert len(long_text_request.text) == 1000
    
    # Test clarification with multiline text
    multiline_clarification = ClarificationRequest(
        call_sid="CA123",
        clarification="Line 1\nLine 2\nLine 3"
    )
    assert "\n" in multiline_clarification.clarification


def test_concurrent_override_requests(client):
    """Test handling of concurrent override requests."""
    import concurrent.futures
    
    call_sid = "CA123"
    
    def make_text_request(i):
        return client.post("/override/text", json={"call_sid": call_sid, "text": f"Message {i}"})
    
    def make_dtmf_request(i):
        return client.post("/override/dtmf", json={"call_sid": call_sid, "digit": str(i % 10)})
    
    # Mock all override functions
    with patch('backend.override_api.send_text_to_caller') as mock_send_text, \
         patch('backend.override_api.send_dtmf_to_caller') as mock_send_dtmf:
        
        mock_send_text.return_value = {"success": True}
        mock_send_dtmf.return_value = {"success": True}
        
        # Send multiple requests concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = []
            for i in range(5):
                futures.append(executor.submit(make_text_request, i))
                futures.append(executor.submit(make_dtmf_request, i))
            
            responses = [future.result() for future in futures]
        
        # All requests should succeed
        for response in responses:
            assert response.status_code == 200
            assert response.json()["success"] is True