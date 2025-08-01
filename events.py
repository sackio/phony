import asyncio
import json
from datetime import datetime
from typing import Any, Dict, Optional

# Event types used across the application
# ---------------------------------------
# session_start      -> {"type": "session_start", "timestamp": ISO8601, "callSid": str}
# session_end        -> {"type": "session_end", "timestamp": ISO8601, "callSid": str}
# transcript         -> {"type": "transcript", "timestamp": ISO8601, "callSid": str,
#                        "speaker": "caller", "text": str}
# assistant_response -> {"type": "assistant_response", "timestamp": ISO8601,
#                        "callSid": str, "text": str}
# command_executed   -> {"type": "command_executed", "timestamp": ISO8601,
#                        "callSid": str, "command": str, "value": Optional[str]}

_queues: Dict[str, asyncio.Queue] = {}


def timestamp() -> str:
    """Return current UTC time in ISO8601 format."""
    return datetime.utcnow().isoformat() + "Z"


async def start_session(call_sid: str) -> None:
    """Create a queue for the call and emit a ``session_start`` event."""
    queue = _queues.setdefault(call_sid, asyncio.Queue())
    await queue.put({"type": "session_start", "timestamp": timestamp(), "callSid": call_sid})


async def end_session(call_sid: str) -> None:
    """Emit ``session_end`` and close the queue for the call."""
    queue = _queues.get(call_sid)
    if not queue:
        return
    await queue.put({"type": "session_end", "timestamp": timestamp(), "callSid": call_sid})
    await queue.put(None)  # Sentinel for consumers
    _queues.pop(call_sid, None)


async def publish_event(call_sid: str, event: Dict[str, Any]) -> None:
    """Publish an event dictionary to the call's queue."""
    queue = _queues.get(call_sid)
    if queue:
        await queue.put(event)


def subscribe(call_sid: str) -> asyncio.Queue:
    """Return the queue for the given callSid. Creates one if missing."""
    return _queues.setdefault(call_sid, asyncio.Queue())
