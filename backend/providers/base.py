"""
Abstract provider interface.
All adapters implement this contract so services stay provider-agnostic.

A profile = one provider + one API key + one model string.
Task routing (which task → which profile) is handled at the registry level;
the provider itself just uses its single configured model for every call.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator


@dataclass
class ProviderConfig:
    api_key: str
    base_url: str | None
    model: str          # single model string — e.g. "gpt-4o" or "qwen/qwen3-..."


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
    async def health_check(self) -> bool:
        """Return True if the provider responds successfully."""
