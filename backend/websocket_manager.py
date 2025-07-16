import asyncio
import json
from typing import Dict, List, Optional
from fastapi import WebSocket
import logging
import time
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Notification
from collections import defaultdict, deque

logger = logging.getLogger(__name__)

class WebSocketConnection:
    """Enhanced WebSocket connection with metadata"""
    def __init__(self, websocket: WebSocket, user_id: int):
        self.websocket = websocket
        self.user_id = user_id
        self.connected_at = datetime.now()
        self.last_ping = time.time()
        self.is_alive = True

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[WebSocketConnection]] = {}
        self.ping_interval = 60  # seconds (increased from 30)
        self.ping_timeout = 120   # seconds (increased from 10)
        self._ping_task = None
        
        # Rate limiting
        self.rate_limits: Dict[int, deque] = defaultdict(lambda: deque())
        self.max_messages_per_minute = 60  # Max messages per user per minute
        self.rate_limit_window = 60  # seconds
        
        # Performance monitoring
        self.stats = {
            "total_messages_sent": 0,
            "total_connections": 0,
            "rate_limited_messages": 0,
            "errors": 0,
            "start_time": datetime.now()
        }
        
        self._start_ping_task()

    def _is_rate_limited(self, user_id: int) -> bool:
        """Check if user is rate limited"""
        now = time.time()
        user_timestamps = self.rate_limits[user_id]
        
        # Remove old timestamps outside the window
        while user_timestamps and user_timestamps[0] < now - self.rate_limit_window:
            user_timestamps.popleft()
        
        # Check if user has exceeded the limit
        if len(user_timestamps) >= self.max_messages_per_minute:
            self.stats["rate_limited_messages"] += 1
            return True
        
        # Add current timestamp
        user_timestamps.append(now)
        return False

    def _start_ping_task(self):
        """Start the ping task for connection health monitoring"""
        if self._ping_task is None:
            self._ping_task = asyncio.create_task(self._ping_connections())

    async def _ping_connections(self):
        """Send ping messages to all connections to check health"""
        while True:
            try:
                await asyncio.sleep(self.ping_interval)
                current_time = time.time()
                
                for user_id in list(self.active_connections.keys()):
                    if user_id in self.active_connections:
                        disconnected = []
                        for connection in self.active_connections[user_id]:
                            try:
                                # Check if connection is stale
                                if current_time - connection.last_ping > self.ping_timeout:
                                    logger.warning(f"Connection timeout for user {user_id}")
                                    disconnected.append(connection)
                                    continue
                                
                                # Send ping
                                await connection.websocket.send_text(json.dumps({
                                    "type": "ping",
                                    "timestamp": current_time
                                }))
                                connection.last_ping = current_time
                                
                            except Exception as e:
                                logger.error(f"Error pinging user {user_id}: {e}")
                                disconnected.append(connection)
                        
                        # Clean up disconnected connections
                        for connection in disconnected:
                            self.disconnect(connection.websocket, user_id)
                            
            except Exception as e:
                logger.error(f"Error in ping task: {e}")

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        
        connection = WebSocketConnection(websocket, user_id)
        self.active_connections[user_id].append(connection)
        self.stats["total_connections"] += 1
        logger.info(f"WebSocket connected for user {user_id} (total connections: {len(self.active_connections[user_id])})")
        
        # Send missed notifications (recent unread ones)
        await self._send_missed_notifications(user_id)

    def disconnect(self, websocket: WebSocket, user_id: int):
        if user_id in self.active_connections:
            # Find and remove the specific connection
            for connection in self.active_connections[user_id][:]:
                if connection.websocket == websocket:
                    connection.is_alive = False
                    self.active_connections[user_id].remove(connection)
                    break
            
            # Clean up empty user entries
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"WebSocket disconnected for user {user_id}")

    async def send_personal_message(self, message: dict, user_id: int, bypass_rate_limit: bool = False):
        # Check rate limiting for non-system messages
        if not bypass_rate_limit and message.get("type") not in ["ping", "auth_status"]:
            if self._is_rate_limited(user_id):
                logger.warning(f"Rate limit exceeded for user {user_id}, dropping message: {message.get('type', 'unknown')}")
                return
        
        if user_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[user_id]:
                if not connection.is_alive:
                    disconnected.append(connection)
                    continue
                    
                try:
                    await connection.websocket.send_text(json.dumps(message))
                    self.stats["total_messages_sent"] += 1
                except Exception as e:
                    logger.error(f"Error sending message to user {user_id}: {e}")
                    connection.is_alive = False
                    disconnected.append(connection)
                    self.stats["errors"] += 1
            
            # Clean up disconnected connections
            for connection in disconnected:
                self.disconnect(connection.websocket, user_id)

    async def send_progress_update(self, user_id: int, message: str, progress: int, status: str = "in_progress"):
        """Send progress update (backward compatibility)"""
        update = {
            "type": "progress_update",
            "message": message,
            "progress": progress,
            "status": status,
            "timestamp": datetime.now().isoformat()
        }
        await self.send_personal_message(update, user_id)

    async def send_enhanced_progress_update(self, user_id: int, show_title: str, operation_type: str,
                                          message: str, progress: int, status: str = "in_progress",
                                          current_step: str = None, total_steps: int = None, 
                                          current_step_number: int = None, details: dict = None):
        """Send enhanced progress update with detailed information for regular operations"""
        
        # Create more detailed progress information
        enhanced_message = message
        if current_step:
            enhanced_message = f"{current_step}: {message}"
        
        update = {
            "type": "enhanced_progress_update",
            "operation_type": operation_type,  # "season_it_single", "season_it_all", etc.
            "show_title": show_title,
            "message": enhanced_message,
            "progress": progress,
            "status": status,
            "current_step": current_step,
            "current_step_number": current_step_number,
            "total_steps": total_steps,
            "details": details or {},
            "timestamp": datetime.now().isoformat()
        }
        await self.send_personal_message(update, user_id)

    async def send_bulk_operation_update(self, user_id: int, operation_id: str, operation_type: str, 
                                       overall_progress: int, current_item: int, total_items: int,
                                       current_item_name: str, current_item_progress: int = 0,
                                       message: str = None, status: str = "in_progress", 
                                       completed_items: list = None, failed_items: list = None,
                                       poster_url: str = None):
        """Send bulk operation progress update with detailed information"""
        
        # Create a more descriptive message that prominently shows the current show title
        if message:
            # If there's a specific message, use it but prefix with show title
            main_message = f"🎬 {current_item_name}: {message}"
        else:
            # Default message with prominent show title
            if operation_type == "season_it_bulk":
                main_message = f"🧂 Season It! Processing '{current_item_name}' ({current_item}/{total_items})"
            else:
                main_message = f"🎬 Processing '{current_item_name}' ({current_item}/{total_items})"
        
        update = {
            "type": "bulk_operation_update",
            "operation_id": operation_id,
            "operation_type": operation_type,  # "season_it_bulk", "search_bulk", etc.
            "overall_progress": overall_progress,
            "current_item": current_item,
            "total_items": total_items,
            "current_item_name": current_item_name,
            "current_item_progress": current_item_progress,
            "message": main_message,
            "status": status,
            "completed_items": completed_items or [],
            "failed_items": failed_items or [],
            "poster_url": poster_url,
            "timestamp": datetime.now().isoformat()
        }
        await self.send_personal_message(update, user_id)

    async def send_bulk_operation_start(self, user_id: int, operation_id: str, operation_type: str, 
                                      total_items: int, items: list, message: str = None):
        """Send bulk operation start notification"""
        
        # Create a more descriptive start message
        if message:
            start_message = message
        else:
            if operation_type == "season_it_bulk":
                start_message = f"🧂 Starting Season It! for {total_items} show{'s' if total_items != 1 else ''}"
            else:
                start_message = f"🎬 Starting {operation_type} for {total_items} item{'s' if total_items != 1 else ''}"
        
        update = {
            "type": "bulk_operation_start",
            "operation_id": operation_id,
            "operation_type": operation_type,
            "total_items": total_items,
            "items": items,  # List of item names/IDs
            "message": start_message,
            "timestamp": datetime.now().isoformat()
        }
        await self.send_personal_message(update, user_id)

    async def send_bulk_operation_complete(self, user_id: int, operation_id: str, operation_type: str,
                                         total_items: int, completed_items: list, failed_items: list,
                                         message: str = None, status: str = "success"):
        """Send bulk operation completion notification"""
        success_count = len(completed_items)
        failure_count = len(failed_items)
        
        if failure_count == 0:
            final_status = "success"
            if operation_type == "season_it_bulk":
                default_message = f"🎉 Season It! completed successfully for all {total_items} show{'s' if total_items != 1 else ''}!"
            else:
                default_message = f"✅ Successfully completed {operation_type} for all {total_items} item{'s' if total_items != 1 else ''}!"
        elif success_count == 0:
            final_status = "error"
            if operation_type == "season_it_bulk":
                default_message = f"❌ Season It! failed for all {total_items} show{'s' if total_items != 1 else ''}"
            else:
                default_message = f"❌ Failed to complete {operation_type} for all {total_items} item{'s' if total_items != 1 else ''}"
        else:
            final_status = "warning"
            if operation_type == "season_it_bulk":
                default_message = f"⚠️ Season It! completed: {success_count} successful, {failure_count} failed"
            else:
                default_message = f"⚠️ Completed {operation_type}: {success_count} successful, {failure_count} failed"
        
        update = {
            "type": "bulk_operation_complete",
            "operation_id": operation_id,
            "operation_type": operation_type,
            "total_items": total_items,
            "success_count": success_count,
            "failure_count": failure_count,
            "completed_items": completed_items,
            "failed_items": failed_items,
            "message": message or default_message,
            "status": final_status,
            "timestamp": datetime.now().isoformat()
        }
        await self.send_personal_message(update, user_id)

    async def send_notification(self, user_id: int, title: str, message: str, notification_type: str = "info", priority: str = "normal", persistent: bool = False, extra_data: dict = None):
        """Send general notification"""
        notification_data = {
            "type": "notification",
            "title": title,
            "message": message,
            "notification_type": notification_type,  # info, success, warning, error
            "priority": priority,  # low, normal, high
            "persistent": persistent,  # whether notification stays until dismissed
            "timestamp": datetime.now().isoformat()
        }
        
        # Save to database
        await self._save_notification_to_db(
            user_id=user_id,
            title=title,
            message=message,
            notification_type=notification_type,
            message_type="notification",
            priority=priority,
            persistent=persistent,
            extra_data=extra_data
        )
        
        await self.send_personal_message(notification_data, user_id)

    async def send_show_update(self, user_id: int, show_id: int, action: str, details: dict = None):
        """Send show-related update"""
        update = {
            "type": "show_update",
            "show_id": show_id,
            "action": action,  # downloaded, monitored, unmonitored, etc.
            "details": details or {},
            "timestamp": datetime.now().isoformat()
        }
        await self.send_personal_message(update, user_id)

    async def broadcast_message(self, message: dict, exclude_user_id: Optional[int] = None):
        """Send message to all connected users"""
        message["timestamp"] = datetime.now().isoformat()
        
        for user_id in list(self.active_connections.keys()):
            if exclude_user_id and user_id == exclude_user_id:
                continue
            await self.send_personal_message(message, user_id)

    async def send_system_announcement(self, title: str, message: str, announcement_type: str = "info"):
        """Send system-wide announcement"""
        announcement = {
            "type": "system_announcement",
            "title": title,
            "message": message,
            "announcement_type": announcement_type,
            "timestamp": datetime.now().isoformat()
        }
        await self.broadcast_message(announcement)

    async def _save_notification_to_db(self, user_id: int, title: str, message: str, notification_type: str, message_type: str, priority: str = "normal", persistent: bool = False, extra_data: dict = None):
        """Save notification to database"""
        try:
            db = SessionLocal()
            try:
                notification = Notification(
                    user_id=user_id,
                    title=title,
                    message=message,
                    notification_type=notification_type,
                    message_type=message_type,
                    priority=priority,
                    persistent=persistent,
                    extra_data=extra_data
                )
                db.add(notification)
                db.commit()
                logger.info(f"Saved notification to database for user {user_id}: {title}")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Error saving notification to database: {e}")

    async def _send_missed_notifications(self, user_id: int):
        """Send recent unread notifications to newly connected user"""
        try:
            db = SessionLocal()
            try:
                # Get recent unread notifications (last 24 hours)
                from datetime import timedelta
                cutoff_time = datetime.now() - timedelta(hours=24)
                
                notifications = db.query(Notification).filter(
                    Notification.user_id == user_id,
                    Notification.read == False,
                    Notification.created_at >= cutoff_time
                ).order_by(Notification.created_at.desc()).limit(10).all()
                
                for notification in notifications:
                    notification_data = {
                        "type": notification.message_type,
                        "id": notification.id,
                        "title": notification.title,
                        "message": notification.message,
                        "notification_type": notification.notification_type,
                        "priority": notification.priority,
                        "persistent": notification.persistent,
                        "timestamp": notification.created_at.isoformat(),
                        "from_db": True  # Indicate this is a missed notification
                    }
                    
                    # Add extra_data if available
                    if notification.extra_data:
                        notification_data.update(notification.extra_data)
                    
                    await self.send_personal_message(notification_data, user_id)
                
                if notifications:
                    logger.info(f"Sent {len(notifications)} missed notifications to user {user_id}")
                    
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Error sending missed notifications: {e}")

    def get_connection_stats(self) -> dict:
        """Get connection statistics and performance metrics"""
        active_connections = sum(len(connections) for connections in self.active_connections.values())
        uptime = datetime.now() - self.stats["start_time"]
        
        return {
            "active_users": len(self.active_connections),
            "active_connections": active_connections,
            "users_online": list(self.active_connections.keys()),
            "performance": {
                "total_messages_sent": self.stats["total_messages_sent"],
                "total_connections_made": self.stats["total_connections"],
                "rate_limited_messages": self.stats["rate_limited_messages"],
                "errors": self.stats["errors"],
                "uptime_seconds": int(uptime.total_seconds()),
                "messages_per_second": round(self.stats["total_messages_sent"] / max(uptime.total_seconds(), 1), 2)
            },
            "rate_limiting": {
                "max_messages_per_minute": self.max_messages_per_minute,
                "window_seconds": self.rate_limit_window,
                "current_rate_limited_users": len([uid for uid, timestamps in self.rate_limits.items() if len(timestamps) >= self.max_messages_per_minute])
            }
        }

manager = ConnectionManager()