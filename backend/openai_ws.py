"""OpenAI Realtime WebSocket proxy logic.

This module manages a persistent WebSocket connection to the OpenAI
Realtime API. It receives transcription events from Twilio's
ConversationRelay and forwards them to the LLM. Token responses are
streamed back to Twilio so they can be played to the caller in real
 time.

The session is configured with the ``gpt-4o-realtime-preview`` model and
supports both audio and text modalities. Incoming caller speech is sent
as ``text`` events. The model's audio tokens are forwarded to Twilio in
the expected JSON schema.

``relay_ws.py`` delegates all LLM interaction to ``proxy_call`` defined
here, allowing this component to be tested in isolation.
"""

import os
import json
import asyncio
import time
from typing import Any, Dict, Optional

from fastapi import WebSocket, WebSocketDisconnect
from websockets import connect

from .events import start_session, end_session, publish_event, timestamp
from .logging import CallLogger

OPENAI_URL = "wss://api.openai.com/v1/realtime"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-realtime-preview")
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT", "You are a helpful phone assistant.")
OPENAI_VOICE = os.getenv("OPENAI_VOICE", "alloy")
API_KEY = os.getenv("OPENAI_API_KEY")
REQUIRE_FEEDBACK = os.getenv("REQUIRE_SUPERVISOR_FEEDBACK", "false").lower() == "true"

# Mapping of active callSid to their OpenAI session objects. Used to inject
# supervisor overrides via the REST API.
ACTIVE_SESSIONS: Dict[str, "OpenAISession"] = {}

# Structured logger instance used across the session
LOGGER = CallLogger()


class OpenAISession:
    """Manage a single OpenAI Realtime API session."""

    def __init__(
        self,
        model: str = OPENAI_MODEL,
        system_prompt: str = SYSTEM_PROMPT,
        voice: str = OPENAI_VOICE,
    ) -> None:
        self.model = model
        self.system_prompt = system_prompt
        self.voice = voice
        self.ws = None  # type: Optional[Any]
        self.history = []
        # Flags controlling clarification hold flow
        self.awaiting_user_input: bool = False
        self.query_prompt: Optional[str] = None
        # Supervisor feedback flow
        self.require_feedback: bool = REQUIRE_FEEDBACK
        self.awaiting_feedback: bool = False
        self.pending_response: Optional[str] = None
        self.skip_next_feedback: bool = False

    async def __aenter__(self) -> "OpenAISession":
        headers = {
            "Authorization": f"Bearer {API_KEY}",
            "OpenAI-Beta": "realtime=v1"
        }
        self.ws = await connect(OPENAI_URL, extra_headers=headers)
        session_config = {
            "type": "session.update",
            "session": {
                "model": self.model,
                "modalities": ["audio", "text"],
                "instructions": self.system_prompt,
                "voice": self.voice,
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                    "silence_duration_ms": 200
                },
                "input_audio_transcription": {
                    "model": "whisper-1"
                },
                "temperature": 0.8
            }
        }
        await self.ws.send(json.dumps(session_config))
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self.ws:
            await self.ws.close()

    async def send_text(self, text: str) -> None:
        if not self.ws:
            return
        await self.ws.send(json.dumps({
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": text}]
            }
        }))
        self.history.append({"role": "user", "text": text})

    async def inject_assistant_text(self, text: str) -> None:
        """Inject a supervisor-provided message to be spoken to the caller."""
        if not self.ws:
            return
        await self.ws.send(json.dumps({
            "type": "conversation.item.create", 
            "item": {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": text}]
            }
        }))
        self.history.append({"role": "assistant", "text": text})

    async def inject_supervisor_text(self, text: str) -> None:
        """Send clarification text from supervisor to the model only."""
        if not self.ws:
            return
        await self.ws.send(json.dumps({
            "type": "conversation.item.create",
            "item": {
                "type": "message", 
                "role": "user",
                "content": [{"type": "input_text", "text": f"supervisor: {text}"}]
            }
        }))
        self.history.append({"role": "supervisor", "text": text})

    async def cancel_response(self) -> None:
        if self.ws:
            await self.ws.send(json.dumps({"type": "response.cancel"}))

    async def aiter_messages(self):
        if not self.ws:
            return
        async for message in self.ws:
            yield json.loads(message)


async def proxy_call(twilio_ws: WebSocket) -> None:
    """Proxy transcripts from Twilio to OpenAI and stream responses back."""
    await twilio_ws.accept()

    session: Dict[str, Any] = {
        "callSid": None,
        "streamSid": None,
        "request_ts": None,
        "response_logged": False,
    }

    async with OpenAISession() as openai_session:

        async def from_twilio() -> None:
            while True:
                try:
                    data = await twilio_ws.receive_text()
                except WebSocketDisconnect:
                    await openai_session.ws.close()
                    break

                event = json.loads(data)
                if event.get("event") == "disconnect":
                    await openai_session.ws.send(json.dumps({"type": "session.update", "session": {"turn_detection": None}}))
                    break
                if "callSid" in event:
                    if session["callSid"] is None:
                        session["callSid"] = event.get("callSid")
                        await start_session(session["callSid"])
                        ACTIVE_SESSIONS[session["callSid"]] = openai_session
                if "streamSid" in event:
                    session["streamSid"] = event.get("streamSid")

                if event.get("type") == "prompt":
                    text = event.get("voicePrompt", "")
                    if session["callSid"]:
                        await publish_event(
                            session["callSid"],
                            {
                                "type": "transcript",
                                "timestamp": timestamp(),
                                "callSid": session["callSid"],
                                "speaker": "caller",
                                "text": text,
                            },
                        )
                        LOGGER.log_transcript(session["callSid"], "caller", text)
                    if not openai_session.awaiting_user_input:
                        start_ts = time.perf_counter()
                        await openai_session.send_text(text)
                        if session["callSid"]:
                            LOGGER.log_latency(
                                session["callSid"],
                                "stt_to_gpt_ms",
                                (time.perf_counter() - start_ts) * 1000,
                            )
                            session["request_ts"] = time.perf_counter()
                            session["response_logged"] = False

                if event.get("interruptible") is False or event.get("preemptible"):
                    await openai_session.cancel_response()

        async def from_openai() -> None:
            async for message in openai_session.aiter_messages():
                if message.get("type") in {"end", "error"}:
                    break

                if (
                    openai_session.require_feedback
                    and not openai_session.awaiting_feedback
                    and not openai_session.skip_next_feedback
                    and message.get("text")
                ):
                    openai_session.awaiting_feedback = True
                    openai_session.awaiting_user_input = True
                    openai_session.pending_response = message.get("text")
                    if session["callSid"]:
                        await publish_event(
                            session["callSid"],
                            {
                                "type": "pending_response",
                                "timestamp": timestamp(),
                                "callSid": session["callSid"],
                                "text": message.get("text"),
                            },
                        )
                    await openai_session.cancel_response()
                    await twilio_ws.send_text(
                        json.dumps({
                            "type": "text", 
                            "token": "Please hold while I check that.",
                            "last": True,
                            "interruptible": False
                        })
                    )
                    continue

                # Format response according to Twilio ConversationRelay specification
                if message.get("audio"):
                    # Audio response
                    out: Dict[str, Any] = {
                        "type": "audio",
                        "media": {
                            "payload": message.get("audio"),
                            "format": "audio/x-mulaw"
                        },
                        "last": message.get("last", False)
                    }
                else:
                    # Text response  
                    out: Dict[str, Any] = {
                        "type": "text",
                        "token": message.get("text", ""),
                        "last": message.get("last", False),
                        "interruptible": message.get("interruptible", True)
                    }
                if session["callSid"]:
                    first_chunk = session["request_ts"] is not None and not session["response_logged"]
                    if first_chunk:
                        LOGGER.log_latency(
                            session["callSid"],
                            "gpt_response_ms",
                            (time.perf_counter() - session["request_ts"]) * 1000,
                        )
                    await publish_event(
                        session["callSid"],
                        {
                            "type": "assistant_response",
                            "timestamp": timestamp(),
                            "callSid": session["callSid"],
                            "text": message.get("text"),
                        },
                    )
                    LOGGER.log_assistant_response(session["callSid"], message.get("text", ""))

                await twilio_ws.send_text(json.dumps(out))
                if session["callSid"] and first_chunk:
                    LOGGER.log_latency(
                        session["callSid"],
                        "playback_start_ms",
                        (time.perf_counter() - session["request_ts"]) * 1000,
                    )
                    session["request_ts"] = None
                    session["response_logged"] = True
                    openai_session.skip_next_feedback = False

        await asyncio.gather(from_twilio(), from_openai())
        if session["callSid"]:
            ACTIVE_SESSIONS.pop(session["callSid"], None)
            await end_session(session["callSid"])

    await twilio_ws.close()
