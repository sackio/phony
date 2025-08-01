from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import re

from events import publish_event, end_session, timestamp
from commands import Command, execute_command
from openai_ws import ACTIVE_SESSIONS

router = APIRouter()

_digit_re = re.compile(r'^[0-9*#]$')
_phone_re = re.compile(r'^\+?[0-9]{7,15}$')


class TextPayload(BaseModel):
    callSid: str = Field(..., description="Twilio Call SID")
    text: str = Field(..., min_length=1)


class DtmfPayload(BaseModel):
    callSid: str
    digit: str

    @classmethod
    def validate_digit(cls, v: str) -> str:
        if not _digit_re.match(v):
            raise ValueError('digit must be 0-9, * or #')
        return v

    def __init__(self, **data):
        super().__init__(**data)
        self.digit = self.validate_digit(self.digit)


class EndPayload(BaseModel):
    callSid: str


class TransferPayload(BaseModel):
    callSid: str
    target: str

    @classmethod
    def validate_target(cls, v: str) -> str:
        if not _phone_re.match(v):
            raise ValueError('invalid phone number')
        return v

    def __init__(self, **data):
        super().__init__(**data)
        self.target = self.validate_target(self.target)


@router.post('/text')
async def override_text(payload: TextPayload):
    """Inject a supervisor text message into the active session."""
    session = ACTIVE_SESSIONS.get(payload.callSid)
    if not session:
        raise HTTPException(status_code=404, detail='call not active')

    try:
        await session.inject_assistant_text(payload.text)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    await publish_event(payload.callSid, {
        'type': 'assistant_override',
        'timestamp': timestamp(),
        'callSid': payload.callSid,
        'text': payload.text,
    })
    return {'status': 'ok'}


@router.post('/dtmf')
async def override_dtmf(payload: DtmfPayload):
    """Send a DTMF digit on the call."""
    cmd = Command(action='press', value=payload.digit)
    try:
        execute_command(cmd, payload.callSid)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    await publish_event(payload.callSid, {
        'type': 'command_executed',
        'timestamp': timestamp(),
        'callSid': payload.callSid,
        'command': 'press',
        'value': payload.digit,
    })
    return {'status': 'ok'}


@router.post('/end')
async def override_end(payload: EndPayload):
    """Force end the call."""
    cmd = Command(action='end_call')
    try:
        execute_command(cmd, payload.callSid)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    await publish_event(payload.callSid, {
        'type': 'session_end',
        'timestamp': timestamp(),
        'callSid': payload.callSid,
    })
    await end_session(payload.callSid)
    return {'status': 'ok'}


@router.post('/transfer')
async def override_transfer(payload: TransferPayload):
    """Transfer the caller to another phone number."""
    cmd = Command(action='transfer', value=payload.target)
    try:
        execute_command(cmd, payload.callSid)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    await publish_event(payload.callSid, {
        'type': 'session_transfer',
        'timestamp': timestamp(),
        'callSid': payload.callSid,
        'target': payload.target,
    })
    return {'status': 'ok'}
