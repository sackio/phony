#!/usr/bin/env python
"""Interactive Twilio setup helper.

This script helps you purchase a Twilio phone number and configure the voice
webhook for this project. It stores the credentials and phone number in the
project's `.env` file so other scripts can use them.

Steps performed:
1. Ensure a `.env` file exists (copying from `.env.example` if needed).
2. Prompt for Twilio Account SID and Auth Token if not already set.
3. Let the user search for and purchase an available phone number.
4. Configure the number's Voice webhook to point to the project's
   `/receive_call` endpoint.
5. Save the selected phone number and host back into the `.env` file.

Note: This script uses the Twilio REST API. Any charges incurred from purchasing
phone numbers or making requests will appear on your Twilio account.
"""

import sys
from pathlib import Path

from dotenv import find_dotenv, get_key, set_key
from twilio.base.exceptions import TwilioException
from twilio.rest import Client


def _ensure_env_file() -> Path:
    """Ensure a `.env` file exists and return its path."""
    env_path = Path(find_dotenv(usecwd=True) or "")
    if env_path.exists():
        return env_path

    example = Path(".env.example")
    if example.exists():
        example.copy(".env")
        return Path(".env")

    print("Could not locate .env or .env.example in the project root.")
    sys.exit(1)


def _prompt_env_value(env_path: Path, key: str, prompt: str) -> str:
    """Retrieve a value from `.env` or prompt the user."""
    value = get_key(str(env_path), key)
    if value:
        return value
    value = input(prompt).strip()
    set_key(str(env_path), key, value)
    return value


def _purchase_number(client: Client, host: str) -> str:
    """Search for and purchase a Twilio phone number."""
    print("\n=== Phone Number Search ===")
    area_code = input("Enter a US area code to search (or press Enter for any): ").strip()
    try:
        available = client.available_phone_numbers("US").local.list(
            area_code=area_code or None, limit=5
        )
    except TwilioException as exc:
        print(f"Error retrieving available numbers: {exc}")
        sys.exit(1)

    if not available:
        print("No phone numbers available for that search.")
        sys.exit(1)

    for idx, num in enumerate(available, start=1):
        print(f"{idx}. {num.friendly_name} ({num.phone_number})")

    choice = input("Select a number to purchase [1-5]: ").strip()
    try:
        selected = available[int(choice) - 1]
    except (ValueError, IndexError):
        print("Invalid selection.")
        sys.exit(1)

    try:
        incoming = client.incoming_phone_numbers.create(
            phone_number=selected.phone_number,
            voice_url=f"https://{host}/receive_call",
            voice_method="POST",
        )
    except TwilioException as exc:
        print(f"Failed to purchase number: {exc}")
        sys.exit(1)

    print(f"Purchased number {incoming.phone_number}")
    return incoming.phone_number


def main() -> None:
    env_path = _ensure_env_file()

    account_sid = _prompt_env_value(env_path, "TWILIO_ACCOUNT_SID", "Twilio Account SID: ")
    auth_token = _prompt_env_value(env_path, "TWILIO_AUTH_TOKEN", "Twilio Auth Token: ")
    host = _prompt_env_value(env_path, "HOST", "Public host for webhooks (e.g. abcd.ngrok.io): ")

    client = Client(account_sid, auth_token)

    existing = get_key(str(env_path), "TWILIO_PHONE_NUMBER")
    if existing:
        print(f"Existing phone number detected: {existing}")
        if input("Update its webhook? [y/N]: ").strip().lower() == "y":
            try:
                nums = client.incoming_phone_numbers.list(phone_number=existing, limit=1)
                if not nums:
                    print("Could not find existing number in Twilio account.")
                else:
                    nums[0].update(voice_url=f"https://{host}/receive_call", voice_method="POST")
                    print("Webhook updated.")
            except TwilioException as exc:
                print(f"Failed to update number: {exc}")
        return

    phone_number = _purchase_number(client, host)
    set_key(str(env_path), "TWILIO_PHONE_NUMBER", phone_number)
    print("Twilio setup complete. Environment variables saved to .env")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nSetup cancelled.")
