"""
Resolves ModelProfile from DB and returns a configured provider instance.

Entry points:
  get_active_provider(db, user_id)              — first active profile for user
  get_provider_for_task(task, db, user_id)      — per-task routing (chat tasks)
  get_embedding_provider_for_user(db, user_id)  — embedding-capable profile for "embed" task

All public functions wrap the returned provider in InstrumentedProvider by default
so every LLM call is automatically logged to the llm_calls table.
Pass record=False to skip instrumentation (e.g. during health checks).
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.models import ModelProfile, ProviderType, TaskProviderMapping
from providers.base import BaseProvider, ProviderConfig
from providers.instrumented import InstrumentedProvider
from providers.key_store import decrypt_key
from providers.openai_adapter import OpenAIAdapter
from providers.openrouter_adapter import OpenRouterAdapter


async def get_active_provider(
    db: AsyncSession,
    user_id: int,
    *,
    task_name: str | None = None,
    record: bool = True,
) -> BaseProvider:
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
    provider = build_provider(profile)
    if record:
        return InstrumentedProvider(
            inner=provider,
            db=db,
            user_id=user_id,
            task_name=task_name,
            provider_type=profile.provider_type.value,
        )
    return provider


async def get_provider_for_task(
    routing_task: str,
    db: AsyncSession,
    user_id: int,
    *,
    record: bool = True,
    monitor_task: str | None = None,
) -> BaseProvider:
    """
    Return a provider for a specific chat routing task for a given user.
    Looks up TaskProviderMapping first; falls back to the active profile.
    For embedding tasks use get_embedding_provider_for_user() instead.
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
            provider = build_provider(profile)
            if record:
                return InstrumentedProvider(
                    inner=provider,
                    db=db,
                    user_id=user_id,
                    task_name=monitor_task or routing_task,
                    provider_type=profile.provider_type.value,
                )
            return provider
    return await get_active_provider(db, user_id, task_name=monitor_task or routing_task, record=record)


async def get_embedding_provider_for_user(
    db: AsyncSession,
    user_id: int,
    *,
    record: bool = True,
) -> BaseProvider:
    """
    Return a provider configured for embedding for the given user.

    Resolution order:
      1. Profile mapped to the "embed" task (TaskProviderMapping)
      2. First active profile that declares "embedding" capability
      3. RuntimeError — user must configure an embedding profile

    The returned provider's embed_texts() / embed_query() are ready to call.
    """
    # 1. Check explicit task mapping
    result = await db.execute(
        select(TaskProviderMapping).where(
            TaskProviderMapping.user_id == user_id,
            TaskProviderMapping.task_name == "embed",
        )
    )
    mapping = result.scalar_one_or_none()
    if mapping is not None and mapping.profile_id is not None:
        profile = await db.get(ModelProfile, mapping.profile_id)
        if profile is not None and profile.user_id == user_id:
            if not profile.has_capability("embedding"):
                raise RuntimeError(
                    f"Profile '{profile.name}' is mapped to the embed task "
                    "but does not have the 'embedding' capability."
                )
            provider = build_provider(profile)
            if record:
                return InstrumentedProvider(
                    inner=provider,
                    db=db,
                    user_id=user_id,
                    task_name="embed",
                    provider_type=profile.provider_type.value,
                )
            return provider

    # 2. Fall back to first active embedding-capable profile
    result = await db.execute(
        select(ModelProfile).where(
            ModelProfile.user_id == user_id,
            ModelProfile.active == True,
        ).order_by(ModelProfile.created_at)
    )
    for profile in result.scalars().all():
        if profile.has_capability("embedding"):
            provider = build_provider(profile)
            if record:
                return InstrumentedProvider(
                    inner=provider,
                    db=db,
                    user_id=user_id,
                    task_name="embed",
                    provider_type=profile.provider_type.value,
                )
            return provider

    raise RuntimeError(
        "No embedding profile configured. "
        "Go to Settings → Providers and create a profile with the 'embedding' capability, "
        "then assign it to the Embed task."
    )


def build_provider(profile: ModelProfile) -> BaseProvider:
    api_key = decrypt_key(profile.key_ref)
    config = ProviderConfig(
        api_key=api_key,
        base_url=profile.base_url,
        model=profile.model,
    )
    if profile.provider_type == ProviderType.OPENROUTER:
        return OpenRouterAdapter(config)
    return OpenAIAdapter(config)
