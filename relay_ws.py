"""WebSocket relay between Twilio ConversationRelay and OpenAI Realtime API."""

import asyncio
from fastapi import WebSocket

from openai_ws import proxy_call


async def relay_ws_handler(websocket: WebSocket) -> None:
    """Handle ConversationRelay websocket connection."""
    await proxy_call(websocket)
