"""ONE real LLM call to check key, model and network (costs a fraction of a cent).

    make smoke        # or: python -m scripts.smoke

Exit codes: 0 ok, 1 the call failed, 2 no API key (mock mode).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

from app.config import get_settings
from app.llm import LLMError, get_llm
from app.tasks import all_tasks, get_task


async def main() -> int:
    settings = get_settings()
    if settings.mock_mode:
        key_var = "ANTHROPIC_API_KEY" if settings.llm_provider == "anthropic" else "OPENAI_COMPAT_API_KEY"
        print(f"Mock mode: set {key_var} in .env (and LLM_MOCK=false) to make a real call.", file=sys.stderr)
        return 2

    # SMOKE_TASK=<name> picks a task; default: the first registered task that has examples.
    name = os.environ.get("SMOKE_TASK")
    task = get_task(name) if name else next((t for t in all_tasks() if t.examples), None)
    if task is None or not task.examples:
        print("No task with examples: set `examples` on a task or SMOKE_TASK=<name>.", file=sys.stderr)
        return 1
    payload = task.examples[0]
    try:
        result = await task.run(payload, use_cache=False, degrade_on_error=False)
    except LLMError as exc:
        print(f"FAIL {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        await get_llm().aclose()

    meta = result.meta
    cost = "n/a" if meta.cost_usd is None else f"${meta.cost_usd:.6f}"
    print(f"provider : {meta.provider}")
    print(f"model    : {meta.model}")
    print(f"latency  : {meta.latency_ms:.0f} ms ({meta.attempts} attempt(s))")
    print(
        f"tokens   : in {meta.input_tokens} (+cache read {meta.cache_read_tokens}, "
        f"write {meta.cache_write_tokens}), out {meta.output_tokens}"
    )
    print(f"cost     : {cost}")
    print("output   :", json.dumps(result.output.model_dump(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
