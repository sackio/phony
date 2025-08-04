import asyncio
import pytest

from backend import events


@pytest.mark.asyncio
async def test_events_websocket(client):
    sid = 'CAWS'
    queue = asyncio.Queue()
    events._queues[sid] = queue
    async def sender():
        await queue.put({'type': 'transcript', 'timestamp': 't', 'callSid': sid, 'speaker': 'caller', 'text': 'hi'})
        await asyncio.sleep(0.1)
        await queue.put(None)
    asyncio.create_task(sender())
    with client.websocket_connect(f'/events/ws?callSid={sid}') as ws:
        msg = ws.receive_json()
        assert msg['type'] == 'transcript'

