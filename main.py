"""FastAPI application exposing Twilio webhooks."""

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from twilio.twiml.voice_response import VoiceResponse, Connect

app = FastAPI()


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
