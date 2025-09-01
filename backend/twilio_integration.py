"""
Twilio integration service for managing phone numbers and calls.
"""

import os
from typing import List, Optional, Dict, Any
from twilio.rest import Client
from twilio.base.exceptions import TwilioException
import logging

from .database import PhoneNumber, PhoneNumberCRUD

logger = logging.getLogger(__name__)

class TwilioService:
    """Service for interacting with Twilio API."""
    
    def __init__(self):
        self.account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        self.auth_token = os.getenv("TWILIO_AUTH_TOKEN")
        
        if not self.account_sid or not self.auth_token:
            raise ValueError("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set")
        
        self.client = Client(self.account_sid, self.auth_token)
    
    async def sync_phone_numbers(self) -> List[PhoneNumber]:
        """Sync phone numbers from Twilio to our database."""
        try:
            # Get all phone numbers from Twilio
            twilio_numbers = self.client.incoming_phone_numbers.list()
            
            synced_numbers = []
            
            for twilio_number in twilio_numbers:
                # Check if we already have this number in our database
                existing_numbers = await PhoneNumberCRUD.get_all()
                existing_number = None
                
                for num in existing_numbers:
                    if num.phone_number == twilio_number.phone_number:
                        existing_number = num
                        break
                
                if not existing_number:
                    # Create new phone number record
                    phone_number = PhoneNumber(
                        phone_number=twilio_number.phone_number,
                        twilio_sid=twilio_number.sid,
                        friendly_name=twilio_number.friendly_name or f"Phone {twilio_number.phone_number}",
                        capabilities=self._get_capabilities(twilio_number),
                        status="available"
                    )
                    
                    created_number = await PhoneNumberCRUD.create(phone_number)
                    synced_numbers.append(created_number)
                    logger.info(f"Added new phone number: {twilio_number.phone_number}")
                else:
                    synced_numbers.append(existing_number)
            
            logger.info(f"Synced {len(synced_numbers)} phone numbers from Twilio")
            return synced_numbers
            
        except TwilioException as e:
            logger.error(f"Twilio API error during sync: {e}")
            raise
        except Exception as e:
            logger.error(f"Error syncing phone numbers: {e}")
            raise
    
    def _get_capabilities(self, twilio_number) -> List[str]:
        """Extract capabilities from Twilio phone number object."""
        capabilities = []
        
        if getattr(twilio_number, 'capabilities', None):
            caps = twilio_number.capabilities
            if getattr(caps, 'voice', False):
                capabilities.append('voice')
            if getattr(caps, 'sms', False):
                capabilities.append('sms')
            if getattr(caps, 'mms', False):
                capabilities.append('mms')
        
        return capabilities if capabilities else ['voice']  # Default to voice
    
    async def configure_webhook(self, phone_number: str, webhook_url: str) -> bool:
        """Configure webhook URL for a phone number."""
        try:
            # Find the phone number in Twilio
            numbers = self.client.incoming_phone_numbers.list()
            twilio_number = None
            
            for number in numbers:
                if number.phone_number == phone_number:
                    twilio_number = number
                    break
            
            if not twilio_number:
                logger.error(f"Phone number {phone_number} not found in Twilio account")
                return False
            
            # Update webhook URL
            self.client.incoming_phone_numbers(twilio_number.sid).update(
                voice_url=webhook_url,
                voice_method='POST'
            )
            
            logger.info(f"Updated webhook for {phone_number} to {webhook_url}")
            return True
            
        except TwilioException as e:
            logger.error(f"Twilio API error configuring webhook: {e}")
            return False
        except Exception as e:
            logger.error(f"Error configuring webhook: {e}")
            return False
    
    def make_call(
        self, 
        to_number: str, 
        from_number: str, 
        twiml_url: str,
        agent_context: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """Initiate an outbound call."""
        try:
            # Create call with custom parameters
            call = self.client.calls.create(
                to=to_number,
                from_=from_number,
                url=twiml_url,
                method='POST'
            )
            
            logger.info(f"Initiated call {call.sid} from {from_number} to {to_number}")
            return call.sid
            
        except TwilioException as e:
            logger.error(f"Twilio API error making call: {e}")
            return None
        except Exception as e:
            logger.error(f"Error making call: {e}")
            return None
    
    def get_call_status(self, call_sid: str) -> Optional[Dict[str, Any]]:
        """Get current status of a call."""
        try:
            call = self.client.calls(call_sid).fetch()
            
            return {
                "call_sid": call.sid,
                "status": call.status,
                "direction": call.direction,
                "from": call.from_formatted,
                "to": call.to_formatted,
                "start_time": call.start_time,
                "end_time": call.end_time,
                "duration": call.duration,
                "price": call.price,
                "price_unit": call.price_unit
            }
            
        except TwilioException as e:
            logger.error(f"Twilio API error getting call status: {e}")
            return None
        except Exception as e:
            logger.error(f"Error getting call status: {e}")
            return None
    
    def hangup_call(self, call_sid: str) -> bool:
        """End an active call."""
        try:
            self.client.calls(call_sid).update(status='completed')
            logger.info(f"Hung up call {call_sid}")
            return True
            
        except TwilioException as e:
            logger.error(f"Twilio API error hanging up call: {e}")
            return False
        except Exception as e:
            logger.error(f"Error hanging up call: {e}")
            return False

# Global service instance
twilio_service = TwilioService()

def get_twilio_service() -> TwilioService:
    """Get Twilio service instance."""
    return twilio_service