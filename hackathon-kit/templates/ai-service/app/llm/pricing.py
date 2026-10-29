"""Rough cost estimates (USD per 1M tokens). Update the table if prices change.

Source: Anthropic public pricing (cached 2026-10). Unknown models return None, so reports
show "n/a" instead of a made-up number. Prompt-cache multipliers: write 1.25x, read 0.1x.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Price:
    input_per_mtok: float
    output_per_mtok: float


PRICES: dict[str, Price] = {
    "claude-fable-5-1": Price(10.00, 50.00),
    "claude-opus-5-5": Price(4.00, 20.00),
    "claude-opus-5": Price(5.00, 25.00),
    "claude-sonnet-5-5": Price(2.00, 10.00),
    "claude-sonnet-5": Price(2.00, 10.00),
    "claude-sonnet-4-6": Price(3.00, 15.00),
    "claude-haiku-5-5": Price(0.10, 0.50),  # prompts <= 100K tokens
    "claude-haiku-4-5": Price(1.00, 5.00),
}

CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.10


def _normalize(model: str) -> str:
    """'anthropic/claude-sonnet-5.5' (OpenRouter style) -> 'claude-sonnet-5-5'."""
    name = model.rsplit("/", 1)[-1].lower()
    return re.sub(r"(?<=\d)\.(?=\d)", "-", name)


def price_for(model: str) -> Price | None:
    return PRICES.get(_normalize(model))


def estimate_cost(
    model: str,
    *,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float | None:
    """Estimated USD cost of one call, or None if the model is not in the price table."""
    price = price_for(model)
    if price is None:
        return None
    input_cost = (
        input_tokens + cache_write_tokens * CACHE_WRITE_MULTIPLIER + cache_read_tokens * CACHE_READ_MULTIPLIER
    ) * price.input_per_mtok
    return (input_cost + output_tokens * price.output_per_mtok) / 1_000_000
