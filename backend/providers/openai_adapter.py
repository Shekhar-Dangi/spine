"""
OpenAI adapter — also used for OpenRouter (same SDK, different base_url).
Handles both chat completions and embeddings via the openai library.
"""
from typing import AsyncIterator

import httpx
from openai import (
    AsyncOpenAI,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
)

from providers.base import BaseProvider, ProviderConfig
from providers.errors import ProviderAuthError, ProviderError, ProviderRateLimitError, ProviderTimeoutError


# Legacy models that still accept max_tokens; everything else uses max_completion_tokens.
_LEGACY_MAX_TOKENS_PREFIXES = ("gpt-4", "gpt-3.5")

_TIMEOUT = httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=5.0)


def _uses_legacy_max_tokens(model: str) -> bool:
    name = model.split("/")[-1].lower()  # handle org/model-name format
    return any(name.startswith(p) for p in _LEGACY_MAX_TOKENS_PREFIXES)


def _map_exception(exc: Exception) -> ProviderError:
    """Convert OpenAI SDK exceptions to typed ProviderError subclasses."""
    if isinstance(exc, RateLimitError):
        return ProviderRateLimitError(f"Rate limit exceeded: {exc}")
    if isinstance(exc, APITimeoutError):
        return ProviderTimeoutError(f"Request timed out: {exc}")
    if isinstance(exc, AuthenticationError):
        return ProviderAuthError(f"Authentication failed: {exc}")
    return ProviderError(str(exc))


class OpenAIAdapter(BaseProvider):

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self._client = AsyncOpenAI(
            api_key=config.api_key,
            base_url=config.base_url,  # None = default OpenAI endpoint
            max_retries=3,
            timeout=_TIMEOUT,
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
        try:
            response = await self._client.chat.completions.create(
                model=self.config.model,
                messages=messages,
                **self._token_limit_kwargs(max_tokens),
            )
            if response.usage:
                self._last_usage = (response.usage.prompt_tokens, response.usage.completion_tokens)
                details = getattr(response.usage, "prompt_tokens_details", None)
                self._last_cached_tokens = getattr(details, "cached_tokens", None)
            return response.choices[0].message.content or ""
        except (ProviderError, BadRequestError):
            raise
        except Exception as exc:
            raise _map_exception(exc) from exc

    def stream_text(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 10000,
    ) -> AsyncIterator[str]:
        async def _stream_generator() -> AsyncIterator[str]:
            try:
                stream = await self._client.chat.completions.create(
                    model=self.config.model,
                    messages=messages,
                    **self._token_limit_kwargs(max_tokens),
                    stream=True,
                    stream_options={"include_usage": True},
                )
            except BadRequestError:
                # Model doesn't support stream_options — retry without it
                stream = await self._client.chat.completions.create(
                    model=self.config.model,
                    messages=messages,
                    **self._token_limit_kwargs(max_tokens),
                    stream=True,
                )
            except Exception as exc:
                raise _map_exception(exc) from exc

            try:
                async for chunk in stream:
                    # Final usage chunk: choices may be empty
                    if chunk.usage:
                        self._last_usage = (chunk.usage.prompt_tokens, chunk.usage.completion_tokens)
                        details = getattr(chunk.usage, "prompt_tokens_details", None)
                        self._last_cached_tokens = getattr(details, "cached_tokens", None)
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta.content
                    if delta:
                        yield delta
            except Exception as exc:
                raise _map_exception(exc) from exc

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
            if response.usage:
                self._last_usage = (response.usage.prompt_tokens, response.usage.completion_tokens)
                details = getattr(response.usage, "prompt_tokens_details", None)
                self._last_cached_tokens = getattr(details, "cached_tokens", None)
            return response.choices[0].message.content or ""
        except BadRequestError:
            # Model doesn't support response_format — fall back to plain completion
            return await self.generate_text(messages, max_tokens=max_tokens)
        except (ProviderError,):
            raise
        except Exception as exc:
            raise _map_exception(exc) from exc

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """
        Embed a batch of texts using the configured model.
        Works with OpenAI embedding models (text-embedding-3-small, etc.)
        and OpenRouter embedding models (thenlper/gte-large, etc.).
        """
        try:
            response = await self._client.embeddings.create(
                model=self.config.model,
                input=texts,
            )
            if response.usage:
                self._last_usage = (response.usage.prompt_tokens, 0)
            # API guarantees same order as input
            return [item.embedding for item in response.data]
        except (ProviderError,):
            raise
        except Exception as exc:
            raise _map_exception(exc) from exc

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
