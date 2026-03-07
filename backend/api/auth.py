"""
Authentication endpoints: login, logout, me, register, invite management, initial setup.
"""
import secrets
from datetime import datetime, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Response, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import InviteCode, User
from auth.tokens import create_access_token
from auth.deps import get_current_user, require_admin
from config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class LoginIn(BaseModel):
    username_or_email: str
    password: str


class RegisterIn(BaseModel):
    invite_code: str
    username: str
    email: str
    password: str


class SetupIn(BaseModel):
    username: str
    email: str
    password: str
    setup_key: str


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    is_admin: bool
    created_at: datetime

    class Config:
        from_attributes = True


class InviteOut(BaseModel):
    id: int
    code: str
    created_at: datetime
    expires_at: datetime | None
    used_by_id: int | None
    used_by_username: str | None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="spine_auth",
        value=token,
        httponly=True,
        samesite=settings.cookie_samesite,
        secure=settings.cookie_secure,
        max_age=86400 * 30,
    )


# ---------------------------------------------------------------------------
# Setup (first admin account)
# ---------------------------------------------------------------------------


@router.get("/setup-status")
async def setup_status(db: AsyncSession = Depends(get_db)):
    """Check if initial setup is needed (no users exist)."""
    result = await db.execute(select(func.count(User.id)))
    count = result.scalar()
    return {"needs_setup": count == 0}


@router.post("/setup", response_model=UserOut)
async def setup(body: SetupIn, response: Response, db: AsyncSession = Depends(get_db)):
    """Create the first admin account. Requires SPINE_SETUP_KEY."""
    # Check if users already exist
    result = await db.execute(select(func.count(User.id)))
    count = result.scalar()
    if count > 0:
        raise HTTPException(status_code=409, detail="Setup already completed.")

    # Validate setup key
    if not settings.setup_key:
        raise HTTPException(
            status_code=500,
            detail="SPINE_SETUP_KEY not configured on server.",
        )
    if body.setup_key != settings.setup_key:
        raise HTTPException(status_code=403, detail="Invalid setup key.")

    # Validate inputs
    username = body.username.strip()
    if not username or len(username) > 64:
        raise HTTPException(status_code=422, detail="Invalid username.")
    email = body.email.strip().lower()
    if not email or len(email) > 256:
        raise HTTPException(status_code=422, detail="Invalid email.")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")

    user = User(
        username=username,
        email=email,
        password_hash=_hash_password(body.password),
        is_admin=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id, user.username)
    _set_auth_cookie(response, token)
    return user


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/login", response_model=UserOut)
async def login(body: LoginIn, response: Response, db: AsyncSession = Depends(get_db)):
    # Try username first, then email
    result = await db.execute(
        select(User).where(User.username == body.username_or_email)
    )
    user = result.scalar_one_or_none()
    if not user:
        result = await db.execute(
            select(User).where(User.email == body.username_or_email)
        )
        user = result.scalar_one_or_none()

    if not user or not _verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled.")

    token = create_access_token(user.id, user.username)
    _set_auth_cookie(response, token)
    return user


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("spine_auth", httponly=True, samesite=settings.cookie_samesite)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/register", response_model=UserOut)
async def register(body: RegisterIn, response: Response, db: AsyncSession = Depends(get_db)):
    # Validate invite code
    result = await db.execute(
        select(InviteCode).where(InviteCode.code == body.invite_code)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=400, detail="Invalid invite code.")
    if invite.used_by_id is not None:
        raise HTTPException(status_code=400, detail="Invite code already used.")
    if invite.expires_at and invite.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite code has expired.")

    # Check uniqueness
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already taken.")
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered.")

    # Validate inputs
    username = body.username.strip()
    if not username or len(username) > 64:
        raise HTTPException(status_code=422, detail="Invalid username.")
    email = body.email.strip().lower()
    if not email or len(email) > 256:
        raise HTTPException(status_code=422, detail="Invalid email.")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")

    user = User(
        username=username,
        email=email,
        password_hash=_hash_password(body.password),
        is_admin=False,
    )
    db.add(user)
    await db.flush()  # get user.id before commit

    invite.used_by_id = user.id
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id, user.username)
    _set_auth_cookie(response, token)
    return user


@router.post("/invites", response_model=dict)
async def create_invite(
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    code = secrets.token_urlsafe(32)
    invite = InviteCode(code=code, created_by_id=admin.id)
    db.add(invite)
    await db.commit()

    base_url = str(request.base_url).rstrip("/")
    # Point to frontend register page
    frontend_base = base_url.replace(":8000", ":3000")
    url = f"{frontend_base}/register?code={code}"
    return {"code": code, "url": url}


@router.get("/invites", response_model=list[InviteOut])
async def list_invites(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(InviteCode).order_by(InviteCode.created_at.desc())
    )
    invites = result.scalars().all()

    # Collect used_by usernames
    user_ids = [i.used_by_id for i in invites if i.used_by_id]
    users_by_id: dict[int, str] = {}
    if user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        for u in users_result.scalars().all():
            users_by_id[u.id] = u.username

    return [
        InviteOut(
            id=i.id,
            code=i.code,
            created_at=i.created_at,
            expires_at=i.expires_at,
            used_by_id=i.used_by_id,
            used_by_username=users_by_id.get(i.used_by_id) if i.used_by_id else None,
        )
        for i in invites
    ]
