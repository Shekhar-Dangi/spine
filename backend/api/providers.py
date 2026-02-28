"""
Model profile management endpoints.
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import settings
from db.database import get_db
from db.models import ModelProfile, ProviderType
from providers.key_store import encrypt_key
from providers.registry import build_provider

router = APIRouter(prefix="/api/providers", tags=["providers"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ModelMapIn(BaseModel):
    deep_explain: str
    qa: str
    extract: str
    # embed intentionally removed — embedding is local via fastembed


class ProfileCreateIn(BaseModel):
    name: str
    provider_type: ProviderType
    api_key: str           # plaintext — encrypted immediately, never stored raw
    base_url: str | None = None
    model_map: ModelMapIn


class ProfileUpdateIn(BaseModel):
    name: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    model_map: ModelMapIn | None = None
    active: bool | None = None


class ProfileOut(BaseModel):
    id: int
    name: str
    provider_type: str
    base_url: str | None
    model_map: dict
    active: bool

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/capabilities", response_model=dict)
async def get_capabilities():
    """Returns which optional integrations are configured server-side."""
    return {"tavily_available": bool(settings.tavily_api_key)}


@router.post("/profiles", response_model=ProfileOut)
async def create_profile(body: ProfileCreateIn, db: AsyncSession = Depends(get_db)):
    profile = ModelProfile(
        name=body.name,
        provider_type=body.provider_type,
        key_ref=encrypt_key(body.api_key),
        base_url=body.base_url,
        model_map_json=json.dumps(body.model_map.model_dump()),
        active=True,
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return _profile_out(profile)


@router.get("/profiles", response_model=list[ProfileOut])
async def list_profiles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ModelProfile).order_by(ModelProfile.created_at))
    return [_profile_out(p) for p in result.scalars().all()]


@router.patch("/profiles/{profile_id}", response_model=ProfileOut)
async def update_profile(
    profile_id: int, body: ProfileUpdateIn, db: AsyncSession = Depends(get_db)
):
    profile = await db.get(ModelProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found.")
    if body.name is not None:
        profile.name = body.name
    if body.api_key is not None:
        profile.key_ref = encrypt_key(body.api_key)
    if body.base_url is not None:
        profile.base_url = body.base_url
    if body.model_map is not None:
        profile.model_map_json = json.dumps(body.model_map.model_dump())
    if body.active is not None:
        profile.active = body.active
    await db.commit()
    await db.refresh(profile)
    return _profile_out(profile)


@router.delete("/profiles/{profile_id}", response_model=dict)
async def delete_profile(profile_id: int, db: AsyncSession = Depends(get_db)):
    profile = await db.get(ModelProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found.")
    await db.delete(profile)
    await db.commit()
    return {"deleted": profile_id}


@router.post("/profiles/{profile_id}/test", response_model=dict)
async def test_profile(profile_id: int, db: AsyncSession = Depends(get_db)):
    profile = await db.get(ModelProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found.")
    provider = build_provider(profile)
    ok = await provider.health_check()
    return {"profile_id": profile_id, "reachable": ok}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _profile_out(p: ModelProfile) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "provider_type": p.provider_type,
        "base_url": p.base_url,
        "model_map": json.loads(p.model_map_json),
        "active": p.active,
    }
