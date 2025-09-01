"""FastAPI application exposing Twilio webhooks."""

import os
import time
from pathlib import Path
from fastapi import FastAPI, HTTPException, WebSocket, Request, Form
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from twilio.request_validator import RequestValidator
from .override_api import router as override_router
from .agent_api import router as agent_router
from .events import subscribe
from .openai_ws import ACTIVE_SESSIONS
from .relay_ws import relay_ws_handler
from .twiml import conversation_relay_response
from .database import init_database, close_database
from .twilio_integration import get_twilio_service
from .agent_call_handler import get_agent_call_handler

app = FastAPI(title="Phony Voice AI Agent System", version="2.0.0")

# Include API routers
app.include_router(override_router, prefix="/override")
app.include_router(agent_router)

_start_time = time.time()

# Database startup/shutdown events
@app.on_event("startup")
async def startup_event():
    """Initialize database connection on startup."""
    try:
        await init_database()
        
        # Sync phone numbers from Twilio
        twilio_service = get_twilio_service()
        await twilio_service.sync_phone_numbers()
        
        print("✅ Database connected and phone numbers synced")
    except Exception as e:
        print(f"❌ Startup error: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """Close database connection on shutdown."""
    await close_database()
    print("✅ Database connection closed")

# Initialize Twilio request validator for webhook security
auth_token = os.getenv("TWILIO_AUTH_TOKEN")
request_validator = RequestValidator(auth_token) if auth_token else None

# Serve dashboard static files
dashboard_path = Path(__file__).parent.parent / "dashboard"
if dashboard_path.exists():
    app.mount("/dashboard", StaticFiles(directory=str(dashboard_path), html=True), name="dashboard")


@app.get("/")
async def root():
    """Redirect to dashboard."""
    return Response(
        content='<html><head><meta http-equiv="refresh" content="0; url=/dashboard/"></head><body>Redirecting to <a href="/dashboard/">dashboard</a>...</body></html>',
        media_type="text/html"
    )


def validate_twilio_request(request: Request, form_data: dict = None) -> bool:
    """Validate Twilio webhook signature for security."""
    if not request_validator:
        # Skip validation if no auth token configured (development mode)
        return True
    
    signature = request.headers.get('X-Twilio-Signature', '')
    url = str(request.url)
    params = form_data or {}
    
    return request_validator.validate(url, params, signature)


@app.post("/start_call")
async def start_call(request: Request, CallSid: str = Form(None), From: str = Form(None), To: str = Form(None)):
    """Return TwiML instructions for a new outbound call."""
    form_data = {"CallSid": CallSid, "From": From, "To": To} if CallSid else {}
    
    if not validate_twilio_request(request, form_data):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")
    
    try:
        # For outbound calls, we'll need to identify the agent via query parameter or session
        # For now, use the default conversation relay
        return conversation_relay_response()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/receive_call")
async def receive_call(request: Request, CallSid: str = Form(None), From: str = Form(None), To: str = Form(None)):
    """Return TwiML instructions for an inbound call with agent routing."""
    form_data = {"CallSid": CallSid, "From": From, "To": To} if CallSid else {}
    
    if not validate_twilio_request(request, form_data):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")
    
    try:
        # Find agent assigned to this phone number
        handler = get_agent_call_handler()
        agent = await handler.get_agent_for_incoming_call(To)
        
        if agent:
            # Start agent call session
            await handler.start_agent_call_session(
                agent=agent,
                call_sid=CallSid,
                from_number=From,
                to_number=To,
                direction="inbound"
            )
            
            # Return TwiML with agent-specific configuration
            return conversation_relay_response(agent_greeting=agent.greeting_message)
        else:
            # No agent assigned, use default handling
            return conversation_relay_response()
            
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.websocket("/relay/ws")
async def relay_ws_endpoint(websocket: WebSocket):
    """WebSocket endpoint for Twilio ConversationRelay."""
    await relay_ws_handler(websocket)

@app.websocket("/events/ws")
async def events_ws(websocket: WebSocket, callSid: str):
    """Stream real-time call events to the dashboard."""
    await websocket.accept()
    queue = subscribe(callSid)
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            await websocket.send_json(event)
    finally:
        await websocket.close()


@app.get("/healthz")
async def healthz():
    """Simple health check endpoint."""
    uptime = time.time() - _start_time
    return {
        "status": "ok",
        "uptime": int(uptime),
        "activeCalls": len(ACTIVE_SESSIONS),
    }
