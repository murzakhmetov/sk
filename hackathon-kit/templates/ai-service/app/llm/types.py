"""Data types shared by the LLM client, providers, API and evals."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field

from app.config import Effort

Source = Literal["llm", "cache", "mock", "fallback"]
"""Where an answer came from: a live call, the disk cache, mock mode, or the heuristic after an error."""


@dataclass(frozen=True, slots=True)
class CompletionRequest:
    """What a provider needs to produce one JSON answer."""

    system: str
    user: str
    schema: type[BaseModel]
    model: str
    max_tokens: int
    effort: Effort | None = None


@dataclass(frozen=True, slots=True)
class Completion:
    """Raw provider answer: JSON text plus usage. Validation happens in the client."""

    text: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


class CallMeta(BaseModel):
    """Observability data attached to every answer (returned by the API, aggregated by evals)."""

    source: Source
    provider: str
    model: str
    latency_ms: float = Field(description="Wall-clock time of this call, ms.")
    attempts: int = Field(default=0, description="Provider calls made (0 for cache/mock).")
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float | None = Field(default=None, description="Rough estimate; None if model price is unknown.")
    error: str | None = Field(default=None, description="Why the heuristic was used (source=fallback).")


@dataclass(frozen=True, slots=True)
class LLMResult[OutT: BaseModel]:
    """A validated structured answer plus its metadata."""

    output: OutT
    meta: CallMeta


class UsageTotals(BaseModel):
    """Running totals over many calls (process lifetime, a batch, or an eval run)."""

    calls: int = 0
    by_source: dict[str, int] = Field(default_factory=dict)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = Field(default=0.0, description="Money actually spent: cache hits and mocks are free.")
    unpriced_calls: int = Field(default=0, description="Live calls whose model price is unknown.")

    def add(self, meta: CallMeta) -> None:
        self.calls += 1
        self.by_source[meta.source] = self.by_source.get(meta.source, 0) + 1
        if meta.source != "llm":
            return
        self.input_tokens += meta.input_tokens + meta.cache_read_tokens + meta.cache_write_tokens
        self.output_tokens += meta.output_tokens
        if meta.cost_usd is None:
            self.unpriced_calls += 1
        else:
            self.cost_usd += meta.cost_usd
