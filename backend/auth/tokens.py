"""
JWT token creation and verification.
"""
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from fastapi import HTTPException

from config import settings


def create_access_token(user_id: int, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_upload_token(user_id: int) -> str:
    """Short-lived (5 min) token returned as JSON so the browser can use it
    as a Bearer header for direct-to-backend file uploads (bypasses Vercel's
    4.5 MB function payload limit)."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    payload = {"sub": str(user_id), "exp": expire, "scope": "upload"}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
