"""FastAPI application exposing Twilio webhooks."""

import time
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.responses import Response
from .override_api import router as override_router
from .events import subscribe
from .openai_ws import ACTIVE_SESSIONS
from .relay_ws import relay_ws_handler
from .twiml import conversation_relay_response

app = FastAPI()
app.include_router(override_router, prefix="/override")
_start_time = time.time()


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
