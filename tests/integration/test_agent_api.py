"""
Integration tests for agent API endpoints.
Tests the HTTP API with real FastAPI test client but mocked database operations.
"""

import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, patch
from datetime import datetime, timezone

from backend.main import app
from backend.database import Agent, CallContext, PhoneNumber, CallSession

# Mark all tests in this module as integration and api tests
pytestmark = [pytest.mark.integration, pytest.mark.api, pytest.mark.agent]


@pytest.fixture
def sample_agent():
    """Sample agent fixture for testing."""
    return Agent(
        id="agent123",
        name="Test Agent",
        type="inbound",
        phone_number="+15551234567",
        system_prompt="You are a test assistant.",
        voice="alloy",
        context_data={"department": "support"}
    )


@pytest.fixture
def sample_phone_number():
    """Sample phone number fixture for testing."""
    return PhoneNumber(
        phone_number="+15551234567",
        twilio_sid="PN123456789",
        friendly_name="Test Number",
        capabilities=["voice", "sms"],
        status="available"
    )


@pytest.fixture
def sample_call_context():
    """Sample call context fixture for testing."""
    return CallContext(
        id="context123",
        agent_id="agent123",
        call_sid="CA123456",
        context_data={"customer_name": "John Doe"},
        notes="Priority customer",
        call_status="active"
    )


@pytest.fixture
def sample_call_session():
    """Sample call session fixture for testing."""
    return CallSession(
        id="session123",
        call_sid="CA123456",
        agent_id="agent123",
        from_number="+15551111111",
        to_number="+15552222222",
        direction="inbound",
        status="active",
        system_prompt="Test prompt",
        voice="alloy",
        context_data={},
        transcript_count=0,
        command_count=0,
        override_count=0,
        estimated_cost=0.0,
        openai_tokens=0,
        twilio_cost=0.0
    )


class TestAgentAPI:
    """Test agent management API endpoints."""
    
    @pytest.mark.asyncio
    async def test_create_agent_success(self, sample_agent):
        """Test successful agent creation."""
        with patch('backend.agent_api.AgentCRUD.create', return_value=sample_agent):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.post("/api/agents", json={
                    "name": "Test Agent",
                    "type": "inbound",
                    "phone_number": "+15551234567",
                    "system_prompt": "You are a test assistant.",
                    "voice": "alloy",
                    "context_data": {"department": "support"}
                })
        
        assert response.status_code == 201
        data = response.json()
        assert data["id"] == "agent123"
        assert data["name"] == "Test Agent"
        assert data["type"] == "inbound"
    
    @pytest.mark.asyncio
    async def test_create_agent_validation_error(self):
        """Test agent creation with validation errors."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post("/api/agents", json={
                "name": "",  # Empty name should fail validation
                "type": "invalid_type",
                "system_prompt": "Test"
            })
        
        assert response.status_code == 422
    
    @pytest.mark.asyncio
    async def test_get_agent_success(self, sample_agent):
        """Test successful agent retrieval."""
        with patch('backend.agent_api.AgentCRUD.get', return_value=sample_agent):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get("/api/agents/agent123")
        
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "agent123"
        assert data["name"] == "Test Agent"
    
    @pytest.mark.asyncio
    async def test_get_agent_not_found(self):
        """Test agent retrieval when not found."""
        with patch('backend.agent_api.AgentCRUD.get', return_value=None):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get("/api/agents/nonexistent")
        
        assert response.status_code == 404
    
    @pytest.mark.asyncio
    async def test_get_all_agents(self, sample_agent):
        """Test getting all agents."""
        agents = [sample_agent]
        
        with patch('backend.agent_api.AgentCRUD.get_all', return_value=agents):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get("/api/agents")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == "agent123"
    
    @pytest.mark.asyncio
    async def test_update_agent_success(self, sample_agent):
        """Test successful agent update."""
        updated_agent = sample_agent.model_copy()
        updated_agent.name = "Updated Agent"
        
        with patch('backend.agent_api.AgentCRUD.update', return_value=updated_agent):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.put("/api/agents/agent123", json={
                    "name": "Updated Agent"
                })
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Agent"
    
    @pytest.mark.asyncio
    async def test_update_agent_not_found(self):
        """Test agent update when not found."""
        with patch('backend.agent_api.AgentCRUD.update', return_value=None):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.put("/api/agents/nonexistent", json={
                    "name": "Updated Agent"
                })
        
        assert response.status_code == 404
    
    @pytest.mark.asyncio
    async def test_delete_agent_success(self):
        """Test successful agent deletion."""
        with patch('backend.agent_api.AgentCRUD.delete', return_value=True):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.delete("/api/agents/agent123")
        
        assert response.status_code == 204
    
    @pytest.mark.asyncio
    async def test_delete_agent_not_found(self):
        """Test agent deletion when not found."""
        with patch('backend.agent_api.AgentCRUD.delete', return_value=False):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.delete("/api/agents/nonexistent")
        
        assert response.status_code == 404


class TestPhoneNumberAPI:
    """Test phone number management API endpoints."""
    
    @pytest.mark.asyncio
    async def test_get_available_numbers(self, sample_phone_number):
        """Test getting available phone numbers."""
        numbers = [sample_phone_number]
        
        with patch('backend.agent_api.PhoneNumberCRUD.get_available', return_value=numbers):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get("/api/phone-numbers/available")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["phone_number"] == "+15551234567"
        assert data[0]["status"] == "available"
    
    @pytest.mark.asyncio
    async def test_assign_phone_number_success(self):
        """Test successful phone number assignment."""
        with patch('backend.agent_api.PhoneNumberCRUD.assign_to_agent', return_value=True):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.post("/api/phone-numbers/+15551234567/assign", json={
                    "agent_id": "agent123"
                })
        
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Phone number assigned successfully"
    
    @pytest.mark.asyncio
    async def test_assign_phone_number_failed(self):
        """Test failed phone number assignment."""
        with patch('backend.agent_api.PhoneNumberCRUD.assign_to_agent', return_value=False):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.post("/api/phone-numbers/+15551234567/assign", json={
                    "agent_id": "agent123"
                })
        
        assert response.status_code == 400
        data = response.json()
        assert "not available" in data["detail"]
    
    @pytest.mark.asyncio
    async def test_unassign_phone_number_success(self):
        """Test successful phone number unassignment."""
        with patch('backend.agent_api.PhoneNumberCRUD.unassign', return_value=True):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.post("/api/phone-numbers/+15551234567/unassign")
        
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Phone number unassigned successfully"


class TestCallContextAPI:
    """Test call context management API endpoints."""
    
    @pytest.mark.asyncio
    async def test_get_context_by_agent(self, sample_call_context):
        """Test getting context by agent ID."""
        with patch('backend.agent_api.CallContextCRUD.get_by_agent', return_value=sample_call_context):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get("/api/contexts/agent/agent123")
        
        assert response.status_code == 200
        data = response.json()
        assert data["agent_id"] == "agent123"
        assert data["context_data"]["customer_name"] == "John Doe"
    
    @pytest.mark.asyncio
    async def test_update_context_success(self, sample_call_context):
        """Test successful context update."""
        updated_context = sample_call_context.model_copy()
        updated_context.notes = "Updated notes"
        
        with patch('backend.agent_api.CallContextCRUD.update_by_call_sid', return_value=updated_context):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.put("/api/contexts/CA123456", json={
                    "notes": "Updated notes",
                    "context_data": {"priority": "high"}
                })
        
        assert response.status_code == 200
        data = response.json()
        assert data["call_sid"] == "CA123456"


class TestOutboundCallAPI:
    """Test outbound call initiation API endpoints."""
    
    @pytest.mark.asyncio
    async def test_make_outbound_call_success(self, sample_agent, sample_call_session):
        """Test successful outbound call initiation."""
        with patch('backend.agent_api.AgentCRUD.get', return_value=sample_agent), \
             patch('backend.agent_api.twilio_client.calls.create') as mock_create, \
             patch('backend.agent_api.CallSessionCRUD.create', return_value=sample_call_session):
            
            # Mock Twilio call creation
            mock_call = AsyncMock()
            mock_call.sid = "CA123456"
            mock_call.status = "queued"
            mock_create.return_value = mock_call
            
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.post("/api/agents/agent123/call", json={
                    "to_number": "+15559999999",
                    "context_override": {"priority": "high"}
                })
        
        assert response.status_code == 200
        data = response.json()
        assert data["call_sid"] == "CA123456"
        assert data["status"] == "queued"
    
    @pytest.mark.asyncio
    async def test_make_outbound_call_agent_not_found(self):
        """Test outbound call with non-existent agent."""
        with patch('backend.agent_api.AgentCRUD.get', return_value=None):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.post("/api/agents/nonexistent/call", json={
                    "to_number": "+15559999999"
                })
        
        assert response.status_code == 404


class TestCallSessionAPI:
    """Test call session monitoring API endpoints."""
    
    @pytest.mark.asyncio
    async def test_get_active_calls(self, sample_call_session):
        """Test getting active call sessions."""
        sessions = [sample_call_session]
        
        with patch('backend.agent_api.CallSessionCRUD.get_active', return_value=sessions):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get("/api/calls/active")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["call_sid"] == "CA123456"
        assert data[0]["status"] == "active"
    
    @pytest.mark.asyncio
    async def test_get_call_session_by_sid(self, sample_call_session):
        """Test getting call session by SID."""
        with patch('backend.agent_api.CallSessionCRUD.get_by_call_sid', return_value=sample_call_session):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get("/api/calls/CA123456")
        
        assert response.status_code == 200
        data = response.json()
        assert data["call_sid"] == "CA123456"
        assert data["agent_id"] == "agent123"
    
    @pytest.mark.asyncio
    async def test_get_call_session_not_found(self):
        """Test getting non-existent call session."""
        with patch('backend.agent_api.CallSessionCRUD.get_by_call_sid', return_value=None):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get("/api/calls/nonexistent")
        
        assert response.status_code == 404


class TestAgentStatsAPI:
    """Test agent statistics API endpoints."""
    
    @pytest.mark.asyncio
    async def test_get_agent_stats(self):
        """Test getting agent statistics."""
        stats = [
            {
                "agent_id": "agent123",
                "name": "Test Agent",
                "type": "inbound",
                "total_calls": 5,
                "total_minutes": 25,
                "status": "active",
                "phone_number": "+15551234567"
            }
        ]
        
        with patch('backend.agent_api.AgentCRUD.get_stats', return_value=stats):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get("/api/agents/stats")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["agent_id"] == "agent123"
        assert data[0]["total_calls"] == 5


class TestErrorHandling:
    """Test error handling and edge cases."""
    
    @pytest.mark.asyncio
    async def test_internal_server_error_handling(self):
        """Test internal server error handling."""
        with patch('backend.agent_api.AgentCRUD.get_all', side_effect=Exception("Database error")):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get("/api/agents")
        
        assert response.status_code == 500
        data = response.json()
        assert "Internal server error" in data["detail"]
    
    @pytest.mark.asyncio
    async def test_invalid_phone_number_format(self):
        """Test API with invalid phone number format."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post("/api/phone-numbers/invalid-number/assign", json={
                "agent_id": "agent123"
            })
        
        # Should handle gracefully - specific behavior depends on implementation
        assert response.status_code in [400, 422]
    
    @pytest.mark.asyncio
    async def test_malformed_json_request(self):
        """Test API with malformed JSON."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.post(
                "/api/agents",
                content="invalid json",
                headers={"content-type": "application/json"}
            )
        
        assert response.status_code == 422