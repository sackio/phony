"""
Agent-aware call handling for the Phony voice AI system.
Routes calls to appropriate agents and manages agent context during calls.
"""

import os
import json
import asyncio
from typing import Optional, Dict, Any
from datetime import datetime

from .database import (
    AgentCRUD, CallContextCRUD, CallSessionCRUD, TranscriptCRUD,
    Agent, CallContext, CallSession, Transcript
)
from .openai_ws import OpenAISession, ACTIVE_SESSIONS
from .events import publish_event, timestamp
from .logging import CallLogger

class AgentCallHandler:
    """Handles agent-based call routing and context management."""
    
    def __init__(self):
        self.logger = CallLogger()
    
    async def get_agent_for_incoming_call(self, phone_number: str) -> Optional[Agent]:
        """Get the agent assigned to handle calls for this phone number."""
        return await AgentCRUD.get_by_phone_number(phone_number)
    
    async def get_agent_for_outbound_call(self, agent_id: str) -> Optional[Agent]:
        """Get agent for making an outbound call."""
        agent = await AgentCRUD.get(agent_id)
        if agent and agent.type == "outbound":
            return agent
        return None
    
    async def start_agent_call_session(
        self,
        agent: Agent,
        call_sid: str,
        from_number: str,
        to_number: str,
        direction: str
    ) -> CallSession:
        """Start a new call session with agent configuration."""
        
        # Get or create call context for this agent
        context = await CallContextCRUD.get_by_agent(agent.id)
        if not context:
            context = CallContext(
                agent_id=agent.id,
                context_data=agent.context_data,
                call_sid=call_sid,
                caller_number=from_number if direction == "inbound" else to_number,
                call_direction=direction
            )
            await CallContextCRUD.create(context)
        else:
            # Update context with current call info
            await CallContextCRUD.update(context.id, {
                "call_sid": call_sid,
                "caller_number": from_number if direction == "inbound" else to_number,
                "call_direction": direction,
                "call_status": "active"
            })
        
        # Create call session
        session = CallSession(
            call_sid=call_sid,
            agent_id=agent.id,
            from_number=from_number,
            to_number=to_number,
            direction=direction,
            system_prompt=agent.system_prompt,
            voice=agent.voice,
            context_data=context.context_data,
            status="active"
        )
        
        created_session = await CallSessionCRUD.create(session)
        
        # Update agent call stats
        await AgentCRUD.increment_calls(agent.id)
        
        # Log session start
        self.logger.log_event(call_sid, "agent_session_started", {
            "agent_id": agent.id,
            "agent_name": agent.name,
            "agent_type": agent.type,
            "context_size": len(str(context.context_data))
        })
        
        return created_session
    
    async def create_openai_session_for_agent(
        self,
        agent: Agent,
        call_context: Optional[CallContext] = None
    ) -> OpenAISession:
        """Create OpenAI session with agent-specific configuration."""
        
        # Build enhanced system prompt with agent context
        enhanced_prompt = self._build_enhanced_prompt(agent, call_context)
        
        session = OpenAISession(
            system_prompt=enhanced_prompt,
            voice=agent.voice,
            temperature=0.7,  # Make configurable per agent later
            max_tokens=150    # Make configurable per agent later
        )
        
        return session
    
    def _build_enhanced_prompt(
        self,
        agent: Agent,
        context: Optional[CallContext] = None
    ) -> str:
        """Build enhanced system prompt with agent and context data."""
        
        prompt_parts = [agent.system_prompt]
        
        # Add personality if specified
        if agent.personality:
            prompt_parts.append(f"Your personality is: {agent.personality}")
        
        # Add greeting message guidance
        if agent.greeting_message:
            prompt_parts.append(f"Use this greeting when appropriate: {agent.greeting_message}")
        
        # Add context data if available
        if context and context.context_data:
            prompt_parts.append("Context information for this call:")
            for key, value in context.context_data.items():
                prompt_parts.append(f"- {key}: {value}")
        
        # Add agent-specific context from the agent's context_data
        if agent.context_data:
            prompt_parts.append("Additional agent context:")
            for key, value in agent.context_data.items():
                prompt_parts.append(f"- {key}: {value}")
        
        # Add notes if available
        if context and context.notes:
            prompt_parts.append(f"Special notes for this call: {context.notes}")
        
        return "\n\n".join(prompt_parts)
    
    async def handle_call_transcript(
        self,
        call_sid: str,
        speaker: str,
        text: str,
        confidence: Optional[float] = None
    ):
        """Handle and store call transcript with agent context."""
        
        # Find the call session
        session = await CallSessionCRUD.get_by_call_sid(call_sid)
        if not session:
            return
        
        # Create transcript record
        transcript = Transcript(
            session_id=session.id,
            call_sid=call_sid,
            agent_id=session.agent_id,
            speaker=speaker,
            text=text,
            confidence=confidence
        )
        
        await TranscriptCRUD.create(transcript)
        
        # Publish real-time event for live monitoring
        await publish_event(call_sid, {
            "type": "agent_transcript",
            "timestamp": timestamp(),
            "call_sid": call_sid,
            "agent_id": session.agent_id,
            "speaker": speaker,
            "text": text,
            "confidence": confidence
        })
    
    async def update_call_context_realtime(
        self,
        call_sid: str,
        context_updates: Dict[str, Any]
    ) -> Optional[CallContext]:
        """Update call context in real-time during an active call."""
        
        context = await CallContextCRUD.get_by_call_sid(call_sid)
        if not context:
            return None
        
        updated_context = await CallContextCRUD.update_by_call_sid(call_sid, context_updates)
        
        # Update the OpenAI session if it's active
        if call_sid in ACTIVE_SESSIONS:
            session = ACTIVE_SESSIONS[call_sid]
            if hasattr(session, 'update_context'):
                await session.update_context(context_updates)
        
        # Publish real-time update
        await publish_event(call_sid, {
            "type": "context_updated",
            "timestamp": timestamp(),
            "call_sid": call_sid,
            "updates": context_updates
        })
        
        return updated_context
    
    async def end_agent_call_session(self, call_sid: str):
        """End agent call session and update statistics."""
        
        session = await CallSessionCRUD.get_by_call_sid(call_sid)
        if not session:
            return
        
        # Update session status
        updated_session = await CallSessionCRUD.update_status(call_sid, "completed")
        
        # Update agent statistics with call duration
        if updated_session and updated_session.duration_seconds:
            minutes = (updated_session.duration_seconds + 59) // 60  # Round up to next minute
            await AgentCRUD.increment_calls(session.agent_id, minutes)
        
        # Clear call context
        context = await CallContextCRUD.get_by_call_sid(call_sid)
        if context:
            await CallContextCRUD.update_by_call_sid(call_sid, {
                "call_status": "completed",
                "call_sid": None
            })
        
        # Log session end
        self.logger.log_event(call_sid, "agent_session_ended", {
            "agent_id": session.agent_id,
            "duration_seconds": updated_session.duration_seconds if updated_session else 0,
            "transcript_count": updated_session.transcript_count if updated_session else 0
        })
    
    async def get_agent_call_history(
        self,
        agent_id: str,
        limit: int = 50
    ) -> list:
        """Get recent call history for an agent."""
        # This would require additional database queries
        # For now, return empty list - implement as needed
        return []
    
    async def get_active_agent_calls(self) -> Dict[str, Dict[str, Any]]:
        """Get all currently active agent calls."""
        active_sessions = await CallSessionCRUD.get_active_sessions()
        
        result = {}
        for session in active_sessions:
            agent = await AgentCRUD.get(session.agent_id)
            context = await CallContextCRUD.get_by_call_sid(session.call_sid)
            
            result[session.call_sid] = {
                "session": session.model_dump(),
                "agent": agent.model_dump() if agent else None,
                "context": context.model_dump() if context else None,
                "duration": int((datetime.utcnow() - session.started_at).total_seconds()) if session.started_at else 0
            }
        
        return result

# Global handler instance
agent_call_handler = AgentCallHandler()

def get_agent_call_handler() -> AgentCallHandler:
    """Get agent call handler instance."""
    return agent_call_handler