"""
OpenAI adapter — also used for OpenRouter (same SDK, different base_url).
Handles both chat completions and embeddings via the openai library.
"""
from typing import AsyncIterator

from openai import AsyncOpenAI, BadRequestError

from providers.base import BaseProvider, ProviderConfig


# Legacy models that still accept max_tokens; everything else uses max_completion_tokens.
_LEGACY_MAX_TOKENS_PREFIXES = ("gpt-4", "gpt-3.5")


def _uses_legacy_max_tokens(model: str) -> bool:
    name = model.split("/")[-1].lower()  # handle org/model-name format
    return any(name.startswith(p) for p in _LEGACY_MAX_TOKENS_PREFIXES)


class OpenAIAdapter(BaseProvider):

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self._client = AsyncOpenAI(
            api_key=config.api_key,
            base_url=config.base_url,  # None = default OpenAI endpoint
        )

    def _token_limit_kwargs(self, max_tokens: int) -> dict:
        key = "max_tokens" if _uses_legacy_max_tokens(self.config.model) else "max_completion_tokens"
        return {key: max_tokens}

    async def generate_text(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 10000,
    ) -> str:
        response = await self._client.chat.completions.create(
            model=self.config.model,
            messages=messages,
            **self._token_limit_kwargs(max_tokens),
        )
        return response.choices[0].message.content or ""

    def stream_text(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 10000,
    ) -> AsyncIterator[str]:
        async def _stream_generator() -> AsyncIterator[str]:
            stream = await self._client.chat.completions.create(
                model=self.config.model,
                messages=messages,
                **self._token_limit_kwargs(max_tokens),
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta

        return _stream_generator()

    async def generate_json(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 2048,
    ) -> str:
        """Use json_object response_format when the model supports it.

        Falls back to a plain generate_text call for models (e.g. on OpenRouter)
        that return BadRequestError for the response_format parameter.
        """
        try:
            response = await self._client.chat.completions.create(
                model=self.config.model,
                messages=messages,
                response_format={"type": "json_object"},
                **self._token_limit_kwargs(max_tokens),
            )
            return response.choices[0].message.content or ""
        except BadRequestError:
            # Model doesn't support response_format — fall back to plain completion
            return await self.generate_text(messages, max_tokens=max_tokens)

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """
        Embed a batch of texts using the configured model.
        Works with OpenAI embedding models (text-embedding-3-small, etc.)
        and OpenRouter embedding models (thenlper/gte-large, etc.).
        """
        response = await self._client.embeddings.create(
            model=self.config.model,
            input=texts,
        )
        # API guarantees same order as input
        return [item.embedding for item in response.data]

    async def health_check(self) -> bool:
        """Test chat capability by attempting a minimal completion with the configured model."""
        try:
            await self._client.chat.completions.create(
                model=self.config.model,
                messages=[{"role": "user", "content": "hi"}],
            )
            return True
        except Exception:
            return False
