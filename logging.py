import json
from typing import Any, Dict, Optional

import logging as pylogging

from events import timestamp


class CallLogger:
    """Utility class for structured call logging."""

    def __init__(self, logfile: Optional[str] = "call.log") -> None:
        self.logger = pylogging.getLogger("phony")
        if not self.logger.handlers:
            self.logger.setLevel(pylogging.INFO)
            formatter = pylogging.Formatter("%(message)s")
            console = pylogging.StreamHandler()
            console.setFormatter(formatter)
            self.logger.addHandler(console)
            if logfile:
                file_handler = pylogging.FileHandler(logfile)
                file_handler.setFormatter(formatter)
                self.logger.addHandler(file_handler)

    def _log(self, data: Dict[str, Any]) -> None:
        self.logger.info(json.dumps(data))

    def log_transcript(self, call_sid: str, speaker: str, text: str) -> None:
        self._log({
            "event": "transcript",
            "timestamp": timestamp(),
            "callSid": call_sid,
            "speaker": speaker,
            "text": text,
        })

    def log_assistant_response(self, call_sid: str, text: str) -> None:
        self._log({
            "event": "assistant_response",
            "timestamp": timestamp(),
            "callSid": call_sid,
            "text": text,
        })

    def log_command(self, call_sid: str, action: str, value: Optional[str] = None) -> None:
        data = {
            "event": "command_executed",
            "timestamp": timestamp(),
            "callSid": call_sid,
            "command": action,
        }
        if value:
            data["value"] = value
        self._log(data)

    def log_override(self, call_sid: str, action: str, value: Optional[str] = None) -> None:
        data = {
            "event": "assistant_override",
            "timestamp": timestamp(),
            "callSid": call_sid,
            "action": action,
        }
        if value:
            data["value"] = value
        self._log(data)

    def log_latency(self, call_sid: str, metric: str, ms: float) -> None:
        self._log({
            "event": "latency",
            "timestamp": timestamp(),
            "callSid": call_sid,
            "metric": metric,
            "ms": round(ms, 2),
        })
