"""FastAPI application exposing Twilio webhooks."""

import time
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.responses import Response
from twilio.twiml.voice_response import VoiceResponse, Connect

from .override_api import router as override_router
from .events import subscribe
from .openai_ws import ACTIVE_SESSIONS
from .relay_ws import relay_ws_handler

app = FastAPI()
app.include_router(override_router, prefix="/override")
_start_time = time.time()


@app.post("/start_call")
async def start_call():
    """Return TwiML instructions for a new outbound call."""
    try:
        # Create the root TwiML response object
        response = VoiceResponse()

        # ConversationRelay connects the call audio to our WebSocket backend
        connect = Connect()
        connect.conversation_relay(
            url="wss://<YOUR_HOST>/relay/ws",
            welcome_greeting="Hello, connecting you now",
            welcome_greeting_interruptible="speech",
        )
        response.append(connect)

        return Response(content=str(response), media_type="application/xml")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/receive_call")
async def receive_call():
    """Return TwiML instructions for an inbound call."""
    try:
        response = VoiceResponse()
        connect = Connect()
        connect.conversation_relay(
            url="wss://<YOUR_HOST>/relay/ws",
            welcome_greeting="Hello, connecting you now",
            welcome_greeting_interruptible="speech",
        )
        response.append(connect)
        return Response(content=str(response), media_type="application/xml")
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
