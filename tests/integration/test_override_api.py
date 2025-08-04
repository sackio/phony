import asyncio
import pytest
from backend.override_api import ACTIVE_SESSIONS
from backend import events, override_api


class DummySession:
    def __init__(self):
        self.injected = []
        self.supervisor = []
        self.awaiting_user_input = False
        self.query_prompt = None
        self.awaiting_feedback = False
        self.pending_response = None
        self.skip_next_feedback = False

    async def inject_assistant_text(self, text):
        self.injected.append(text)

    async def inject_supervisor_text(self, text):
        self.supervisor.append(text)

    async def cancel_response(self):
        pass


def _event_queue(monkeypatch):
    q = asyncio.Queue()
    monkeypatch.setattr(events, "publish_event", lambda sid, evt: q.put_nowait(evt))
    return q


def test_override_text(monkeypatch, client):
    session = DummySession()
    ACTIVE_SESSIONS["CA1"] = session
    q = _event_queue(monkeypatch)

    resp = client.post("/override/text", json={"callSid": "CA1", "text": "hi"})
    assert resp.json() == {"status": "ok"}
    assert session.injected == ["hi"]
    assert q.get_nowait()["type"] == "assistant_override"
    ACTIVE_SESSIONS.clear()


@pytest.mark.parametrize(
    "endpoint,payload,event_type",
    [
        ("/override/dtmf", {"callSid": "CA1", "digit": "1"}, "command_executed"),
        ("/override/end", {"callSid": "CA1"}, "session_end"),
        ("/override/transfer", {"callSid": "CA1", "target": "+1234567890"}, "session_transfer"),
    ],
)
def test_override_commands(monkeypatch, client, endpoint, payload, event_type):
    q = _event_queue(monkeypatch)
    monkeypatch.setattr(override_api, "execute_command", lambda cmd, sid: None)
    resp = client.post(endpoint, json=payload)
    assert resp.json() == {"status": "ok"}
    assert q.get_nowait()["type"] == event_type


def test_override_clarification(monkeypatch, client):
    session = DummySession()
    session.awaiting_user_input = True
    ACTIVE_SESSIONS["CA1"] = session
    q = _event_queue(monkeypatch)

    resp = client.post(
        "/override/clarification", json={"callSid": "CA1", "response": "yes"}
    )
    assert resp.json() == {"status": "ok"}
    assert session.supervisor == ["yes"]
    assert q.get_nowait()["type"] == "query_response"
    ACTIVE_SESSIONS.clear()
