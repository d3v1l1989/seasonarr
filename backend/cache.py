import time
import json
import logging
from typing import Any, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class SimpleCache:
    """Simple in-memory cache with TTL support"""
    
    def __init__(self):
        self._cache = {}
        self._last_cleanup = time.time()
        self._cleanup_interval = 300  # Cleanup every 5 minutes
    
    def get(self, key: str) -> Optional[Any]:
        """Get value from cache"""
        self._cleanup_expired()
        
        if key in self._cache:
            entry = self._cache[key]
            if entry['expires_at'] > time.time():
                logger.debug(f"Cache hit for key: {key}")
                return entry['data']
            else:
                # Expired entry
                del self._cache[key]
                logger.debug(f"Cache expired for key: {key}")
        
        logger.debug(f"Cache miss for key: {key}")
        return None
    
    def set(self, key: str, value: Any, ttl: int = 1800) -> None:
        """Set value in cache with TTL in seconds (default 30 minutes)"""
        self._cache[key] = {
            'data': value,
            'expires_at': time.time() + ttl,
            'created_at': time.time()
        }
        logger.debug(f"Cache set for key: {key}, TTL: {ttl}s")
    
    def delete(self, key: str) -> bool:
        """Delete key from cache"""
        if key in self._cache:
            del self._cache[key]
            logger.debug(f"Cache deleted for key: {key}")
            return True
        return False
    
    def clear(self) -> None:
        """Clear all cache entries"""
        self._cache.clear()
        logger.info("Cache cleared")
    
    def _cleanup_expired(self) -> None:
        """Remove expired entries"""
        current_time = time.time()
        
        # Only cleanup if enough time has passed
        if current_time - self._last_cleanup < self._cleanup_interval:
            return
        
        expired_keys = []
        for key, entry in self._cache.items():
            if entry['expires_at'] <= current_time:
                expired_keys.append(key)
        
        for key in expired_keys:
            del self._cache[key]
        
        if expired_keys:
            logger.info(f"Cleaned up {len(expired_keys)} expired cache entries")
        
        self._last_cleanup = current_time
    
    def stats(self) -> dict:
        """Get cache statistics"""
        self._cleanup_expired()
        
        total_entries = len(self._cache)
        total_size = sum(len(json.dumps(entry['data'], default=str)) for entry in self._cache.values())
        
        return {
            'total_entries': total_entries,
            'total_size_bytes': total_size,
            'cache_keys': list(self._cache.keys())
        }

# Global cache instance
cache = SimpleCache()

def get_cache_key(prefix: str, *args) -> str:
    """Generate a consistent cache key"""
    key_parts = [str(prefix)] + [str(arg) for arg in args]
    return ":".join(key_parts)

def cache_result(key: str, ttl: int = 1800):
    """Decorator to cache function results"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            cached_value = cache.get(key)
            if cached_value is not None:
                return cached_value
            
            result = func(*args, **kwargs)
            cache.set(key, result, ttl)
            return result
        return wrapper
    return decorator

async def async_cache_result(key: str, ttl: int = 1800):
    """Decorator to cache async function results"""
    def decorator(func):
        async def wrapper(*args, **kwargs):
            cached_value = cache.get(key)
            if cached_value is not None:
                return cached_value
            
            result = await func(*args, **kwargs)
            cache.set(key, result, ttl)
            return result
        return wrapper
    return decorator