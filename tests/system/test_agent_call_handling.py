"""
System tests for agent call handling functionality.
Tests the full call flow from Twilio webhook to OpenAI integration.
"""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone

from backend.main import app
from backend.database import Agent, CallContext, CallSession
from backend.agent_call_handler import AgentCallHandler

# Mark all tests in this module as system and agent tests  
pytestmark = [pytest.mark.system, pytest.mark.agent]


@pytest.fixture
def mock_twilio_call():
    """Mock Twilio call object."""
    call = MagicMock()
    call.sid = "CA123456789"
    call.from_ = "+15551111111"
    call.to = "+15551234567"
    call.status = "in-progress"
    call.direction = "inbound"
    return call


@pytest.fixture
def sample_agent():
    """Sample agent for testing."""
    return Agent(
        id="agent123",
        name="Customer Service Agent",
        type="inbound",
        phone_number="+15551234567",
        system_prompt="You are a helpful customer service representative.",
        voice="alloy",
        context_data={
            "company": "Test Company",
            "department": "Support",
            "greeting": "Thank you for calling Test Company support."
        }
    )


@pytest.fixture
def sample_context():
    """Sample call context for testing."""
    return CallContext(
        id="context123",
        agent_id="agent123",
        call_sid="CA123456789",
        context_data={
            "customer_id": "CUST123",
            "priority": "high",
            "previous_issues": ["billing", "technical"]
        },
        notes="VIP customer with previous billing issues"
    )


class TestAgentCallHandling:
    """Test agent-aware call handling system."""
    
    @pytest.mark.asyncio
    async def test_inbound_call_routing_with_agent(self, sample_agent, mock_twilio_call):
        """Test inbound call routing to specific agent."""
        with patch('backend.agent_call_handler.AgentCRUD.get_by_phone_number', return_value=sample_agent), \
             patch('backend.agent_call_handler.CallSessionCRUD.create') as mock_create_session, \
             patch('backend.agent_call_handler.CallContextCRUD.get_by_agent', return_value=None):
            
            handler = AgentCallHandler()
            
            # Simulate inbound call webhook
            call_data = {
                "CallSid": "CA123456789",
                "From": "+15551111111",
                "To": "+15551234567",
                "Direction": "inbound"
            }
            
            result = await handler.handle_inbound_call(call_data)
            
            # Verify agent was found and session created
            assert result["agent_id"] == "agent123"
            assert result["call_sid"] == "CA123456789"
            mock_create_session.assert_called_once()
            
            # Check that session was created with agent context
            session_data = mock_create_session.call_args[0][0]
            assert session_data.agent_id == "agent123"
            assert session_data.system_prompt == sample_agent.system_prompt
            assert session_data.voice == sample_agent.voice
    
    @pytest.mark.asyncio
    async def test_inbound_call_no_agent_found(self):
        """Test inbound call when no agent is assigned to phone number."""
        with patch('backend.agent_call_handler.AgentCRUD.get_by_phone_number', return_value=None):
            
            handler = AgentCallHandler()
            
            call_data = {
                "CallSid": "CA123456789",
                "From": "+15551111111",
                "To": "+15559999999",  # No agent assigned
                "Direction": "inbound"
            }
            
            result = await handler.handle_inbound_call(call_data)
            
            # Should use default behavior
            assert result["agent_id"] is None
            assert "default" in result["system_prompt"]
    
    @pytest.mark.asyncio
    async def test_context_injection_into_openai_session(self, sample_agent, sample_context):
        """Test that agent context is properly injected into OpenAI session."""
        with patch('backend.agent_call_handler.AgentCRUD.get_by_phone_number', return_value=sample_agent), \
             patch('backend.agent_call_handler.CallContextCRUD.get_by_agent', return_value=sample_context):
            
            handler = AgentCallHandler()
            
            # Test context enhancement
            enhanced_prompt = await handler.enhance_system_prompt(
                base_prompt=sample_agent.system_prompt,
                agent=sample_agent,
                context=sample_context
            )
            
            # Verify context data is injected
            assert "Test Company" in enhanced_prompt
            assert "Support" in enhanced_prompt
            assert "VIP customer" in enhanced_prompt
            assert "billing" in enhanced_prompt
            assert sample_agent.system_prompt in enhanced_prompt
    
    @pytest.mark.asyncio
    async def test_outbound_call_initiation(self, sample_agent):
        """Test outbound call initiation with agent."""
        mock_twilio_call = MagicMock()
        mock_twilio_call.sid = "CA987654321"
        mock_twilio_call.status = "queued"
        
        with patch('backend.agent_call_handler.twilio_client.calls.create', return_value=mock_twilio_call), \
             patch('backend.agent_call_handler.CallSessionCRUD.create') as mock_create_session, \
             patch('backend.agent_call_handler.CallContextCRUD.create') as mock_create_context:
            
            handler = AgentCallHandler()
            
            outbound_data = {
                "agent_id": "agent123",
                "to_number": "+15559999999",
                "context_override": {
                    "purpose": "follow_up",
                    "previous_call_id": "CA111111111"
                }
            }
            
            result = await handler.initiate_outbound_call(sample_agent, outbound_data)
            
            assert result["call_sid"] == "CA987654321"
            assert result["status"] == "queued"
            
            # Verify session and context creation
            mock_create_session.assert_called_once()
            mock_create_context.assert_called_once()
            
            # Check context was created with override data
            context_data = mock_create_context.call_args[0][0]
            assert "follow_up" in context_data.context_data["purpose"]
    
    @pytest.mark.asyncio
    async def test_real_time_context_update_during_call(self, sample_context):
        """Test updating call context while call is active."""
        updated_context = sample_context.model_copy()
        updated_context.notes = "Customer resolved, very satisfied"
        updated_context.context_data.update({"resolution": "billing_corrected", "satisfaction": "high"})
        
        with patch('backend.agent_call_handler.CallContextCRUD.update_by_call_sid', return_value=updated_context), \
             patch('backend.agent_call_handler.websocket_manager') as mock_ws_manager:
            
            handler = AgentCallHandler()
            
            update_data = {
                "context_data": {"resolution": "billing_corrected", "satisfaction": "high"},
                "notes": "Customer resolved, very satisfied"
            }
            
            result = await handler.update_call_context("CA123456789", update_data)
            
            assert result["notes"] == "Customer resolved, very satisfied"
            assert result["context_data"]["resolution"] == "billing_corrected"
            
            # Verify real-time notification was sent
            mock_ws_manager.broadcast_to_call.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_call_statistics_tracking(self, sample_agent):
        """Test that call statistics are properly tracked."""
        with patch('backend.agent_call_handler.AgentCRUD.increment_calls') as mock_increment, \
             patch('backend.agent_call_handler.CallSessionCRUD.update_status') as mock_update_status:
            
            handler = AgentCallHandler()
            
            # Simulate call completion
            call_completion_data = {
                "call_sid": "CA123456789",
                "agent_id": "agent123",
                "duration_seconds": 300,  # 5 minutes
                "status": "completed"
            }
            
            await handler.complete_call(call_completion_data)
            
            # Verify statistics were updated
            mock_increment.assert_called_with("agent123", minutes=5)
            mock_update_status.assert_called_with("CA123456789", "completed")
    
    @pytest.mark.asyncio
    async def test_multi_agent_concurrent_calls(self):
        """Test handling multiple agents with concurrent calls."""
        # Create multiple agents
        agent1 = Agent(
            id="agent1", name="Agent 1", type="inbound", 
            phone_number="+15551111111", system_prompt="Test 1", voice="alloy"
        )
        agent2 = Agent(
            id="agent2", name="Agent 2", type="inbound",
            phone_number="+15552222222", system_prompt="Test 2", voice="nova"
        )
        
        def mock_get_by_phone(phone):
            if phone == "+15551111111":
                return agent1
            elif phone == "+15552222222":
                return agent2
            return None
        
        with patch('backend.agent_call_handler.AgentCRUD.get_by_phone_number', side_effect=mock_get_by_phone), \
             patch('backend.agent_call_handler.CallSessionCRUD.create') as mock_create:
            
            handler = AgentCallHandler()
            
            # Simulate concurrent calls
            call1_data = {"CallSid": "CA111111111", "From": "+15559999991", "To": "+15551111111", "Direction": "inbound"}
            call2_data = {"CallSid": "CA222222222", "From": "+15559999992", "To": "+15552222222", "Direction": "inbound"}
            
            result1 = await handler.handle_inbound_call(call1_data)
            result2 = await handler.handle_inbound_call(call2_data)
            
            # Verify both calls were handled correctly
            assert result1["agent_id"] == "agent1"
            assert result2["agent_id"] == "agent2"
            assert mock_create.call_count == 2
    
    @pytest.mark.asyncio
    async def test_error_handling_during_call_setup(self, sample_agent):
        """Test error handling during call setup."""
        with patch('backend.agent_call_handler.AgentCRUD.get_by_phone_number', return_value=sample_agent), \
             patch('backend.agent_call_handler.CallSessionCRUD.create', side_effect=Exception("Database error")):
            
            handler = AgentCallHandler()
            
            call_data = {
                "CallSid": "CA123456789",
                "From": "+15551111111",
                "To": "+15551234567",
                "Direction": "inbound"
            }
            
            # Should handle error gracefully
            with pytest.raises(Exception) as exc_info:
                await handler.handle_inbound_call(call_data)
            
            assert "Database error" in str(exc_info.value)


class TestOpenAIIntegration:
    """Test OpenAI Realtime API integration with agent context."""
    
    @pytest.mark.asyncio
    async def test_openai_session_configuration(self, sample_agent, sample_context):
        """Test OpenAI session is configured with agent settings."""
        with patch('backend.agent_call_handler.openai_client') as mock_openai:
            
            handler = AgentCallHandler()
            
            session_config = await handler.create_openai_session_config(
                agent=sample_agent,
                context=sample_context
            )
            
            # Verify configuration includes agent settings
            assert session_config["voice"] == "alloy"
            assert sample_agent.system_prompt in session_config["instructions"]
            assert "Test Company" in session_config["instructions"]
            assert "VIP customer" in session_config["instructions"]
    
    @pytest.mark.asyncio
    async def test_agent_personality_injection(self, sample_agent):
        """Test that agent personality traits are injected into AI responses."""
        # Add personality to agent
        sample_agent.context_data["personality"] = "friendly and professional"
        sample_agent.context_data["communication_style"] = "clear and concise"
        
        with patch('backend.agent_call_handler.openai_client'):
            
            handler = AgentCallHandler()
            
            enhanced_prompt = await handler.enhance_system_prompt(
                base_prompt=sample_agent.system_prompt,
                agent=sample_agent,
                context=None
            )
            
            assert "friendly and professional" in enhanced_prompt
            assert "clear and concise" in enhanced_prompt
    
    @pytest.mark.asyncio
    async def test_dynamic_context_updates_to_ai(self, sample_agent, sample_context):
        """Test that context updates are reflected in ongoing AI conversation."""
        mock_openai_session = AsyncMock()
        
        with patch('backend.agent_call_handler.get_active_openai_session', return_value=mock_openai_session):
            
            handler = AgentCallHandler()
            
            # Simulate context update during call
            new_context_data = {
                "customer_tier": "platinum",
                "recent_purchase": "enterprise_license"
            }
            
            await handler.update_ai_context("CA123456789", new_context_data)
            
            # Verify AI session was updated
            mock_openai_session.update_context.assert_called_once()
            update_args = mock_openai_session.update_context.call_args[1]
            assert "platinum" in str(update_args)


class TestCallFlowIntegration:
    """Test complete call flow integration."""
    
    @pytest.mark.asyncio
    async def test_complete_inbound_call_flow(self, sample_agent, sample_context):
        """Test complete inbound call flow from start to finish."""
        # Mock all dependencies
        with patch('backend.agent_call_handler.AgentCRUD.get_by_phone_number', return_value=sample_agent), \
             patch('backend.agent_call_handler.CallContextCRUD.get_by_agent', return_value=sample_context), \
             patch('backend.agent_call_handler.CallSessionCRUD.create') as mock_create_session, \
             patch('backend.agent_call_handler.openai_handler.start_session') as mock_start_ai, \
             patch('backend.agent_call_handler.websocket_manager.add_connection') as mock_add_ws:
            
            handler = AgentCallHandler()
            
            # Step 1: Receive inbound call
            call_data = {
                "CallSid": "CA123456789",
                "From": "+15551111111",
                "To": "+15551234567",
                "Direction": "inbound"
            }
            
            call_result = await handler.handle_inbound_call(call_data)
            
            # Step 2: Start OpenAI session with context
            ai_config = await handler.create_openai_session_config(sample_agent, sample_context)
            
            # Step 3: Verify complete integration
            assert call_result["agent_id"] == "agent123"
            assert "VIP customer" in ai_config["instructions"]
            assert ai_config["voice"] == "alloy"
            
            # Verify all components were called
            mock_create_session.assert_called_once()
            
            # Verify session contains all agent context
            session_args = mock_create_session.call_args[0][0]
            assert session_args.agent_id == "agent123"
            assert session_args.system_prompt == sample_agent.system_prompt
    
    @pytest.mark.asyncio
    async def test_error_recovery_mechanisms(self, sample_agent):
        """Test error recovery during call handling."""
        # Test database failure recovery
        with patch('backend.agent_call_handler.AgentCRUD.get_by_phone_number', side_effect=Exception("DB down")), \
             patch('backend.agent_call_handler.logger') as mock_logger:
            
            handler = AgentCallHandler()
            
            call_data = {
                "CallSid": "CA123456789",
                "From": "+15551111111", 
                "To": "+15551234567",
                "Direction": "inbound"
            }
            
            # Should fallback to default behavior
            with pytest.raises(Exception):
                await handler.handle_inbound_call(call_data)
            
            # Verify error was logged
            mock_logger.error.assert_called()