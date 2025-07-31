from dataclasses import dataclass
import os
import re
from typing import Optional

from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse


@dataclass
class Command:
    """Structured command parsed from GPT output."""
    action: str
    value: Optional[str] = None


_COMMAND_RE = re.compile(r"\[\[(.*?)\]\]")


def detect_command(text: str) -> Optional[Command]:
    """Parse GPT text for embedded commands.

    Supported syntax:
        [[press:digits]]     - Send DTMF digits.
        [[transfer:number]]  - Transfer call to another number.
        [[end_call]]         - Hang up the call.
    """
    if not text:
        return None
    match = _COMMAND_RE.search(text)
    if not match:
        return None

    token = match.group(1).strip()
    if ":" in token:
        action, value = token.split(":", 1)
    else:
        action, value = token, None
    action = action.lower()

    if action in {"press", "transfer", "end_call"}:
        return Command(action=action, value=value)

    return None


def execute_command(cmd: Command, call_sid: str) -> None:
    """Execute a parsed command against the active call."""
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    if not account_sid or not auth_token:
        print("Twilio credentials missing; cannot execute command")
        return

    client = Client(account_sid, auth_token)

    if cmd.action == "press" and cmd.value:
        # Send DTMF digits to the ongoing call
        client.calls(call_sid).update(send_digits=cmd.value)
        print(f"Sent DTMF '{cmd.value}' on call {call_sid}")
    elif cmd.action == "transfer":
        # Transfer to another number and end ConversationRelay session
        target = cmd.value or os.getenv("TRANSFER_NUMBER")
        if not target:
            print("Transfer target not specified")
            return
        vr = VoiceResponse()
        vr.dial(target)
        client.calls(call_sid).update(twiml=str(vr))
        print(f"Transferring call {call_sid} to {target}")
    elif cmd.action == "end_call":
        # End the call gracefully
        client.calls(call_sid).update(status="completed")
        print(f"Ended call {call_sid}")
