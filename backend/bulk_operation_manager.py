import asyncio
import logging
import uuid
from typing import Dict, List, Optional, Any, Callable
from datetime import datetime
from sqlalchemy.orm import Session
from websocket_manager import manager

logger = logging.getLogger(__name__)

class BulkOperationManager:
    def __init__(self):
        self.active_operations: Dict[str, 'BulkOperation'] = {}
        self.operation_history: List[Dict] = []
        self.max_history_size = 100

    def create_operation(self, user_id: int, operation_type: str, items: List[Dict], 
                        operation_func: Callable, description: str = None) -> str:
        """Create and register a new bulk operation"""
        operation_id = str(uuid.uuid4())
        operation = BulkOperation(
            operation_id=operation_id,
            user_id=user_id,
            operation_type=operation_type,
            items=items,
            operation_func=operation_func,
            description=description
        )
        
        self.active_operations[operation_id] = operation
        logger.info(f"Created bulk operation {operation_id} for user {user_id}: {operation_type}")
        return operation_id

    async def execute_operation(self, operation_id: str) -> Dict[str, Any]:
        """Execute a bulk operation"""
        if operation_id not in self.active_operations:
            raise ValueError(f"Operation {operation_id} not found")
        
        operation = self.active_operations[operation_id]
        
        try:
            result = await operation.execute()
            
            # Move to history
            self._move_to_history(operation)
            
            return result
        except Exception as e:
            logger.error(f"Error executing bulk operation {operation_id}: {e}")
            operation.mark_failed(str(e))
            self._move_to_history(operation)
            raise

    def cancel_operation(self, operation_id: str) -> bool:
        """Cancel an active bulk operation"""
        if operation_id not in self.active_operations:
            return False
        
        operation = self.active_operations[operation_id]
        operation.cancel()
        self._move_to_history(operation)
        return True

    def get_operation_status(self, operation_id: str) -> Optional[Dict]:
        """Get the current status of an operation"""
        if operation_id in self.active_operations:
            return self.active_operations[operation_id].get_status()
        
        # Check history
        for op in self.operation_history:
            if op['operation_id'] == operation_id:
                return op
        
        return None

    def get_user_operations(self, user_id: int) -> List[Dict]:
        """Get all operations for a user (active + recent history)"""
        operations = []
        
        # Active operations
        for op in self.active_operations.values():
            if op.user_id == user_id:
                operations.append(op.get_status())
        
        # Historical operations
        for op in self.operation_history:
            if op['user_id'] == user_id:
                operations.append(op)
        
        return sorted(operations, key=lambda x: x['created_at'], reverse=True)

    def _move_to_history(self, operation: 'BulkOperation'):
        """Move an operation to history and clean up active operations"""
        if operation.operation_id in self.active_operations:
            del self.active_operations[operation.operation_id]
        
        # Add to history
        self.operation_history.append(operation.get_status())
        
        # Trim history if too large
        if len(self.operation_history) > self.max_history_size:
            self.operation_history = self.operation_history[-self.max_history_size:]

class BulkOperation:
    def __init__(self, operation_id: str, user_id: int, operation_type: str, 
                 items: List[Dict], operation_func: Callable, description: str = None):
        self.operation_id = operation_id
        self.user_id = user_id
        self.operation_type = operation_type
        self.items = items
        self.operation_func = operation_func
        self.description = description
        
        self.status = "pending"
        self.created_at = datetime.now()
        self.started_at = None
        self.completed_at = None
        self.cancelled = False
        self.error = None
        
        self.current_item = 0
        self.completed_items = []
        self.failed_items = []
        
        # Progress tracking
        self.overall_progress = 0
        self.current_item_progress = 0

    async def execute(self) -> Dict[str, Any]:
        """Execute the bulk operation"""
        if self.cancelled:
            raise Exception("Operation was cancelled")
        
        self.status = "running"
        self.started_at = datetime.now()
        
        try:
            # Send start notification
            await manager.send_bulk_operation_start(
                self.user_id, 
                self.operation_id, 
                self.operation_type,
                len(self.items),
                [item.get('name', f"Item {i+1}") for i, item in enumerate(self.items)],
                self.description
            )
            
            # Process each item
            for i, item in enumerate(self.items):
                if self.cancelled:
                    self.status = "cancelled"
                    break
                
                self.current_item = i + 1
                self.current_item_progress = 0
                item_name = item.get('name', f"Item {i+1}")
                
                # Update progress
                self.overall_progress = int((i / len(self.items)) * 100)
                poster_url = item.get('poster_url')
                await self._send_progress_update(item_name, poster_url=poster_url)
                
                try:
                    # Execute operation for this item
                    result = await self.operation_func(item, self._progress_callback)
                    
                    self.completed_items.append({
                        'name': item_name,
                        'id': item.get('id'),
                        'result': result
                    })
                    
                except Exception as e:
                    logger.error(f"Error processing item {item_name}: {e}")
                    self.failed_items.append({
                        'name': item_name,
                        'id': item.get('id'),
                        'error': str(e)
                    })
            
            # Final progress update
            if not self.cancelled:
                self.overall_progress = 100
                self.status = "completed"
                self.completed_at = datetime.now()
                
                await manager.send_bulk_operation_complete(
                    self.user_id,
                    self.operation_id,
                    self.operation_type,
                    len(self.items),
                    self.completed_items,
                    self.failed_items
                )
            
            return {
                'operation_id': self.operation_id,
                'status': self.status,
                'total_items': len(self.items),
                'completed_items': self.completed_items,
                'failed_items': self.failed_items,
                'cancelled': self.cancelled
            }
            
        except Exception as e:
            self.mark_failed(str(e))
            raise

    async def _progress_callback(self, progress: int, message: str = None, poster_url: str = None):
        """Callback for individual item progress updates"""
        # Don't send progress updates if operation is cancelled
        if self.cancelled:
            return
            
        self.current_item_progress = progress
        item = self.items[self.current_item - 1]
        item_name = item.get('name') or item.get('title') or f"Item {self.current_item}"
        await self._send_progress_update(
            item_name,
            message,
            poster_url
        )

    async def _send_progress_update(self, item_name: str, message: str = None, poster_url: str = None):
        """Send progress update to WebSocket"""
        await manager.send_bulk_operation_update(
            self.user_id,
            self.operation_id,
            self.operation_type,
            self.overall_progress,
            self.current_item,
            len(self.items),
            item_name,
            self.current_item_progress,
            message,
            self.status,
            self.completed_items,
            self.failed_items,
            poster_url
        )

    def cancel(self):
        """Cancel the operation"""
        self.cancelled = True
        self.status = "cancelled"
        self.completed_at = datetime.now()

    def mark_failed(self, error: str):
        """Mark the operation as failed"""
        self.status = "failed"
        self.error = error
        self.completed_at = datetime.now()

    def get_status(self) -> Dict[str, Any]:
        """Get the current status of the operation"""
        return {
            'operation_id': self.operation_id,
            'user_id': self.user_id,
            'operation_type': self.operation_type,
            'status': self.status,
            'created_at': self.created_at.isoformat(),
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'description': self.description,
            'total_items': len(self.items),
            'current_item': self.current_item,
            'overall_progress': self.overall_progress,
            'current_item_progress': self.current_item_progress,
            'completed_items': self.completed_items,
            'failed_items': self.failed_items,
            'cancelled': self.cancelled,
            'error': self.error
        }

# Global instance
bulk_operation_manager = BulkOperationManager()