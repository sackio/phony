#!/usr/bin/env python3
"""Docker-compatible human call demo runner."""

import asyncio
import os
import uuid
from datetime import datetime

print("🎭 Phony Voice AI - Docker Human Call Demo")
print("=" * 50)

# Load environment variables
def get_env_var(name, default=""):
    value = os.getenv(name, default)
    if value:
        return value
    return default

phone_number = get_env_var("TWILIO_PHONE_NUMBER", "+18578167225")
host = get_env_var("HOST", "phony.pushbuild.com")

print(f"\nDemo modes:")
print(f"1. AI calls human (outbound)")
print(f"2. Human calls AI (inbound)")

choice = input("Select mode [2]: ").strip() or "2"

if choice == "1":
    print(f"\n🤖 AI Calls Human Demo")
    print(f"=" * 30)
    
    print(f"⚠️  SAFETY NOTICE:")
    print(f"   - Only call people who have consented")
    print(f"   - Keep calls brief and respectful")
    print(f"   - Monitor via dashboard")
    
    consent = input(f"\nRecipient has consented to AI call? (yes/no): ").strip().lower()
    if consent != "yes":
        print(f"❌ Demo cancelled - consent required")
        exit(1)
    
    target_number = input(f"Enter phone number (+1234567890): ").strip()
    if not target_number:
        print(f"❌ Phone number required")
        exit(1)
    
    # Format number
    if not target_number.startswith('+'):
        target_number = '+1' + target_number.replace('+1', '').replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
    
    print(f"\n🎭 AI Conversation Scenarios:")
    print(f"   1. Customer Service Inquiry")
    print(f"   2. Survey/Feedback Request")
    print(f"   3. Appointment Scheduling") 
    print(f"   4. Friendly Check-in")
    
    scenario = input(f"Select scenario [1]: ").strip() or "1"
    scenarios = {
        "1": "Customer Service Inquiry",
        "2": "Survey/Feedback Request", 
        "3": "Appointment Scheduling",
        "4": "Friendly Check-in"
    }
    
    scenario_name = scenarios.get(scenario, "Customer Service Inquiry")
    
    print(f"\n📋 Call Summary:")
    print(f"   From: {phone_number}")
    print(f"   To: {target_number}")
    print(f"   Scenario: {scenario_name}")
    
    proceed = input(f"\nMake AI call? (yes/no): ").strip().lower()
    if proceed == "yes":
        call_id = f"outbound-{uuid.uuid4().hex[:8]}"
        print(f"\n📞 AI call would be initiated...")
        print(f"📊 Monitor at: http://localhost:24187/dashboard/index.html?callSid={call_id}")
        print(f"🎛️  Use dashboard for real-time control")
        
        print(f"\n✅ In production, Twilio would call {target_number}")
        print(f"🤖 AI would use scenario: {scenario_name}")
    else:
        print(f"❌ Call cancelled")

elif choice == "2":
    print(f"\n📱 Human Calls AI Demo")
    print(f"=" * 30)
    
    print(f"📞 AI Phone Number: {phone_number}")
    print(f"🎯 Call this number to talk with AI")
    
    print(f"\n🤖 AI Personality Options:")
    personalities = {
        "1": "Professional Assistant",
        "2": "Customer Service Rep",
        "3": "Appointment Scheduler", 
        "4": "Information Hotline",
        "5": "Survey Conductor"
    }
    
    for key, name in personalities.items():
        print(f"   {key}. {name}")
    
    personality = input(f"Select AI personality [1]: ").strip() or "1"
    selected_personality = personalities.get(personality, "Professional Assistant")
    
    call_id = f"inbound-{uuid.uuid4().hex[:8]}"
    
    print(f"\n✅ AI is ready for calls!")
    print(f"📞 Call: {phone_number}")
    print(f"🤖 AI personality: {selected_personality}")
    
    print(f"\n📊 Monitor calls at:")
    print(f"   Dashboard: http://localhost:24187/dashboard/")
    print(f"   Live: http://localhost:24187/dashboard/index.html?callSid=[CALL_SID]")
    
    print(f"\n🎛️  Dashboard features:")
    print(f"   - Live conversation transcript")
    print(f"   - Supervisor message override")
    print(f"   - Call control (end/transfer)")
    print(f"   - DTMF tone sending")
    
    print(f"\n📋 Instructions:")
    print(f"   1. Call {phone_number}")
    print(f"   2. AI will answer as {selected_personality}")
    print(f"   3. Have a natural conversation")
    print(f"   4. Monitor via dashboard")
    
    print(f"\n⏳ AI waiting for calls. Press Enter when done...")
    input()
    
    print(f"✅ Demo complete!")

else:
    print(f"❌ Invalid choice: {choice}")

print(f"\n🎉 Human call demo ready!")
print(f"📖 See HUMAN_CALL_DEMO_GUIDE.md for full details")