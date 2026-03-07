"""
FastAPI dependency functions for auth.
"""
from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import User
from auth.tokens import decode_token


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    token = request.cookies.get("spine_auth")
    if not token:
        # Also accept Bearer token (used for direct file uploads that bypass
        # the Vercel proxy — the browser fetches a short-lived upload token
        # first, then POSTs the file directly to the backend with this header).
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(token)
    user_id = int(payload["sub"])
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive.")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user
