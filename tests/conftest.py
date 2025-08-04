import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient

from backend.main import app


@pytest.fixture
def client():
    """Synchronous test client for FastAPI app."""
    return TestClient(app)


@pytest.fixture
async def async_client():
    """Asynchronous HTTP client for FastAPI app."""
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac
