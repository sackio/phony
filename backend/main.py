"""FastAPI application exposing Twilio webhooks."""

import os
import time
from pathlib import Path
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from .override_api import router as override_router
from .events import subscribe
from .openai_ws import ACTIVE_SESSIONS
from .relay_ws import relay_ws_handler
from .twiml import conversation_relay_response

app = FastAPI()
app.include_router(override_router, prefix="/override")
_start_time = time.time()

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


@app.post("/start_call")
async def start_call():
    """Return TwiML instructions for a new outbound call."""
    try:
        return conversation_relay_response()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/receive_call")
async def receive_call():
    """Return TwiML instructions for an inbound call."""
    try:
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
