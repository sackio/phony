import os
import pytest
from unittest.mock import Mock, patch, AsyncMock
from fastapi.testclient import TestClient
from httpx import AsyncClient

# Handle missing dependencies gracefully for testing
try:
    from backend.main import app
    from backend.openai_ws import OpenAISession
    DEPENDENCIES_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Some dependencies not available for testing: {e}")
    DEPENDENCIES_AVAILABLE = False
    app = None
    OpenAISession = None


@pytest.fixture(autouse=True)
def mock_env_vars():
    """Mock environment variables for testing."""
    with patch.dict(os.environ, {
        'TWILIO_ACCOUNT_SID': 'ACtest123',
        'TWILIO_AUTH_TOKEN': 'test_auth_token',
        'TWILIO_PHONE_NUMBER': '+15551234567',
        'OPENAI_API_KEY': 'sk-test123',
        'HOST': 'test.example.com',
        'OPENAI_VOICE': 'alloy',
        'PORT': '24187'
    }):
        yield


@pytest.fixture
def client():
    """Synchronous test client for FastAPI app."""
    if not DEPENDENCIES_AVAILABLE or app is None:
        pytest.skip("Backend dependencies not available")
    return TestClient(app)


@pytest.fixture
async def async_client():
    """Asynchronous HTTP client for FastAPI app."""
    if not DEPENDENCIES_AVAILABLE or app is None:
        pytest.skip("Backend dependencies not available")
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def mock_openai_session():
    """Mock OpenAI session for testing."""
    session = Mock(spec=OpenAISession)
    session.send_text = AsyncMock()
    session.inject_assistant_text = AsyncMock()
    session.inject_supervisor_text = AsyncMock()
    session.cancel_response = AsyncMock()
    session.aiter_messages = AsyncMock()
    session.awaiting_user_input = False
    session.query_prompt = None
    return session


@pytest.fixture
def mock_twilio_client():
    """Mock Twilio client for testing."""
    with patch('backend.commands.Client') as mock_client:
        mock_instance = Mock()
        mock_client.return_value = mock_instance
        
        # Mock calls methods
        mock_instance.calls.return_value.update = Mock()
        mock_instance.calls.return_value = Mock()
        
        yield mock_instance


@pytest.fixture
def sample_twilio_webhook_data():
    """Sample Twilio webhook data for testing."""
    return {
        'CallSid': 'CA1234567890abcdef1234567890abcdef',
        'From': '+15551234567',
        'To': '+15559876543',
        'CallStatus': 'in-progress'
    }


@pytest.fixture
def sample_openai_message():
    """Sample OpenAI Realtime API message for testing."""
    return {
        'type': 'response.audio_transcript.delta',
        'text': 'Hello, how can I help you?',
        'audio': 'base64_audio_data',
        'last': True,
        'interruptible': True
    }


@pytest.fixture
def mock_websocket():
    """Mock WebSocket connection for testing."""
    ws = AsyncMock()
    ws.accept = AsyncMock()
    ws.close = AsyncMock()
    ws.receive_text = AsyncMock()
    ws.send_text = AsyncMock()
    ws.send_json = AsyncMock()
    return ws
