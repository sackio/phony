import asyncio

from backend.override_api import ACTIVE_SESSIONS
from backend import events
from tests.helpers import assert_conversation_relay


class DummySession:
    def __init__(self):
        self.injected = []
        self.awaiting_user_input = False
        self.query_prompt = None
    async def inject_assistant_text(self, text):
        self.injected.append(text)


def test_start_call_returns_twiml(client):
    resp = client.post('/start_call')
    assert resp.status_code == 200
    assert_conversation_relay(resp.text)


def test_receive_call_returns_twiml(client):
    resp = client.post('/receive_call')
    assert resp.status_code == 200
    assert_conversation_relay(resp.text)


def test_override_text(monkeypatch, client):
    session = DummySession()
    ACTIVE_SESSIONS['CA1'] = session
    events_queue = asyncio.Queue()
    monkeypatch.setattr(events, 'publish_event', lambda sid, evt: events_queue.put_nowait(evt))

    resp = client.post('/override/text', json={'callSid': 'CA1', 'text': 'hi'})
    assert resp.json() == {'status': 'ok'}
    assert session.injected == ['hi']
    evt = events_queue.get_nowait()
    assert evt['type'] == 'assistant_override'

