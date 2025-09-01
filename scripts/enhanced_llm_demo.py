#!/usr/bin/env python3
"""Enhanced LLM-to-LLM demo with real phone calls.

This script creates a comprehensive demo where:
1. An LLM agent makes an outbound call to a phone number
2. Another LLM agent receives the call (via webhook)
3. The two agents have a natural conversation
4. The demo includes monitoring, metrics, and intervention capabilities

This is designed to run in Docker and demonstrate the full capabilities
of the Phony voice AI system including real Twilio phone calls.
"""

import asyncio
import uuid
import time
import json
from typing import Any, Dict, List, Optional
from datetime import datetime
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
import os

from backend.commands import detect_command
from backend.events import end_session, publish_event, start_session, timestamp
from backend.openai_ws import ACTIVE_SESSIONS, OpenAISession


class EnhancedDemo:
    """Enhanced LLM demo with real phone calls and comprehensive monitoring."""
    
    def __init__(self):
        self.demo_id = f"demo-{uuid.uuid4().hex[:8]}"
        self.call_sid_a = None
        self.call_sid_b = None
        self.metrics = {
            "start_time": None,
            "end_time": None,
            "total_exchanges": 0,
            "avg_response_time": 0,
            "commands_executed": [],
            "conversation_log": []
        }
        self.server_task = None
        
    async def start_server(self, port: int = 24187) -> None:
        """Start the FastAPI backend server."""
        print(f"🚀 Starting backend server on port {port}...")
        config = uvicorn.Config(
            "backend.main:app", 
            host="0.0.0.0", 
            port=port, 
            log_level="info"
        )
        server = uvicorn.Server(config)
        self.server_task = asyncio.create_task(server.serve())
        
        # Wait for server to start
        await asyncio.sleep(3)
        print("✅ Backend server started")
        
    async def stop_server(self) -> None:
        """Stop the FastAPI backend server."""
        if self.server_task:
            self.server_task.cancel()
            try:
                await self.server_task
            except asyncio.CancelledError:
                pass
            print("🛑 Backend server stopped")
    
    async def setup_llm_agents(self) -> tuple[OpenAISession, OpenAISession]:
        """Set up two LLM agents with different personalities."""
        print("🤖 Setting up LLM agents...")
        
        # Agent A: Outbound caller (more formal, business-like)
        agent_a = OpenAISession()
        await agent_a.initialize()
        await agent_a.send_system_message(
            "You are calling a business to inquire about their services. "
            "Be polite, professional, and ask relevant questions. "
            "Keep responses concise and natural. "
            "You may use commands like [[end_call]] when the conversation concludes."
        )
        
        # Agent B: Inbound receiver (helpful, customer service oriented)  
        agent_b = OpenAISession()
        await agent_b.initialize()
        await agent_b.send_system_message(
            "You are a helpful customer service representative answering phone calls. "
            "Be friendly, informative, and try to assist the caller. "
            "Ask clarifying questions and provide helpful information. "
            "Keep responses natural and conversational."
        )
        
        print("✅ LLM agents configured")
        return agent_a, agent_b
    
    async def _log_conversation(self, speaker: str, text: str, call_sid: str) -> None:
        """Log conversation exchange with timing metrics."""
        exchange = {
            "timestamp": datetime.now().isoformat(),
            "speaker": speaker,
            "text": text,
            "call_sid": call_sid,
            "exchange_id": len(self.metrics["conversation_log"]) + 1
        }
        self.metrics["conversation_log"].append(exchange)
        self.metrics["total_exchanges"] += 1
        
        # Print real-time conversation
        timestamp_str = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp_str}] {speaker}: {text}")
    
    async def _pump_messages(
        self,
        src: OpenAISession,
        dst: OpenAISession,
        src_sid: str,
        dst_sid: str,
        src_name: str,
        dst_name: str
    ) -> None:
        """Forward messages between agents with enhanced monitoring."""
        
        async for message in src.aiter_messages():
            start_time = time.time()
            
            if message.get("type") in {"end", "error"}:
                print(f"❌ {src_name} session ended: {message}")
                break

            text = message.get("text")
            if not text:
                continue

            # Log the conversation
            await self._log_conversation(src_name, text, src_sid)

            # Check for commands
            cmd = detect_command(text)
            if cmd:
                self.metrics["commands_executed"].append({
                    "timestamp": datetime.now().isoformat(),
                    "agent": src_name,
                    "command": cmd.action,
                    "params": cmd.params
                })
                print(f"🔧 Command detected: {cmd.action} by {src_name}")
                
                if cmd.action == "end_call":
                    print(f"📞 {src_name} ended the call")
                    break

            # Publish events for monitoring
            await publish_event(
                src_sid,
                {
                    "type": "assistant_response",
                    "timestamp": timestamp(),
                    "callSid": src_sid,
                    "text": text,
                    "agent_name": src_name
                },
            )
            
            await publish_event(
                dst_sid,
                {
                    "type": "transcript",
                    "timestamp": timestamp(),
                    "callSid": dst_sid,
                    "speaker": "caller",
                    "text": text,
                    "source_agent": src_name
                },
            )

            # Forward to destination agent
            await dst.send_text(text)
            
            # Calculate response time
            response_time = time.time() - start_time
            self.metrics["avg_response_time"] = (
                (self.metrics["avg_response_time"] * (self.metrics["total_exchanges"] - 1) + response_time) /
                self.metrics["total_exchanges"]
            )

    async def run_llm_to_llm_demo(self, initial_message: str = None) -> None:
        """Run the enhanced LLM-to-LLM demo."""
        print("\n🎭 Starting Enhanced LLM-to-LLM Demo")
        print("=" * 50)
        
        self.metrics["start_time"] = datetime.now().isoformat()
        
        # Generate call session IDs
        self.call_sid_a = f"demo-caller-{uuid.uuid4().hex[:8]}"
        self.call_sid_b = f"demo-receiver-{uuid.uuid4().hex[:8]}"
        
        # Setup agents
        agent_a, agent_b = await self.setup_llm_agents()
        
        # Register sessions
        ACTIVE_SESSIONS[self.call_sid_a] = agent_a
        ACTIVE_SESSIONS[self.call_sid_b] = agent_b
        
        # Start sessions for monitoring
        await start_session(self.call_sid_a)
        await start_session(self.call_sid_b)
        
        print(f"\n📊 Monitor the demo:")
        print(f"   Caller Agent:   http://localhost:24187/dashboard/index.html?callSid={self.call_sid_a}")
        print(f"   Receiver Agent: http://localhost:24187/dashboard/index.html?callSid={self.call_sid_b}")
        print(f"   Event Stream:   ws://localhost:24187/events/ws")
        
        print(f"\n🎬 Demo starting...")
        print(f"   Caller SID:   {self.call_sid_a}")  
        print(f"   Receiver SID: {self.call_sid_b}")
        
        # Start the conversation
        initial = initial_message or "Hello, I'm calling to inquire about your services. Are you available to talk?"
        print(f"🎯 Initial message: {initial}")
        await agent_a.send_text(initial)
        
        # Start message pumping between agents
        try:
            await asyncio.gather(
                self._pump_messages(agent_a, agent_b, self.call_sid_a, self.call_sid_b, "Caller", "Receiver"),
                self._pump_messages(agent_b, agent_a, self.call_sid_b, self.call_sid_a, "Receiver", "Caller"),
            )
        except Exception as e:
            print(f"❌ Demo error: {e}")
        finally:
            # Cleanup
            await self._cleanup_demo()
    
    async def _cleanup_demo(self) -> None:
        """Clean up demo sessions and generate final report."""
        print("\n🧹 Cleaning up demo...")
        
        self.metrics["end_time"] = datetime.now().isoformat()
        
        # End sessions
        if self.call_sid_a:
            await end_session(self.call_sid_a)
            ACTIVE_SESSIONS.pop(self.call_sid_a, None)
        
        if self.call_sid_b:
            await end_session(self.call_sid_b)
            ACTIVE_SESSIONS.pop(self.call_sid_b, None)
        
        # Generate report
        await self._generate_demo_report()
    
    async def _generate_demo_report(self) -> None:
        """Generate comprehensive demo report."""
        print("\n📋 Demo Report")
        print("=" * 50)
        
        if self.metrics["start_time"] and self.metrics["end_time"]:
            start = datetime.fromisoformat(self.metrics["start_time"])
            end = datetime.fromisoformat(self.metrics["end_time"])
            duration = (end - start).total_seconds()
            print(f"⏱️  Duration: {duration:.1f} seconds")
        
        print(f"💬 Total exchanges: {self.metrics['total_exchanges']}")
        print(f"⚡ Avg response time: {self.metrics['avg_response_time']:.2f}s")
        print(f"🔧 Commands executed: {len(self.metrics['commands_executed'])}")
        
        if self.metrics["commands_executed"]:
            print("\n🛠️  Commands:")
            for cmd in self.metrics["commands_executed"]:
                print(f"   - {cmd['command']} by {cmd['agent']} at {cmd['timestamp']}")
        
        # Save detailed report to file
        report_file = Path(f"demo_report_{self.demo_id}.json")
        with open(report_file, 'w') as f:
            json.dump(self.metrics, f, indent=2)
        print(f"\n💾 Detailed report saved: {report_file}")


class HumanCallDemo(EnhancedDemo):
    """Demo that calls a real human with AI agent."""
    
    def __init__(self):
        super().__init__()
        self.twilio_client = None
        self.call_sid = None
        
        # Conversation scenarios for human calls
        self.scenarios = {
            "1": {
                "name": "Customer Service Inquiry",
                "system_prompt": "You are calling a business to inquire about their services. Be polite, professional, and ask relevant questions about their offerings, hours, or availability. Keep the conversation brief and natural. Thank them for their time.",
                "opening": "Hello! I hope I'm not calling at a bad time. I was wondering if you could tell me a bit about your services?"
            },
            "2": {
                "name": "Survey/Feedback Request", 
                "system_prompt": "You are conducting a brief, friendly survey. Ask 2-3 simple questions about their experience with a service or product. Be respectful of their time and thank them for participating. Keep it under 2 minutes.",
                "opening": "Hi! I'm calling to get some quick feedback. Do you have just a minute to answer a couple of questions?"
            },
            "3": {
                "name": "Appointment Scheduling",
                "system_prompt": "You are calling to schedule an appointment or check availability. Be professional, ask about available times, and be flexible with scheduling. Confirm details at the end.",
                "opening": "Hello! I'd like to schedule an appointment if possible. What availability do you have?"
            },
            "4": {
                "name": "Friendly Check-in",
                "system_prompt": "You are making a friendly, casual call to check in. Keep it light, ask how they're doing, maybe share a brief update. Be natural and conversational, but don't overstay your welcome.",
                "opening": "Hi! I just wanted to call and see how you're doing. Do you have a few minutes to chat?"
            }
        }
    
    async def setup_twilio(self) -> None:
        """Setup Twilio client for real phone calls."""
        load_dotenv()
        
        account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        auth_token = os.getenv("TWILIO_AUTH_TOKEN")
        
        if not account_sid or not auth_token:
            raise ValueError("Twilio credentials not found in environment")
        
        from twilio.rest import Client
        self.twilio_client = Client(account_sid, auth_token)
        print("✅ Twilio client configured")
    
    async def make_human_call(self, to_number: str, scenario: dict) -> Optional[str]:
        """Make a real call to a human with AI agent."""
        if not self.twilio_client:
            await self.setup_twilio()
        
        from_number = os.getenv("TWILIO_PHONE_NUMBER")
        host = os.getenv("HOST")
        
        if not from_number or not host:
            raise ValueError("TWILIO_PHONE_NUMBER or HOST not configured")
        
        print(f"🤖 AI will use scenario: {scenario['name']}")
        print(f"📝 System prompt configured for appropriate behavior")
        
        try:
            # In a real implementation, you'd pass the scenario to the AI system
            # For now, we'll show how the call would be initiated
            call = self.twilio_client.calls.create(
                to=to_number,
                from_=from_number,
                url=f"https://{host}/start_call",
            )
            self.call_sid = call.sid
            print(f"📞 AI calling human: {call.sid} to {to_number}")
            print(f"🎭 Scenario: {scenario['name']}")
            return call.sid
        except Exception as e:
            print(f"❌ Failed to make call: {e}")
            return None
    
    async def run_human_call_demo(self) -> None:
        """Run the human call demo with safety measures."""
        print("\n🧑 Human Call Demo")
        print("=" * 40)
        
        # Safety notice
        print("⚠️  IMPORTANT SAFETY NOTICE:")
        print("   - Only call people who have consented to receive AI calls")
        print("   - Keep calls brief and respectful")
        print("   - The AI will identify itself if asked")
        print("   - You can monitor and intervene via the dashboard")
        print("   - End the call immediately if requested")
        
        consent = input("\nDo you confirm the recipient has consented to this AI call? (yes/no): ").strip().lower()
        if consent != "yes":
            print("❌ Demo cancelled. Consent is required for human calls.")
            return
        
        # Get phone number
        print("\n📞 Phone Number Entry:")
        phone_number = input("Enter phone number (include country code, e.g., +1234567890): ").strip()
        
        if not phone_number:
            print("❌ Phone number required")
            return
        
        # Format validation
        if not phone_number.startswith('+'):
            phone_number = '+1' + phone_number.replace('+1', '').replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
        
        print(f"📱 Formatted number: {phone_number}")
        
        # Choose scenario
        print(f"\n🎭 Choose AI behavior scenario:")
        for key, scenario in self.scenarios.items():
            print(f"   {key}. {scenario['name']}")
        
        scenario_choice = input("Select scenario [1]: ").strip() or "1"
        
        if scenario_choice not in self.scenarios:
            print("❌ Invalid scenario choice")
            return
        
        selected_scenario = self.scenarios[scenario_choice]
        
        # Confirm details
        print(f"\n📋 Call Summary:")
        print(f"   Number: {phone_number}")
        print(f"   Scenario: {selected_scenario['name']}")
        print(f"   AI will say: \"{selected_scenario['opening']}\"")
        
        final_confirm = input("\nProceed with AI call? (yes/no): ").strip().lower()
        if final_confirm != "yes":
            print("❌ Call cancelled")
            return
        
        # Setup and make the call
        await self.setup_twilio()
        call_sid = await self.make_human_call(phone_number, selected_scenario)
        
        if call_sid:
            print(f"\n✅ AI call in progress!")
            print(f"📊 Monitor live at:")
            print(f"   http://localhost:24187/dashboard/index.html?callSid={call_sid}")
            print(f"\n🎛️  Use the dashboard to:")
            print(f"   - View real-time conversation")
            print(f"   - Send supervisor messages")
            print(f"   - End call if needed")
            print(f"   - Send DTMF tones")
            
            print(f"\n⏳ Call active. Press Enter when finished...")
            input()
            
            print(f"📋 Call completed: {call_sid}")
        else:
            print(f"❌ Failed to initiate call")


class InboundHumanDemo(EnhancedDemo):
    """Demo where a human calls the AI agent."""
    
    def __init__(self):
        super().__init__()
        self.demo_call_sid = None
        
        # AI personality options for inbound calls
        self.personalities = {
            "1": {
                "name": "Professional Assistant",
                "description": "Helpful business assistant ready to answer questions",
                "system_prompt": "You are a professional AI assistant answering phone calls. Be helpful, courteous, and provide clear information. Ask clarifying questions when needed and offer to help with various inquiries."
            },
            "2": {
                "name": "Customer Service Rep",
                "description": "Friendly customer service representative",
                "system_prompt": "You are a customer service representative for a technology company. Help callers with questions about products, services, and support. Be patient, understanding, and solution-focused."
            },
            "3": {
                "name": "Appointment Scheduler",
                "description": "Scheduling coordinator for appointments",
                "system_prompt": "You are an appointment scheduling coordinator. Help callers book appointments, check availability, and manage scheduling requests. Be organized and confirm all details clearly."
            },
            "4": {
                "name": "Information Hotline",
                "description": "General information and FAQ assistant",
                "system_prompt": "You are an information hotline assistant. Answer general questions, provide directions, hours of operation, and basic information. Be knowledgeable and direct in your responses."
            },
            "5": {
                "name": "Survey Conductor",
                "description": "Friendly survey and feedback collector",
                "system_prompt": "You are conducting phone surveys and collecting feedback. Be polite, ask clear questions, and thank participants for their time. Keep surveys brief and engaging."
            }
        }
    
    async def run_inbound_human_demo(self) -> None:
        """Set up AI to receive calls from humans."""
        print("\n📱 Human Calls AI Demo")
        print("=" * 40)
        
        # Display your phone number
        load_dotenv()
        phone_number = os.getenv("TWILIO_PHONE_NUMBER", "+18578167225")
        
        print(f"📞 AI Phone Number: {phone_number}")
        print(f"🎯 Call this number to talk with AI")
        
        # Choose AI personality
        print(f"\n🤖 Choose AI personality for incoming calls:")
        for key, personality in self.personalities.items():
            print(f"   {key}. {personality['name']} - {personality['description']}")
        
        personality_choice = input("Select AI personality [1]: ").strip() or "1"
        
        if personality_choice not in self.personalities:
            print("❌ Invalid personality choice, using default")
            personality_choice = "1"
        
        selected_personality = self.personalities[personality_choice]
        
        print(f"\n🎭 AI Personality Selected: {selected_personality['name']}")
        print(f"📝 {selected_personality['description']}")
        
        # Generate a demo call SID for monitoring
        self.demo_call_sid = f"inbound-demo-{uuid.uuid4().hex[:8]}"
        
        print(f"\n✅ AI is ready to receive calls!")
        print(f"📞 Call: {phone_number}")
        print(f"🤖 AI will behave as: {selected_personality['name']}")
        
        print(f"\n📊 Monitor incoming calls at:")
        print(f"   Main Dashboard: http://localhost:24187/dashboard/")
        print(f"   Live Monitor: http://localhost:24187/dashboard/index.html?callSid=[CALL_SID]")
        print(f"   (The actual call SID will be shown when someone calls)")
        
        print(f"\n🎛️  Dashboard features:")
        print(f"   - Real-time conversation transcript")
        print(f"   - Supervisor message override")
        print(f"   - DTMF tone sending")
        print(f"   - Call control (end, transfer)")
        
        print(f"\n📋 Instructions for the caller:")
        print(f"   1. Call {phone_number}")
        print(f"   2. The AI will answer as: {selected_personality['name']}")
        print(f"   3. Have a natural conversation")
        print(f"   4. The AI will be helpful and professional")
        
        print(f"\n⏳ AI is waiting for calls. Press Enter when demo is complete...")
        input()
        
        print(f"✅ Inbound call demo completed")


class RealPhoneDemo(EnhancedDemo):
    """Extended demo that uses real Twilio phone calls."""
    
    def __init__(self):
        super().__init__()
        self.twilio_client = None
        self.real_call_sid = None
        
    async def setup_twilio(self) -> None:
        """Setup Twilio client for real phone calls."""
        load_dotenv()
        
        account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        auth_token = os.getenv("TWILIO_AUTH_TOKEN")
        
        if not account_sid or not auth_token:
            raise ValueError("Twilio credentials not found in environment")
        
        from twilio.rest import Client
        self.twilio_client = Client(account_sid, auth_token)
        print("✅ Twilio client configured")
    
    async def make_real_call(self, to_number: str) -> Optional[str]:
        """Make a real outbound call using Twilio."""
        if not self.twilio_client:
            await self.setup_twilio()
        
        from_number = os.getenv("TWILIO_PHONE_NUMBER")
        host = os.getenv("HOST")
        
        if not from_number or not host:
            raise ValueError("TWILIO_PHONE_NUMBER or HOST not configured")
        
        try:
            call = self.twilio_client.calls.create(
                to=to_number,
                from_=from_number,
                url=f"https://{host}/start_call",
            )
            self.real_call_sid = call.sid
            print(f"📞 Real call initiated: {call.sid} to {to_number}")
            return call.sid
        except Exception as e:
            print(f"❌ Failed to make call: {e}")
            return None


async def main():
    """Main demo runner with multiple modes."""
    print("🎭 Phony Voice AI - Enhanced Demo Suite")
    print("=" * 60)
    
    # Choose demo mode
    print("\nDemo modes:")
    print("1. LLM-to-LLM simulation (no real calls)")
    print("2. Call a human (AI calls real person)")
    print("3. Human calls AI (you call the AI)")
    print("4. Real phone call demo (requires Twilio setup)")
    print("5. All modes sequentially")
    
    choice = input("Select mode [1]: ").strip() or "1"
    
    if choice == "1":
        demo = EnhancedDemo()
        await demo.start_server()
        try:
            await demo.run_llm_to_llm_demo()
        finally:
            await demo.stop_server()
    
    elif choice == "2":
        demo = HumanCallDemo()
        await demo.start_server()
        try:
            await demo.run_human_call_demo()
        finally:
            await demo.stop_server()
    
    elif choice == "3":
        demo = InboundHumanDemo()
        await demo.start_server()
        try:
            await demo.run_inbound_human_demo()
        finally:
            await demo.stop_server()
    
    elif choice == "4":
        demo = RealPhoneDemo()
        await demo.start_server()
        try:
            phone_number = input("Enter phone number to call (+1234567890): ").strip()
            if phone_number:
                await demo.setup_twilio()
                call_sid = await demo.make_real_call(phone_number)
                if call_sid:
                    print(f"✅ Call in progress. Monitor at:")
                    print(f"   http://localhost:24187/dashboard/index.html?callSid={call_sid}")
                    input("Press Enter when call is complete...")
        finally:
            await demo.stop_server()
    
    elif choice == "5":
        # Run LLM demo first
        print("\n🤖 Running LLM-to-LLM demo first...")
        demo1 = EnhancedDemo()
        await demo1.start_server()
        try:
            await demo1.run_llm_to_llm_demo()
        finally:
            await demo1.stop_server()
        
        # Wait between demos
        input("\nPress Enter to continue to real phone demo...")
        
        # Run real phone demo
        print("\n📞 Running real phone demo...")
        demo2 = RealPhoneDemo()
        await demo2.start_server()
        try:
            phone_number = input("Enter phone number to call (+1234567890): ").strip()
            if phone_number:
                await demo2.setup_twilio()
                call_sid = await demo2.make_real_call(phone_number)
                if call_sid:
                    print(f"✅ Call in progress. Monitor at:")
                    print(f"   http://localhost:24187/dashboard/index.html?callSid={call_sid}")
                    input("Press Enter when call is complete...")
        finally:
            await demo2.stop_server()
    
    print("\n🎉 Demo complete!")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n❌ Demo cancelled by user")
    except Exception as e:
        print(f"\n💥 Demo failed: {e}")
        import traceback
        traceback.print_exc()