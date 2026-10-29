"""LLM layer: one entry point, `structured()`, for schema-validated JSON answers.

from app.llm import structured
result = await structured(system, user, MySchema, fallback=my_heuristic)
result.output  # MySchema instance
result.meta    # source (llm|cache|mock|fallback), latency, tokens, cost
"""

from app.llm.client import LLMClient, get_llm, placeholder, reset_llm, structured
from app.llm.errors import (
    LLMConfigError,
    LLMError,
    LLMOutputError,
    LLMRefusalError,
    LLMTransientError,
)
from app.llm.types import CallMeta, LLMResult, Source, UsageTotals

__all__ = [
    "CallMeta",
    "LLMClient",
    "LLMConfigError",
    "LLMError",
    "LLMOutputError",
    "LLMRefusalError",
    "LLMResult",
    "LLMTransientError",
    "Source",
    "UsageTotals",
    "get_llm",
    "placeholder",
    "reset_llm",
    "structured",
]
