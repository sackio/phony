"""Tenant management API endpoints."""

from datetime import datetime, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.database import (
    get_db, TenantDB, TenantUserDB, TenantPhoneNumberDB, TenantAPIKeyDB, CallSessionDB,
    TenantCRUD
)
from backend.models import (
    Tenant, TenantCreate, TenantUpdate, TenantUser, UserCreate, UserLogin,
    TenantPhoneNumber, PhoneNumberCreate, TenantAPIKey, APIKeyCreate, APIKeyResponse,
    CallSession, UsageSummary
)
from backend.auth import (
    get_current_user, get_current_tenant, require_tenant_admin, require_tenant_supervisor,
    authenticate_user, create_access_token, create_api_key, revoke_api_key,
    hash_password
)

router = APIRouter()


# ==================== Tenant Management ====================

@router.post("/tenants", response_model=Tenant)
async def create_tenant(
    tenant_data: TenantCreate,
    db: Session = Depends(get_db)
):
    """Create a new tenant (public endpoint for registration)."""
    # Check if subdomain already exists
    existing = db.query(TenantDB).filter(TenantDB.subdomain == tenant_data.subdomain).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="Subdomain already exists"
        )
    
    # Create tenant
    tenant_dict = tenant_data.dict()
    tenant = TenantCRUD.create(db, tenant_dict)
    
    return tenant


@router.get("/tenant", response_model=Tenant)
async def get_current_tenant_info(
    tenant: TenantDB = Depends(get_current_tenant)
):
    """Get current tenant information."""
    return tenant


@router.put("/tenant", response_model=Tenant)
async def update_tenant(
    updates: TenantUpdate,
    tenant: TenantDB = Depends(get_current_tenant),
    current_user: TenantUserDB = Depends(require_tenant_admin),
    db: Session = Depends(get_db)
):
    """Update current tenant settings."""
    update_dict = updates.dict(exclude_unset=True)
    updated_tenant = TenantCRUD.update(db, tenant.id, update_dict)
    
    if not updated_tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    
    return updated_tenant


@router.get("/tenant/usage", response_model=UsageSummary)
async def get_tenant_usage(
    tenant: TenantDB = Depends(get_current_tenant)
):
    """Get current tenant usage summary."""
    percentage_used = (tenant.current_month_minutes / tenant.max_monthly_minutes) * 100
    
    return UsageSummary(
        tenant_id=tenant.id,
        current_month_minutes=tenant.current_month_minutes,
        monthly_limit=tenant.max_monthly_minutes,
        active_calls=tenant.current_active_calls,
        concurrent_limit=tenant.max_concurrent_calls,
        percentage_used=percentage_used
    )


# ==================== User Management ====================

@router.post("/users", response_model=TenantUser)
async def create_user(
    user_data: UserCreate,
    tenant: TenantDB = Depends(get_current_tenant),
    current_user: TenantUserDB = Depends(require_tenant_admin),
    db: Session = Depends(get_db)
):
    """Create a new user in the current tenant."""
    # Check if user already exists
    existing = db.query(TenantUserDB).filter(
        TenantUserDB.email == user_data.email,
        TenantUserDB.tenant_id == tenant.id
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="User already exists")
    
    # Create user
    hashed_password = hash_password(user_data.password)
    user = TenantUserDB(
        tenant_id=tenant.id,
        email=user_data.email,
        hashed_password=hashed_password,
        role=user_data.role,
        is_active=True
    )
    
    db.add(user)
    db.commit()
    db.refresh(user)
    
    return user


@router.get("/users", response_model=List[TenantUser])
async def list_users(
    tenant: TenantDB = Depends(get_current_tenant),
    current_user: TenantUserDB = Depends(require_tenant_supervisor),
    db: Session = Depends(get_db)
):
    """List all users in the current tenant."""
    users = db.query(TenantUserDB).filter(
        TenantUserDB.tenant_id == tenant.id
    ).all()
    
    return users


@router.get("/users/me", response_model=TenantUser)
async def get_current_user_info(
    current_user: TenantUserDB = Depends(get_current_user)
):
    """Get current user information."""
    return current_user


# ==================== Authentication ====================

@router.post("/auth/login")
async def login(
    login_data: UserLogin,
    db: Session = Depends(get_db)
):
    """Login a user and return JWT token."""
    # Get tenant by subdomain
    tenant = db.query(TenantDB).filter(
        TenantDB.subdomain == login_data.tenant_subdomain,
        TenantDB.status.in_(["active", "trial"])
    ).first()
    
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    
    # Authenticate user
    user = authenticate_user(db, login_data.email, login_data.password, tenant.id)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Create access token
    access_token = create_access_token(
        data={
            "user_id": str(user.id),
            "tenant_id": str(tenant.id),
            "email": user.email,
            "role": user.role
        }
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user,
        "tenant": tenant
    }


# ==================== Phone Number Management ====================

@router.get("/phone-numbers", response_model=List[TenantPhoneNumber])
async def list_phone_numbers(
    tenant: TenantDB = Depends(get_current_tenant),
    current_user: TenantUserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List phone numbers for the current tenant."""
    numbers = db.query(TenantPhoneNumberDB).filter(
        TenantPhoneNumberDB.tenant_id == tenant.id
    ).all()
    
    return numbers


@router.post("/phone-numbers", response_model=TenantPhoneNumber)
async def add_phone_number(
    number_data: PhoneNumberCreate,
    tenant: TenantDB = Depends(get_current_tenant),
    current_user: TenantUserDB = Depends(require_tenant_admin),
    db: Session = Depends(get_db)
):
    """Add a phone number to the current tenant."""
    # Check tenant phone number limit
    current_count = db.query(TenantPhoneNumberDB).filter(
        TenantPhoneNumberDB.tenant_id == tenant.id
    ).count()
    
    if current_count >= tenant.max_phone_numbers:
        raise HTTPException(
            status_code=400,
            detail=f"Phone number limit reached ({tenant.max_phone_numbers})"
        )
    
    # Check if number already exists
    existing = db.query(TenantPhoneNumberDB).filter(
        TenantPhoneNumberDB.phone_number == number_data.phone_number
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Phone number already in use")
    
    # TODO: Verify number with Twilio and get SID
    # For now, using a placeholder SID
    twilio_sid = f"PN{number_data.phone_number.replace('+', '').replace('-', '')}"
    
    # Create phone number record
    phone_number = TenantPhoneNumberDB(
        tenant_id=tenant.id,
        phone_number=number_data.phone_number,
        twilio_sid=twilio_sid,
        friendly_name=number_data.friendly_name,
        type=number_data.type,
        default_voice=number_data.default_voice,
        default_greeting=number_data.default_greeting,
        system_prompt=number_data.system_prompt,
        is_active=True
    )
    
    db.add(phone_number)
    db.commit()
    db.refresh(phone_number)
    
    return phone_number


# ==================== API Key Management ====================

@router.get("/api-keys", response_model=List[TenantAPIKey])
async def list_api_keys(
    tenant: TenantDB = Depends(get_current_tenant),
    current_user: TenantUserDB = Depends(require_tenant_admin),
    db: Session = Depends(get_db)
):
    """List API keys for the current tenant."""
    keys = db.query(TenantAPIKeyDB).filter(
        TenantAPIKeyDB.tenant_id == tenant.id,
        TenantAPIKeyDB.is_active == True
    ).all()
    
    return keys


@router.post("/api-keys", response_model=APIKeyResponse)
async def create_api_key_endpoint(
    key_data: APIKeyCreate,
    tenant: TenantDB = Depends(get_current_tenant),
    current_user: TenantUserDB = Depends(require_tenant_admin),
    db: Session = Depends(get_db)
):
    """Create a new API key for the current tenant."""
    api_key, key_record = create_api_key(
        db=db,
        tenant_id=tenant.id,
        name=key_data.name,
        scopes=key_data.scopes,
        expires_at=key_data.expires_at
    )
    
    return APIKeyResponse(
        id=key_record.id,
        key=api_key,
        name=key_record.name,
        scopes=key_record.scopes,
        expires_at=key_record.expires_at
    )


@router.delete("/api-keys/{key_id}")
async def revoke_api_key_endpoint(
    key_id: UUID,
    tenant: TenantDB = Depends(get_current_tenant),
    current_user: TenantUserDB = Depends(require_tenant_admin),
    db: Session = Depends(get_db)
):
    """Revoke an API key."""
    success = revoke_api_key(db, key_id, tenant.id)
    
    if not success:
        raise HTTPException(status_code=404, detail="API key not found")
    
    return {"status": "revoked"}


# ==================== Call Session Management ====================

@router.get("/sessions", response_model=List[CallSession])
async def list_call_sessions(
    limit: int = 50,
    offset: int = 0,
    tenant: TenantDB = Depends(get_current_tenant),
    current_user: TenantUserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List call sessions for the current tenant."""
    sessions = db.query(CallSessionDB).filter(
        CallSessionDB.tenant_id == tenant.id
    ).order_by(
        CallSessionDB.started_at.desc()
    ).offset(offset).limit(limit).all()
    
    return sessions


@router.get("/sessions/active", response_model=List[CallSession])
async def list_active_sessions(
    tenant: TenantDB = Depends(get_current_tenant),
    current_user: TenantUserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List active call sessions for the current tenant."""
    sessions = db.query(CallSessionDB).filter(
        CallSessionDB.tenant_id == tenant.id,
        CallSessionDB.status == "active"
    ).all()
    
    return sessions


@router.get("/sessions/{session_id}", response_model=CallSession)
async def get_call_session(
    session_id: UUID,
    tenant: TenantDB = Depends(get_current_tenant),
    current_user: TenantUserDB = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific call session."""
    session = db.query(CallSessionDB).filter(
        CallSessionDB.id == session_id,
        CallSessionDB.tenant_id == tenant.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return session