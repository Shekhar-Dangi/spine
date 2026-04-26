"""
InstrumentedProvider — decorator wrapper around any BaseProvider.

Intercepts every LLM call, measures latency, reads token usage from the inner
adapter's _last_usage attribute, estimates cost, and persists an LlmCall row.

Usage:
    provider = build_provider(profile)
    instrumented = InstrumentedProvider(
        inner=provider,
        db=db,
        user_id=user_id,
        task_name=task_name,
        provider_type=profile.provider_type.value,
    )

The DB write happens in the same request-scoped session so it is committed
together with the request's other writes, or separately via its own commit.
The write is always awaited after the call completes — it adds a few ms at most.
"""
import time
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import LlmCall
from providers.base import BaseProvider, ProviderConfig
from providers.model_pricing import estimate_cost


class InstrumentedProvider(BaseProvider):

    def __init__(
        self,
        inner: BaseProvider,
        db: AsyncSession,
        user_id: int,
        task_name: str | None,
        provider_type: str,
    ) -> None:
        # Don't call super().__init__ — we don't have a ProviderConfig here.
        # BaseProvider only uses self.config in adapters, not in the base itself.
        self.config = inner.config
        self._inner = inner
        self._db = db
        self._user_id = user_id
        self._task_name = task_name
        self._provider_type = provider_type

    async def _record(
        self,
        *,
        is_streaming: bool,
        latency_ms: int,
        status: str,
        error_message: str | None,
    ) -> None:
        """Persist an LlmCall row. Silently swallows DB errors to never block the caller."""
        try:
            usage = self._inner._last_usage
            prompt_tokens = usage[0] if usage else None
            completion_tokens = usage[1] if usage else None
            cached_tokens = getattr(self._inner, "_last_cached_tokens", None)
            cost = estimate_cost(self.config.model, prompt_tokens, completion_tokens, cached_tokens)

            self._db.add(LlmCall(
                user_id=self._user_id,
                task_name=self._task_name,
                model=self.config.model,
                provider_type=self._provider_type,
                is_streaming=is_streaming,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                estimated_cost_usd=cost,
                latency_ms=latency_ms,
                status=status,
                error_message=error_message,
            ))
            await self._db.commit()
        except Exception:
            pass  # monitoring must never break the actual call

    async def generate_text(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 4096,
    ) -> str:
        start = time.monotonic()
        error_msg: str | None = None
        try:
            result = await self._inner.generate_text(messages, max_tokens=max_tokens)
            return result
        except Exception as exc:
            error_msg = str(exc)
            raise
        finally:
            latency_ms = int((time.monotonic() - start) * 1000)
            await self._record(
                is_streaming=False,
                latency_ms=latency_ms,
                status="error" if error_msg else "success",
                error_message=error_msg,
            )

    def stream_text(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        async def _wrapper() -> AsyncIterator[str]:
            start = time.monotonic()
            error_msg: str | None = None
            try:
                async for delta in self._inner.stream_text(messages, max_tokens=max_tokens):
                    yield delta
            except Exception as exc:
                error_msg = str(exc)
                raise
            finally:
                latency_ms = int((time.monotonic() - start) * 1000)
                await self._record(
                    is_streaming=True,
                    latency_ms=latency_ms,
                    status="error" if error_msg else "success",
                    error_message=error_msg,
                )

        return _wrapper()

    async def generate_json(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 2048,
    ) -> str:
        start = time.monotonic()
        error_msg: str | None = None
        try:
            result = await self._inner.generate_json(messages, max_tokens=max_tokens)
            return result
        except Exception as exc:
            error_msg = str(exc)
            raise
        finally:
            latency_ms = int((time.monotonic() - start) * 1000)
            await self._record(
                is_streaming=False,
                latency_ms=latency_ms,
                status="error" if error_msg else "success",
                error_message=error_msg,
            )

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        start = time.monotonic()
        error_msg: str | None = None
        try:
            result = await self._inner.embed_texts(texts)
            return result
        except Exception as exc:
            error_msg = str(exc)
            raise
        finally:
            latency_ms = int((time.monotonic() - start) * 1000)
            await self._record(
                is_streaming=False,
                latency_ms=latency_ms,
                status="error" if error_msg else "success",
                error_message=error_msg,
            )

    async def health_check(self) -> bool:
        # Health checks are not recorded — they are provider tests, not production calls.
        return await self._inner.health_check()

    async def embedding_check(self) -> bool:
        return await self._inner.embedding_check()
