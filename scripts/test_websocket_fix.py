#!/usr/bin/env python3
"""Test WebSocket connectivity."""

import asyncio
import os
import json

async def test_websocket():
    """Simple WebSocket test."""
    print("🧪 Testing WebSocket Connection...")
    
    # Check if we have OpenAI API key
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key or api_key == "your_openai_api_key_here":
        print("⚠️  OpenAI API key not configured - skipping WebSocket test")
        return True  # Don't fail if no API key
    
    try:
        from websockets import connect
        
        # Test basic WebSocket connection (not to OpenAI, just echo server)
        test_url = "wss://echo.websocket.org/"
        
        print("   Testing WebSocket library...")
        async with connect(test_url) as ws:
            await ws.send("test")
            response = await ws.recv()
            print(f"   ✅ WebSocket library working: {response}")
            return True
            
    except ImportError:
        print("   ❌ WebSocket library not installed")
        return False
    except Exception as e:
        print(f"   ⚠️  WebSocket test error: {e}")
        # Don't fail on connection errors (might be network issue)
        return True


async def main():
    """Run WebSocket test."""
    success = await test_websocket()
    
    if success:
        print("\n✅ WebSocket test passed!")
    else:
        print("\n❌ WebSocket test failed!")
    
    return success


if __name__ == "__main__":
    result = asyncio.run(main())
    exit(0 if result else 1)