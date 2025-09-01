"""Multi-tenant session management."""

import asyncio
import logging
from typing import Dict, Optional, List
from uuid import UUID
from datetime import datetime

from backend.openai_ws import OpenAIRealtimeSession

logger = logging.getLogger(__name__)


class TenantSessionManager:
    """Manages WebSocket sessions for multiple tenants."""
    
    def __init__(self):
        # Tenant -> CallSid -> Session mapping
        self._sessions: Dict[UUID, Dict[str, OpenAIRealtimeSession]] = {}
        # Tenant -> Connection tracking for dashboard WebSockets
        self._dashboard_connections: Dict[UUID, Dict[str, any]] = {}
        # Lock for thread-safe operations
        self._lock = asyncio.Lock()
        
    async def add_session(
        self,
        tenant_id: UUID,
        call_sid: str,
        session: OpenAIRealtimeSession
    ) -> None:
        """Add a new session for a tenant."""
        async with self._lock:
            if tenant_id not in self._sessions:
                self._sessions[tenant_id] = {}
                logger.info(f"Created session container for tenant {tenant_id}")
            
            self._sessions[tenant_id][call_sid] = session
            logger.info(f"Added session {call_sid} for tenant {tenant_id}")
            logger.info(f"Active sessions for tenant {tenant_id}: {len(self._sessions[tenant_id])}")
    
    async def get_session(
        self,
        tenant_id: UUID,
        call_sid: str
    ) -> Optional[OpenAIRealtimeSession]:
        """Get a session for a tenant."""
        async with self._lock:
            tenant_sessions = self._sessions.get(tenant_id, {})
            session = tenant_sessions.get(call_sid)
            
            if session:
                logger.debug(f"Retrieved session {call_sid} for tenant {tenant_id}")
            else:
                logger.warning(f"Session {call_sid} not found for tenant {tenant_id}")
            
            return session
    
    async def remove_session(
        self,
        tenant_id: UUID,
        call_sid: str
    ) -> bool:
        """Remove a session for a tenant."""
        async with self._lock:
            if tenant_id in self._sessions:
                if call_sid in self._sessions[tenant_id]:
                    del self._sessions[tenant_id][call_sid]
                    logger.info(f"Removed session {call_sid} for tenant {tenant_id}")
                    
                    # Clean up empty tenant container
                    if not self._sessions[tenant_id]:
                        del self._sessions[tenant_id]
                        logger.info(f"Removed empty session container for tenant {tenant_id}")
                    
                    return True
            
            logger.warning(f"Failed to remove session {call_sid} for tenant {tenant_id} - not found")
            return False
    
    async def get_tenant_sessions(self, tenant_id: UUID) -> List[str]:
        """Get all active session IDs for a tenant."""
        async with self._lock:
            tenant_sessions = self._sessions.get(tenant_id, {})
            return list(tenant_sessions.keys())
    
    async def get_session_count(self, tenant_id: UUID) -> int:
        """Get the count of active sessions for a tenant."""
        async with self._lock:
            tenant_sessions = self._sessions.get(tenant_id, {})
            return len(tenant_sessions)
    
    async def has_capacity(self, tenant_id: UUID, max_concurrent: int) -> bool:
        """Check if tenant has capacity for another session."""
        count = await self.get_session_count(tenant_id)
        return count < max_concurrent
    
    async def cleanup_tenant(self, tenant_id: UUID) -> int:
        """Clean up all sessions for a tenant."""
        async with self._lock:
            if tenant_id in self._sessions:
                count = len(self._sessions[tenant_id])
                
                # Close all sessions
                for call_sid, session in self._sessions[tenant_id].items():
                    try:
                        # Attempt to close the session gracefully
                        if hasattr(session, 'close'):
                            await session.close()
                    except Exception as e:
                        logger.error(f"Error closing session {call_sid}: {str(e)}")
                
                del self._sessions[tenant_id]
                logger.info(f"Cleaned up {count} sessions for tenant {tenant_id}")
                return count
            
            return 0
    
    async def add_dashboard_connection(
        self,
        tenant_id: UUID,
        connection_id: str,
        websocket: any
    ) -> None:
        """Add a dashboard WebSocket connection for a tenant."""
        async with self._lock:
            if tenant_id not in self._dashboard_connections:
                self._dashboard_connections[tenant_id] = {}
            
            self._dashboard_connections[tenant_id][connection_id] = websocket
            logger.info(f"Added dashboard connection {connection_id} for tenant {tenant_id}")
    
    async def remove_dashboard_connection(
        self,
        tenant_id: UUID,
        connection_id: str
    ) -> None:
        """Remove a dashboard WebSocket connection."""
        async with self._lock:
            if tenant_id in self._dashboard_connections:
                if connection_id in self._dashboard_connections[tenant_id]:
                    del self._dashboard_connections[tenant_id][connection_id]
                    logger.info(f"Removed dashboard connection {connection_id} for tenant {tenant_id}")
                    
                    # Clean up empty container
                    if not self._dashboard_connections[tenant_id]:
                        del self._dashboard_connections[tenant_id]
    
    async def broadcast_to_tenant_dashboards(
        self,
        tenant_id: UUID,
        message: dict
    ) -> None:
        """Broadcast a message to all dashboard connections for a tenant."""
        async with self._lock:
            connections = self._dashboard_connections.get(tenant_id, {})
            
            if not connections:
                logger.debug(f"No dashboard connections for tenant {tenant_id}")
                return
            
            # Send to all connections
            disconnected = []
            for conn_id, websocket in connections.items():
                try:
                    await websocket.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending to dashboard {conn_id}: {str(e)}")
                    disconnected.append(conn_id)
            
            # Clean up disconnected connections
            for conn_id in disconnected:
                del self._dashboard_connections[tenant_id][conn_id]
    
    def get_stats(self) -> dict:
        """Get statistics about all sessions."""
        stats = {
            "total_tenants": len(self._sessions),
            "total_sessions": sum(len(sessions) for sessions in self._sessions.values()),
            "total_dashboard_connections": sum(
                len(conns) for conns in self._dashboard_connections.values()
            ),
            "tenants": {}
        }
        
        for tenant_id, sessions in self._sessions.items():
            stats["tenants"][str(tenant_id)] = {
                "active_sessions": len(sessions),
                "session_ids": list(sessions.keys()),
                "dashboard_connections": len(self._dashboard_connections.get(tenant_id, {}))
            }
        
        return stats


# Global session manager instance
session_manager = TenantSessionManager()