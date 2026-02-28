"""
OpenAI adapter — also used for OpenRouter (same SDK, different base_url).
"""
from typing import AsyncIterator

from openai import AsyncOpenAI

from providers.base import BaseProvider, ProviderConfig


class OpenAIAdapter(BaseProvider):

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self._client = AsyncOpenAI(
            api_key=config.api_key,
            base_url=config.base_url,  # None = default OpenAI endpoint
        )

    async def generate_text(
        self,
        task: str,
        messages: list[dict],
        *,
        max_tokens: int = 4096,
    ) -> str:
        response = await self._client.chat.completions.create(
            model=self.model_for(task),
            messages=messages,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content or ""

    async def stream_text(
        self,
        task: str,
        messages: list[dict],
        *,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        async def _stream_generator() -> AsyncIterator[str]:
            stream = await self._client.chat.completions.create(
                model=self.model_for(task),
                messages=messages,
                max_tokens=max_tokens,
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta
        
        return _stream_generator()

    async def health_check(self) -> bool:
        try:
            await self._client.models.list()
            return True
        except Exception:
            return False
