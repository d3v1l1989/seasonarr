from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Boolean, Text, JSON, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    sonarr_instances = relationship("SonarrInstance", back_populates="owner")
    settings = relationship("UserSettings", back_populates="user", uselist=False)

class SonarrInstance(Base):
    __tablename__ = "sonarr_instances"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    url = Column(String, nullable=False)
    api_key = Column(String, nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), index=True)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    owner = relationship("User", back_populates="sonarr_instances")
    
    __table_args__ = (
        Index('ix_sonarr_instances_owner_active', 'owner_id', 'is_active'),
    )

class UserSettings(Base):
    __tablename__ = "user_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    disable_season_pack_check = Column(Boolean, default=False)
    require_deletion_confirmation = Column(Boolean, default=False)
    skip_episode_deletion = Column(Boolean, default=False)
    shows_per_page = Column(Integer, default=35)
    default_sort = Column(String, default='title_asc')
    default_show_missing_only = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    user = relationship("User", back_populates="settings")

class Notification(Base):
    __tablename__ = "notifications"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    notification_type = Column(String, default="info")  # info, success, warning, error
    message_type = Column(String, nullable=False)  # notification, system_announcement, show_update, etc.
    priority = Column(String, default="normal")  # low, normal, high
    persistent = Column(Boolean, default=False)
    read = Column(Boolean, default=False, index=True)
    extra_data = Column(JSON, nullable=True)  # Additional data specific to notification type
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    read_at = Column(DateTime(timezone=True), nullable=True)
    
    user = relationship("User", backref="notifications")
    
    __table_args__ = (
        Index('ix_notifications_user_read', 'user_id', 'read'),
        Index('ix_notifications_user_created', 'user_id', 'created_at'),
    )

class ActivityLog(Base):
    __tablename__ = "activity_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    instance_id = Column(Integer, ForeignKey("sonarr_instances.id"), nullable=False, index=True)
    action_type = Column(String, nullable=False, index=True)  # season_it, manual_search, etc.
    show_id = Column(Integer, nullable=False)
    show_title = Column(String, nullable=False)
    season_number = Column(Integer, nullable=True)  # null for all seasons
    status = Column(String, nullable=False, index=True)  # success, error, in_progress
    message = Column(Text, nullable=True)
    error_details = Column(Text, nullable=True)
    extra_data = Column(JSON, nullable=True)  # Additional data
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    user = relationship("User", backref="activity_logs")
    instance = relationship("SonarrInstance", backref="activity_logs")
    
    __table_args__ = (
        Index('ix_activity_logs_user_created', 'user_id', 'created_at'),
        Index('ix_activity_logs_user_instance', 'user_id', 'instance_id'),
        Index('ix_activity_logs_status_created', 'status', 'created_at'),
    )