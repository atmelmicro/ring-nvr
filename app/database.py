from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

SQLALCHEMY_DATABASE_URL = "sqlite:////nvr/nvr.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class RecordingEvent(Base):
    __tablename__ = "recording_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    device_id: Mapped[str] = mapped_column(String)
    device_name: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)  # motion, ring
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    file_path: Mapped[str] = mapped_column(String)


class RingToken(Base):
    """Stores the Ring OAuth token as a JSON blob. Only one row ever exists (id=1)."""

    __tablename__ = "ring_token"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    token_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class ListenerCredentials(Base):
    """Stores the FCM listener credentials as a JSON blob. Only one row ever exists (id=1)."""

    __tablename__ = "listener_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    credentials_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


Base.metadata.create_all(bind=engine)
