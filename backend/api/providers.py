"""
Model profile management endpoints — per-user API key isolation.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from auth.deps import get_current_user
from config import settings
from db.database import get_db
from db.models import (
    ModelProfile, ProviderType, TaskProviderMapping,
    ROUTING_TASKS, TASK_REQUIRED_CAPABILITY, VALID_CAPABILITIES, User,
)
from providers.key_store import encrypt_key
from providers.registry import build_provider

router = APIRouter(prefix="/api/providers", tags=["providers"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ProfileCreateIn(BaseModel):
    name: str
    provider_type: ProviderType
    api_key: str
    base_url: str | None = None
    model: str
    # List of capabilities this model supports, e.g. ["chat"] or ["embedding"] or ["chat","embedding"]
    capabilities: list[str] = ["chat"]
    # Required when "embedding" is in capabilities.
    embedding_dim: int | None = None

    @field_validator("capabilities")
    @classmethod
    def validate_capabilities(cls, v: list[str]) -> list[str]:
        invalid = set(v) - VALID_CAPABILITIES
        if invalid:
            raise ValueError(f"Unknown capabilities: {invalid}. Valid: {VALID_CAPABILITIES}")
        if not v:
            raise ValueError("At least one capability is required.")
        return v

    @field_validator("embedding_dim")
    @classmethod
    def validate_embedding_dim(cls, v: int | None) -> int | None:
        if v is not None and v <= 0:
            raise ValueError("embedding_dim must be a positive integer.")
        return v

    def model_post_init(self, __context) -> None:
        if "embedding" in self.capabilities and self.embedding_dim is None:
            raise ValueError("embedding_dim is required when 'embedding' capability is selected.")


class ProfileUpdateIn(BaseModel):
    name: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    active: bool | None = None
    capabilities: list[str] | None = None
    embedding_dim: int | None = None

    @field_validator("capabilities")
    @classmethod
    def validate_capabilities(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        invalid = set(v) - VALID_CAPABILITIES
        if invalid:
            raise ValueError(f"Unknown capabilities: {invalid}. Valid: {VALID_CAPABILITIES}")
        if not v:
            raise ValueError("At least one capability is required.")
        return v


class ProfileOut(BaseModel):
    id: int
    name: str
    provider_type: str
    base_url: str | None
    model: str
    active: bool
    capabilities: list[str]
    embedding_dim: int | None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/capabilities", response_model=dict)
async def get_capabilities(current_user: User = Depends(get_current_user)):
    """Returns which optional integrations are configured server-side."""
    return {
        "tavily_available": bool(settings.tavily_api_key),
        "valid_capabilities": list(VALID_CAPABILITIES),
    }


@router.post("/profiles", response_model=ProfileOut)
async def create_profile(
    body: ProfileCreateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import json
    profile = ModelProfile(
        user_id=current_user.id,
        name=body.name,
        provider_type=body.provider_type,
        key_ref=encrypt_key(body.api_key),
        base_url=body.base_url,
        model=body.model,
        active=True,
        capabilities_json=json.dumps(body.capabilities),
        embedding_dim=body.embedding_dim,
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return _profile_out(profile)


@router.get("/profiles", response_model=list[ProfileOut])
async def list_profiles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ModelProfile)
        .where(ModelProfile.user_id == current_user.id)
        .order_by(ModelProfile.created_at)
    )
    return [_profile_out(p) for p in result.scalars().all()]


@router.patch("/profiles/{profile_id}", response_model=ProfileOut)
async def update_profile(
    profile_id: int,
    body: ProfileUpdateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import json
    profile = await db.get(ModelProfile, profile_id)
    if not profile or profile.user_id != current_user.id:
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
    if body.capabilities is not None:
        profile.capabilities_json = json.dumps(body.capabilities)
    if body.embedding_dim is not None:
        profile.embedding_dim = body.embedding_dim

    # Validate embedding_dim present if embedding capability is set
    final_caps = profile.capabilities
    if "embedding" in final_caps and profile.embedding_dim is None:
        raise HTTPException(
            status_code=422,
            detail="embedding_dim is required when 'embedding' capability is set.",
        )

    await db.commit()
    await db.refresh(profile)
    return _profile_out(profile)


@router.delete("/profiles/{profile_id}", response_model=dict)
async def delete_profile(
    profile_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    profile = await db.get(ModelProfile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Profile not found.")
    await db.delete(profile)
    await db.commit()
    return {"deleted": profile_id}


@router.post("/profiles/{profile_id}/test", response_model=dict)
async def test_profile(
    profile_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Test a profile's configured capabilities.
    - chat: calls models.list() to verify connectivity
    - embedding: sends a real embed call to verify the model supports it
    Returns per-capability results so the UI can show exactly what works.
    """
    profile = await db.get(ModelProfile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Profile not found.")

    provider = build_provider(profile)
    caps = profile.capabilities
    results: dict[str, bool | str] = {}

    if "chat" in caps:
        results["chat"] = await provider.health_check()

    if "embedding" in caps:
        ok = await provider.embedding_check()
        results["embedding"] = ok
        if not ok:
            results["embedding_error"] = (
                f"Model '{profile.model}' did not return embeddings. "
                "Verify the model name supports the embeddings endpoint."
            )

    overall_reachable = any(v is True for v in results.values() if isinstance(v, bool))
    return {
        "profile_id": profile_id,
        "reachable": overall_reachable,
        "capabilities_tested": results,
    }


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
        "capabilities": p.capabilities,
        "embedding_dim": p.embedding_dim,
    }


# ---------------------------------------------------------------------------
# Task-Provider Routing (per-user)
# ---------------------------------------------------------------------------


class TaskMappingIn(BaseModel):
    """Map each routing task to a profile id (or null = use active/fallback profile)."""
    dossier: int | None = None
    explain: int | None = None
    qa: int | None = None
    map_extract: int | None = None
    toc_extract: int | None = None
    embed: int | None = None


@router.get("/task-mapping", response_model=dict)
async def get_task_mapping(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TaskProviderMapping).where(TaskProviderMapping.user_id == current_user.id)
    )
    rows = {r.task_name: r.profile_id for r in result.scalars().all()}
    return {task: rows.get(task) for task in ROUTING_TASKS}


@router.put("/task-mapping", response_model=dict)
async def set_task_mapping(
    body: TaskMappingIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Upsert task→profile_id mappings for the current user.
    Validates that the assigned profile has the required capability for the task.
    Pass null for a task to clear its mapping (will fall back to active/default profile).
    """
    updates = body.model_dump()
    for task_name in ROUTING_TASKS:
        profile_id = updates.get(task_name)
        if profile_id is not None:
            profile = await db.get(ModelProfile, profile_id)
            if not profile or profile.user_id != current_user.id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Profile id={profile_id} not found (task: {task_name}).",
                )
            # Validate capability match
            required_cap = TASK_REQUIRED_CAPABILITY.get(task_name)
            if required_cap and not profile.has_capability(required_cap):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Profile '{profile.name}' cannot be assigned to task '{task_name}': "
                        f"requires '{required_cap}' capability, "
                        f"but profile only has {profile.capabilities}."
                    ),
                )

        result = await db.execute(
            select(TaskProviderMapping).where(
                TaskProviderMapping.user_id == current_user.id,
                TaskProviderMapping.task_name == task_name,
            )
        )
        existing = result.scalar_one_or_none()
        if existing is None:
            db.add(TaskProviderMapping(
                user_id=current_user.id,
                task_name=task_name,
                profile_id=profile_id,
            ))
        else:
            existing.profile_id = profile_id

    await db.commit()
    result = await db.execute(
        select(TaskProviderMapping).where(TaskProviderMapping.user_id == current_user.id)
    )
    rows = {r.task_name: r.profile_id for r in result.scalars().all()}
    return {task: rows.get(task) for task in ROUTING_TASKS}
