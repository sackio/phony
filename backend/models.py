"""Database models for multi-tenant support."""

from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID, uuid4
from enum import Enum
from pydantic import BaseModel, Field


class TenantStatus(str, Enum):
    """Tenant account status."""
    TRIAL = "trial"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    CANCELLED = "cancelled"


class UserRole(str, Enum):
    """User roles within a tenant."""
    ADMIN = "admin"
    SUPERVISOR = "supervisor"
    VIEWER = "viewer"


class CallDirection(str, Enum):
    """Call direction."""
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class CallStatus(str, Enum):
    """Call session status."""
    INITIATING = "initiating"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"


# ==================== Tenant Models ====================

class Tenant(BaseModel):
    """Tenant organization model."""
    id: UUID = Field(default_factory=uuid4)
    name: str
    subdomain: str  # e.g., "acme" for acme.phony.pushbuild.com
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    status: TenantStatus = TenantStatus.TRIAL
    
    # Limits
    max_concurrent_calls: int = 5
    max_monthly_minutes: int = 1000
    max_phone_numbers: int = 3
    
    # Configuration
    settings: Dict[str, Any] = Field(default_factory=dict)
    features: Dict[str, bool] = Field(default_factory=dict)
    
    # Usage tracking
    current_month_minutes: int = 0
    current_active_calls: int = 0


class TenantCreate(BaseModel):
    """Model for creating a new tenant."""
    name: str
    subdomain: str
    max_concurrent_calls: int = 5
    max_monthly_minutes: int = 1000
    max_phone_numbers: int = 3


class TenantUpdate(BaseModel):
    """Model for updating tenant settings."""
    name: Optional[str] = None
    status: Optional[TenantStatus] = None
    max_concurrent_calls: Optional[int] = None
    max_monthly_minutes: Optional[int] = None
    max_phone_numbers: Optional[int] = None
    settings: Optional[Dict[str, Any]] = None
    features: Optional[Dict[str, bool]] = None


# ==================== User Models ====================

class TenantUser(BaseModel):
    """User within a tenant organization."""
    id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    email: str
    hashed_password: str
    role: UserRole = UserRole.VIEWER
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login: Optional[datetime] = None
    is_active: bool = True


class UserCreate(BaseModel):
    """Model for creating a new user."""
    email: str
    password: str
    role: UserRole = UserRole.VIEWER


class UserLogin(BaseModel):
    """Model for user login."""
    email: str
    password: str
    tenant_subdomain: str


# ==================== Phone Number Models ====================

class TenantPhoneNumber(BaseModel):
    """Phone number assigned to a tenant."""
    id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    phone_number: str
    twilio_sid: str
    friendly_name: Optional[str] = None
    
    # Configuration
    type: str = "both"  # inbound, outbound, both
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # AI Settings for this number
    default_voice: str = "alloy"
    default_greeting: Optional[str] = None
    system_prompt: Optional[str] = None


class PhoneNumberCreate(BaseModel):
    """Model for adding a phone number to tenant."""
    phone_number: str
    friendly_name: Optional[str] = None
    type: str = "both"
    default_voice: str = "alloy"
    default_greeting: Optional[str] = None
    system_prompt: Optional[str] = None


# ==================== API Key Models ====================

class TenantAPIKey(BaseModel):
    """API key for programmatic access."""
    id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    key_hash: str  # Hashed API key
    name: str
    scopes: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_used: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    is_active: bool = True


class APIKeyCreate(BaseModel):
    """Model for creating an API key."""
    name: str
    scopes: List[str] = Field(default_factory=list)
    expires_at: Optional[datetime] = None


class APIKeyResponse(BaseModel):
    """Response when creating an API key."""
    id: UUID
    key: str  # Only returned once on creation
    name: str
    scopes: List[str]
    expires_at: Optional[datetime]


# ==================== Call Session Models ====================

class CallSession(BaseModel):
    """Active or completed call session."""
    id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    call_sid: str
    phone_number_id: UUID
    
    # Call details
    from_number: str
    to_number: str
    direction: CallDirection
    status: CallStatus = CallStatus.INITIATING
    
    # Timing
    started_at: datetime = Field(default_factory=datetime.utcnow)
    answered_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    
    # AI Configuration
    ai_personality: Optional[str] = None
    system_prompt: Optional[str] = None
    voice: str = "alloy"
    
    # Metrics
    transcript_count: int = 0
    command_count: int = 0
    override_count: int = 0
    
    # Costs
    estimated_cost: float = 0.0


class CallSessionCreate(BaseModel):
    """Model for creating a call session."""
    call_sid: str
    phone_number_id: UUID
    from_number: str
    to_number: str
    direction: CallDirection
    ai_personality: Optional[str] = None
    system_prompt: Optional[str] = None
    voice: str = "alloy"


# ==================== Transcript Models ====================

class SessionTranscript(BaseModel):
    """Transcript entry for a call session."""
    id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    tenant_id: UUID
    speaker: str  # caller, assistant, supervisor
    text: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    confidence: Optional[float] = None


class TranscriptCreate(BaseModel):
    """Model for creating a transcript entry."""
    session_id: UUID
    speaker: str
    text: str
    confidence: Optional[float] = None


# ==================== Usage Models ====================

class TenantUsage(BaseModel):
    """Tenant usage metrics for billing."""
    id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    period_start: datetime
    period_end: datetime
    
    # Usage metrics
    total_minutes: int = 0
    inbound_minutes: int = 0
    outbound_minutes: int = 0
    transcript_count: int = 0
    command_count: int = 0
    
    # Costs
    twilio_cost: float = 0.0
    openai_cost: float = 0.0
    platform_fee: float = 0.0
    total_cost: float = 0.0


class UsageSummary(BaseModel):
    """Usage summary for dashboard display."""
    tenant_id: UUID
    current_month_minutes: int
    monthly_limit: int
    active_calls: int
    concurrent_limit: int
    percentage_used: float


# ==================== WebSocket Models ====================

class TenantWebSocketConnection(BaseModel):
    """Track WebSocket connections per tenant."""
    tenant_id: UUID
    connection_id: str
    call_sid: Optional[str] = None
    connected_at: datetime = Field(default_factory=datetime.utcnow)
    connection_type: str  # "dashboard", "relay", "events"


# ==================== Token Models ====================

class TokenData(BaseModel):
    """JWT token payload."""
    user_id: UUID
    tenant_id: UUID
    email: str
    role: UserRole
    exp: datetime