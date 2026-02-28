"""
Abstract provider interface.
All adapters implement this contract so services stay provider-agnostic.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator


@dataclass
class ModelMap:
    """Task-to-model mapping stored per profile.
    Embedding is handled locally via fastembed — no embed model needed here.
    """
    deep_explain: str
    qa: str
    extract: str        # dossier / map extraction


@dataclass
class ProviderConfig:
    api_key: str
    base_url: str | None
    model_map: ModelMap


class BaseProvider(ABC):

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    @abstractmethod
    async def generate_text(
        self,
        task: str,
        messages: list[dict],
        *,
        max_tokens: int = 4096,
    ) -> str:
        """Non-streaming completion. Returns full response text."""

    @abstractmethod
    async def stream_text(
        self,
        task: str,
        messages: list[dict],
        *,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        """Streaming completion. Yields text deltas."""

    @abstractmethod
    async def health_check(self) -> bool:
        """Return True if the provider responds successfully."""

    def model_for(self, task: str) -> str:
        return getattr(self.config.model_map, task)
