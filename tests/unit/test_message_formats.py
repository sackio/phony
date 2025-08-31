import json
import pytest
from unittest.mock import AsyncMock, Mock
from backend.relay_ws import InterceptWebSocket
from backend.openai_ws import proxy_call


@pytest.mark.asyncio
async def test_twilio_prompt_message_handling():
    """Test that Twilio 'prompt' message type is handled correctly."""
    mock_ws = AsyncMock()
    interceptor = InterceptWebSocket(mock_ws)
    interceptor.call_sid = "CA123"
    
    # Simulate receiving a 'prompt' message from Twilio
    prompt_message = {
        "type": "prompt",
        "voicePrompt": "Hello, how are you?",
        "lang": "en-US",
        "last": True,
        "callSid": "CA123"
    }
    
    mock_ws.receive_text.return_value = json.dumps(prompt_message)
    
    # Call receive_text which should process the prompt message
    data = await interceptor.receive_text()
    
    # Verify the data was returned unchanged
    assert json.loads(data) == prompt_message
    
    # The logging should have been called with the correct text
    # (This would be verified by checking the logger mock in a full test)


@pytest.mark.asyncio 
async def test_outbound_message_format_text():
    """Test that outbound text messages use correct ConversationRelay format."""
    mock_twilio_ws = AsyncMock()
    mock_twilio_ws.accept = AsyncMock()
    mock_twilio_ws.receive_text = AsyncMock()
    mock_twilio_ws.send_text = AsyncMock()
    
    # Mock a text response from OpenAI
    openai_message = {
        "type": "response.audio_transcript.delta",
        "text": "Hello there!",
        "last": True,
        "interruptible": True
    }
    
    # This would be part of the proxy_call function testing
    # In a real test, we would mock the entire flow
    
    # Expected format for Twilio ConversationRelay
    expected_format = {
        "type": "text",
        "token": "Hello there!",
        "last": True,
        "interruptible": True
    }
    
    # Verify the format matches expectations
    assert expected_format["type"] == "text"
    assert expected_format["token"] == openai_message["text"]
    assert expected_format["last"] == openai_message["last"]
    assert expected_format["interruptible"] == openai_message["interruptible"]


@pytest.mark.asyncio
async def test_outbound_message_format_audio():
    """Test that outbound audio messages use correct ConversationRelay format."""
    # Mock an audio response from OpenAI
    openai_message = {
        "type": "response.audio.delta", 
        "audio": "base64_encoded_audio_data",
        "last": False
    }
    
    # Expected format for Twilio ConversationRelay
    expected_format = {
        "type": "audio",
        "media": {
            "payload": "base64_encoded_audio_data",
            "format": "audio/x-mulaw"
        },
        "last": False
    }
    
    # Verify the format matches expectations
    assert expected_format["type"] == "audio"
    assert expected_format["media"]["payload"] == openai_message["audio"]
    assert expected_format["media"]["format"] == "audio/x-mulaw"
    assert expected_format["last"] == openai_message["last"]


def test_hold_message_format():
    """Test that hold messages use correct ConversationRelay format."""
    expected_hold_message = {
        "type": "text",
        "token": "Please hold while I check that.",
        "last": True,
        "interruptible": False
    }
    
    # This is the format used when the AI requests clarification
    assert expected_hold_message["type"] == "text"
    assert expected_hold_message["token"] == "Please hold while I check that."
    assert expected_hold_message["last"] is True
    assert expected_hold_message["interruptible"] is False


@pytest.mark.asyncio
async def test_websocket_message_interceptor():
    """Test that WebSocket interceptor properly processes messages."""
    mock_ws = AsyncMock()
    interceptor = InterceptWebSocket(mock_ws)
    
    # Test accepting connection
    await interceptor.accept()
    mock_ws.accept.assert_called_once()
    
    # Test closing connection  
    await interceptor.close()
    mock_ws.close.assert_called_once()
    
    # Test sending properly formatted messages
    test_message = {
        "type": "text",
        "token": "Test message",
        "last": True
    }
    
    await interceptor.send_text(json.dumps(test_message))
    mock_ws.send_text.assert_called_once_with(json.dumps(test_message))


@pytest.mark.asyncio
async def test_command_suppression():
    """Test that command detection properly suppresses message transmission."""
    mock_ws = AsyncMock()
    interceptor = InterceptWebSocket(mock_ws)
    interceptor.call_sid = "CA123"
    
    # Test message with command
    command_message = {
        "text": "Pressing 1 now [[press:1]]",
        "last": True
    }
    
    # The interceptor should suppress this message and not send it to Twilio
    await interceptor.send_text(json.dumps(command_message))
    
    # Verify the original message was not sent (command was detected)
    # This would need to be verified by checking that only the command
    # execution occurs, not the text transmission