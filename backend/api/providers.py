"""
Model profile management endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import settings
from db.database import get_db
from db.models import ModelProfile, ProviderType, TaskProviderMapping, ROUTING_TASKS
from providers.key_store import encrypt_key
from providers.registry import build_provider

router = APIRouter(prefix="/api/providers", tags=["providers"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ProfileCreateIn(BaseModel):
    name: str
    provider_type: ProviderType
    api_key: str           # plaintext — encrypted immediately, never stored raw
    base_url: str | None = None
    model: str             # single model string, e.g. "gpt-4o"


class ProfileUpdateIn(BaseModel):
    name: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    active: bool | None = None


class ProfileOut(BaseModel):
    id: int
    name: str
    provider_type: str
    base_url: str | None
    model: str
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
        model=body.model,
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
    if body.model is not None:
        profile.model = body.model
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
        "model": p.model,
        "active": p.active,
    }


# ---------------------------------------------------------------------------
# Task-Provider Routing
# ---------------------------------------------------------------------------


class TaskMappingIn(BaseModel):
    """Map each routing task to a profile id (or null = use active profile)."""
    dossier: int | None = None
    explain: int | None = None
    qa: int | None = None
    map_extract: int | None = None
    toc_extract: int | None = None


@router.get("/task-mapping", response_model=dict)
async def get_task_mapping(db: AsyncSession = Depends(get_db)):
    """Return the current task→profile_id mapping for all routing tasks."""
    result = await db.execute(select(TaskProviderMapping))
    rows = {r.task_name: r.profile_id for r in result.scalars().all()}
    return {task: rows.get(task) for task in ROUTING_TASKS}


@router.put("/task-mapping", response_model=dict)
async def set_task_mapping(body: TaskMappingIn, db: AsyncSession = Depends(get_db)):
    """
    Upsert task→profile_id mappings.
    Pass null for a task to clear its mapping (will fall back to active profile).
    """
    updates = body.model_dump()
    for task_name in ROUTING_TASKS:
        profile_id = updates.get(task_name)
        if profile_id is not None:
            profile = await db.get(ModelProfile, profile_id)
            if not profile:
                raise HTTPException(
                    status_code=400,
                    detail=f"Profile id={profile_id} not found (task: {task_name}).",
                )
        existing = await db.get(TaskProviderMapping, task_name)
        if existing is None:
            db.add(TaskProviderMapping(
                task_name=task_name, profile_id=profile_id))
        else:
            existing.profile_id = profile_id

    await db.commit()
    result = await db.execute(select(TaskProviderMapping))
    rows = {r.task_name: r.profile_id for r in result.scalars().all()}
    return {task: rows.get(task) for task in ROUTING_TASKS}
