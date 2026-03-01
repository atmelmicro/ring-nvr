from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import yaml
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext


def get_config() -> dict[str, Any]:
    with open("config.yaml", "r", encoding="utf-8") as config_file:
        loaded = yaml.safe_load(config_file)
    return loaded if isinstance(loaded, dict) else {}


config = get_config()
auth_config = config.get("auth", {})
if not isinstance(auth_config, dict):
    auth_config = {}

SECRET_KEY = str(auth_config.get("secret_key", "change-me"))
ALGORITHM = str(auth_config.get("algorithm", "HS256"))
ACCESS_TOKEN_EXPIRE_MINUTES = int(auth_config.get("access_token_expire_minutes", 60))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def verify_password(plain_password: str, stored_password: str) -> bool:
    if stored_password.startswith("$2"):
        return pwd_context.verify(plain_password, stored_password)
    return secrets.compare_digest(plain_password, stored_password)


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expires_in = expires_delta if expires_delta is not None else timedelta(minutes=15)
    to_encode.update({"exp": datetime.now(timezone.utc) + expires_in})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise credentials_exception from exc

    username = payload.get("sub")
    if not isinstance(username, str) or not username:
        raise credentials_exception

    users = get_config().get("users", [])
    if isinstance(users, list) and any(
        isinstance(user, dict) and user.get("username") == username for user in users
    ):
        return username
    raise credentials_exception
