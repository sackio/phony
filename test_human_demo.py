#!/usr/bin/env python3
"""Quick test of the human call demo functionality."""

import asyncio
import sys
import os
sys.path.append('.')

from scripts.enhanced_llm_demo import HumanCallDemo, InboundHumanDemo


async def test_human_call_demo():
    """Test the outbound human call demo."""
    print("🧪 Testing Outbound Human Call Demo")
    print("=" * 40)
    
    demo = HumanCallDemo()
    
    # Display the scenarios
    print("Available scenarios:")
    for key, scenario in demo.scenarios.items():
        print(f"   {key}. {scenario['name']}")
        print(f"      Opening: \"{scenario['opening']}\"")
        print()
    
    print("✅ Outbound demo scenarios loaded successfully")


async def test_inbound_human_demo():
    """Test the inbound human call demo."""
    print("\n🧪 Testing Inbound Human Call Demo")
    print("=" * 40)
    
    demo = InboundHumanDemo()
    
    # Display the personalities
    print("Available AI personalities:")
    for key, personality in demo.personalities.items():
        print(f"   {key}. {personality['name']}")
        print(f"      Description: {personality['description']}")
        print()
    
    # Show the phone number that would be displayed
    from dotenv import load_dotenv
    load_dotenv()
    phone_number = os.getenv("TWILIO_PHONE_NUMBER", "+18578167225")
    print(f"📞 AI Phone Number for calls: {phone_number}")
    
    print("✅ Inbound demo personalities loaded successfully")


async def main():
    """Run all tests."""
    await test_human_call_demo()
    await test_inbound_human_demo()
    
    print("\n🎉 All human call demo features tested successfully!")
    print("\nTo run the full demo:")
    print("   python3 scripts/enhanced_llm_demo.py")
    print("   Then select option 2 (Call a human) or 3 (Human calls AI)")


if __name__ == "__main__":
    asyncio.run(main())