"""Run a demo call with two LLM agents talking to each other.

The script starts the FastAPI backend and spawns two independent
:class:`~backend.openai_ws.OpenAISession` instances. Responses from one
agent are forwarded to the other so they carry on a conversation. Each
agent is assigned a synthetic ``callSid`` and publishes events identical
to a real phone call, enabling the existing dashboard UI to observe and
intervene.

Usage
-----
Run this module directly. Two ``callSid`` values will be printed to the
terminal. Open two dashboard pages and connect each to one of the printed
IDs to watch and interact with both sides of the call.

```bash
python scripts/llm_duet_demo.py
```
"""

import asyncio
import uuid
from typing import Any

import uvicorn

from backend.commands import detect_command
from backend.events import end_session, publish_event, start_session, timestamp
from backend.openai_ws import ACTIVE_SESSIONS, OpenAISession


async def _pump(
    src: OpenAISession,
    dst: OpenAISession,
    src_sid: str,
    dst_sid: str,
) -> None:
    """Forward messages from ``src`` to ``dst`` while emitting events.

    Parameters
    ----------
    src, dst:
        The source and destination OpenAI sessions.
    src_sid, dst_sid:
        ``callSid`` values associated with ``src`` and ``dst`` respectively.
    """

    async for message in src.aiter_messages():
        if message.get("type") in {"end", "error"}:
            break

        text = message.get("text")
        if not text:
            continue

        cmd = detect_command(text)
        if cmd and cmd.action == "end_call":
            break

        await publish_event(
            src_sid,
            {
                "type": "assistant_response",
                "timestamp": timestamp(),
                "callSid": src_sid,
                "text": text,
            },
        )
        await publish_event(
            dst_sid,
            {
                "type": "transcript",
                "timestamp": timestamp(),
                "callSid": dst_sid,
                "speaker": "caller",
                "text": text,
            },
        )
        await dst.send_text(text)


async def _run_demo() -> None:
    """Create two LLM agents and let them converse."""
    sid_a = f"demo-{uuid.uuid4().hex[:8]}"
    sid_b = f"demo-{uuid.uuid4().hex[:8]}"

    async with OpenAISession() as agent_a, OpenAISession() as agent_b:
        ACTIVE_SESSIONS[sid_a] = agent_a
        ACTIVE_SESSIONS[sid_b] = agent_b
        await start_session(sid_a)
        await start_session(sid_b)

        print(f"Agent A callSid: {sid_a}")
        print(f"Agent B callSid: {sid_b}")

        # Kick off the conversation with a greeting.
        await agent_a.send_text("Hello there!")

        await asyncio.gather(
            _pump(agent_a, agent_b, sid_a, sid_b),
            _pump(agent_b, agent_a, sid_b, sid_a),
        )

        await end_session(sid_a)
        await end_session(sid_b)
        ACTIVE_SESSIONS.pop(sid_a, None)
        ACTIVE_SESSIONS.pop(sid_b, None)


async def main() -> None:
    """Start the backend server and the LLM demo conversation."""
    config = uvicorn.Config("backend.main:app", host="0.0.0.0", port=8000, log_level="info")
    server = uvicorn.Server(config)

    server_task = asyncio.create_task(server.serve())
    await asyncio.sleep(1)  # Allow the server to start

    try:
        await _run_demo()
    finally:
        server.should_exit = True
        await server_task


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
