#!/usr/bin/env python3
"""Configure webhook for the specified phone number."""

import os
from dotenv import load_dotenv
from twilio.rest import Client

def main():
    load_dotenv()
    
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    phone_number = os.getenv("TWILIO_PHONE_NUMBER")
    host = os.getenv("HOST")
    
    print(f"🔧 Configuring webhook for {phone_number}")
    print(f"📡 Webhook URL: https://{host}/receive_call")
    
    client = Client(account_sid, auth_token)
    
    # Find the phone number and update its webhook
    numbers = client.incoming_phone_numbers.list(phone_number=phone_number)
    
    if not numbers:
        print(f"❌ Phone number {phone_number} not found in account")
        return
        
    number = numbers[0]
    number.update(
        voice_url=f"https://{host}/receive_call",
        voice_method="POST"
    )
    
    print(f"✅ Webhook configured for {phone_number}")
    print(f"📞 Ready for inbound calls!")

if __name__ == "__main__":
    main()