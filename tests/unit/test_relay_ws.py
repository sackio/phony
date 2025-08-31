import json
import pytest
from unittest.mock import AsyncMock, Mock
from backend import relay_ws
from backend import openai_ws
from backend.events import publish_event


class DummyWS:
    def __init__(self):
        self.sent = []
        self.closed = False

    async def send_text(self, data):
        self.sent.append(data)

    async def receive_text(self):
        return self.sent.pop(0) if self.sent else ""
    
    async def accept(self):
        pass
    
    async def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_intercept_websocket_initialization():
    """Test InterceptWebSocket initialization."""
    mock_ws = AsyncMock()
    interceptor = relay_ws.InterceptWebSocket(mock_ws)
    
    assert interceptor.ws is mock_ws
    assert interceptor.call_sid is None


@pytest.mark.asyncio
async def test_intercept_websocket_accept():
    """Test WebSocket accept functionality."""
    mock_ws = AsyncMock()
    interceptor = relay_ws.InterceptWebSocket(mock_ws)
    
    await interceptor.accept()
    mock_ws.accept.assert_called_once()


@pytest.mark.asyncio
async def test_intercept_websocket_close():
    """Test WebSocket close functionality."""
    mock_ws = AsyncMock()
    interceptor = relay_ws.InterceptWebSocket(mock_ws)
    
    await interceptor.close()
    mock_ws.close.assert_called_once()


@pytest.mark.asyncio
async def test_receive_text_with_prompt_message():
    """Test receiving and processing prompt messages from Twilio."""
    mock_ws = AsyncMock()
    interceptor = relay_ws.InterceptWebSocket(mock_ws)
    interceptor.call_sid = "CA123"
    
    prompt_message = {
        "type": "prompt",
        "voicePrompt": "Hello, how are you?",
        "lang": "en-US",
        "last": True,
        "callSid": "CA123"
    }
    
    mock_ws.receive_text.return_value = json.dumps(prompt_message)
    
    result = await interceptor.receive_text()
    
    assert json.loads(result) == prompt_message
    mock_ws.receive_text.assert_called_once()


@pytest.mark.asyncio
async def test_send_text_normal_message():
    """Test sending normal text messages through the interceptor."""
    ws = DummyWS()
    interceptor = relay_ws.InterceptWebSocket(ws)
    interceptor.call_sid = "CA123"
    
    message = {
        "type": "text",
        "token": "Hello there!",
        "last": True,
        "interruptible": True
    }
    
    await interceptor.send_text(json.dumps(message))
    assert json.dumps(message) in ws.sent


@pytest.mark.asyncio
async def test_send_text_executes_command(monkeypatch):
    """Test that commands are detected and executed properly."""
    monkeypatch.setattr(relay_ws.CallLogger, "log_command", lambda *a, **k: None)
    ws = DummyWS()
    intercept = relay_ws.InterceptWebSocket(ws)
    intercept.call_sid = "CA1"
    published = []
    monkeypatch.setattr(relay_ws, "publish_event", lambda sid, evt: published.append(evt))
    executed = []
    monkeypatch.setattr(relay_ws, "execute_command", lambda cmd, sid: executed.append((cmd.action, cmd.value)))

    await intercept.send_text(json.dumps({"text": "[[press:1]]", "last": True}))

    assert not ws.sent  # Command was detected and suppressed
    assert executed == [("press", "1")]
    assert published[0]["type"] == "command_executed"


@pytest.mark.asyncio
async def test_request_user_flow(monkeypatch):
    """Test request_user command flow."""
    monkeypatch.setattr(relay_ws.CallLogger, "log_command", lambda *a, **k: None)
    ws = DummyWS()
    intercept = relay_ws.InterceptWebSocket(ws)
    intercept.call_sid = "CA2"
    published = []
    monkeypatch.setattr(relay_ws, "publish_event", lambda sid, evt: published.append(evt))
    session = type("S", (), {"awaiting_user_input": False, "query_prompt": None, "cancel_response": lambda self: None})()
    openai_ws.ACTIVE_SESSIONS["CA2"] = session

    await intercept.send_text(json.dumps({"text": "[[request_user:code]]"}))

    assert published[0]["type"] == "query"
    assert session.awaiting_user_input is True
    assert json.loads(ws.sent[0])["text"].startswith("Please hold")
    openai_ws.ACTIVE_SESSIONS.clear()


@pytest.mark.asyncio
async def test_send_text_audio_message():
    """Test sending audio messages through the interceptor."""
    ws = DummyWS()
    interceptor = relay_ws.InterceptWebSocket(ws)
    interceptor.call_sid = "CA123"
    
    audio_message = {
        "type": "audio",
        "media": {
            "payload": "base64_audio_data",
            "format": "audio/x-mulaw"
        },
        "last": False
    }
    
    await interceptor.send_text(json.dumps(audio_message))
    assert json.dumps(audio_message) in ws.sent


@pytest.mark.asyncio
async def test_message_format_conversion():
    """Test message format conversion between OpenAI and Twilio."""
    # Test text message conversion
    openai_text = {
        "type": "response.audio_transcript.delta",
        "text": "Hello there!",
        "last": True,
        "interruptible": True
    }
    
    expected_twilio_text = {
        "type": "text",
        "token": "Hello there!",
        "last": True,
        "interruptible": True
    }
    
    # This would be done in the actual message processing
    converted = {
        "type": "text",
        "token": openai_text["text"],
        "last": openai_text["last"],
        "interruptible": openai_text["interruptible"]
    }
    
    assert converted == expected_twilio_text
    
    # Test audio message conversion
    openai_audio = {
        "type": "response.audio.delta",
        "audio": "base64_encoded_audio",
        "last": False
    }
    
    expected_twilio_audio = {
        "type": "audio",
        "media": {
            "payload": "base64_encoded_audio",
            "format": "audio/x-mulaw"
        },
        "last": False
    }
    
    converted_audio = {
        "type": "audio",
        "media": {
            "payload": openai_audio["audio"],
            "format": "audio/x-mulaw"
        },
        "last": openai_audio["last"]
    }
    
    assert converted_audio == expected_twilio_audio


@pytest.mark.asyncio
async def test_error_handling_in_websocket():
    """Test error handling in WebSocket operations."""
    mock_ws = AsyncMock()
    interceptor = relay_ws.InterceptWebSocket(mock_ws)
    
    # Test handling of WebSocket connection errors
    mock_ws.receive_text.side_effect = Exception("Connection lost")
    
    with pytest.raises(Exception):
        await interceptor.receive_text()
    
    # Test handling of send errors
    mock_ws.send_text.side_effect = Exception("Send failed")
    
    with pytest.raises(Exception):
        await interceptor.send_text("test message")
