import asyncio
import pytest

from backend import events


@pytest.mark.asyncio
async def test_session_lifecycle():
    call_sid = "CA123"
    await events.start_session(call_sid)
    queue = events.subscribe(call_sid)
    start_evt = await queue.get()
    assert start_evt["type"] == "session_start"
    await events.publish_event(call_sid, {"type": "custom", "payload": 1})
    evt = await queue.get()
    assert evt == {"type": "custom", "payload": 1}
    await events.end_session(call_sid)
    end_evt = await queue.get()
    assert end_evt["type"] == "session_end"
    sentinel = await queue.get()
    assert sentinel is None


@pytest.mark.asyncio
async def test_subscribe_creates_queue():
    call_sid = "NEW123"
    queue = events.subscribe(call_sid)
    await events.publish_event(call_sid, {"type": "ping"})
    evt = await queue.get()
    assert evt["type"] == "ping"
