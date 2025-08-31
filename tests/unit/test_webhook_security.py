import pytest
from unittest.mock import patch, Mock
from fastapi import HTTPException
from backend.main import validate_twilio_request


class MockRequest:
    """Mock FastAPI Request object for testing."""
    def __init__(self, headers=None, url="https://example.com/webhook"):
        self.headers = headers or {}
        self.url = url


def test_webhook_validation_with_valid_signature():
    """Test webhook validation with valid Twilio signature."""
    mock_validator = Mock()
    mock_validator.validate.return_value = True
    
    with patch('backend.main.request_validator', mock_validator):
        request = MockRequest(headers={'X-Twilio-Signature': 'valid_signature'})
        form_data = {'CallSid': 'CA123', 'From': '+15551234567'}
        
        result = validate_twilio_request(request, form_data)
        assert result is True
        
        # Verify validator was called with correct parameters
        mock_validator.validate.assert_called_once_with(
            str(request.url), 
            form_data, 
            'valid_signature'
        )


def test_webhook_validation_with_invalid_signature():
    """Test webhook validation with invalid Twilio signature."""
    mock_validator = Mock()
    mock_validator.validate.return_value = False
    
    with patch('backend.main.request_validator', mock_validator):
        request = MockRequest(headers={'X-Twilio-Signature': 'invalid_signature'})
        form_data = {'CallSid': 'CA123', 'From': '+15551234567'}
        
        result = validate_twilio_request(request, form_data)
        assert result is False


def test_webhook_validation_without_signature():
    """Test webhook validation when signature header is missing."""
    mock_validator = Mock()
    mock_validator.validate.return_value = False
    
    with patch('backend.main.request_validator', mock_validator):
        request = MockRequest(headers={})  # No signature header
        form_data = {'CallSid': 'CA123', 'From': '+15551234567'}
        
        result = validate_twilio_request(request, form_data)
        assert result is False
        
        # Verify validator was called with empty signature
        mock_validator.validate.assert_called_once_with(
            str(request.url),
            form_data,
            ''
        )


def test_webhook_validation_skips_when_no_validator():
    """Test that validation is skipped in development mode (no auth token)."""
    with patch('backend.main.request_validator', None):
        request = MockRequest()
        form_data = {}
        
        result = validate_twilio_request(request, form_data)
        assert result is True  # Should skip validation and return True


def test_webhook_endpoints_require_valid_signature(client):
    """Test that webhook endpoints validate signatures."""
    # Mock invalid signature validation
    with patch('backend.main.validate_twilio_request', return_value=False):
        response = client.post("/start_call", data={
            'CallSid': 'CA123',
            'From': '+15551234567',
            'To': '+15559876543'
        })
        assert response.status_code == 403
        assert response.json()["detail"] == "Invalid webhook signature"


def test_webhook_endpoints_accept_valid_signature(client):
    """Test that webhook endpoints accept valid signatures.""" 
    # Mock valid signature validation
    with patch('backend.main.validate_twilio_request', return_value=True):
        response = client.post("/start_call", data={
            'CallSid': 'CA123',
            'From': '+15551234567',
            'To': '+15559876543'
        })
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/xml"


def test_receive_call_endpoint_validation(client):
    """Test that receive_call endpoint also validates signatures."""
    # Mock invalid signature validation
    with patch('backend.main.validate_twilio_request', return_value=False):
        response = client.post("/receive_call", data={
            'CallSid': 'CA456',
            'From': '+15551234567',
            'To': '+15559876543'
        })
        assert response.status_code == 403
        assert response.json()["detail"] == "Invalid webhook signature"