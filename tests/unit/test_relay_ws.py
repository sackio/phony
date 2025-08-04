import json
import pytest
from backend import relay_ws
from backend import openai_ws


class DummyWS:
    def __init__(self):
        self.sent = []

    async def send_text(self, data):
        self.sent.append(data)

    async def receive_text(self):
        return self.sent.pop(0) if self.sent else ""


@pytest.mark.asyncio
async def test_send_text_executes_command(monkeypatch):
    monkeypatch.setattr(relay_ws.CallLogger, "log_command", lambda *a, **k: None)
    ws = DummyWS()
    intercept = relay_ws.InterceptWebSocket(ws)
    intercept.call_sid = "CA1"
    published = []
    monkeypatch.setattr(relay_ws, "publish_event", lambda sid, evt: published.append(evt))
    executed = []
    monkeypatch.setattr(relay_ws, "execute_command", lambda cmd, sid: executed.append((cmd.action, cmd.value)))

    await intercept.send_text(json.dumps({"text": "[[press:1]]", "last": True}))

    assert not ws.sent
    assert executed == [("press", "1")]
    assert published[0]["type"] == "command_executed"


@pytest.mark.asyncio
async def test_request_user_flow(monkeypatch):
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
