"""
Agent management API endpoints for the Phony voice AI system.
Provides REST API for creating, managing, and deploying AI agents.
"""

import os
from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

from .database import (
    Agent, CallContext, PhoneNumber, 
    AgentCRUD, CallContextCRUD, PhoneNumberCRUD,
    get_database, Database
)
from .twilio_integration import TwilioService, get_twilio_service
from .agent_call_handler import get_agent_call_handler

router = APIRouter(prefix="/agents", tags=["agents"])

# Request/Response models
class AgentCreateRequest(BaseModel):
    name: str
    type: str  # "inbound" or "outbound"
    system_prompt: str = "You are a helpful AI assistant."
    voice: str = "alloy"
    phone_number: Optional[str] = None
    personality: Optional[str] = None
    context_data: Dict[str, Any] = {}
    greeting_message: Optional[str] = None

class AgentUpdateRequest(BaseModel):
    name: Optional[str] = None
    system_prompt: Optional[str] = None
    voice: Optional[str] = None
    personality: Optional[str] = None
    context_data: Optional[Dict[str, Any]] = None
    greeting_message: Optional[str] = None
    status: Optional[str] = None

class ContextUpdateRequest(BaseModel):
    context_data: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None

class PhoneNumberAssignRequest(BaseModel):
    phone_number: str
    agent_id: str

# API Endpoints

@router.post("/", response_model=Agent)
async def create_agent(
    request: AgentCreateRequest,
    db: Database = Depends(get_database)
):
    """Create a new AI agent."""
    
    # Validate agent type
    if request.type not in ["inbound", "outbound"]:
        raise HTTPException(status_code=400, detail="Agent type must be 'inbound' or 'outbound'")
    
    # For inbound agents, phone number is required
    if request.type == "inbound" and not request.phone_number:
        raise HTTPException(status_code=400, detail="Phone number is required for inbound agents")
    
    # Check if phone number is already assigned (for inbound agents)
    if request.phone_number:
        existing_agent = await AgentCRUD.get_by_phone_number(request.phone_number)
        if existing_agent:
            raise HTTPException(status_code=400, detail="Phone number already assigned to another agent")
    
    # Create agent
    agent = Agent(
        name=request.name,
        type=request.type,
        phone_number=request.phone_number,
        system_prompt=request.system_prompt,
        voice=request.voice,
        personality=request.personality,
        context_data=request.context_data,
        greeting_message=request.greeting_message
    )
    
    created_agent = await AgentCRUD.create(agent)
    
    # If phone number provided, assign it
    if request.phone_number:
        await PhoneNumberCRUD.assign_to_agent(request.phone_number, created_agent.id)
    
    return created_agent

@router.get("/", response_model=List[Agent])
async def get_agents(db: Database = Depends(get_database)):
    """Get all agents."""
    return await AgentCRUD.get_all()

@router.get("/{agent_id}", response_model=Agent)
async def get_agent(
    agent_id: str,
    db: Database = Depends(get_database)
):
    """Get a specific agent."""
    agent = await AgentCRUD.get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent

@router.put("/{agent_id}", response_model=Agent)
async def update_agent(
    agent_id: str,
    request: AgentUpdateRequest,
    db: Database = Depends(get_database)
):
    """Update an agent."""
    # Check if agent exists
    existing_agent = await AgentCRUD.get(agent_id)
    if not existing_agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Prepare updates
    updates = {}
    for field, value in request.model_dump(exclude_unset=True).items():
        if value is not None:
            updates[field] = value
    
    if not updates:
        return existing_agent
    
    updated_agent = await AgentCRUD.update(agent_id, updates)
    return updated_agent

@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: str,
    db: Database = Depends(get_database)
):
    """Delete an agent."""
    agent = await AgentCRUD.get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Unassign phone number if assigned
    if agent.phone_number:
        await PhoneNumberCRUD.unassign(agent.phone_number)
    
    success = await AgentCRUD.delete(agent_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete agent")
    
    return {"message": "Agent deleted successfully"}

# Context Management Endpoints

@router.get("/{agent_id}/context", response_model=CallContext)
async def get_agent_context(
    agent_id: str,
    db: Database = Depends(get_database)
):
    """Get agent's current context."""
    # Check if agent exists
    agent = await AgentCRUD.get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    context = await CallContextCRUD.get_by_agent(agent_id)
    if not context:
        # Create default context if none exists
        context = CallContext(
            agent_id=agent_id,
            context_data=agent.context_data
        )
        context = await CallContextCRUD.create(context)
    
    return context

@router.put("/{agent_id}/context", response_model=CallContext)
async def update_agent_context(
    agent_id: str,
    request: ContextUpdateRequest,
    db: Database = Depends(get_database)
):
    """Update agent's context in real-time."""
    # Check if agent exists
    agent = await AgentCRUD.get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    context = await CallContextCRUD.get_by_agent(agent_id)
    if not context:
        # Create new context
        context = CallContext(
            agent_id=agent_id,
            context_data=request.context_data or {},
            notes=request.notes or ""
        )
        return await CallContextCRUD.create(context)
    
    # Update existing context
    updates = {}
    if request.context_data is not None:
        updates["context_data"] = request.context_data
    if request.notes is not None:
        updates["notes"] = request.notes
    
    if updates:
        updated_context = await CallContextCRUD.update(context.id, updates)
        return updated_context
    
    return context

@router.put("/call/{call_sid}/context", response_model=CallContext)
async def update_call_context(
    call_sid: str,
    request: ContextUpdateRequest,
    db: Database = Depends(get_database)
):
    """Update context for an active call."""
    context = await CallContextCRUD.get_by_call_sid(call_sid)
    if not context:
        raise HTTPException(status_code=404, detail="Call context not found")
    
    # Prepare updates
    updates = {}
    if request.context_data is not None:
        updates["context_data"] = request.context_data
    if request.notes is not None:
        updates["notes"] = request.notes
    
    if updates:
        updated_context = await CallContextCRUD.update_by_call_sid(call_sid, updates)
        return updated_context
    
    return context

# Phone Number Management

@router.get("/phone-numbers/available", response_model=List[PhoneNumber])
async def get_available_phone_numbers(db: Database = Depends(get_database)):
    """Get all available (unassigned) phone numbers."""
    return await PhoneNumberCRUD.get_available()

@router.get("/phone-numbers/all", response_model=List[PhoneNumber])
async def get_all_phone_numbers(db: Database = Depends(get_database)):
    """Get all phone numbers with their assignment status."""
    return await PhoneNumberCRUD.get_all()

@router.post("/phone-numbers/assign")
async def assign_phone_number(
    request: PhoneNumberAssignRequest,
    db: Database = Depends(get_database)
):
    """Assign a phone number to an agent."""
    # Check if agent exists and is inbound type
    agent = await AgentCRUD.get(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    if agent.type != "inbound":
        raise HTTPException(status_code=400, detail="Only inbound agents can be assigned phone numbers")
    
    # Check if agent already has a phone number
    if agent.phone_number:
        raise HTTPException(status_code=400, detail="Agent already has a phone number assigned")
    
    # Assign the phone number
    success = await PhoneNumberCRUD.assign_to_agent(request.phone_number, request.agent_id)
    if not success:
        raise HTTPException(status_code=400, detail="Phone number not available or already assigned")
    
    # Update agent with phone number
    await AgentCRUD.update(request.agent_id, {"phone_number": request.phone_number})
    
    return {"message": "Phone number assigned successfully"}

@router.post("/phone-numbers/{phone_number}/unassign")
async def unassign_phone_number(
    phone_number: str,
    db: Database = Depends(get_database)
):
    """Unassign a phone number from its current agent."""
    # Find agent with this phone number
    agent = await AgentCRUD.get_by_phone_number(phone_number)
    if agent:
        # Clear phone number from agent
        await AgentCRUD.update(agent.id, {"phone_number": None, "twilio_sid": None})
    
    # Unassign in phone numbers collection
    success = await PhoneNumberCRUD.unassign(phone_number)
    if not success:
        raise HTTPException(status_code=404, detail="Phone number not found")
    
    return {"message": "Phone number unassigned successfully"}

# Agent Statistics

@router.get("/{agent_id}/stats")
async def get_agent_stats(
    agent_id: str,
    db: Database = Depends(get_database)
):
    """Get agent usage statistics."""
    agent = await AgentCRUD.get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    return {
        "agent_id": agent_id,
        "name": agent.name,
        "type": agent.type,
        "total_calls": agent.total_calls,
        "total_minutes": agent.total_minutes,
        "last_call_at": agent.last_call_at,
        "status": agent.status,
        "phone_number": agent.phone_number
    }

# Outbound Call Management

class OutboundCallRequest(BaseModel):
    agent_id: str
    to_number: str
    from_number: Optional[str] = None
    context_override: Optional[Dict[str, Any]] = None

@router.post("/call/outbound")
async def make_outbound_call(
    request: OutboundCallRequest,
    db: Database = Depends(get_database)
):
    """Make an outbound call using a specific agent."""
    
    # Get agent
    handler = get_agent_call_handler()
    agent = await handler.get_agent_for_outbound_call(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found or not configured for outbound calls")
    
    # Use agent's phone number or provided number
    from_number = request.from_number or agent.phone_number
    if not from_number:
        raise HTTPException(status_code=400, detail="No phone number available for outbound call")
    
    try:
        # Make the call via Twilio
        twilio_service = get_twilio_service()
        
        # Build TwiML URL with agent ID parameter
        twiml_url = f"https://{os.getenv('HOST', 'localhost')}/start_call?agent_id={agent.id}"
        
        call_sid = twilio_service.make_call(
            to_number=request.to_number,
            from_number=from_number,
            twiml_url=twiml_url,
            agent_context=request.context_override
        )
        
        if not call_sid:
            raise HTTPException(status_code=500, detail="Failed to initiate call")
        
        # Create agent call session
        await handler.start_agent_call_session(
            agent=agent,
            call_sid=call_sid,
            from_number=from_number,
            to_number=request.to_number,
            direction="outbound"
        )
        
        # Update context if provided
        if request.context_override:
            await handler.update_call_context_realtime(call_sid, {
                "context_data": request.context_override
            })
        
        return {
            "call_sid": call_sid,
            "agent_id": agent.id,
            "from_number": from_number,
            "to_number": request.to_number,
            "status": "initiated"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to make call: {str(e)}")

# Active Call Management

@router.get("/calls/active")
async def get_active_calls(db: Database = Depends(get_database)):
    """Get all currently active agent calls."""
    handler = get_agent_call_handler()
    active_calls = await handler.get_active_agent_calls()
    return active_calls

@router.post("/calls/{call_sid}/context")
async def update_active_call_context(
    call_sid: str,
    request: ContextUpdateRequest,
    db: Database = Depends(get_database)
):
    """Update context for an active call in real-time."""
    handler = get_agent_call_handler()
    
    updates = {}
    if request.context_data is not None:
        updates["context_data"] = request.context_data
    if request.notes is not None:
        updates["notes"] = request.notes
    
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    
    updated_context = await handler.update_call_context_realtime(call_sid, updates)
    if not updated_context:
        raise HTTPException(status_code=404, detail="Call not found or context not available")
    
    return updated_context

@router.post("/calls/{call_sid}/end")
async def end_call(
    call_sid: str,
    db: Database = Depends(get_database)
):
    """End an active call."""
    try:
        # End via Twilio
        twilio_service = get_twilio_service()
        success = twilio_service.hangup_call(call_sid)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to end call via Twilio")
        
        # End agent session
        handler = get_agent_call_handler()
        await handler.end_agent_call_session(call_sid)
        
        return {"message": "Call ended successfully", "call_sid": call_sid}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to end call: {str(e)}")

@router.get("/calls/{call_sid}/status")
async def get_call_status(
    call_sid: str,
    db: Database = Depends(get_database)
):
    """Get current status of a call."""
    try:
        # Get status from Twilio
        twilio_service = get_twilio_service()
        twilio_status = twilio_service.get_call_status(call_sid)
        
        # Get agent session info
        handler = get_agent_call_handler()
        active_calls = await handler.get_active_agent_calls()
        agent_info = active_calls.get(call_sid)
        
        return {
            "twilio_status": twilio_status,
            "agent_info": agent_info,
            "call_sid": call_sid
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get call status: {str(e)}")