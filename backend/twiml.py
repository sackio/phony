import os
from fastapi.responses import Response
from twilio.twiml.voice_response import VoiceResponse, Connect


def conversation_relay_response() -> Response:
    """Build TwiML to connect a call via ConversationRelay.

    Returns
    -------
    Response
        FastAPI Response containing the TwiML XML.
    """
    host = os.getenv("HOST", "<YOUR_HOST>")

    response = VoiceResponse()
    connect = Connect()
    connect.conversation_relay(
        url=f"wss://{host}/relay/ws",
        welcome_greeting="Hello, connecting you now",
        welcome_greeting_interruptible="speech",
    )
    response.append(connect)
    return Response(content=str(response), media_type="application/xml")
