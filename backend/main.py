from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Request, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from typing import List, Optional
import uvicorn
import os
from database import get_db, init_db
from models import User, SonarrInstance, UserSettings, Notification, ActivityLog
from auth import verify_token, get_current_user
from schemas import UserLogin, UserRegister, SonarrInstanceCreate, SonarrInstanceResponse, SeasonItRequest, UserSettingsResponse, UserSettingsUpdate, NotificationResponse, NotificationUpdate, ActivityLogResponse
from websocket_manager import manager
import logging
import json
import time
from datetime import datetime
from jose import JWTError, jwt
from auth import SECRET_KEY, ALGORITHM

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Seasonarr API", version="1.0.0")

# Add GZip compression middleware (should be first)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Configure CORS origins from environment variable or default to all
cors_origins = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

async def verify_websocket_token(token: str, db: Session) -> User:
    """Verify JWT token for WebSocket connections and return the user"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials"
            )
        
        user = db.query(User).filter(User.username == username).first()
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        return user
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials"
        )

@app.on_event("startup")
async def startup_event():
    init_db()
    logger.info("Database initialized")

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "seasonarr-api"}

@app.get("/api/setup/first-run")
async def check_first_run():
    from database import check_if_first_run
    return {"is_first_run": check_if_first_run()}

@app.post("/api/setup/register")
async def register_first_user(user_data: UserRegister, db: Session = Depends(get_db)):
    from database import check_if_first_run
    from auth import get_password_hash, create_access_token
    
    if not check_if_first_run():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration is only allowed during first run"
        )
    
    existing_user = db.query(User).filter(User.username == user_data.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists"
        )
    
    hashed_password = get_password_hash(user_data.password)
    user = User(username=user_data.username, hashed_password=hashed_password)
    db.add(user)
    db.commit()
    db.refresh(user)
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer", "user": {"id": user.id, "username": user.username}}

@app.post("/api/login")
async def login(user_data: UserLogin, db: Session = Depends(get_db)):
    from auth import authenticate_user, create_access_token
    
    user = authenticate_user(db, user_data.username, user_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {"username": current_user.username, "id": current_user.id}

@app.post("/api/sonarr", response_model=SonarrInstanceResponse)
async def create_sonarr_instance(
    instance_data: SonarrInstanceCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from sonarr_client import test_sonarr_connection
    
    if not await test_sonarr_connection(instance_data.url, instance_data.api_key):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not connect to Sonarr instance"
        )
    
    db_instance = SonarrInstance(
        name=instance_data.name,
        url=instance_data.url,
        api_key=instance_data.api_key,
        owner_id=current_user.id
    )
    db.add(db_instance)
    db.commit()
    db.refresh(db_instance)
    return db_instance

@app.get("/api/sonarr", response_model=list[SonarrInstanceResponse])
async def get_sonarr_instances(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Optimized query with explicit filtering using index
    instances = db.query(SonarrInstance).filter(
        SonarrInstance.owner_id == current_user.id,
        SonarrInstance.is_active == True
    ).order_by(SonarrInstance.created_at.desc()).all()
    return instances

@app.delete("/api/sonarr/{instance_id}")
async def delete_sonarr_instance(
    instance_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    instance = db.query(SonarrInstance).filter(
        SonarrInstance.id == instance_id,
        SonarrInstance.owner_id == current_user.id
    ).first()
    
    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sonarr instance not found"
        )
    
    instance.is_active = False
    db.commit()
    return {"message": "Sonarr instance deleted successfully"}

@app.get("/api/shows")
async def get_shows(
    instance_id: int,
    page: int = 1,
    page_size: int = 35,
    search: str = "",
    status: str = "",
    monitored: bool = None,
    missing_episodes: bool = None,
    network: str = "",
    genres: Optional[List[str]] = Query(None),
    year_from: Optional[int] = Query(None),
    year_to: Optional[int] = Query(None),
    runtime_min: Optional[int] = Query(None),
    runtime_max: Optional[int] = Query(None),
    certification: str = "",
    hide_incomplete_seasons: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from sonarr_client import SonarrClient
    
    instance = db.query(SonarrInstance).filter(
        SonarrInstance.id == instance_id,
        SonarrInstance.owner_id == current_user.id,
        SonarrInstance.is_active == True
    ).first()
    
    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sonarr instance not found"
        )
    
    # Get user settings to determine if we should hide incomplete seasons
    from models import UserSettings
    user_settings = db.query(UserSettings).filter(UserSettings.user_id == current_user.id).first()
    
    # Use the setting from database if available, otherwise use the parameter
    should_hide_incomplete = hide_incomplete_seasons
    if user_settings:
        should_hide_incomplete = user_settings.hide_incomplete_seasons or hide_incomplete_seasons
    
    client = SonarrClient(instance.url, instance.api_key, instance.id)
    try:
        return await client.get_series(
            page=page, 
            page_size=page_size,
            search=search,
            status=status,
            monitored=monitored,
            missing_episodes=missing_episodes,
            network=network,
            genres=genres or [],
            year_from=year_from,
            year_to=year_to,
            runtime_min=runtime_min,
            runtime_max=runtime_max,
            certification=certification,
            hide_incomplete_seasons=should_hide_incomplete
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching shows: {str(e)}"
        )

@app.get("/api/shows/filter-options")
async def get_filter_options(
    instance_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get unique values for filtering options with caching"""
    from sonarr_client import SonarrClient
    from cache import cache, get_cache_key
    
    instance = db.query(SonarrInstance).filter(
        SonarrInstance.id == instance_id,
        SonarrInstance.owner_id == current_user.id,
        SonarrInstance.is_active == True
    ).first()
    
    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sonarr instance not found"
        )
    
    # Use the new caching system
    cache_key = get_cache_key("filter_options", instance_id)
    cached_result = cache.get(cache_key)
    
    if cached_result is not None:
        logger.info(f"Returning cached filter options for instance {instance_id}")
        return cached_result
    
    client = SonarrClient(instance.url, instance.api_key, instance.id)
    try:
        logger.info(f"Fetching filter options from Sonarr API for instance {instance_id}")
        
        # Get all shows with optimized approach - use streaming/chunked processing
        all_shows_response = await client.get_series(page=1, page_size=1000)  # Reduced from 10000
        shows = all_shows_response["shows"]
        
        # Process data more efficiently
        networks = set()
        genres = set()
        certifications = set()
        years = []
        runtimes = []
        
        for show in shows:
            if show.network:
                networks.add(show.network)
            if show.genres:
                genres.update(show.genres)
            if show.certification:
                certifications.add(show.certification)
            if show.year:
                years.append(show.year)
            if show.runtime:
                runtimes.append(show.runtime)
        
        # Convert sets to sorted lists
        networks = sorted(list(networks))
        genres = sorted(list(genres))
        certifications = sorted(list(certifications))
        
        # Calculate ranges efficiently
        year_min = min(years) if years else None
        year_max = max(years) if years else None
        runtime_min = min(runtimes) if runtimes else None
        runtime_max = max(runtimes) if runtimes else None
        
        result = {
            "networks": networks,
            "genres": genres,
            "certifications": certifications,
            "year_range": {"min": year_min, "max": year_max},
            "runtime_range": {"min": runtime_min, "max": runtime_max}
        }
        
        # Cache the result for 30 minutes
        cache.set(cache_key, result, ttl=1800)
        logger.info(f"Cached filter options for instance {instance_id}")
        
        return result
        
    except Exception as e:
        logger.error(f"Error fetching filter options: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching filter options: {str(e)}"
        )

@app.get("/api/activity-logs", response_model=List[ActivityLogResponse])
async def get_activity_logs(
    instance_id: Optional[int] = None,
    page: int = 1,
    page_size: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get activity logs for the current user"""
    query = db.query(ActivityLog).filter(ActivityLog.user_id == current_user.id)
    
    if instance_id:
        query = query.filter(ActivityLog.instance_id == instance_id)
    
    query = query.order_by(ActivityLog.created_at.desc())
    
    # Pagination
    offset = (page - 1) * page_size
    logs = query.offset(offset).limit(page_size).all()
    
    return logs

@app.get("/api/shows/{show_id}")
async def get_show_detail(
    show_id: int,
    instance_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from sonarr_client import SonarrClient
    
    instance = db.query(SonarrInstance).filter(
        SonarrInstance.id == instance_id,
        SonarrInstance.owner_id == current_user.id,
        SonarrInstance.is_active == True
    ).first()
    
    if not instance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sonarr instance not found"
        )
    
    client = SonarrClient(instance.url, instance.api_key, instance.id)
    try:
        return await client.get_show_detail(show_id)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching show detail: {str(e)}"
        )

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int, token: str = Query(...)):
    """
    WebSocket endpoint with JWT authentication
    Token should be passed as a query parameter: /ws/123?token=your_jwt_token
    """
    try:
        # Get database session for authentication
        db = next(get_db())
        try:
            # Verify the token and get the user
            user = await verify_websocket_token(token, db)
            
            # Ensure the user_id in the URL matches the authenticated user
            if user.id != user_id:
                await websocket.close(code=1008, reason="User ID mismatch")
                return
                
            # Connect to WebSocket manager
            await manager.connect(websocket, user_id)
            logger.info(f"Authenticated WebSocket connection for user {user_id}")
            
            # Send authentication success message
            await manager.send_personal_message({
                "type": "auth_status",
                "status": "authenticated",
                "message": "WebSocket connection authenticated successfully"
            }, user_id)
            
            try:
                while True:
                    data = await websocket.receive_text()
                    try:
                        message = json.loads(data)
                        message_type = message.get("type")
                        
                        if message_type == "pong":
                            # Update last ping time for this connection
                            if user_id in manager.active_connections:
                                for connection in manager.active_connections[user_id]:
                                    if connection.websocket == websocket:
                                        connection.last_ping = time.time()
                                        break
                        else:
                            logger.info(f"Received WebSocket message from user {user_id}: {data}")
                            
                    except json.JSONDecodeError:
                        logger.warning(f"Invalid JSON received from user {user_id}: {data}")
                        
            except WebSocketDisconnect:
                manager.disconnect(websocket, user_id)
                logger.info(f"WebSocket disconnected for user {user_id}")
                
        finally:
            db.close()
            
    except HTTPException as e:
        # Authentication failed
        logger.warning(f"WebSocket authentication failed for user {user_id}: {e.detail}")
        await websocket.close(code=1008, reason=f"Authentication failed: {e.detail}")
    except Exception as e:
        # Other errors
        logger.error(f"WebSocket connection error for user {user_id}: {e}")
        await websocket.close(code=1011, reason="Internal server error")

@app.get("/api/proxy-image")
async def proxy_image(
    url: str,
    instance_id: int,
    request: Request
):
    from fastapi.responses import StreamingResponse
    import httpx
    
    logger.info(f"Proxy image request: url={url}, instance_id={instance_id}")
    logger.info(f"Client IP: {request.client.host}")
    logger.info(f"User-Agent: {request.headers.get('user-agent', 'Unknown')}")
    
    # Get the instance with a separate DB session to avoid pool exhaustion
    from database import SessionLocal
    db = SessionLocal()
    try:
        instance = db.query(SonarrInstance).filter(
            SonarrInstance.id == instance_id,
            SonarrInstance.is_active == True
        ).first()
        
        if not instance:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sonarr instance not found"
            )
        
        # Store instance data to avoid using DB connection during HTTP request
        instance_url = instance.url
        instance_api_key = instance.api_key
        
    finally:
        db.close()
    
    logger.info(f"Found instance: {instance_url}")
    
    try:
        from urllib.parse import unquote
        decoded_url = unquote(url)
        # Use the API MediaCover endpoint instead of the direct path to bypass basic auth
        if decoded_url.startswith('/MediaCover/'):
            api_url = decoded_url.replace('/MediaCover/', '/api/v3/MediaCover/')
        else:
            api_url = decoded_url
        full_url = f"{instance_url.rstrip('/')}{api_url}"
        headers = {"X-Api-Key": instance_api_key}
        
        logger.info(f"Proxying image: {full_url}")
        logger.info(f"Headers: {headers}")
        
        # Load image content and return it (simpler approach)
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True) as client:
            response = await client.get(full_url, headers=headers)
            logger.info(f"Response status: {response.status_code}")
            
            if response.status_code == 200:
                logger.info(f"Returning image content, size: {len(response.content)}")
                return StreamingResponse(
                    iter([response.content]),
                    media_type=response.headers.get("content-type", "image/jpeg"),
                    headers={
                        "Cache-Control": "public, max-age=3600",  # Cache for 1 hour
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET",
                        "Access-Control-Allow-Headers": "*",
                    }
                )
            else:
                logger.error(f"Sonarr returned status {response.status_code}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Image not found"
                )
    except Exception as e:
        import traceback
        logger.error(f"Error proxying image: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to proxy image: {str(e)}"
        )

@app.post("/api/season-it")
async def season_it(
    request: SeasonItRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from season_it_service import SeasonItService
    
    service = SeasonItService(db, current_user.id)
    
    try:
        result = await service.process_season_it(request.show_id, request.season_number, request.instance_id)
        return {"message": "Season It process completed", "result": result}
    except Exception as e:
        logger.error(f"Season It error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Season It failed: {str(e)}"
        )

@app.post("/api/bulk-season-it")
async def bulk_season_it(
    request: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Process Season It for multiple shows"""
    from season_it_service import SeasonItService
    
    show_items = request.get("show_items", [])
    if not show_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No shows provided"
        )
    
    service = SeasonItService(db, current_user.id)
    
    try:
        result = await service.process_bulk_season_it(show_items)
        return {"message": "Bulk Season It process completed", "result": result}
    except Exception as e:
        logger.error(f"Bulk Season It error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Bulk Season It failed: {str(e)}"
        )

@app.post("/api/operations/{operation_id}/cancel")
async def cancel_operation(
    operation_id: str,
    current_user: User = Depends(get_current_user)
):
    """Cancel a running bulk operation"""
    from bulk_operation_manager import bulk_operation_manager
    
    try:
        success = bulk_operation_manager.cancel_operation(operation_id)
        if success:
            return {"message": "Operation cancelled successfully"}
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Operation not found"
            )
    except Exception as e:
        logger.error(f"Error cancelling operation {operation_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cancel operation: {str(e)}"
        )

@app.get("/api/operations/{operation_id}")
async def get_operation_status(
    operation_id: str,
    current_user: User = Depends(get_current_user)
):
    """Get the status of a bulk operation"""
    from bulk_operation_manager import bulk_operation_manager
    
    try:
        operation = bulk_operation_manager.get_operation_status(operation_id)
        if operation:
            return operation
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Operation not found"
            )
    except Exception as e:
        logger.error(f"Error getting operation status {operation_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get operation status: {str(e)}"
        )

@app.get("/api/operations")
async def get_user_operations(
    current_user: User = Depends(get_current_user)
):
    """Get all operations for the current user"""
    from bulk_operation_manager import bulk_operation_manager
    
    try:
        operations = bulk_operation_manager.get_user_operations(current_user.id)
        return {"operations": operations}
    except Exception as e:
        logger.error(f"Error getting user operations: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get operations: {str(e)}"
        )

@app.get("/api/settings", response_model=UserSettingsResponse)
async def get_user_settings(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get user settings"""
    settings = db.query(UserSettings).filter(UserSettings.user_id == current_user.id).first()
    
    if not settings:
        # Create default settings if they don't exist
        settings = UserSettings(user_id=current_user.id)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    
    return settings

@app.put("/api/settings", response_model=UserSettingsResponse)
async def update_user_settings(
    settings_update: UserSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user settings"""
    settings = db.query(UserSettings).filter(UserSettings.user_id == current_user.id).first()
    
    if not settings:
        # Create new settings if they don't exist
        settings = UserSettings(user_id=current_user.id)
        db.add(settings)
    
    # Update only the fields that were provided
    update_data = settings_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(settings, field, value)
    
    db.commit()
    db.refresh(settings)
    
    return settings

@app.get("/api/notifications", response_model=list[NotificationResponse])
async def get_notifications(
    skip: int = 0,
    limit: int = 50,
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user notifications with optimized query"""
    # Use index-optimized query
    if unread_only:
        # This will use the ix_notifications_user_read composite index
        notifications = db.query(Notification).filter(
            Notification.user_id == current_user.id,
            Notification.read == False
        ).order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()
    else:
        # This will use the ix_notifications_user_created composite index
        notifications = db.query(Notification).filter(
            Notification.user_id == current_user.id
        ).order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()
    
    return notifications

@app.get("/api/notifications/unread-count")
async def get_unread_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get count of unread notifications"""
    count = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.read == False
    ).count()
    return {"count": count}

@app.put("/api/notifications/{notification_id}", response_model=NotificationResponse)
async def update_notification(
    notification_id: int,
    notification_update: NotificationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update notification (mark as read/unread)"""
    notification = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id
    ).first()
    
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found"
        )
    
    if notification_update.read is not None:
        notification.read = notification_update.read
        if notification_update.read:
            notification.read_at = datetime.utcnow()
        else:
            notification.read_at = None
    
    db.commit()
    db.refresh(notification)
    return notification

@app.put("/api/notifications/mark-all-read")
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark all notifications as read"""
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.read == False
    ).update({
        "read": True,
        "read_at": datetime.utcnow()
    })
    db.commit()
    return {"message": "All notifications marked as read"}

@app.delete("/api/notifications/{notification_id}")
async def delete_notification(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a notification"""
    notification = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id
    ).first()
    
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found"
        )
    
    db.delete(notification)
    db.commit()
    return {"message": "Notification deleted"}

@app.delete("/api/notifications")
async def clear_all_notifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Clear all notifications for the user"""
    db.query(Notification).filter(Notification.user_id == current_user.id).delete()
    db.commit()
    return {"message": "All notifications cleared"}

@app.post("/api/notifications/test")
async def test_notification(
    current_user: User = Depends(get_current_user),
):
    """Test endpoint to send a notification"""
    await manager.send_notification(
        user_id=current_user.id,
        title="Test Notification",
        message="This is a test notification to verify the WebSocket system is working properly.",
        notification_type="info",
        priority="normal",
        persistent=False
    )
    return {"message": "Test notification sent"}

@app.get("/api/websocket/stats")
async def websocket_stats(current_user: User = Depends(get_current_user)):
    """Get WebSocket connection statistics"""
    stats = manager.get_connection_stats()
    return stats

@app.get("/api/cache/stats")
async def cache_stats(current_user: User = Depends(get_current_user)):
    """Get cache statistics"""
    from cache import cache
    stats = cache.stats()
    return stats

@app.post("/api/cache/clear")
async def clear_cache(current_user: User = Depends(get_current_user)):
    """Clear all cache entries"""
    from cache import cache
    cache.clear()
    return {"message": "Cache cleared successfully"}

# Add a catch-all route for SPA (Single Page Application)
from fastapi.responses import FileResponse
import os

@app.get("/{path:path}")
async def serve_spa(path: str):
    """Serve the React SPA for all non-API routes"""
    static_dir = "static"
    
    # If it's a file request (has extension), try to serve it
    if "." in path:
        file_path = os.path.join(static_dir, path)
        if os.path.exists(file_path):
            return FileResponse(file_path)
    
    # For all other routes, serve index.html (SPA routing)
    return FileResponse(os.path.join(static_dir, "index.html"))

# Mount static files for assets
app.mount("/assets", StaticFiles(directory="static/assets"), name="assets")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)