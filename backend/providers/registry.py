"""
Resolves ModelProfile from DB and returns a configured provider instance.

Two entry points:
  get_active_provider(db, user_id)        — first active profile for user
  get_provider_for_task(task, db, user_id) — per-task routing via TaskProviderMapping
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.models import ModelProfile, ProviderType, TaskProviderMapping
from providers.base import ProviderConfig
from providers.key_store import decrypt_key
from providers.openai_adapter import OpenAIAdapter
from providers.openrouter_adapter import OpenRouterAdapter


async def get_active_provider(db: AsyncSession, user_id: int):
    """Return a provider instance for the first active ModelProfile owned by user."""
    result = await db.execute(
        select(ModelProfile).where(
            ModelProfile.user_id == user_id,
            ModelProfile.active == True,
        ).limit(1)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        raise RuntimeError("No active model profile configured.")
    return build_provider(profile)


async def get_provider_for_task(routing_task: str, db: AsyncSession, user_id: int):
    """
    Return a provider for a specific routing task for a given user.
    Looks up TaskProviderMapping first; falls back to the active profile.
    """
    result = await db.execute(
        select(TaskProviderMapping).where(
            TaskProviderMapping.user_id == user_id,
            TaskProviderMapping.task_name == routing_task,
        )
    )
    mapping = result.scalar_one_or_none()
    if mapping is not None and mapping.profile_id is not None:
        profile = await db.get(ModelProfile, mapping.profile_id)
        if profile is not None and profile.user_id == user_id:
            return build_provider(profile)
    return await get_active_provider(db, user_id)


def build_provider(profile: ModelProfile):
    api_key = decrypt_key(profile.key_ref)
    config = ProviderConfig(
        api_key=api_key,
        base_url=profile.base_url,
        model=profile.model,
    )
    if profile.provider_type == ProviderType.OPENROUTER:
        return OpenRouterAdapter(config)
    return OpenAIAdapter(config)
