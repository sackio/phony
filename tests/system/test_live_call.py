import os
import pytest

from tests.helpers import assert_conversation_relay


@pytest.mark.skipif(
    not os.getenv('LIVE_TESTS'),
    reason='Set LIVE_TESTS=1 to run system tests'
)
@pytest.mark.asyncio
async def test_health_and_start_call(async_client):
    health = await async_client.get('/healthz')
    assert health.status_code == 200
    start = await async_client.post('/start_call')
    assert start.status_code == 200
    assert_conversation_relay(start.text)
    receive = await async_client.post('/receive_call')
    assert receive.status_code == 200
    assert_conversation_relay(receive.text)

