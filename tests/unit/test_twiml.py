import os
from unittest.mock import patch
from backend.twiml import conversation_relay_response
from tests.helpers import assert_conversation_relay


def test_conversation_relay_response_builds_twiml():
    """Test basic TwiML generation."""
    resp = conversation_relay_response()
    assert resp.media_type == 'application/xml'
    assert_conversation_relay(resp.body.decode())


def test_twiml_includes_provider_configuration():
    """Test that TwiML includes provider-specific configuration."""
    resp = conversation_relay_response()
    twiml_content = resp.body.decode()
    
    # Check for provider configurations added in API compliance fixes
    assert 'language="en-US"' in twiml_content
    assert 'tts_provider="google"' in twiml_content
    assert 'transcription_provider="deepgram"' in twiml_content
    assert 'dtmf_detection="true"' in twiml_content


def test_twiml_uses_environment_host():
    """Test that TwiML uses the correct WebSocket URL from environment."""
    with patch.dict(os.environ, {'HOST': 'custom.example.com'}):
        resp = conversation_relay_response()
        twiml_content = resp.body.decode()
        assert 'wss://custom.example.com/relay/ws' in twiml_content


def test_twiml_includes_welcome_greeting():
    """Test that TwiML includes welcome greeting configuration."""
    resp = conversation_relay_response()
    twiml_content = resp.body.decode()
    
    assert 'welcome_greeting="Hello, connecting you now"' in twiml_content
    assert 'welcome_greeting_interruptible="speech"' in twiml_content
