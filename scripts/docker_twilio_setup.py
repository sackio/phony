#!/usr/bin/env python3
"""Docker-compatible Twilio setup script.

This script handles Twilio setup in a Docker environment where .env
credentials may not be fully configured. It provides interactive
credential collection and phone number configuration.
"""

import sys
import os
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

    print("❌ Could not locate .env or .env.example in the project root.")
    sys.exit(1)


def _get_credential(env_path: Path, key: str, prompt: str, env_var_name: str = None) -> str:
    """Get credential from environment, .env file, or user input."""
    # First try environment variable
    if env_var_name and os.getenv(env_var_name):
        value = os.getenv(env_var_name)
        print(f"✅ Using {key} from environment variable")
        return value
    
    # Then try .env file (if not a placeholder)
    value = get_key(str(env_path), key)
    if value and not any(placeholder in value.lower() for placeholder in ['xxx', 'your_', 'replace', 'todo']):
        print(f"✅ Using {key} from .env file")
        return value
    
    # Finally, request from user
    print(f"🔑 {prompt}")
    print("   (Enter the actual value - no placeholders)")
    while True:
        value = input("   > ").strip()
        if value and not any(placeholder in value.lower() for placeholder in ['xxx', 'your_', 'replace', 'todo']):
            set_key(str(env_path), key, value)
            return value
        print("   ❌ Please enter a valid value (not a placeholder)")


def _list_reserved_numbers(client: Client) -> List[IncomingPhoneNumberInstance]:
    """List all phone numbers in the Twilio account."""
    try:
        numbers = client.incoming_phone_numbers.list()
        return numbers
    except TwilioException as exc:
        print(f"❌ Error retrieving phone numbers: {exc}")
        return []


def _configure_number(client: Client, number: IncomingPhoneNumberInstance, host: str) -> bool:
    """Configure webhook for a specific phone number."""
    try:
        number.update(
            voice_url=f"https://{host}/receive_call",
            voice_method="POST",
            sms_url=None,  # Clear SMS webhook if set
            sms_method=None
        )
        print(f"✅ Configured webhook for {number.phone_number}")
        return True
    except TwilioException as exc:
        print(f"❌ Failed to configure {number.phone_number}: {exc}")
        return False


def main() -> None:
    print("🔧 Docker Twilio Setup")
    print("=" * 40)
    
    env_path = _ensure_env_file()

    # Get credentials with multiple fallback methods
    print("\n🔑 Configuring Twilio credentials...")
    account_sid = _get_credential(
        env_path, 
        "TWILIO_ACCOUNT_SID", 
        "Enter your Twilio Account SID (from console.twilio.com):",
        "TWILIO_ACCOUNT_SID"
    )
    
    auth_token = _get_credential(
        env_path,
        "TWILIO_AUTH_TOKEN",
        "Enter your Twilio Auth Token (from console.twilio.com):",
        "TWILIO_AUTH_TOKEN"
    )
    
    host = _get_credential(
        env_path,
        "HOST",
        "Enter your public host for webhooks (e.g., phony.pushbuild.com):",
        "HOST"
    )

    # Test Twilio connection
    print("\n🔌 Testing Twilio connection...")
    try:
        client = Client(account_sid, auth_token)
        account = client.api.accounts(account_sid).fetch()
        print(f"✅ Connected to Twilio account: {account.friendly_name}")
    except TwilioException as exc:
        print(f"❌ Failed to connect to Twilio: {exc}")
        print("Please check your Account SID and Auth Token")
        sys.exit(1)

    # List and configure phone numbers
    print("\n📞 Retrieving your phone numbers...")
    numbers = _list_reserved_numbers(client)
    
    if not numbers:
        print("❌ No phone numbers found in your Twilio account.")
        print("Please purchase numbers through the Twilio Console first:")
        print("   https://console.twilio.com/us1/develop/phone-numbers/manage/search")
        sys.exit(1)

    print(f"\n📋 Found {len(numbers)} phone number(s):")
    for idx, num in enumerate(numbers, start=1):
        status = "✅ Active" if num.status == "in-use" else f"⚠️  {num.status}"
        webhook_status = "📡 Configured" if num.voice_url else "❌ No webhook"
        print(f"   {idx}. {num.friendly_name} ({num.phone_number}) - {status} - {webhook_status}")
        if num.voice_url:
            print(f"      Current webhook: {num.voice_url}")

    # Select primary number
    print(f"\n🎯 Select primary number for outbound calls (1-{len(numbers)}):")
    while True:
        try:
            choice = input("   > ").strip()
            selected_idx = int(choice) - 1
            if 0 <= selected_idx < len(numbers):
                primary_number = numbers[selected_idx]
                break
            else:
                print(f"   ❌ Please enter a number between 1 and {len(numbers)}")
        except ValueError:
            print(f"   ❌ Please enter a valid number between 1 and {len(numbers)}")

    # Configure webhooks
    print("\n⚙️ Configure webhooks:")
    print("   1. Selected number only")
    print("   2. All numbers")
    
    while True:
        config_choice = input("   Choice (1 or 2): ").strip()
        if config_choice in ["1", "2"]:
            break
        print("   ❌ Please enter 1 or 2")
    
    success_count = 0
    if config_choice == "2":
        print("\n🔧 Configuring all numbers...")
        for num in numbers:
            if _configure_number(client, num, host):
                success_count += 1
    else:
        print("\n🔧 Configuring selected number...")
        if _configure_number(client, primary_number, host):
            success_count += 1

    # Update .env file
    print(f"\n💾 Updating .env file...")
    set_key(str(env_path), "TWILIO_PHONE_NUMBER", primary_number.phone_number)
    print(f"✅ Set TWILIO_PHONE_NUMBER to {primary_number.phone_number}")

    # Summary
    print(f"\n🎉 Setup Complete!")
    print("=" * 40)
    print(f"✅ Configured {success_count} webhook(s)")
    print(f"📞 Primary number: {primary_number.phone_number}")
    print(f"🌐 Webhook host: https://{host}")
    print(f"📥 Inbound endpoint: https://{host}/receive_call")
    print(f"📤 Outbound endpoint: https://{host}/start_call")
    
    print(f"\n🧪 Ready to test:")
    print(f"1. Start backend: docker-compose up backend")
    print(f"2. Make test call: docker-compose run --rm demo python scripts/make_call.py +15551234567")
    print(f"3. Test inbound: Call {primary_number.phone_number} directly")
    print(f"4. Monitor: http://localhost:24187/dashboard/")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n❌ Setup cancelled by user.")
    except Exception as exc:
        print(f"\n💥 Unexpected error: {exc}")
        import traceback
        traceback.print_exc()
        sys.exit(1)