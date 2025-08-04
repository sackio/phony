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
async def test_session_sends_and_closes(monkeypatch):
    ws = DummyWS()

    async def dummy_connect(url, extra_headers=None):
        return ws

    monkeypatch.setattr("backend.openai_ws.connect", dummy_connect)

    async with OpenAISession() as session:
        await session.send_text("hello")
        await session.inject_assistant_text("override")
        await session.inject_supervisor_text("clarify")
        await session.cancel_response()

    assert json.loads(ws.sent[0])["type"] == "start"
    assert json.loads(ws.sent[1]) == {"type": "text", "text": "hello"}
    assert json.loads(ws.sent[2]) == {"type": "assistant_override", "text": "override"}
    assert json.loads(ws.sent[3]) == {"type": "text", "text": "supervisor: clarify"}
    assert json.loads(ws.sent[4]) == {"type": "cancel"}
    assert ws.closed
