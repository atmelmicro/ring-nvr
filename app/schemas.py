from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class RecordingEvent(BaseModel):
    id: int
    device_id: str
    device_name: str
    kind: str
    created_at: datetime
    file_path: str

    class Config:
        from_attributes = True


class RingLoginRequest(BaseModel):
    email: str
    password: str


class Ring2FARequest(BaseModel):
    code: str


class RecordingSettings(BaseModel):
    autodelete_days: int = Field(
        default=14,
        ge=0,
        description="Delete recordings older than this many days. Set to 0 to disable.",
    )
    duration_seconds: int = Field(
        default=150, gt=0, description="How long each recording lasts in seconds."
    )
