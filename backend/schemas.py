from pydantic import BaseModel, HttpUrl
from typing import Optional, List, Dict, Any
from datetime import datetime

class UserLogin(BaseModel):
    username: str
    password: str
    remember_me: Optional[bool] = False

class UserRegister(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: int
    username: str
    created_at: datetime
    
    class Config:
        from_attributes = True

class SonarrInstanceCreate(BaseModel):
    name: str
    url: str
    api_key: str

class SonarrInstanceUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    api_key: Optional[str] = None
    is_active: Optional[bool] = None

class SonarrInstanceResponse(BaseModel):
    id: int
    name: str
    url: str
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

class ShowResponse(BaseModel):
    id: int
    title: str
    year: Optional[int] = None
    poster_url: Optional[str] = None
    status: str
    monitored: bool
    episode_count: int
    missing_episode_count: int
    seasons: List[dict] = []
    network: Optional[str] = None
    genres: List[str] = []
    runtime: Optional[int] = None
    certification: Optional[str] = None

class SeasonItRequest(BaseModel):
    show_id: int
    season_number: Optional[int] = None
    instance_id: int

class SearchSeasonPacksRequest(BaseModel):
    show_id: int
    season_number: int
    instance_id: int

class DownloadReleaseRequest(BaseModel):
    release_guid: str
    show_id: int
    season_number: int
    instance_id: int
    indexer_id: int

class ReleaseResponse(BaseModel):
    guid: str
    title: str
    size: int
    size_formatted: str
    seeders: int
    leechers: int
    age: int
    age_formatted: str
    quality: str
    quality_score: int
    indexer: str
    approved: bool
    indexer_flags: List[str]
    release_weight: int

class ProgressUpdate(BaseModel):
    message: str
    progress: int
    status: str

class UserSettingsResponse(BaseModel):
    disable_season_pack_check: bool
    require_deletion_confirmation: bool
    skip_episode_deletion: bool
    shows_per_page: int
    default_sort: str
    default_show_missing_only: bool
    
    class Config:
        from_attributes = True

class UserSettingsUpdate(BaseModel):
    disable_season_pack_check: Optional[bool] = None
    require_deletion_confirmation: Optional[bool] = None
    skip_episode_deletion: Optional[bool] = None
    shows_per_page: Optional[int] = None
    default_sort: Optional[str] = None
    default_show_missing_only: Optional[bool] = None

class NotificationCreate(BaseModel):
    title: str
    message: str
    notification_type: str = "info"
    message_type: str
    priority: str = "normal"
    persistent: bool = False
    extra_data: Optional[Dict[str, Any]] = None

class NotificationResponse(BaseModel):
    id: int
    title: str
    message: str
    notification_type: str
    message_type: str
    priority: str
    persistent: bool
    read: bool
    extra_data: Optional[Dict[str, Any]]
    created_at: datetime
    read_at: Optional[datetime]
    
    class Config:
        from_attributes = True

class NotificationUpdate(BaseModel):
    read: Optional[bool] = None

class ActivityLogResponse(BaseModel):
    id: int
    action_type: str
    show_id: int
    show_title: str
    season_number: Optional[int]
    status: str
    message: Optional[str]
    error_details: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]
    
    class Config:
        from_attributes = True