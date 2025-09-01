#!/usr/bin/env python
"""Setup Twilio with reserved phone numbers.

This script configures Twilio using phone numbers you've already reserved
in your Twilio account, rather than purchasing new ones. It will:

1. List all available phone numbers in your Twilio account
2. Let you select which numbers to use for inbound/outbound calling
3. Configure the webhooks for the selected numbers
4. Update your .env file with the configuration

This is ideal when you already have phone numbers reserved and just need
to configure them for the Phony voice AI agent.
"""

import sys
from pathlib import Path
from typing import List

from dotenv import find_dotenv, get_key, set_key
from twilio.base.exceptions import TwilioException
from twilio.rest import Client
from twilio.rest.api.v2010.account.incoming_phone_number import IncomingPhoneNumberInstance


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


def _list_reserved_numbers(client: Client) -> List[IncomingPhoneNumberInstance]:
    """List all phone numbers in the Twilio account."""
    try:
        numbers = client.incoming_phone_numbers.list()
        return numbers
    except TwilioException as exc:
        print(f"Error retrieving phone numbers: {exc}")
        sys.exit(1)


def _configure_number(client: Client, number: IncomingPhoneNumberInstance, host: str) -> None:
    """Configure webhook for a specific phone number."""
    try:
        number.update(
            voice_url=f"https://{host}/receive_call",
            voice_method="POST",
            sms_url=None,  # Clear SMS webhook if set
            sms_method=None
        )
        print(f"✅ Configured webhook for {number.phone_number}")
    except TwilioException as exc:
        print(f"❌ Failed to configure {number.phone_number}: {exc}")


def main() -> None:
    print("🔧 Twilio Reserved Numbers Setup")
    print("=" * 40)
    
    env_path = _ensure_env_file()

    # Get Twilio credentials
    print("\n📋 Getting Twilio credentials...")
    account_sid = _prompt_env_value(env_path, "TWILIO_ACCOUNT_SID", "Twilio Account SID: ")
    auth_token = _prompt_env_value(env_path, "TWILIO_AUTH_TOKEN", "Twilio Auth Token: ")
    host = _prompt_env_value(env_path, "HOST", "Public host for webhooks (e.g. phony.pushbuild.com): ")

    # Initialize Twilio client
    try:
        client = Client(account_sid, auth_token)
        # Test connection
        client.api.accounts.get(account_sid)
        print("✅ Successfully connected to Twilio")
    except TwilioException as exc:
        print(f"❌ Failed to connect to Twilio: {exc}")
        sys.exit(1)

    # List reserved numbers
    print("\n📞 Retrieving your reserved phone numbers...")
    numbers = _list_reserved_numbers(client)
    
    if not numbers:
        print("❌ No phone numbers found in your Twilio account.")
        print("Please purchase numbers through the Twilio Console first.")
        sys.exit(1)

    print(f"\n📋 Found {len(numbers)} phone number(s):")
    for idx, num in enumerate(numbers, start=1):
        status = "✅ Active" if num.status == "in-use" else f"⚠️  {num.status}"
        webhook_status = "📡 Configured" if num.voice_url else "❌ No webhook"
        print(f"{idx}. {num.friendly_name} ({num.phone_number}) - {status} - {webhook_status}")
        if num.voice_url:
            print(f"   Current webhook: {num.voice_url}")

    # Select primary number for the .env file
    print("\n🎯 Select primary number for outbound calls:")
    choice = input(f"Select number [1-{len(numbers)}]: ").strip()
    
    try:
        selected_idx = int(choice) - 1
        primary_number = numbers[selected_idx]
    except (ValueError, IndexError):
        print("❌ Invalid selection.")
        sys.exit(1)

    # Configure webhooks
    print("\n⚙️ Configuring webhooks...")
    config_choice = input("Configure webhooks for: (1) Selected number only, (2) All numbers [1]: ").strip()
    
    if config_choice == "2":
        print("Configuring all numbers...")
        for num in numbers:
            _configure_number(client, num, host)
    else:
        print("Configuring selected number only...")
        _configure_number(client, primary_number, host)

    # Update .env file
    print("\n💾 Updating .env file...")
    set_key(str(env_path), "TWILIO_PHONE_NUMBER", primary_number.phone_number)
    print(f"✅ Set TWILIO_PHONE_NUMBER to {primary_number.phone_number}")

    # Display summary
    print("\n🎉 Setup Complete!")
    print("=" * 40)
    print(f"Primary number: {primary_number.phone_number}")
    print(f"Webhook host: https://{host}")
    print(f"Inbound calls: https://{host}/receive_call")
    print(f"Outbound calls: https://{host}/start_call")
    
    # Show test instructions
    print("\n🧪 Test your setup:")
    print(f"1. Start the server: ./start.sh")
    print(f"2. Make a test call: python scripts/make_call.py +15551234567")
    print(f"3. Call your Twilio number directly to test inbound")
    print(f"4. Monitor calls: http://localhost:24187/dashboard/")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n❌ Setup cancelled.")
    except Exception as exc:
        print(f"\n❌ Unexpected error: {exc}")
        sys.exit(1)