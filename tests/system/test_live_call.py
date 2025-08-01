import os
import json
import pytest
import asyncio
from httpx import AsyncClient

from backend.main import app


@pytest.mark.skipif(
    not os.getenv('LIVE_TESTS'),
    reason='Set LIVE_TESTS=1 to run system tests'
)
@pytest.mark.asyncio
async def test_health_and_start_call():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        health = await ac.get('/healthz')
        assert health.status_code == 200
        start = await ac.post('/start_call')
        assert start.status_code == 200
        assert '<Response>' in start.text

