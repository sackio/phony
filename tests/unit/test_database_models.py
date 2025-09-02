"""
Unit tests for MongoDB database models and CRUD operations.
Tests the Pydantic models and database operations without actual database connections.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import json

from backend.database import (
    Agent, CallContext, CallSession, Transcript, PhoneNumber,
    AgentCRUD, CallContextCRUD, CallSessionCRUD, TranscriptCRUD, PhoneNumberCRUD,
    Database
)

# Mark all tests in this module as unit and database tests
pytestmark = [pytest.mark.unit, pytest.mark.database]


class TestPydanticModels:
    """Test Pydantic model validation and serialization."""
    
    def test_agent_model_creation(self):
        """Test Agent model creation with valid data."""
        agent = Agent(
            name="Test Agent",
            type="inbound",
            phone_number="+15551234567",
            system_prompt="You are a test assistant.",
            voice="alloy",
            context_data={"key": "value"}
        )
        
        assert agent.name == "Test Agent"
        assert agent.type == "inbound"
        assert agent.phone_number == "+15551234567"
        assert agent.voice == "alloy"
        assert agent.status == "active"  # default value
        assert agent.total_calls == 0  # default value
        assert isinstance(agent.created_at, datetime)
    
    def test_agent_model_validation(self):
        """Test Agent model validation errors."""
        # Test invalid voice
        with pytest.raises(ValueError):
            Agent(
                name="Test",
                type="inbound",
                voice="invalid_voice",
                system_prompt="Test"
            )
    
    def test_agent_serialization(self):
        """Test Agent model serialization to dict."""
        agent = Agent(
            name="Test Agent",
            type="outbound",
            system_prompt="Test prompt",
            context_data={"instructions": "Be helpful"}
        )
        
        data = agent.model_dump()
        assert data["name"] == "Test Agent"
        assert data["type"] == "outbound"
        assert data["context_data"]["instructions"] == "Be helpful"
        assert "id" in data
        assert "created_at" in data
    
    def test_call_context_model(self):
        """Test CallContext model creation."""
        context = CallContext(
            agent_id="agent123",
            context_data={"customer_name": "John Doe"},
            notes="Priority customer",
            call_sid="CA123456"
        )
        
        assert context.agent_id == "agent123"
        assert context.context_data["customer_name"] == "John Doe"
        assert context.notes == "Priority customer"
        assert context.call_status == "active"  # default
    
    def test_call_session_model(self):
        """Test CallSession model creation."""
        session = CallSession(
            call_sid="CA123456",
            agent_id="agent123",
            from_number="+15551111111",
            to_number="+15552222222",
            direction="inbound",
            system_prompt="Test prompt",
            voice="nova"
        )
        
        assert session.call_sid == "CA123456"
        assert session.direction == "inbound"
        assert session.status == "initiated"  # default
        assert session.transcript_count == 0  # default
    
    def test_phone_number_model(self):
        """Test PhoneNumber model creation."""
        phone = PhoneNumber(
            phone_number="+15551234567",
            twilio_sid="PN123456789",
            friendly_name="Test Number",
            capabilities=["voice", "sms"]
        )
        
        assert phone.phone_number == "+15551234567"
        assert phone.status == "available"  # default
        assert "voice" in phone.capabilities
    
    def test_transcript_model(self):
        """Test Transcript model creation."""
        transcript = Transcript(
            session_id="session123",
            call_sid="CA123456",
            agent_id="agent123",
            speaker="caller",
            text="Hello, how are you?",
            confidence=0.95
        )
        
        assert transcript.speaker == "caller"
        assert transcript.text == "Hello, how are you?"
        assert transcript.confidence == 0.95
        assert transcript.event_type == "transcript"  # default


@pytest.fixture
def mock_database():
    """Mock database fixture."""
    db = Database()
    db.agents = AsyncMock()
    db.call_contexts = AsyncMock()
    db.call_sessions = AsyncMock()
    db.transcripts = AsyncMock()
    db.phone_numbers = AsyncMock()
    return db


@pytest.fixture
def sample_agent():
    """Sample agent fixture."""
    return Agent(
        id="agent123",
        name="Test Agent",
        type="inbound",
        phone_number="+15551234567",
        system_prompt="You are a test assistant.",
        voice="alloy",
        context_data={"department": "support"}
    )


class TestAgentCRUD:
    """Test AgentCRUD operations."""
    
    @pytest.mark.asyncio
    async def test_create_agent(self, mock_database, sample_agent):
        """Test agent creation."""
        with patch('backend.database.db', mock_database):
            mock_database.agents.insert_one.return_value = AsyncMock(inserted_id=sample_agent.id)
            
            result = await AgentCRUD.create(sample_agent)
            
            assert result.id == sample_agent.id
            assert result.name == sample_agent.name
            mock_database.agents.insert_one.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_agent(self, mock_database, sample_agent):
        """Test get agent by ID."""
        with patch('backend.database.db', mock_database):
            mock_database.agents.find_one.return_value = sample_agent.model_dump()
            
            result = await AgentCRUD.get("agent123")
            
            assert result.id == "agent123"
            assert result.name == "Test Agent"
            mock_database.agents.find_one.assert_called_with({"id": "agent123"})
    
    @pytest.mark.asyncio
    async def test_get_agent_not_found(self, mock_database):
        """Test get agent when not found."""
        with patch('backend.database.db', mock_database):
            mock_database.agents.find_one.return_value = None
            
            result = await AgentCRUD.get("nonexistent")
            
            assert result is None
    
    @pytest.mark.asyncio
    async def test_get_agent_by_phone_number(self, mock_database, sample_agent):
        """Test get agent by phone number."""
        with patch('backend.database.db', mock_database):
            mock_database.agents.find_one.return_value = sample_agent.model_dump()
            
            result = await AgentCRUD.get_by_phone_number("+15551234567")
            
            assert result.phone_number == "+15551234567"
            mock_database.agents.find_one.assert_called_with({"phone_number": "+15551234567"})
    
    @pytest.mark.asyncio
    async def test_get_all_agents(self, mock_database):
        """Test get all agents."""
        agent1 = Agent(name="Agent 1", type="inbound", system_prompt="Test")
        agent2 = Agent(name="Agent 2", type="outbound", system_prompt="Test")
        
        mock_cursor = AsyncMock()
        mock_cursor.__aiter__.return_value = [agent1.model_dump(), agent2.model_dump()]
        
        with patch('backend.database.db', mock_database):
            mock_database.agents.find.return_value = mock_cursor
            
            result = await AgentCRUD.get_all()
            
            assert len(result) == 2
            assert result[0].name == "Agent 1"
            assert result[1].name == "Agent 2"
    
    @pytest.mark.asyncio
    async def test_update_agent(self, mock_database, sample_agent):
        """Test agent update."""
        updates = {"name": "Updated Agent", "voice": "nova"}
        
        with patch('backend.database.db', mock_database):
            mock_database.agents.update_one.return_value = AsyncMock(modified_count=1)
            
            with patch.object(AgentCRUD, 'get', return_value=sample_agent) as mock_get:
                result = await AgentCRUD.update("agent123", updates)
                
                mock_database.agents.update_one.assert_called_once()
                mock_get.assert_called_with("agent123")
                assert result == sample_agent
    
    @pytest.mark.asyncio
    async def test_delete_agent(self, mock_database):
        """Test agent deletion."""
        with patch('backend.database.db', mock_database):
            mock_database.agents.delete_one.return_value = AsyncMock(deleted_count=1)
            
            result = await AgentCRUD.delete("agent123")
            
            assert result is True
            mock_database.agents.delete_one.assert_called_with({"id": "agent123"})
    
    @pytest.mark.asyncio
    async def test_increment_calls(self, mock_database):
        """Test increment agent call stats."""
        with patch('backend.database.db', mock_database):
            mock_database.agents.update_one.return_value = AsyncMock()
            
            await AgentCRUD.increment_calls("agent123", minutes=10)
            
            mock_database.agents.update_one.assert_called_once()
            call_args = mock_database.agents.update_one.call_args
            
            assert call_args[0][0] == {"id": "agent123"}
            assert "$inc" in call_args[0][1]
            assert "$set" in call_args[0][1]


class TestCallContextCRUD:
    """Test CallContextCRUD operations."""
    
    @pytest.mark.asyncio
    async def test_create_context(self, mock_database):
        """Test context creation."""
        context = CallContext(
            agent_id="agent123",
            context_data={"priority": "high"},
            notes="Urgent customer"
        )
        
        with patch('backend.database.db', mock_database):
            mock_database.call_contexts.insert_one.return_value = AsyncMock()
            
            result = await CallContextCRUD.create(context)
            
            assert result == context
            mock_database.call_contexts.insert_one.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_context_by_agent(self, mock_database):
        """Test get context by agent ID."""
        context_data = {
            "id": "context123",
            "agent_id": "agent123",
            "context_data": {"key": "value"},
            "notes": "Test notes",
            "call_status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        with patch('backend.database.db', mock_database):
            mock_database.call_contexts.find_one.return_value = context_data
            
            result = await CallContextCRUD.get_by_agent("agent123")
            
            assert result.agent_id == "agent123"
            mock_database.call_contexts.find_one.assert_called_with({"agent_id": "agent123"})
    
    @pytest.mark.asyncio
    async def test_update_context_by_call_sid(self, mock_database):
        """Test update context by call SID."""
        updates = {"notes": "Updated notes", "context_data": {"updated": True}}
        
        context_data = {
            "id": "context123",
            "agent_id": "agent123",
            "call_sid": "CA123456",
            "context_data": {"updated": True},
            "notes": "Updated notes",
            "call_status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        with patch('backend.database.db', mock_database):
            mock_database.call_contexts.update_one.return_value = AsyncMock(modified_count=1)
            mock_database.call_contexts.find_one.return_value = context_data
            
            result = await CallContextCRUD.update_by_call_sid("CA123456", updates)
            
            assert result.call_sid == "CA123456"
            assert result.notes == "Updated notes"
            mock_database.call_contexts.update_one.assert_called_once()


class TestCallSessionCRUD:
    """Test CallSessionCRUD operations."""
    
    @pytest.mark.asyncio
    async def test_create_session(self, mock_database):
        """Test session creation."""
        session = CallSession(
            call_sid="CA123456",
            agent_id="agent123",
            from_number="+15551111111",
            to_number="+15552222222",
            direction="inbound",
            system_prompt="Test prompt",
            voice="alloy"
        )
        
        with patch('backend.database.db', mock_database):
            mock_database.call_sessions.insert_one.return_value = AsyncMock()
            
            result = await CallSessionCRUD.create(session)
            
            assert result == session
            mock_database.call_sessions.insert_one.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_update_session_status(self, mock_database):
        """Test session status update."""
        session_data = {
            "id": "session123",
            "call_sid": "CA123456",
            "agent_id": "agent123",
            "from_number": "+15551111111",
            "to_number": "+15552222222",
            "direction": "inbound",
            "status": "active",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "system_prompt": "Test",
            "voice": "alloy",
            "context_data": {},
            "transcript_count": 0,
            "command_count": 0,
            "override_count": 0,
            "estimated_cost": 0.0,
            "openai_tokens": 0,
            "twilio_cost": 0.0
        }
        
        with patch('backend.database.db', mock_database):
            mock_database.call_sessions.update_one.return_value = AsyncMock()
            
            with patch.object(CallSessionCRUD, 'get_by_call_sid', return_value=CallSession(**session_data)):
                result = await CallSessionCRUD.update_status("CA123456", "completed")
                
                mock_database.call_sessions.update_one.assert_called_once()
                call_args = mock_database.call_sessions.update_one.call_args
                assert call_args[0][0] == {"call_sid": "CA123456"}
                assert "status" in call_args[0][1]["$set"]


class TestPhoneNumberCRUD:
    """Test PhoneNumberCRUD operations."""
    
    @pytest.mark.asyncio
    async def test_assign_phone_to_agent(self, mock_database):
        """Test phone number assignment."""
        with patch('backend.database.db', mock_database):
            mock_database.phone_numbers.update_one.return_value = AsyncMock(modified_count=1)
            
            result = await PhoneNumberCRUD.assign_to_agent("+15551234567", "agent123")
            
            assert result is True
            mock_database.phone_numbers.update_one.assert_called_with(
                {"phone_number": "+15551234567", "assigned_agent_id": None},
                {"$set": {"assigned_agent_id": "agent123", "status": "assigned"}}
            )
    
    @pytest.mark.asyncio
    async def test_unassign_phone_number(self, mock_database):
        """Test phone number unassignment."""
        with patch('backend.database.db', mock_database):
            mock_database.phone_numbers.update_one.return_value = AsyncMock(modified_count=1)
            
            result = await PhoneNumberCRUD.unassign("+15551234567")
            
            assert result is True
            mock_database.phone_numbers.update_one.assert_called_with(
                {"phone_number": "+15551234567"},
                {"$set": {"assigned_agent_id": None, "status": "available"}}
            )


class TestTranscriptCRUD:
    """Test TranscriptCRUD operations."""
    
    @pytest.mark.asyncio
    async def test_create_transcript(self, mock_database):
        """Test transcript creation."""
        transcript = Transcript(
            session_id="session123",
            call_sid="CA123456",
            agent_id="agent123",
            speaker="caller",
            text="Hello there!",
            confidence=0.95
        )
        
        with patch('backend.database.db', mock_database):
            mock_database.transcripts.insert_one.return_value = AsyncMock()
            mock_database.call_sessions.update_one.return_value = AsyncMock()
            
            result = await TranscriptCRUD.create(transcript)
            
            assert result == transcript
            mock_database.transcripts.insert_one.assert_called_once()
            # Should also update session transcript count
            mock_database.call_sessions.update_one.assert_called_once()


class TestDatabase:
    """Test Database class operations."""
    
    @pytest.mark.asyncio
    async def test_database_connect(self):
        """Test database connection."""
        db = Database()
        
        with patch('backend.database.AsyncIOMotorClient') as mock_client:
            mock_client_instance = AsyncMock()
            mock_client.return_value = mock_client_instance
            mock_client_instance.admin.command = AsyncMock()
            
            await db.connect()
            
            assert db.client == mock_client_instance
            mock_client.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_database_disconnect(self):
        """Test database disconnection."""
        db = Database()
        db.client = MagicMock()
        
        await db.disconnect()
        
        db.client.close.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_create_indexes(self):
        """Test index creation."""
        db = Database()
        db.agents = AsyncMock()
        db.call_contexts = AsyncMock()
        db.call_sessions = AsyncMock()
        db.transcripts = AsyncMock()
        db.phone_numbers = AsyncMock()
        
        await db._create_indexes()
        
        # Verify that create_index was called for each collection
        db.agents.create_index.assert_called()
        db.call_contexts.create_index.assert_called()
        db.call_sessions.create_index.assert_called()
        db.transcripts.create_index.assert_called()
        db.phone_numbers.create_index.assert_called()