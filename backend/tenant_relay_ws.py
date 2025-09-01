"""Multi-tenant WebSocket relay between Twilio ConversationRelay and OpenAI Realtime API."""

import asyncio
import json
import logging
from typing import Optional
from uuid import UUID
from fastapi import WebSocket
from sqlalchemy.orm import Session

from .events import publish_event, timestamp
from .logging import CallLogger
from .openai_ws import proxy_call, ACTIVE_SESSIONS
from .commands import detect_command, execute_command
from .database import SessionLocal, TenantPhoneNumberDB, CallSessionDB, CallSessionCRUD
from .session_manager import session_manager

logger = logging.getLogger(__name__)


async def get_tenant_from_phone_number(phone_number: str, db: Session) -> Optional[UUID]:
    """Get tenant ID from phone number."""
    phone_record = db.query(TenantPhoneNumberDB).filter(
        TenantPhoneNumberDB.phone_number == phone_number,
        TenantPhoneNumberDB.is_active == True
    ).first()
    
    return phone_record.tenant_id if phone_record else None


class TenantInterceptWebSocket:
    """Multi-tenant WebSocket wrapper to detect GPT commands before sending to Twilio."""

    def __init__(self, websocket: WebSocket) -> None:
        self.ws = websocket
        self.call_sid = None
        self.tenant_id = None
        self.suppress = False
        self.logger = CallLogger()
        self.db_session = None

    async def accept(self):
        return await self.ws.accept()

    async def close(self):
        if self.db_session:
            self.db_session.close()
        return await self.ws.close()

    async def receive_text(self) -> str:
        data = await self.ws.receive_text()
        try:
            event = json.loads(data)
            
            # Extract call SID and determine tenant
            if not self.call_sid and "callSid" in event:
                self.call_sid = event["callSid"]
                await self._determine_tenant(event)
            
            # Log transcription with tenant context
            if event.get("type") == "transcription" and self.call_sid and self.tenant_id:
                self.logger.log_transcript(
                    self.call_sid, "caller", event.get("text", ""), tenant_id=str(self.tenant_id)
                )
                
                # Store transcript in database
                if self.db_session:
                    from .database import TranscriptCRUD
                    session_record = self.db_session.query(CallSessionDB).filter(
                        CallSessionDB.call_sid == self.call_sid
                    ).first()
                    
                    if session_record:
                        TranscriptCRUD.create(self.db_session, {
                            "session_id": session_record.id,
                            "tenant_id": self.tenant_id,
                            "speaker": "caller",
                            "text": event.get("text", ""),
                            "confidence": event.get("confidence")
                        })
        except Exception as e:
            logger.error(f"Error processing received message: {str(e)}")
        
        return data

    async def send_text(self, data: str) -> None:
        try:
            message = json.loads(data)
        except Exception:
            await self.ws.send_text(data)
            return

        if self.suppress:
            if message.get("last"):
                self.suppress = False
            return

        if message.get("type") == "response" and self.call_sid:
            text = message.get("text", "")
            
            # Log AI response with tenant context
            self.logger.log_transcript(
                self.call_sid, "assistant", text, tenant_id=str(self.tenant_id) if self.tenant_id else None
            )
            
            # Store AI response in database
            if self.db_session and self.tenant_id:
                from .database import TranscriptCRUD
                session_record = self.db_session.query(CallSessionDB).filter(
                    CallSessionDB.call_sid == self.call_sid
                ).first()
                
                if session_record:
                    TranscriptCRUD.create(self.db_session, {
                        "session_id": session_record.id,
                        "tenant_id": self.tenant_id,
                        "speaker": "assistant",
                        "text": text
                    })

            # Check for embedded commands
            if text and "[[" in text and "]]" in text:
                command = detect_command(text)
                if command:
                    logger.info(f"Tenant {self.tenant_id}: Detected command in response: {command}")
                    
                    try:
                        result = await execute_command(command, self.call_sid, self.tenant_id)
                        if result.get("suppress_output"):
                            self.suppress = True
                            
                        # Log command execution
                        await publish_event(self.call_sid, {
                            "type": "command",
                            "command": command,
                            "result": result,
                            "timestamp": timestamp(),
                            "tenant_id": str(self.tenant_id) if self.tenant_id else None
                        })
                        
                    except Exception as e:
                        logger.error(f"Tenant {self.tenant_id}: Command execution failed: {str(e)}")
                        await publish_event(self.call_sid, {
                            "type": "error",
                            "error": str(e),
                            "timestamp": timestamp(),
                            "tenant_id": str(self.tenant_id) if self.tenant_id else None
                        })

            # Publish assistant response event
            await publish_event(self.call_sid, {
                "type": "assistant_response",
                "text": text,
                "timestamp": timestamp(),
                "tenant_id": str(self.tenant_id) if self.tenant_id else None
            })

        await self.ws.send_text(data)

    async def _determine_tenant(self, initial_event: dict):
        """Determine tenant from the initial WebSocket event."""
        try:
            self.db_session = SessionLocal()
            
            # Try to get tenant from phone number in the event
            to_number = initial_event.get("to")
            from_number = initial_event.get("from")
            
            # For inbound calls, the "to" is our Twilio number
            # For outbound calls, the "from" is our Twilio number
            phone_numbers_to_check = [to_number, from_number]
            
            for phone_number in phone_numbers_to_check:
                if phone_number:
                    tenant_id = await get_tenant_from_phone_number(phone_number, self.db_session)
                    if tenant_id:
                        self.tenant_id = tenant_id
                        logger.info(f"Determined tenant {tenant_id} for call {self.call_sid}")
                        
                        # Create call session record
                        await self._create_call_session(initial_event)
                        break
            
            if not self.tenant_id:
                logger.warning(f"Could not determine tenant for call {self.call_sid}")
                
        except Exception as e:
            logger.error(f"Error determining tenant: {str(e)}")

    async def _create_call_session(self, event: dict):
        """Create a call session record in the database."""
        try:
            # Get phone number record
            to_number = event.get("to")
            from_number = event.get("from")
            
            phone_record = self.db_session.query(TenantPhoneNumberDB).filter(
                TenantPhoneNumberDB.tenant_id == self.tenant_id,
                TenantPhoneNumberDB.is_active == True
            ).first()
            
            if not phone_record:
                logger.error(f"No phone number found for tenant {self.tenant_id}")
                return
            
            # Determine call direction
            direction = "inbound" if to_number == phone_record.phone_number else "outbound"
            
            # Create session record
            session_data = {
                "tenant_id": self.tenant_id,
                "call_sid": self.call_sid,
                "phone_number_id": phone_record.id,
                "from_number": from_number,
                "to_number": to_number,
                "direction": direction,
                "status": "active",
                "voice": phone_record.default_voice,
                "system_prompt": phone_record.system_prompt
            }
            
            session = CallSessionCRUD.create(self.db_session, session_data)
            logger.info(f"Created call session {session.id} for tenant {self.tenant_id}")
            
        except Exception as e:
            logger.error(f"Error creating call session: {str(e)}")


async def tenant_relay_ws_handler(websocket: WebSocket):
    """Multi-tenant WebSocket handler for Twilio ConversationRelay."""
    logger.info("Starting tenant-aware relay WebSocket connection")
    
    # Wrap WebSocket with tenant-aware interceptor
    wrapped_ws = TenantInterceptWebSocket(websocket)
    
    try:
        await wrapped_ws.accept()
        
        # Start the OpenAI proxy with wrapped WebSocket
        await proxy_call(wrapped_ws)
        
    except Exception as e:
        logger.error(f"Tenant relay WebSocket error: {str(e)}")
        
    finally:
        # Clean up tenant session if we have the info
        if wrapped_ws.call_sid and wrapped_ws.tenant_id:
            try:
                # Remove from session manager
                await session_manager.remove_session(wrapped_ws.tenant_id, wrapped_ws.call_sid)
                
                # Update database session record
                if wrapped_ws.db_session:
                    session_record = wrapped_ws.db_session.query(CallSessionDB).filter(
                        CallSessionDB.call_sid == wrapped_ws.call_sid
                    ).first()
                    
                    if session_record:
                        CallSessionCRUD.end_session(wrapped_ws.db_session, session_record.id)
                        logger.info(f"Ended call session for tenant {wrapped_ws.tenant_id}")
                        
            except Exception as e:
                logger.error(f"Error cleaning up tenant session: {str(e)}")
        
        await wrapped_ws.close()
        logger.info("Tenant relay WebSocket connection closed")