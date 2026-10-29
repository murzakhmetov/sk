"""`structured()` — the single entry point for every LLM call in the project.

Pipeline for one call:

    mock mode? ──yes──> fallback() (task heuristic) ─────────────────────────┐
        │no                                                                  │
    disk cache hit? ──yes──> cached answer ──────────────────────────────────┤
        │no                                                                  ├─> LLMResult(output, meta)
    provider.complete() with retries + exponential backoff                   │
        ├─ ok ──> validate against schema ──> write cache ───────────────────┤
        └─ error ──> degrade_on_error? fallback() (source="fallback") ───────┘ or raise LLMError
"""

from __future__ import annotations

import asyncio
import logging
import random
import re
import time
import types
from collections.abc import Awaitable, Callable
from enum import Enum
from typing import Any, Literal, Union, get_args, get_origin

from pydantic import BaseModel, ValidationError

from app.config import Effort, Settings, get_settings
from app.llm.cache import DiskCache, cache_key
from app.llm.errors import LLMError, LLMOutputError
from app.llm.pricing import estimate_cost
from app.llm.providers import AnthropicProvider, OpenAICompatProvider, Provider
from app.llm.types import CallMeta, Completion, CompletionRequest, LLMResult, Source, UsageTotals

log = logging.getLogger("app.llm")

DEFAULT_MAX_TOKENS = 2048
_BACKOFF_BASE_S = 0.5
_BACKOFF_MAX_S = 8.0

Sleep = Callable[[float], Awaitable[None]]


class LLMClient:
    """Holds the provider, cache and usage totals. Create one per process (see `get_llm()`)."""

    def __init__(
        self,
        settings: Settings,
        *,
        provider: Provider | None = None,
        cache: DiskCache | None = None,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        self.settings = settings
        self._provider = provider
        self.cache = cache or DiskCache(settings.cache_dir, enabled=settings.cache_enabled)
        self.usage = UsageTotals()
        self._sleep = sleep

    @property
    def mock(self) -> bool:
        """Injecting a provider (tests) turns mock mode off regardless of keys."""
        return self._provider is None and self.settings.mock_mode

    @property
    def provider_name(self) -> str:
        return self._provider.name if self._provider else self.settings.llm_provider

    @property
    def provider(self) -> Provider:
        if self._provider is None:
            self._provider = _build_provider(self.settings)
        return self._provider

    async def aclose(self) -> None:
        if self._provider is not None:
            await self._provider.aclose()

    async def structured[T: BaseModel](
        self,
        system: str,
        user: str,
        schema: type[T],
        *,
        model: str | None = None,
        fallback: Callable[[], T] | None = None,
        effort: Effort | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        use_cache: bool = True,
        degrade_on_error: bool | None = None,
    ) -> LLMResult[T]:
        """Ask the model for a JSON answer that validates against `schema`.

        Args:
            system: Instructions (stable per task — gets prompt-cached).
            user: The per-request content.
            schema: Pydantic model the answer must satisfy.
            model: Model id; defaults to LLM_MODEL.
            fallback: Cheap offline answer (e.g. heuristics). Used in mock mode and, if
                `degrade_on_error`, when the LLM fails. Defaults to a schema placeholder.
            effort: Anthropic effort level; LLM_EFFORT overrides it globally.
            max_tokens: Output cap (includes thinking tokens on Claude).
            use_cache: Read/write the disk cache.
            degrade_on_error: Return `fallback()` instead of raising; defaults to LLM_DEGRADE_ON_ERROR.
        """
        model = model or self.settings.llm_model
        effort = self.settings.llm_effort or effort
        started = time.perf_counter()

        def meta(source: Source, **fields: Any) -> CallMeta:
            return CallMeta(
                source=source,
                provider=self.provider_name,
                model=fields.pop("model", model),
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
                **fields,
            )

        def offline_answer() -> T:
            return fallback() if fallback is not None else placeholder(schema)

        if self.mock:
            return self._finish(LLMResult(output=offline_answer(), meta=meta("mock")))

        key = cache_key(
            provider=self.provider_name, model=model, system=system, user=user, schema=schema, effort=effort
        )
        if use_cache and (entry := self.cache.get(key)) is not None:
            try:
                output = schema.model_validate(entry["output"])
            except (KeyError, ValidationError):
                log.warning("stale cache entry %s ignored", key[:12])
            else:
                return self._finish(LLMResult(output=output, meta=meta("cache", **entry.get("usage", {}))))

        request = CompletionRequest(
            system=system, user=user, schema=schema, model=model, max_tokens=max_tokens, effort=effort
        )
        try:
            output, completion, attempts = await self._complete_with_retries(request, schema)
        except LLMError as exc:
            degrade = self.settings.llm_degrade_on_error if degrade_on_error is None else degrade_on_error
            if not degrade:
                raise
            log.error("LLM failed, using fallback: %s", exc)
            error = f"{type(exc).__name__}: {exc}"
            return self._finish(LLMResult(output=offline_answer(), meta=meta("fallback", error=error)))

        usage = {
            "model": completion.model,
            "input_tokens": completion.input_tokens,
            "output_tokens": completion.output_tokens,
            "cache_read_tokens": completion.cache_read_tokens,
            "cache_write_tokens": completion.cache_write_tokens,
            "cost_usd": estimate_cost(
                completion.model,
                input_tokens=completion.input_tokens,
                output_tokens=completion.output_tokens,
                cache_read_tokens=completion.cache_read_tokens,
                cache_write_tokens=completion.cache_write_tokens,
            ),
        }
        if use_cache:
            self.cache.set(key, {"output": output.model_dump(mode="json"), "usage": usage})
        return self._finish(LLMResult(output=output, meta=meta("llm", attempts=attempts, **usage)))

    async def _complete_with_retries[T: BaseModel](
        self, request: CompletionRequest, schema: type[T]
    ) -> tuple[T, Completion, int]:
        max_attempts = self.settings.llm_max_retries + 1
        for attempt in range(1, max_attempts + 1):
            try:
                completion = await self.provider.complete(request)
                return parse_output(completion.text, schema), completion, attempt
            except LLMError as exc:
                if not exc.retryable or attempt == max_attempts:
                    raise
                delay = exc.retry_after or min(_BACKOFF_BASE_S * 2 ** (attempt - 1), _BACKOFF_MAX_S)
                delay += random.uniform(0, delay / 4)  # jitter: batch requests don't retry in lockstep
                log.warning("attempt %d/%d failed (%s), retrying in %.1fs", attempt, max_attempts, exc, delay)
                await self._sleep(delay)
        raise AssertionError("unreachable")  # the loop always returns or raises

    def _finish[T: BaseModel](self, result: LLMResult[T]) -> LLMResult[T]:
        m = result.meta
        self.usage.add(m)
        log.info(
            "llm source=%s provider=%s model=%s latency_ms=%.0f in=%d out=%d cache_read=%d cost_usd=%s attempts=%d",
            m.source, m.provider, m.model, m.latency_ms, m.input_tokens, m.output_tokens,
            m.cache_read_tokens, "n/a" if m.cost_usd is None else f"{m.cost_usd:.6f}", m.attempts,
        )  # fmt: skip
        return result


def _build_provider(settings: Settings) -> Provider:
    api_key = settings.api_key
    if api_key is None:
        raise LLMError(f"no API key configured for provider {settings.llm_provider!r}")
    if settings.llm_provider == "anthropic":
        return AnthropicProvider(
            api_key=api_key, timeout_s=settings.llm_timeout_s, refusal_fallback=settings.llm_refusal_fallback
        )
    return OpenAICompatProvider(
        base_url=settings.openai_compat_base_url,
        api_key=api_key,
        timeout_s=settings.llm_timeout_s,
        json_schema=settings.openai_compat_json_schema,
    )


# --- Output parsing --------------------------------------------------------------------------

_FENCED = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)


def extract_json(text: str) -> str:
    """Strip markdown fences / chatter around a JSON object (needed for some OpenAI-compatible models)."""
    stripped = text.strip()
    if fenced := _FENCED.match(stripped):
        stripped = fenced.group(1)
    if not stripped.startswith("{"):
        start, end = stripped.find("{"), stripped.rfind("}")
        if start != -1 and end > start:
            stripped = stripped[start : end + 1]
    return stripped


def parse_output[T: BaseModel](text: str, schema: type[T]) -> T:
    try:
        return schema.model_validate_json(extract_json(text))
    except ValidationError as exc:
        raise LLMOutputError(f"answer does not match {schema.__name__}: {exc.errors()[:3]}") from exc


# --- Mock placeholders -----------------------------------------------------------------------


def placeholder[T: BaseModel](schema: type[T]) -> T:
    """Build a schema-valid dummy instance (first Literal/Enum option, 0, "", [] ...).

    Lets a brand-new task work in mock mode before anyone writes its heuristic.
    Best effort: schemas with constraints such as `min_length` need a real fallback.
    """
    values = {
        name: _placeholder_value(field.annotation) for name, field in schema.model_fields.items() if field.is_required()
    }
    return schema.model_validate(values)


def _placeholder_value(annotation: Any) -> Any:
    origin = get_origin(annotation)
    args = get_args(annotation)
    if origin is Literal:
        return args[0]
    if origin in (Union, types.UnionType):
        return None if type(None) in args else _placeholder_value(args[0])
    if origin in (list, set, frozenset, tuple):
        return []
    if origin is dict:
        return {}
    if isinstance(annotation, type):
        if issubclass(annotation, BaseModel):
            return placeholder(annotation).model_dump()
        if issubclass(annotation, Enum):
            return next(iter(annotation)).value
        if issubclass(annotation, bool):
            return False
        if issubclass(annotation, int | float):
            return 0
        if issubclass(annotation, str):
            return "mock"
    return None


# --- Module-level convenience API ------------------------------------------------------------

_client: LLMClient | None = None


def get_llm() -> LLMClient:
    """Process-wide client built from current settings."""
    global _client
    if _client is None:
        _client = LLMClient(get_settings())
    return _client


def reset_llm() -> None:
    """Forget the process-wide client (tests, settings reload). Does not close connections."""
    global _client
    _client = None


async def structured[T: BaseModel](
    system: str,
    user: str,
    schema: type[T],
    *,
    model: str | None = None,
    fallback: Callable[[], T] | None = None,
    effort: Effort | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    use_cache: bool = True,
    degrade_on_error: bool | None = None,
) -> LLMResult[T]:
    """Shortcut for `get_llm().structured(...)` — see `LLMClient.structured` for arguments."""
    return await get_llm().structured(
        system,
        user,
        schema,
        model=model,
        fallback=fallback,
        effort=effort,
        max_tokens=max_tokens,
        use_cache=use_cache,
        degrade_on_error=degrade_on_error,
    )
