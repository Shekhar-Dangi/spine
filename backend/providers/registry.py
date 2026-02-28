"""
Resolves the active ModelProfile from DB and returns a configured provider instance.
"""
import json

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.models import ModelProfile, ProviderType
from providers.base import ModelMap, ProviderConfig
from providers.key_store import decrypt_key
from providers.openai_adapter import OpenAIAdapter
from providers.openrouter_adapter import OpenRouterAdapter


async def get_active_provider(db: AsyncSession):
    """Return a provider instance for the first active ModelProfile."""
    result = await db.execute(
        select(ModelProfile).where(ModelProfile.active == True).limit(1)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        raise RuntimeError("No active model profile configured.")
    return build_provider(profile)


def build_provider(profile: ModelProfile):
    api_key = decrypt_key(profile.key_ref)
    model_map_raw = json.loads(profile.model_map_json)
    # Strip 'embed' key if present in older saved profiles — embedding is now local
    model_map_raw.pop("embed", None)
    model_map = ModelMap(**model_map_raw)
    config = ProviderConfig(
        api_key=api_key,
        base_url=profile.base_url,
        model_map=model_map,
    )
    if profile.provider_type == ProviderType.OPENROUTER:
        return OpenRouterAdapter(config)
    return OpenAIAdapter(config)
