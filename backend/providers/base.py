"""
Abstract provider interface.
All adapters implement this contract so services stay provider-agnostic.

A profile = one provider + one API key + one model string.
Task routing (which task → which profile) is handled at the registry level;
the provider itself just uses its single configured model for every call.

Capabilities are declared on ModelProfile, not here — a single adapter class
handles both chat and embedding; which operations are valid depends on the
model the user configured, not the adapter code.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator


@dataclass
class ProviderConfig:
    api_key: str
    base_url: str | None
    model: str


class BaseProvider(ABC):

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    @abstractmethod
    async def generate_text(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 4096,
    ) -> str:
        """Non-streaming completion. Returns full response text."""

    @abstractmethod
    def stream_text(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        """Streaming completion. Returns an async generator that yields text deltas."""

    @abstractmethod
    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts. Returns list of float vectors."""

    async def embed_query(self, text: str) -> list[float]:
        """Embed a single query string. Convenience wrapper around embed_texts."""
        results = await self.embed_texts([text])
        return results[0]

    @abstractmethod
    async def health_check(self) -> bool:
        """Return True if the provider responds successfully (chat path)."""

    async def embedding_check(self) -> bool:
        """
        Return True if this provider + model actually supports the embeddings endpoint.
        Sends a minimal test embed and returns False (not raises) on failure.
        """
        try:
            await self.embed_texts(["test"])
            return True
        except Exception:
            return False
