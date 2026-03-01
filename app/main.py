from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from os import path
from typing import Annotated, Any, Generator

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app import schemas
from app.auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    get_config,
    get_current_user,
    verify_password,
)
from app.database import RecordingEvent, SessionLocal
from app.ring_manager import RingManager
from app.schemas import RecordingSettings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Ring NVR Backend")
ring_manager = RingManager()
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/login", auto_error=False)

# All API routes live under /api to match the frontend's axios baseURL
api = APIRouter(prefix="/api")

# ─────────────────────────────────────────────────────────────────────────────
# Frontend static files
# ─────────────────────────────────────────────────────────────────────────────

_FRONTEND_DIST = path.join(path.dirname(__file__), "..", "web", "dist")

if path.isdir(path.join(_FRONTEND_DIST, "assets")):
    app.mount(
        "/assets",
        StaticFiles(directory=path.join(_FRONTEND_DIST, "assets")),
        name="assets",
    )


def _serve_index() -> HTMLResponse:
    index = path.join(_FRONTEND_DIST, "index.html")
    if path.isfile(index):
        with open(index, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(
        content="<p>Frontend not built. Run <code>bun run build</code> inside <code>web/</code>.</p>",
        status_code=503,
    )


# ─────────────────────────────────────────────────────────────────────────────
# DB helper
# ─────────────────────────────────────────────────────────────────────────────


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# Lifecycle
# ─────────────────────────────────────────────────────────────────────────────


@app.on_event("startup")
async def startup_event() -> None:
    logger.info("Starting up...")
    try:
        await ring_manager.initialize()
        if ring_manager.ring_authenticated:
            asyncio.create_task(ring_manager.start_listener())
    except Exception:
        logger.exception("Failed to initialize Ring Manager")


@app.on_event("shutdown")
async def shutdown_event() -> None:
    logger.info("Shutting down...")
    await ring_manager.stop()


# ─────────────────────────────────────────────────────────────────────────────
# App auth (NVR user login)
# ─────────────────────────────────────────────────────────────────────────────


@api.post("/login")
async def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
) -> dict[str, str]:
    config = get_config()
    users = config.get("users", [])

    username: str | None = None
    if isinstance(users, list):
        for user in users:
            if not isinstance(user, dict):
                continue
            candidate_username = user.get("username")
            candidate_password = user.get("password")
            if (
                isinstance(candidate_username, str)
                and isinstance(candidate_password, str)
                and candidate_username == form_data.username
                and verify_password(form_data.password, candidate_password)
            ):
                username = candidate_username
                break

    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        data={"sub": username},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}


# ─────────────────────────────────────────────────────────────────────────────
# Recordings
# ─────────────────────────────────────────────────────────────────────────────


@api.get("/events")
async def get_events(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[str, Depends(get_current_user)],
) -> list[schemas.RecordingEvent]:
    del current_user
    return db.query(RecordingEvent).order_by(RecordingEvent.created_at.desc()).all()


@api.get("/recordings/{event_id}")
async def get_recording(
    event_id: int,
    db: Annotated[Session, Depends(get_db)],
    token: Annotated[str | None, Query()] = None,
    token_header: str | None = Depends(oauth2_scheme_optional),
) -> FileResponse:
    token_to_validate = token or token_header
    if not token_to_validate:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        await get_current_user(token_to_validate)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Invalid token")

    event = db.query(RecordingEvent).filter(RecordingEvent.id == event_id).first()
    if event is None:
        raise HTTPException(status_code=404, detail="Recording not found")

    if not path.exists(event.file_path):
        raise HTTPException(status_code=404, detail="Recording file not found on disk")

    return FileResponse(event.file_path)


# ─────────────────────────────────────────────────────────────────────────────
# Settings – Ring account
# ─────────────────────────────────────────────────────────────────────────────


@api.get("/settings/ring/status")
async def ring_status(
    current_user: Annotated[str, Depends(get_current_user)],
) -> dict[str, Any]:
    """Return the current Ring connection status."""
    del current_user
    return {
        "authenticated": ring_manager.ring_authenticated,
        "account_email": ring_manager.ring_account_email,
        "listener_running": ring_manager.is_running,
    }


@api.post("/settings/ring/login")
async def ring_login(
    body: schemas.RingLoginRequest,
    current_user: Annotated[str, Depends(get_current_user)],
) -> dict[str, Any]:
    """
    Begin a Ring login with email + password.

    Returns:
      {"status": "ok"}            – authenticated, no 2FA needed
      {"status": "2fa_required"}  – caller must POST to /api/settings/ring/2fa
      {"status": "error", "detail": "..."}
    """
    del current_user
    result = await ring_manager.ring_login(body.email, body.password)
    if result["status"] == "error":
        raise HTTPException(
            status_code=400, detail=result.get("detail", "Login failed")
        )
    return result


@api.post("/settings/ring/2fa")
async def ring_submit_2fa(
    body: schemas.Ring2FARequest,
    current_user: Annotated[str, Depends(get_current_user)],
) -> dict[str, Any]:
    """Submit the 2FA OTP code after /api/settings/ring/login returned 2fa_required."""
    del current_user
    result = await ring_manager.ring_submit_2fa(body.code)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("detail", "2FA failed"))
    return result


@api.post("/settings/ring/logout")
async def ring_logout(
    current_user: Annotated[str, Depends(get_current_user)],
) -> dict[str, str]:
    """Revoke the Ring session and remove the cached token."""
    del current_user
    await ring_manager.ring_logout()
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────────────────────────
# Settings – Storage
# ─────────────────────────────────────────────────────────────────────────────


@api.get("/settings/storage")
async def storage_stats(
    current_user: Annotated[str, Depends(get_current_user)],
) -> dict[str, Any]:
    """Return storage utilisation stats for the recordings directory."""
    del current_user
    return ring_manager.get_storage_stats()


# ─────────────────────────────────────────────────────────────────────────────
# Settings – Recording
# ─────────────────────────────────────────────────────────────────────────────


@api.get("/settings/recording")
async def get_recording_settings(
    current_user: Annotated[str, Depends(get_current_user)],
) -> RecordingSettings:
    """Return the current recording settings (e.g. autodelete_days)."""
    del current_user
    data = ring_manager.get_recording_settings()
    return RecordingSettings(**data)


@api.put("/settings/recording")
async def update_recording_settings(
    body: RecordingSettings,
    current_user: Annotated[str, Depends(get_current_user)],
) -> RecordingSettings:
    """Update recording settings. Persists changes to config.yaml."""
    del current_user
    if body.autodelete_days < 0:
        raise HTTPException(
            status_code=400,
            detail="autodelete_days must be 0 (disabled) or a positive number of days",
        )
    ring_manager.set_autodelete_days(body.autodelete_days)
    data = ring_manager.get_recording_settings()
    return RecordingSettings(**data)


# ─────────────────────────────────────────────────────────────────────────────
# Settings – Devices
# ─────────────────────────────────────────────────────────────────────────────


@api.get("/settings/devices")
async def list_devices(
    current_user: Annotated[str, Depends(get_current_user)],
) -> list[dict[str, Any]]:
    """Return all Ring devices associated with the authenticated account."""
    del current_user
    if not ring_manager.ring_authenticated:
        raise HTTPException(
            status_code=503,
            detail="Ring account not authenticated. Please log in via Settings.",
        )
    return ring_manager.get_devices()


# ─────────────────────────────────────────────────────────────────────────────
# Register the API router, then add SPA catch-all AFTER it
# ─────────────────────────────────────────────────────────────────────────────

app.include_router(api)


@app.get("/")
async def root() -> HTMLResponse:
    return _serve_index()


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str) -> HTMLResponse:
    """Return index.html for any non-API path so React Router can handle it."""
    return _serve_index()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
