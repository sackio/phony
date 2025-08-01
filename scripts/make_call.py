import os
import sys
from typing import Optional

from dotenv import load_dotenv
from twilio.rest import Client


def initiate_call(to_number: str) -> Optional[str]:
    """Initiate an outbound call using Twilio.

    Parameters
    ----------
    to_number: str
        The phone number to call in E.164 format.

    Returns
    -------
    Optional[str]
        The SID of the created call if successful, otherwise ``None``.
    """
    # Load environment variables from a .env file if present
    load_dotenv()

    # Read credentials and the public host from environment variables
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    from_number = os.getenv("TWILIO_PHONE_NUMBER")
    host = os.getenv("HOST")

    if not all([account_sid, auth_token, from_number, host]):
        print("Missing required environment variables.")
        return None

    # Initialize Twilio client
    client = Client(account_sid, auth_token)

    try:
        # Twilio will request /start_call on our server when the call is answered
        call = client.calls.create(
            to=to_number,
            from_=from_number,
            url=f"https://{host}/start_call",
        )
        print(f"Call initiated, SID: {call.sid}")
        return call.sid
    except Exception as exc:
        print(f"Failed to initiate call: {exc}")
        return None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python make_call.py +15551234567")
        sys.exit(1)

    initiate_call(sys.argv[1])
