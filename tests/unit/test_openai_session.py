import json
import pytest
from backend.openai_ws import OpenAISession


class DummyWS:
    def __init__(self):
        self.sent = []
        self.closed = False

    async def send(self, data):
        self.sent.append(data)

    async def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_session_api_compliance_fixes(monkeypatch):
    """Test that OpenAI session uses correct API format after compliance fixes."""
    ws = DummyWS()

    async def dummy_connect(url, extra_headers=None):
        # Verify the correct headers are being sent
        assert extra_headers["Authorization"].startswith("Bearer ")
        assert extra_headers["OpenAI-Beta"] == "realtime=v1"
        return ws

    monkeypatch.setattr("backend.openai_ws.connect", dummy_connect)

    async with OpenAISession() as session:
        await session.send_text("hello")
        await session.inject_assistant_text("override")
        await session.inject_supervisor_text("clarify")
        await session.cancel_response()

    # Test session configuration message (first message)
    session_config = json.loads(ws.sent[0])
    assert session_config["type"] == "session.update"
    assert "session" in session_config
    assert session_config["session"]["modalities"] == ["audio", "text"]
    assert session_config["session"]["instructions"] == "You are a helpful phone assistant."
    assert session_config["session"]["voice"] == "alloy"
    assert session_config["session"]["input_audio_format"] == "pcm16"
    assert session_config["session"]["output_audio_format"] == "pcm16"
    assert "turn_detection" in session_config["session"]
    assert session_config["session"]["turn_detection"]["type"] == "server_vad"
    assert "input_audio_transcription" in session_config["session"]
    assert session_config["session"]["input_audio_transcription"]["model"] == "whisper-1"

    # Test text message format (conversation.item.create)
    text_msg = json.loads(ws.sent[1])
    assert text_msg["type"] == "conversation.item.create"
    assert text_msg["item"]["type"] == "message"
    assert text_msg["item"]["role"] == "user"
    assert text_msg["item"]["content"][0]["type"] == "input_text"
    assert text_msg["item"]["content"][0]["text"] == "hello"

    # Test assistant override format
    assistant_msg = json.loads(ws.sent[2])
    assert assistant_msg["type"] == "conversation.item.create"
    assert assistant_msg["item"]["role"] == "assistant"
    assert assistant_msg["item"]["content"][0]["text"] == "override"

    # Test supervisor text format
    supervisor_msg = json.loads(ws.sent[3])
    assert supervisor_msg["type"] == "conversation.item.create"
    assert supervisor_msg["item"]["role"] == "user"
    assert supervisor_msg["item"]["content"][0]["text"] == "supervisor: clarify"

    # Test cancel response format
    cancel_msg = json.loads(ws.sent[4])
    assert cancel_msg["type"] == "response.cancel"

    assert ws.closed


@pytest.mark.asyncio 
async def test_session_backward_compatibility(monkeypatch):
    """Test that session still works with basic functionality."""
    ws = DummyWS()

    async def dummy_connect(url, extra_headers=None):
        return ws

    monkeypatch.setattr("backend.openai_ws.connect", dummy_connect)

    session = OpenAISession(
        model="gpt-4o-realtime-preview",
        system_prompt="Custom prompt",
        voice="nova"
    )
    
    async with session:
        await session.send_text("test message")

    # Verify session configuration uses custom values
    session_config = json.loads(ws.sent[0])
    assert session_config["session"]["instructions"] == "Custom prompt"
    assert session_config["session"]["voice"] == "nova"
    assert session_config["session"]["model"] == "gpt-4o-realtime-preview"


@pytest.mark.asyncio
async def test_session_history_tracking():
    """Test that session properly tracks conversation history."""
    session = OpenAISession()
    
    # Mock the websocket
    session.ws = DummyWS()
    
    await session.send_text("user message")
    await session.inject_assistant_text("assistant message") 
    await session.inject_supervisor_text("supervisor message")
    
    assert len(session.history) == 3
    assert session.history[0] == {"role": "user", "text": "user message"}
    assert session.history[1] == {"role": "assistant", "text": "assistant message"}
    assert session.history[2] == {"role": "supervisor", "text": "supervisor message"}
