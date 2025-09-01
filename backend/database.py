"""MongoDB database connection and configuration for the Phony voice AI agent system."""

import os
from datetime import datetime
from typing import Optional, Dict, Any, List, Union
from uuid import uuid4
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase, AsyncIOMotorCollection
from pymongo.errors import ServerSelectionTimeoutError
from pydantic import BaseModel, Field
import logging

logger = logging.getLogger(__name__)

# MongoDB connection URL from environment
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "phony")


# ==================== Pydantic Models ====================

class Agent(BaseModel):
    """AI Agent model for making and receiving calls."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    type: str  # "inbound", "outbound"
    phone_number: Optional[str] = None  # Twilio phone number (required for inbound)
    twilio_sid: Optional[str] = None  # Twilio phone number SID
    
    # AI Configuration
    system_prompt: str = "You are a helpful AI assistant."
    voice: str = "alloy"  # OpenAI voice
    personality: Optional[str] = None
    
    # Context and behavior
    context_data: Dict[str, Any] = Field(default_factory=dict)
    greeting_message: Optional[str] = None
    
    # Status and metadata
    status: str = "active"  # active, inactive, disabled
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Usage tracking
    total_calls: int = 0
    total_minutes: int = 0
    last_call_at: Optional[datetime] = None

class CallContext(BaseModel):
    """Real-time call context that can be updated during calls."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    agent_id: str
    call_sid: Optional[str] = None
    
    # Dynamic context data
    context_data: Dict[str, Any] = Field(default_factory=dict)
    notes: str = ""
    
    # Call information
    caller_number: Optional[str] = None
    call_direction: Optional[str] = None  # inbound, outbound
    call_status: str = "active"
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class CallSession(BaseModel):
    """Complete call session record."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    call_sid: str
    agent_id: str
    
    # Call details
    from_number: str
    to_number: str
    direction: str  # inbound, outbound
    status: str = "initiated"  # initiated, ringing, active, completed, failed
    
    # Timing
    started_at: datetime = Field(default_factory=datetime.utcnow)
    answered_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    
    # AI Configuration used
    system_prompt: str
    voice: str
    context_data: Dict[str, Any] = Field(default_factory=dict)
    
    # Metrics
    transcript_count: int = 0
    command_count: int = 0
    override_count: int = 0
    
    # Cost tracking
    estimated_cost: float = 0.0
    openai_tokens: int = 0
    twilio_cost: float = 0.0

class Transcript(BaseModel):
    """Individual transcript entry."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    session_id: str
    call_sid: str
    agent_id: str
    
    # Content
    speaker: str  # caller, assistant, supervisor
    text: str
    confidence: Optional[float] = None
    
    # Metadata
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    event_type: str = "transcript"  # transcript, command, override

class PhoneNumber(BaseModel):
    """Available Twilio phone numbers."""
    phone_number: str
    twilio_sid: str
    friendly_name: Optional[str] = None
    assigned_agent_id: Optional[str] = None  # Only one agent per number for inbound
    capabilities: List[str] = Field(default_factory=list)  # voice, sms, mms
    status: str = "available"  # available, assigned, disabled

class Database:
    """MongoDB database manager for agent deployment system."""
    
    def __init__(self):
        self.client: Optional[AsyncIOMotorClient] = None
        self.db: Optional[AsyncIOMotorDatabase] = None
        
        # Collections
        self.agents: Optional[AsyncIOMotorCollection] = None
        self.call_contexts: Optional[AsyncIOMotorCollection] = None
        self.call_sessions: Optional[AsyncIOMotorCollection] = None
        self.transcripts: Optional[AsyncIOMotorCollection] = None
        self.phone_numbers: Optional[AsyncIOMotorCollection] = None
        
    async def connect(self):
        """Connect to MongoDB database."""
        try:
            self.client = AsyncIOMotorClient(MONGODB_URL)
            
            # Test connection
            await self.client.admin.command('ismaster')
            
            self.db = self.client[MONGODB_DATABASE]
            
            # Initialize collections
            self.agents = self.db.agents
            self.call_contexts = self.db.call_contexts
            self.call_sessions = self.db.call_sessions
            self.transcripts = self.db.transcripts
            self.phone_numbers = self.db.phone_numbers
            
            # Create indexes
            await self._create_indexes()
            
            logger.info(f"Connected to MongoDB: {MONGODB_URL}/{MONGODB_DATABASE}")
            
        except ServerSelectionTimeoutError:
            logger.error("Failed to connect to MongoDB - server timeout")
            raise
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise
    
    async def disconnect(self):
        """Disconnect from MongoDB."""
        if self.client:
            self.client.close()
            logger.info("Disconnected from MongoDB")
    
    async def _create_indexes(self):
        """Create database indexes for optimal performance."""
        if not self.agents:
            return
            
        # Agent indexes
        await self.agents.create_index("phone_number", unique=True, sparse=True)
        await self.agents.create_index("type")
        await self.agents.create_index("status")
        await self.agents.create_index("created_at")
        
        # Call context indexes
        await self.call_contexts.create_index("agent_id")
        await self.call_contexts.create_index("call_sid", unique=True, sparse=True)
        await self.call_contexts.create_index("updated_at")
        
        # Call session indexes
        await self.call_sessions.create_index("call_sid", unique=True)
        await self.call_sessions.create_index("agent_id")
        await self.call_sessions.create_index("started_at")
        await self.call_sessions.create_index("status")
        
        # Transcript indexes
        await self.transcripts.create_index("call_sid")
        await self.transcripts.create_index("agent_id")
        await self.transcripts.create_index("session_id")
        await self.transcripts.create_index("timestamp")
        
        # Phone number indexes
        await self.phone_numbers.create_index("phone_number", unique=True)
        await self.phone_numbers.create_index("twilio_sid", unique=True)
        await self.phone_numbers.create_index("assigned_agent_id", sparse=True)
        
        logger.info("Database indexes created")

# Global database instance
db = Database()

async def get_database() -> Database:
    """Get database instance (dependency injection)."""
    return db

async def init_database():
    """Initialize database connection."""
    await db.connect()

async def close_database():
    """Close database connection."""
    await db.disconnect()


# ==================== CRUD Operations ====================

class AgentCRUD:
    """CRUD operations for AI agents."""
    
    @staticmethod
    async def create(agent: Agent) -> Agent:
        """Create a new agent."""
        agent_dict = agent.model_dump()
        result = await db.agents.insert_one(agent_dict)
        agent.id = str(result.inserted_id) if result.inserted_id != agent.id else agent.id
        return agent
    
    @staticmethod
    async def get(agent_id: str) -> Optional[Agent]:
        """Get agent by ID."""
        doc = await db.agents.find_one({"id": agent_id})
        return Agent(**doc) if doc else None
    
    @staticmethod
    async def get_by_phone_number(phone_number: str) -> Optional[Agent]:
        """Get agent by phone number."""
        doc = await db.agents.find_one({"phone_number": phone_number})
        return Agent(**doc) if doc else None
    
    @staticmethod
    async def get_all() -> List[Agent]:
        """Get all agents."""
        cursor = db.agents.find()
        agents = []
        async for doc in cursor:
            agents.append(Agent(**doc))
        return agents
    
    @staticmethod
    async def update(agent_id: str, updates: Dict[str, Any]) -> Optional[Agent]:
        """Update agent."""
        updates["updated_at"] = datetime.utcnow()
        result = await db.agents.update_one(
            {"id": agent_id},
            {"$set": updates}
        )
        if result.modified_count:
            return await AgentCRUD.get(agent_id)
        return None
    
    @staticmethod
    async def delete(agent_id: str) -> bool:
        """Delete agent."""
        result = await db.agents.delete_one({"id": agent_id})
        return result.deleted_count > 0
    
    @staticmethod
    async def increment_calls(agent_id: str, minutes: int = 0):
        """Increment agent's call stats."""
        await db.agents.update_one(
            {"id": agent_id},
            {
                "$inc": {"total_calls": 1, "total_minutes": minutes},
                "$set": {"last_call_at": datetime.utcnow()}
            }
        )


class CallContextCRUD:
    """CRUD operations for call contexts."""
    
    @staticmethod
    async def create(context: CallContext) -> CallContext:
        """Create a new call context."""
        context_dict = context.model_dump()
        result = await db.call_contexts.insert_one(context_dict)
        return context
    
    @staticmethod
    async def get_by_agent(agent_id: str) -> Optional[CallContext]:
        """Get context by agent ID."""
        doc = await db.call_contexts.find_one({"agent_id": agent_id})
        return CallContext(**doc) if doc else None
    
    @staticmethod
    async def get_by_call_sid(call_sid: str) -> Optional[CallContext]:
        """Get context by call SID."""
        doc = await db.call_contexts.find_one({"call_sid": call_sid})
        return CallContext(**doc) if doc else None
    
    @staticmethod
    async def update(context_id: str, updates: Dict[str, Any]) -> Optional[CallContext]:
        """Update call context."""
        updates["updated_at"] = datetime.utcnow()
        result = await db.call_contexts.update_one(
            {"id": context_id},
            {"$set": updates}
        )
        if result.modified_count:
            doc = await db.call_contexts.find_one({"id": context_id})
            return CallContext(**doc) if doc else None
        return None
    
    @staticmethod
    async def update_by_call_sid(call_sid: str, updates: Dict[str, Any]) -> Optional[CallContext]:
        """Update context by call SID."""
        updates["updated_at"] = datetime.utcnow()
        result = await db.call_contexts.update_one(
            {"call_sid": call_sid},
            {"$set": updates}
        )
        if result.modified_count:
            doc = await db.call_contexts.find_one({"call_sid": call_sid})
            return CallContext(**doc) if doc else None
        return None


class CallSessionCRUD:
    """CRUD operations for call sessions."""
    
    @staticmethod
    async def create(session: CallSession) -> CallSession:
        """Create a new call session."""
        session_dict = session.model_dump()
        result = await db.call_sessions.insert_one(session_dict)
        return session
    
    @staticmethod
    async def get_by_call_sid(call_sid: str) -> Optional[CallSession]:
        """Get session by call SID."""
        doc = await db.call_sessions.find_one({"call_sid": call_sid})
        return CallSession(**doc) if doc else None
    
    @staticmethod
    async def update_status(call_sid: str, status: str) -> Optional[CallSession]:
        """Update session status."""
        updates = {"status": status, "updated_at": datetime.utcnow()}
        
        if status == "completed":
            updates["ended_at"] = datetime.utcnow()
            
            # Calculate duration if we have start time
            session = await CallSessionCRUD.get_by_call_sid(call_sid)
            if session and session.started_at:
                duration = (updates["ended_at"] - session.started_at).total_seconds()
                updates["duration_seconds"] = int(duration)
        
        result = await db.call_sessions.update_one(
            {"call_sid": call_sid},
            {"$set": updates}
        )
        
        if result.modified_count:
            return await CallSessionCRUD.get_by_call_sid(call_sid)
        return None
    
    @staticmethod
    async def get_active_sessions() -> List[CallSession]:
        """Get all active call sessions."""
        cursor = db.call_sessions.find({"status": {"$in": ["active", "ringing"]}})
        sessions = []
        async for doc in cursor:
            sessions.append(CallSession(**doc))
        return sessions


class PhoneNumberCRUD:
    """CRUD operations for phone numbers."""
    
    @staticmethod
    async def create(phone_number: PhoneNumber) -> PhoneNumber:
        """Create/register a phone number."""
        phone_dict = phone_number.model_dump()
        result = await db.phone_numbers.insert_one(phone_dict)
        return phone_number
    
    @staticmethod
    async def get_all() -> List[PhoneNumber]:
        """Get all phone numbers."""
        cursor = db.phone_numbers.find()
        numbers = []
        async for doc in cursor:
            numbers.append(PhoneNumber(**doc))
        return numbers
    
    @staticmethod
    async def get_available() -> List[PhoneNumber]:
        """Get available (unassigned) phone numbers."""
        cursor = db.phone_numbers.find({"assigned_agent_id": None, "status": "available"})
        numbers = []
        async for doc in cursor:
            numbers.append(PhoneNumber(**doc))
        return numbers
    
    @staticmethod
    async def assign_to_agent(phone_number: str, agent_id: str) -> bool:
        """Assign phone number to an agent."""
        result = await db.phone_numbers.update_one(
            {"phone_number": phone_number, "assigned_agent_id": None},
            {"$set": {"assigned_agent_id": agent_id, "status": "assigned"}}
        )
        return result.modified_count > 0
    
    @staticmethod
    async def unassign(phone_number: str) -> bool:
        """Unassign phone number from agent."""
        result = await db.phone_numbers.update_one(
            {"phone_number": phone_number},
            {"$set": {"assigned_agent_id": None, "status": "available"}}
        )
        return result.modified_count > 0


class TranscriptCRUD:
    """CRUD operations for transcripts."""
    
    @staticmethod
    async def create(transcript: Transcript) -> Transcript:
        """Create a new transcript entry."""
        transcript_dict = transcript.model_dump()
        result = await db.transcripts.insert_one(transcript_dict)
        
        # Update session transcript count
        await db.call_sessions.update_one(
            {"call_sid": transcript.call_sid},
            {"$inc": {"transcript_count": 1}}
        )
        
        return transcript
    
    @staticmethod
    async def get_by_call_sid(call_sid: str) -> List[Transcript]:
        """Get all transcripts for a call."""
        cursor = db.transcripts.find({"call_sid": call_sid}).sort("timestamp", 1)
        transcripts = []
        async for doc in cursor:
            transcripts.append(Transcript(**doc))
        return transcripts
