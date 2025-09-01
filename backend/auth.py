"""Authentication and authorization for multi-tenant system."""

import os
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional, Tuple, List
from uuid import UUID

import jwt
from fastapi import HTTPException, Security, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from backend.database import get_db, TenantDB, TenantUserDB, TenantAPIKeyDB

# Configuration
SECRET_KEY = os.getenv("JWT_SECRET_KEY", secrets.token_urlsafe(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Bearer token scheme
bearer_scheme = HTTPBearer()


# ==================== Password Utilities ====================

def hash_password(password: str) -> str:
    """Hash a password for storage."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(plain_password, hashed_password)


# ==================== API Key Utilities ====================

def generate_api_key() -> str:
    """Generate a new API key."""
    return f"pk_{secrets.token_urlsafe(32)}"


def hash_api_key(api_key: str) -> str:
    """Hash an API key for storage."""
    return hashlib.sha256(api_key.encode()).hexdigest()


# ==================== JWT Token Utilities ====================

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ==================== Tenant Extraction ====================

def extract_tenant_from_subdomain(request: Request) -> Optional[str]:
    """Extract tenant subdomain from request host."""
    host = request.headers.get("host", "")
    
    # Handle localhost for development
    if host.startswith("localhost") or host.startswith("127.0.0.1"):
        # Check for X-Tenant-Subdomain header in development
        return request.headers.get("X-Tenant-Subdomain")
    
    # Extract subdomain from host
    parts = host.split(".")
    if len(parts) >= 3:  # subdomain.domain.tld
        return parts[0]
    
    return None


def extract_tenant_from_api_key(api_key: str, db: Session) -> Optional[UUID]:
    """Extract tenant ID from API key."""
    key_hash = hash_api_key(api_key)
    
    api_key_record = db.query(TenantAPIKeyDB).filter(
        TenantAPIKeyDB.key_hash == key_hash,
        TenantAPIKeyDB.is_active == True
    ).first()
    
    if api_key_record:
        # Check expiration
        if api_key_record.expires_at and api_key_record.expires_at < datetime.utcnow():
            return None
        
        # Update last used timestamp
        api_key_record.last_used = datetime.utcnow()
        db.commit()
        
        return api_key_record.tenant_id
    
    return None


# ==================== Authentication Dependencies ====================

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
    db: Session = Depends(get_db)
) -> TenantUserDB:
    """Get current authenticated user from JWT token."""
    token = credentials.credentials
    
    try:
        payload = decode_token(token)
        user_id = UUID(payload.get("user_id"))
        tenant_id = UUID(payload.get("tenant_id"))
        
        user = db.query(TenantUserDB).filter(
            TenantUserDB.id == user_id,
            TenantUserDB.tenant_id == tenant_id,
            TenantUserDB.is_active == True
        ).first()
        
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        
        return user
        
    except (ValueError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid token payload")


async def get_current_tenant(
    request: Request,
    db: Session = Depends(get_db)
) -> TenantDB:
    """Get current tenant from request context."""
    # Try API key first
    api_key = request.headers.get("X-API-Key")
    if api_key:
        tenant_id = extract_tenant_from_api_key(api_key, db)
        if tenant_id:
            tenant = db.query(TenantDB).filter(
                TenantDB.id == tenant_id,
                TenantDB.status == "active"
            ).first()
            if tenant:
                return tenant
    
    # Try subdomain
    subdomain = extract_tenant_from_subdomain(request)
    if subdomain:
        tenant = db.query(TenantDB).filter(
            TenantDB.subdomain == subdomain,
            TenantDB.status == "active"
        ).first()
        if tenant:
            return tenant
    
    # Try JWT token
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            payload = decode_token(token)
            tenant_id = UUID(payload.get("tenant_id"))
            tenant = db.query(TenantDB).filter(
                TenantDB.id == tenant_id,
                TenantDB.status == "active"
            ).first()
            if tenant:
                return tenant
        except:
            pass
    
    raise HTTPException(status_code=401, detail="Tenant identification required")


# ==================== Authorization Dependencies ====================

async def require_tenant_admin(
    current_user: TenantUserDB = Depends(get_current_user)
) -> TenantUserDB:
    """Require current user to be a tenant admin."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


async def require_tenant_supervisor(
    current_user: TenantUserDB = Depends(get_current_user)
) -> TenantUserDB:
    """Require current user to be at least a supervisor."""
    if current_user.role not in ["admin", "supervisor"]:
        raise HTTPException(status_code=403, detail="Supervisor access required")
    return current_user


# ==================== User Authentication ====================

def authenticate_user(
    db: Session,
    email: str,
    password: str,
    tenant_id: UUID
) -> Optional[TenantUserDB]:
    """Authenticate a user within a tenant."""
    user = db.query(TenantUserDB).filter(
        TenantUserDB.email == email,
        TenantUserDB.tenant_id == tenant_id,
        TenantUserDB.is_active == True
    ).first()
    
    if not user or not verify_password(password, user.hashed_password):
        return None
    
    # Update last login
    user.last_login = datetime.utcnow()
    db.commit()
    
    return user


# ==================== API Key Management ====================

def create_api_key(
    db: Session,
    tenant_id: UUID,
    name: str,
    scopes: List[str] = None,
    expires_at: Optional[datetime] = None
) -> Tuple[str, TenantAPIKeyDB]:
    """Create a new API key for a tenant."""
    api_key = generate_api_key()
    key_hash = hash_api_key(api_key)
    
    api_key_record = TenantAPIKeyDB(
        tenant_id=tenant_id,
        key_hash=key_hash,
        name=name,
        scopes=scopes or [],
        expires_at=expires_at,
        is_active=True
    )
    
    db.add(api_key_record)
    db.commit()
    db.refresh(api_key_record)
    
    return api_key, api_key_record


def revoke_api_key(db: Session, api_key_id: UUID, tenant_id: UUID) -> bool:
    """Revoke an API key."""
    api_key_record = db.query(TenantAPIKeyDB).filter(
        TenantAPIKeyDB.id == api_key_id,
        TenantAPIKeyDB.tenant_id == tenant_id
    ).first()
    
    if api_key_record:
        api_key_record.is_active = False
        db.commit()
        return True
    
    return False