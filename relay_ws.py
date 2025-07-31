"""WebSocket relay between Twilio ConversationRelay and OpenAI Realtime API.

Flow:
    1. Twilio connects to `/relay/ws` and streams transcription events.
    2. This handler forwards transcripts to OpenAI's realtime WebSocket API.
    3. GPT-generated audio/text tokens are streamed back to Twilio for playback.
    4. Twilio handles TTS and interruption logic based on provided flags.

Incoming Twilio event schema (JSON):
    {
        "type": "transcription",
        "text": "<partial or final text>",
        "interruptible": true,
        "preemptible": false,
        "callSid": "<call sid>",
        "streamSid": "<stream sid>"
    }

Outgoing message schema back to Twilio:
    {
        "audio": "<base64 encoded audio chunk>",
        "text": "<optional text>",
        "interruptible": "speech",
        "last": false
    }

Only a single call session is supported at a time.
"""

import os
import json
import asyncio

from fastapi import WebSocket, WebSocketDisconnect
from websockets import connect

OPENAI_URL = "wss://api.openai.com/v1/realtime"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-realtime-preview")
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT", "You are a helpful phone assistant.")
API_KEY = os.getenv("OPENAI_API_KEY")


async def relay_ws_handler(twilio_ws: WebSocket) -> None:
    """Handle ConversationRelay websocket connection."""
    await twilio_ws.accept()

    session = {
        "callSid": None,
        "streamSid": None,
        "history": [],
    }

    openai_headers = {"Authorization": f"Bearer {API_KEY}"}

    async with connect(OPENAI_URL, extra_headers=openai_headers) as openai_ws:
        # Configure the realtime session
        config = {
            "type": "start",
            "model": OPENAI_MODEL,
            "modality": ["audio", "text"],
            "system": SYSTEM_PROMPT,
        }
        await openai_ws.send(json.dumps(config))

        async def from_twilio():
            while True:
                try:
                    data = await twilio_ws.receive_text()
                except WebSocketDisconnect:
                    await openai_ws.close()
                    break

                event = json.loads(data)
                if event.get("event") == "disconnect":
                    await openai_ws.send(json.dumps({"type": "stop"}))
                    break

                if "callSid" in event:
                    session["callSid"] = event.get("callSid")
                if "streamSid" in event:
                    session["streamSid"] = event.get("streamSid")

                if event.get("type") == "transcription":
                    text = event.get("text", "")
                    session["history"].append({"role": "user", "text": text})
                    await openai_ws.send(json.dumps({"type": "text", "text": text}))

        async def from_openai():
            async for message in openai_ws:
                data = json.loads(message)
                if data.get("type") in {"end", "error"}:
                    break

                out = {
                    "audio": data.get("audio"),
                    "text": data.get("text"),
                    "last": data.get("last", False),
                }
                if "interruptible" in data:
                    out["interruptible"] = data["interruptible"]

                await twilio_ws.send_text(json.dumps(out))

        await asyncio.gather(from_twilio(), from_openai())

        await twilio_ws.close()
