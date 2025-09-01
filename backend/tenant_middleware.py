"""Middleware for tenant context and isolation."""

import logging
from typing import Optional
from uuid import UUID

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from backend.database import SessionLocal, TenantDB
from backend.auth import extract_tenant_from_subdomain, extract_tenant_from_api_key

logger = logging.getLogger(__name__)


class TenantContextMiddleware:
    """Middleware to inject tenant context into requests."""
    
    # Paths that don't require tenant context
    EXEMPT_PATHS = [
        "/healthz",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/auth/register",  # Tenant registration
        "/auth/superadmin",  # Superadmin login
    ]
    
    async def __call__(self, request: Request, call_next):
        """Process request and inject tenant context."""
        # Skip tenant validation for exempt paths
        if any(request.url.path.startswith(path) for path in self.EXEMPT_PATHS):
            response = await call_next(request)
            return response
        
        # Skip for static files
        if request.url.path.startswith("/dashboard/") or request.url.path.endswith((".js", ".css", ".html")):
            response = await call_next(request)
            return response
        
        # Get database session
        db = SessionLocal()
        
        try:
            tenant = None
            tenant_id = None
            
            # Try to extract tenant from API key
            api_key = request.headers.get("X-API-Key")
            if api_key:
                tenant_id = extract_tenant_from_api_key(api_key, db)
                if tenant_id:
                    tenant = db.query(TenantDB).filter(
                        TenantDB.id == tenant_id
                    ).first()
            
            # Try to extract tenant from subdomain
            if not tenant:
                subdomain = extract_tenant_from_subdomain(request)
                if subdomain:
                    tenant = db.query(TenantDB).filter(
                        TenantDB.subdomain == subdomain
                    ).first()
            
            # Try to extract from JWT token (handled in auth dependencies)
            # This is a fallback for authenticated endpoints
            
            # Special handling for Twilio webhooks
            if request.url.path in ["/receive_call", "/start_call", "/relay/ws"]:
                # For Twilio webhooks, we might get tenant info from the phone number
                # This will be handled in the endpoint itself
                request.state.tenant_id = None
                request.state.tenant = None
                response = await call_next(request)
                return response
            
            # Verify tenant exists and is active
            if tenant:
                if tenant.status not in ["active", "trial"]:
                    return JSONResponse(
                        status_code=403,
                        content={"error": f"Tenant is {tenant.status}"}
                    )
                
                # Add tenant to request state
                request.state.tenant_id = tenant.id
                request.state.tenant = tenant
                
                logger.info(f"Request for tenant: {tenant.subdomain} (ID: {tenant.id})")
            else:
                # Some endpoints don't require tenant context
                if request.url.path.startswith("/auth/"):
                    request.state.tenant_id = None
                    request.state.tenant = None
                else:
                    logger.warning(f"No tenant context for path: {request.url.path}")
                    request.state.tenant_id = None
                    request.state.tenant = None
            
            # Process request
            response = await call_next(request)
            
            # Add tenant header to response
            if tenant:
                response.headers["X-Tenant-ID"] = str(tenant.id)
                response.headers["X-Tenant-Subdomain"] = tenant.subdomain
            
            return response
            
        except Exception as e:
            logger.error(f"Error in tenant middleware: {str(e)}")
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"}
            )
        finally:
            db.close()


class TenantRateLimitMiddleware:
    """Middleware to enforce per-tenant rate limits."""
    
    def __init__(self):
        # In-memory rate limit tracking (use Redis in production)
        self.request_counts = {}
    
    async def __call__(self, request: Request, call_next):
        """Check and enforce rate limits."""
        tenant_id = getattr(request.state, "tenant_id", None)
        
        if not tenant_id:
            # No tenant context, allow request
            response = await call_next(request)
            return response
        
        tenant = getattr(request.state, "tenant", None)
        if not tenant:
            response = await call_next(request)
            return response
        
        # Check concurrent call limits for call-related endpoints
        if request.url.path in ["/start_call", "/receive_call"]:
            if tenant.current_active_calls >= tenant.max_concurrent_calls:
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": "Concurrent call limit reached",
                        "limit": tenant.max_concurrent_calls,
                        "current": tenant.current_active_calls
                    }
                )
        
        # Check monthly minute limits
        if tenant.current_month_minutes >= tenant.max_monthly_minutes:
            if request.url.path in ["/start_call", "/receive_call"]:
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": "Monthly minute limit reached",
                        "limit": tenant.max_monthly_minutes,
                        "used": tenant.current_month_minutes
                    }
                )
        
        # Process request
        response = await call_next(request)
        return response


class TenantUsageTrackingMiddleware:
    """Middleware to track tenant API usage."""
    
    async def __call__(self, request: Request, call_next):
        """Track API usage per tenant."""
        tenant_id = getattr(request.state, "tenant_id", None)
        
        # Process request
        response = await call_next(request)
        
        if tenant_id and response.status_code < 400:
            # Track successful API calls
            # In production, this would write to a metrics system
            logger.debug(f"API call for tenant {tenant_id}: {request.method} {request.url.path}")
        
        return response