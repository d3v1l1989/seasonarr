from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./seasonarr.db")

# Configure connection pooling for better performance
if DATABASE_URL.startswith("sqlite"):
    # SQLite specific configuration
    engine = create_engine(
        DATABASE_URL, 
        connect_args={
            "check_same_thread": False,
            "timeout": 30,  # 30 second timeout
            "isolation_level": None  # Autocommit mode for better concurrency
        },
        pool_pre_ping=True,  # Validate connections before use
        pool_recycle=3600,   # Recycle connections every hour
        echo=False  # Set to True for SQL debugging
    )
else:
    # For other databases (PostgreSQL, MySQL, etc.)
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,        # Number of connections to maintain
        max_overflow=20,     # Additional connections beyond pool_size
        pool_pre_ping=True,  # Validate connections before use
        pool_recycle=3600,   # Recycle connections every hour
        echo=False  # Set to True for SQL debugging
    )
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    # Ensure data directory exists
    db_path = DATABASE_URL.replace("sqlite:///", "")
    db_dir = os.path.dirname(db_path)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    
    from models import User, SonarrInstance, UserSettings
    Base.metadata.create_all(bind=engine)

def check_if_first_run():
    from models import User
    db = SessionLocal()
    try:
        user_count = db.query(User).count()
        return user_count == 0
    finally:
        db.close()