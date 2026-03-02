from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRecorder
from ring_doorbell import Auth, AuthenticationError, Requires2FAError, Ring
from ring_doorbell.listen import RingEventListener
from ring_doorbell.webrtcstream import RingWebRtcStream

from app.database import ListenerCredentials, RecordingEvent, RingToken, SessionLocal

logger = logging.getLogger(__name__)

RING_USER_AGENT = "RingNVR-1.0"


class RingManager:
    def __init__(self) -> None:
        self.storage_path = "/nvr/recordings"
        self.duration = 150
        self.autodelete_days: int = 14

        self.auth: Auth | None = None
        self.ring: Ring | None = None
        self.is_running = False
        self.active_recordings: set[str] = set()
        self._autodelete_task: asyncio.Task[None] | None = None
        self._event_listener: RingEventListener | None = None

        # Pending 2FA auth object (waiting for OTP)
        self._pending_auth: Auth | None = None
        self._pending_username: str | None = None
        self._pending_password: str | None = None

    # ------------------------------------------------------------------ #
    # DB-backed token storage                                              #
    # ------------------------------------------------------------------ #

    def _load_token_from_db(self) -> dict[str, Any] | None:
        """Return the stored Ring token dict, or None if not present."""
        db = SessionLocal()
        try:
            row = db.query(RingToken).filter(RingToken.id == 1).first()
            if row is None:
                return None
            return json.loads(row.token_json)  # type: ignore[return-value]
        except Exception:
            logger.exception("Failed to load Ring token from DB")
            return None
        finally:
            db.close()

    def _save_token_to_db(self, token: dict[str, Any]) -> None:
        """Upsert the Ring token into the DB."""
        db = SessionLocal()
        try:
            row = db.query(RingToken).filter(RingToken.id == 1).first()
            token_json = json.dumps(token)
            if row is None:
                db.add(RingToken(id=1, token_json=token_json))
            else:
                row.token_json = token_json
                row.updated_at = datetime.utcnow()
            db.commit()
        except Exception:
            logger.exception("Failed to save Ring token to DB")
            db.rollback()
        finally:
            db.close()

    def _delete_token_from_db(self) -> None:
        """Remove the stored Ring token from the DB."""
        db = SessionLocal()
        try:
            row = db.query(RingToken).filter(RingToken.id == 1).first()
            if row is not None:
                db.delete(row)
                db.commit()
        except Exception:
            logger.exception("Failed to delete Ring token from DB")
            db.rollback()
        finally:
            db.close()

    def token_updated(self, token: dict[str, Any]) -> None:
        """Callback passed to ring_doorbell Auth; called whenever the token refreshes."""
        self._save_token_to_db(token)

    # ------------------------------------------------------------------ #
    # DB-backed listener credential storage                               #
    # ------------------------------------------------------------------ #

    def _load_listener_credentials_from_db(self) -> dict[str, Any] | None:
        """Return the stored FCM listener credentials dict, or None if not present."""
        db = SessionLocal()
        try:
            row = db.query(ListenerCredentials).filter(ListenerCredentials.id == 1).first()
            if row is None:
                return None
            return json.loads(row.credentials_json)  # type: ignore[return-value]
        except Exception:
            logger.exception("Failed to load listener credentials from DB")
            return None
        finally:
            db.close()

    def _save_listener_credentials_to_db(self, credentials: dict[str, Any]) -> None:
        """Upsert the FCM listener credentials into the DB."""
        db = SessionLocal()
        try:
            row = db.query(ListenerCredentials).filter(ListenerCredentials.id == 1).first()
            credentials_json = json.dumps(credentials)
            if row is None:
                db.add(ListenerCredentials(id=1, credentials_json=credentials_json))
            else:
                row.credentials_json = credentials_json
                row.updated_at = datetime.utcnow()
            db.commit()
        except Exception:
            logger.exception("Failed to save listener credentials to DB")
            db.rollback()
        finally:
            db.close()

    def _listener_credentials_updated(self, credentials: dict[str, Any]) -> None:
        """Callback passed to RingEventListener; called when FCM credentials are refreshed."""
        self._save_listener_credentials_to_db(credentials)

    # ------------------------------------------------------------------ #
    # Recording settings                                                   #
    # ------------------------------------------------------------------ #

    def get_recording_settings(self) -> dict[str, Any]:
        """Return the current recording settings."""
        return {
            "autodelete_days": self.autodelete_days,
            "duration_seconds": self.duration,
        }

    def set_autodelete_days(self, days: int) -> None:
        """Update the autodelete_days value in memory."""
        self.autodelete_days = days
        logger.info("autodelete_days updated to %d", days)

    # ------------------------------------------------------------------ #
    # Autodelete                                                           #
    # ------------------------------------------------------------------ #

    async def _autodelete_loop(self) -> None:
        """Background loop that deletes recordings older than autodelete_days once per hour."""
        logger.info("Autodelete loop started (interval: 1 h)")
        while self.is_running:
            try:
                await self._run_autodelete()
            except Exception:
                logger.exception("Error during autodelete run")
            # Sleep 1 hour, but wake up every 60 s to respect is_running flag
            for _ in range(60):
                if not self.is_running:
                    break
                await asyncio.sleep(60)

    async def _run_autodelete(self) -> None:
        """Delete DB rows and files for recordings older than autodelete_days."""
        if self.autodelete_days <= 0:
            return
        cutoff = datetime.utcnow() - timedelta(days=self.autodelete_days)
        logger.info(
            "Running autodelete: removing recordings older than %s (cutoff %s)",
            self.autodelete_days,
            cutoff.isoformat(),
        )

        db = SessionLocal()
        try:
            old_events = (
                db.query(RecordingEvent)
                .filter(RecordingEvent.created_at < cutoff)
                .all()
            )
            deleted_files = 0
            deleted_rows = 0
            for event in old_events:
                file = Path(event.file_path)
                if file.exists():
                    try:
                        file.unlink()
                        deleted_files += 1
                    except Exception:
                        logger.exception("Failed to delete file %s", file)
                db.delete(event)
                deleted_rows += 1
            db.commit()
            if deleted_rows:
                logger.info(
                    "Autodelete: removed %d DB rows, %d files",
                    deleted_rows,
                    deleted_files,
                )
            else:
                logger.debug("Autodelete: nothing to remove")
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    # ------------------------------------------------------------------ #
    # Initialise from cached token (called at app startup)                #
    # ------------------------------------------------------------------ #

    async def initialize(self) -> None:
        Path(self.storage_path).mkdir(parents=True, exist_ok=True)

        # Start autodelete background task regardless of Ring auth state
        self.is_running = True
        self._autodelete_task = asyncio.create_task(self._autodelete_loop())

        token = self._load_token_from_db()
        if token is None:
            logger.warning(
                "No Ring token found in DB. Ring features disabled until authenticated via Settings."
            )
            return

        self.auth = Auth(RING_USER_AGENT, token, self.token_updated)
        self.ring = Ring(self.auth)
        try:
            await self.ring.async_create_session()
        except AuthenticationError:
            logger.warning(
                "Cached token is invalid. Re-authentication required via Settings."
            )
            self.auth = None
            self.ring = None
            return

        await self.ring.async_update_data()
        logger.info("Ring manager initialized from DB token")
        # Run an immediate cleanup pass on startup
        asyncio.create_task(self._run_autodelete())

    # ------------------------------------------------------------------ #
    # Runtime authentication API (used by /settings/ring/* endpoints)     #
    # ------------------------------------------------------------------ #

    @property
    def ring_authenticated(self) -> bool:
        return self.ring is not None and self.auth is not None

    @property
    def ring_account_email(self) -> str | None:
        """Return the email from the DB-stored token if available."""
        token = self._load_token_from_db()
        if token is None:
            return None
        try:
            return token.get("profile", {}).get("email") or token.get("email")
        except Exception:
            return None

    async def ring_login(self, username: str, password: str) -> dict[str, Any]:
        """
        Begin a Ring login.  Returns one of:
          {"status": "ok"}           – logged in, no 2FA required
          {"status": "2fa_required"} – caller must follow up with ring_submit_2fa()
          {"status": "error", "detail": "..."}
        """
        Path(self.storage_path).mkdir(parents=True, exist_ok=True)

        auth = Auth(RING_USER_AGENT, None, self.token_updated)
        try:
            await auth.async_fetch_token(username, password)
        except Requires2FAError:
            self._pending_auth = auth
            self._pending_username = username
            self._pending_password = password
            return {"status": "2fa_required"}
        except AuthenticationError as exc:
            return {"status": "error", "detail": str(exc)}
        except Exception as exc:
            return {"status": "error", "detail": str(exc)}

        await self._finalise_auth(auth)
        return {"status": "ok"}

    async def ring_submit_2fa(self, code: str) -> dict[str, Any]:
        """
        Submit a 2FA OTP code after ring_login() returned {"status": "2fa_required"}.
        Returns {"status": "ok"} or {"status": "error", "detail": "..."}
        """
        if (
            self._pending_auth is None
            or self._pending_password is None
            or self._pending_username is None
        ):
            return {
                "status": "error",
                "detail": "No pending 2FA session. Please start login again.",
            }

        try:
            await self._pending_auth.async_fetch_token(
                self._pending_username, self._pending_password, code
            )
        except AuthenticationError as exc:
            return {"status": "error", "detail": str(exc)}
        except Exception as exc:
            return {"status": "error", "detail": str(exc)}
        finally:
            auth = self._pending_auth
            self._pending_auth = None
            self._pending_username = None
            self._pending_password = None

        await self._finalise_auth(auth)
        return {"status": "ok"}

    async def _finalise_auth(self, auth: Auth) -> None:
        """Store auth, create a Ring session, and restart the listener."""
        self.auth = auth
        self.ring = Ring(auth)
        await self.ring.async_create_session()
        await self.ring.async_update_data()
        logger.info("Ring authenticated successfully")

        # Ensure autodelete loop is running
        if self._autodelete_task is None or self._autodelete_task.done():
            self.is_running = True
            self._autodelete_task = asyncio.create_task(self._autodelete_loop())

        # Start event listener
        await self.start_listener()

    async def ring_logout(self) -> None:
        """Revoke the current Ring session and remove the stored token."""
        self.is_running = False
        if self._event_listener is not None:
            try:
                await self._event_listener.stop()
            except Exception:
                logger.exception("Error stopping Ring event listener on logout")
            self._event_listener = None
        if self.auth is not None:
            try:
                await self.auth.async_close()
            except Exception:
                logger.exception("Error closing Ring auth on logout")
            self.auth = None
        self.ring = None
        self._delete_token_from_db()
        logger.info("Ring logged out and token removed from DB")

    # ------------------------------------------------------------------ #
    # Storage stats                                                        #
    # ------------------------------------------------------------------ #

    def get_storage_stats(self) -> dict[str, Any]:
        """Return storage utilisation information for the recordings directory."""
        import shutil

        storage_dir = Path(self.storage_path)
        storage_dir.mkdir(parents=True, exist_ok=True)

        try:
            total, used, free = shutil.disk_usage(storage_dir)
        except Exception:
            total = used = free = 0

        recordings_size = 0
        recordings_count = 0
        for f in storage_dir.rglob("*"):
            if f.is_file():
                recordings_count += 1
                try:
                    recordings_size += f.stat().st_size
                except Exception:
                    pass

        return {
            "storage_path": str(storage_dir.resolve()),
            "disk_total_bytes": total,
            "disk_used_bytes": used,
            "disk_free_bytes": free,
            "disk_used_percent": round((used / total * 100), 2) if total else 0,
            "recordings_size_bytes": recordings_size,
            "recordings_count": recordings_count,
        }

    # ------------------------------------------------------------------ #
    # Device listing                                                       #
    # ------------------------------------------------------------------ #

    def get_devices(self) -> list[dict[str, Any]]:
        """Return a simple list of connected Ring devices."""
        if self.ring is None:
            return []
        devices = self.ring.devices()
        result: list[dict[str, Any]] = []
        for device in devices.all_devices:
            result.append(
                {
                    "id": device.id,
                    "device_id": str(device.device_id),
                    "name": device.name,
                    "model": getattr(device, "model", None),
                    "family": getattr(device, "family", None),
                    "firmware": getattr(device, "firmware", None),
                    "battery_life": getattr(device, "battery_life", None),
                    "wifi_signal_strength": getattr(
                        device, "wifi_signal_strength", None
                    ),
                    "address": getattr(device, "address", None),
                }
            )
        return result

    # ------------------------------------------------------------------ #
    # Recording                                                            #
    # ------------------------------------------------------------------ #

    async def capture_video(self, device: Any, event_kind: str) -> None:
        device_id = str(device.device_id)
        if device_id in self.active_recordings:
            logger.info("Already recording %s", device.name)
            return

        self.active_recordings.add(device_id)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{device.name}_{event_kind}_{timestamp}.mp4".replace(" ", "_")
        file_path = str(Path(self.storage_path) / filename)
        logger.info(
            "Starting recording for %s due to %s at %s",
            device.name,
            event_kind,
            file_path,
        )

        pc = RTCPeerConnection()
        pc.addTransceiver("video", direction="recvonly")
        pc.addTransceiver("audio", direction="recvonly")
        recorder = MediaRecorder(file_path)

        @pc.on("track")
        def on_track(track: Any) -> None:
            recorder.addTrack(track)

        stream = RingWebRtcStream(device._ring, device.device_api_id)
        db = SessionLocal()
        recording_started = False
        try:
            offer = await pc.createOffer()
            await pc.setLocalDescription(offer)

            while pc.iceGatheringState != "complete":
                await asyncio.sleep(0.1)

            local_description = pc.localDescription
            if local_description is None:
                raise RuntimeError("Local SDP description was not generated")

            answer_sdp = await stream.generate(local_description.sdp)
            if not answer_sdp:
                raise RuntimeError("Failed to get SDP answer")

            await pc.setRemoteDescription(
                RTCSessionDescription(sdp=answer_sdp, type="answer")
            )

            start_wait = time.time()
            while time.time() - start_wait < 10:
                if pc.connectionState == "connected":
                    break
                await asyncio.sleep(0.1)

            await asyncio.sleep(2)
            await recorder.start()
            recording_started = True

            event = RecordingEvent(
                device_id=device_id,
                device_name=str(device.name),
                kind=event_kind,
                file_path=file_path,
            )
            db.add(event)
            db.commit()

            await asyncio.sleep(self.duration)
            await recorder.stop()
            recording_started = False
            logger.info("Finished recording %s", file_path)
        except Exception:
            logger.exception("Error during recording")
            if recording_started:
                try:
                    await recorder.stop()
                except Exception:
                    logger.exception("Failed stopping recorder after recording error")
            db.rollback()
        finally:
            db.close()
            await pc.close()
            await stream.close()
            self.active_recordings.discard(device_id)

    # ------------------------------------------------------------------ #
    # Event listener                                                       #
    # ------------------------------------------------------------------ #

    def _on_event(self, event: Any) -> None:
        """Callback invoked by RingEventListener for each incoming Ring event.

        The event object has doorbot_id (device identifier) and kind (e.g. motion, ding).
        """
        if self.ring is None:
            return
        doorbot_id = getattr(event, "doorbot_id", None)
        kind = str(getattr(event, "kind", "unknown"))
        if doorbot_id is None:
            return
        device = self.ring.get_device_by_api_id(doorbot_id)
        if device:
            asyncio.create_task(self.capture_video(device, kind))

    async def start_listener(self) -> None:
        if self.ring is None:
            raise RuntimeError("Ring manager is not initialized")

        # Stop any existing listener before starting a new one
        if self._event_listener is not None:
            try:
                await self._event_listener.stop()
            except Exception:
                logger.exception("Error stopping previous Ring event listener")
            self._event_listener = None

        credentials = self._load_listener_credentials_from_db()
        self._event_listener = RingEventListener(
            self.ring,
            credentials,
            self._listener_credentials_updated,
        )
        self._event_listener.add_notification_callback(self._on_event)
        started = await self._event_listener.start()
        if started:
            logger.info("Ring event listener started")
        else:
            logger.warning("Ring event listener failed to start")

    async def stop(self) -> None:
        self.is_running = False
        if self._event_listener is not None:
            try:
                await self._event_listener.stop()
            except Exception:
                logger.exception("Error stopping Ring event listener")
            self._event_listener = None
        if self._autodelete_task is not None and not self._autodelete_task.done():
            self._autodelete_task.cancel()
            try:
                await self._autodelete_task
            except asyncio.CancelledError:
                pass
            self._autodelete_task = None
        if self.auth is not None:
            await self.auth.async_close()
