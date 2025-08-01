"""WebSocket relay between Twilio ConversationRelay and OpenAI Realtime API."""

import asyncio
import json
from fastapi import WebSocket
from events import publish_event, timestamp

from openai_ws import proxy_call
from commands import detect_command, execute_command


class InterceptWebSocket:
    """Wrap WebSocket to detect GPT commands before sending to Twilio."""

    def __init__(self, websocket: WebSocket) -> None:
        self.ws = websocket
        self.call_sid = None
        self.suppress = False

    async def accept(self):
        return await self.ws.accept()

    async def close(self):
        return await self.ws.close()

    async def receive_text(self) -> str:
        data = await self.ws.receive_text()
        try:
            event = json.loads(data)
            if not self.call_sid and "callSid" in event:
                self.call_sid = event["callSid"]
        except Exception:
            pass
        return data

    async def send_text(self, data: str) -> None:
        try:
            message = json.loads(data)
        except Exception:
            await self.ws.send_text(data)
            return

        if self.suppress:
            if message.get("last"):
                self.suppress = False
            return

        cmd = detect_command(message.get("text", ""))
        if cmd:
            if self.call_sid:
                await publish_event(self.call_sid, {"type": "command_executed", "timestamp": timestamp(), "callSid": self.call_sid, "command": cmd.action, "value": cmd.value})
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, execute_command, cmd, self.call_sid)
            if not message.get("last", False):
                self.suppress = True
            return
                self.suppress = True
            return

        await self.ws.send_text(data)


async def relay_ws_handler(websocket: WebSocket) -> None:
    """Handle ConversationRelay websocket connection."""
    intercepted = InterceptWebSocket(websocket)
    await proxy_call(intercepted)
