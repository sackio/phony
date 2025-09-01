#!/usr/bin/env python3
"""Simple demo runner for LLM-to-LLM conversation with random topic."""

import asyncio
import uuid
import time
import random
from datetime import datetime


class SimpleLLMDemo:
    """Simplified LLM demo for testing purposes."""
    
    def __init__(self):
        self.demo_id = f"demo-{uuid.uuid4().hex[:8]}"
        self.conversation = []
        
        # Random demo topics
        self.topics = [
            "exploring the fascinating world of urban beekeeping",
            "discussing the science behind sourdough bread making", 
            "planning a sustainable community garden project",
            "comparing different coffee brewing methods",
            "analyzing the benefits of vertical farming",
            "exploring renewable energy solutions for homes",
            "discussing the art of pottery and ceramics",
            "planning a neighborhood composting program",
            "comparing traditional vs modern music education",
            "exploring the psychology of color in interior design"
        ]
    
    async def simulate_conversation(self):
        """Simulate an LLM-to-LLM conversation."""
        topic = random.choice(self.topics)
        call_sid_a = f"caller-{self.demo_id}"
        call_sid_b = f"receiver-{self.demo_id}"
        
        print(f"🎭 Enhanced LLM Demo Started")
        print("=" * 50)
        print(f"📋 Demo ID: {self.demo_id}")
        print(f"🎯 Topic: {topic}")
        print(f"📞 Caller SID: {call_sid_a}")
        print(f"📞 Receiver SID: {call_sid_b}")
        print(f"📊 Monitor at: http://localhost:24187/dashboard/index.html?callSid={call_sid_a}")
        print("\n🎬 Conversation Starting...\n")
        
        # Simulate conversation exchanges
        exchanges = [
            f"Hello! I'm calling because I'm really interested in {topic}. Do you have time to discuss this?",
            f"Absolutely! I'd be happy to talk about {topic}. It's such an fascinating subject. What specifically interests you about it?",
            f"Well, I've been reading about it lately and I'm curious about the practical aspects. What would you recommend for someone just starting out?",
            f"That's a great question! I'd suggest starting with the fundamentals. Have you considered looking into local resources or communities that focus on this area?",
            f"I haven't yet, but that's a brilliant idea. Are there any common mistakes beginners should avoid?",
            f"Definitely! The most common mistake is trying to do too much too quickly. It's better to start small and build your knowledge gradually. Would you like me to recommend some specific resources?",
            f"That would be incredibly helpful! I really appreciate you taking the time to share your expertise.",
            f"My pleasure! I love talking about {topic}. Feel free to call back if you have more questions as you get started. Good luck with your journey!",
            f"Thank you so much! This has been really enlightening. Have a wonderful day!"
        ]
        
        speakers = ["Caller", "Receiver"]
        
        for i, exchange in enumerate(exchanges):
            speaker = speakers[i % 2]
            timestamp = datetime.now().strftime("%H:%M:%S")
            
            print(f"[{timestamp}] {speaker}: {exchange}")
            
            # Log conversation
            self.conversation.append({
                "timestamp": timestamp,
                "speaker": speaker,
                "text": exchange,
                "exchange_id": i + 1
            })
            
            # Simulate natural conversation pace
            await asyncio.sleep(2)
        
        print(f"\n✅ Conversation Complete!")
        print(f"💬 Total exchanges: {len(exchanges)}")
        print(f"⏱️  Duration: {len(exchanges) * 2} seconds (simulated)")
        
        return {
            "demo_id": self.demo_id,
            "topic": topic,
            "call_sids": [call_sid_a, call_sid_b],
            "conversation": self.conversation,
            "total_exchanges": len(exchanges),
            "status": "completed"
        }


async def main():
    """Run the demo."""
    demo = SimpleLLMDemo()
    results = await demo.simulate_conversation()
    
    print(f"\n📋 Demo Report")
    print("=" * 50)
    print(f"✅ Status: {results['status']}")
    print(f"🎯 Topic: {results['topic']}")
    print(f"💬 Exchanges: {results['total_exchanges']}")
    print(f"📊 Full monitoring available at dashboard URLs above")
    
    return results


if __name__ == "__main__":
    try:
        result = asyncio.run(main())
        print("\n🎉 Demo completed successfully!")
    except KeyboardInterrupt:
        print("\n❌ Demo cancelled")
    except Exception as e:
        print(f"\n💥 Demo failed: {e}")
        import traceback
        traceback.print_exc()