import json
import asyncio
from fastapi.testclient import TestClient

from backend.main import app
from backend.override_api import ACTIVE_SESSIONS
from backend import events

client = TestClient(app)

class DummySession:
    def __init__(self):
        self.injected = []
        self.awaiting_user_input = False
        self.query_prompt = None
    async def inject_assistant_text(self, text):
        self.injected.append(text)


def test_start_call_returns_twiml():
    resp = client.post('/start_call')
    assert resp.status_code == 200
    assert '<Response>' in resp.text


def test_override_text(monkeypatch):
    session = DummySession()
    ACTIVE_SESSIONS['CA1'] = session
    events_queue = asyncio.Queue()
    monkeypatch.setattr(events, 'publish_event', lambda sid, evt: events_queue.put_nowait(evt))

    resp = client.post('/override/text', json={'callSid': 'CA1', 'text': 'hi'})
    assert resp.json() == {'status': 'ok'}
    assert session.injected == ['hi']
    evt = events_queue.get_nowait()
    assert evt['type'] == 'assistant_override'

