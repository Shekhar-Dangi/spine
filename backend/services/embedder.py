"""
Embedding is now handled via API-based providers (OpenAI / OpenRouter).
Use providers.registry.get_embedding_provider_for_user() to obtain the
embedding provider for a given user, then call provider.embed_texts() or
provider.embed_query() directly.

This module is kept only to avoid breaking any stale imports during migration.
"""

__all__: list[str] = []
