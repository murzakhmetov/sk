"""Task = one AI capability exposed by the service (schemas + prompt + offline heuristic).

To add a task, subclass `Task`, decorate it with `@register` and drop the module into
`app/tasks/` — it is auto-imported, gets `/v1/tasks/<name>` (+ `/batch`) routes, shows up
in the playground and can be evaluated with `evals/run_eval.py --task <name>`.
"""

from __future__ import annotations

import dataclasses
from abc import ABC, abstractmethod
from collections.abc import Sequence
from typing import Any, Literal

from pydantic import BaseModel

from app.config import Effort, get_settings
from app.llm import LLMResult, placeholder, structured

ModelTier = Literal["main", "fast"]


class Task[InT: BaseModel, OutT: BaseModel](ABC):
    """Base class for tasks. Subclasses set the class attributes and implement `build_prompt`."""

    name: str
    """URL-safe id: /v1/tasks/<name>."""
    title: str
    """Human-readable title for docs and the playground."""
    description: str
    input_model: type[InT]
    output_model: type[OutT]
    system_prompt: str

    model_tier: ModelTier = "main"
    """"main" -> LLM_MODEL, "fast" -> LLM_FAST_MODEL (cheap high-volume tasks)."""
    effort: Effort | None = None
    """Anthropic effort level; None = model default."""
    max_tokens: int = 2048
    examples: Sequence[InT] = ()
    """Sample inputs shown in the playground and OpenAPI docs."""

    eval_target: str | None = None
    """Output field scored by evals (accuracy / macro-F1). Defaults to the first `expected` key."""
    negative_label: str | None = None
    """Value of `eval_target` meaning "nothing found" (e.g. "ok"); enables binary precision/recall."""

    @abstractmethod
    def build_prompt(self, payload: InT) -> str:
        """Render the per-request user message."""

    def heuristic(self, payload: InT) -> OutT:
        """Offline answer for mock mode and LLM outages. Override with rules / a small model."""
        return placeholder(self.output_model)

    def postprocess(self, payload: InT, output: OutT) -> OutT:
        """Business rules applied to EVERY answer (llm, cache, mock, fallback) before it leaves the task.

        Decisions with consequences (auto-close, ban, refund) must be recomputed here from the
        input and validated fields, never trusted from the model: the model can be wrong or
        prompt-injected by the user's text. Default: no-op.
        """
        return output

    @property
    def model(self) -> str:
        settings = get_settings()
        return settings.llm_fast_model if self.model_tier == "fast" else settings.llm_model

    async def run(
        self, payload: InT, *, use_cache: bool = True, degrade_on_error: bool | None = None
    ) -> LLMResult[OutT]:
        result = await structured(
            self.system_prompt,
            self.build_prompt(payload),
            self.output_model,
            model=self.model,
            fallback=lambda: self.heuristic(payload),
            effort=self.effort,
            max_tokens=self.max_tokens,
            use_cache=use_cache,
            degrade_on_error=degrade_on_error,
        )
        return dataclasses.replace(result, output=self.postprocess(payload, result.output))


AnyTask = Task[Any, Any]

_REGISTRY: dict[str, AnyTask] = {}


class UnknownTaskError(KeyError):
    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name


def register[TaskT: type[AnyTask]](cls: TaskT) -> TaskT:
    """Class decorator: instantiate the task and add it to the registry."""
    task = cls()
    missing = [
        attr
        for attr in ("name", "title", "description", "input_model", "output_model", "system_prompt")
        if not hasattr(task, attr)
    ]
    if missing:
        raise TypeError(f"{cls.__name__} must define: {', '.join(missing)}")
    if task.name in _REGISTRY:
        raise ValueError(f"duplicate task name {task.name!r}")
    _REGISTRY[task.name] = task
    return cls


def get_task(name: str) -> AnyTask:
    try:
        return _REGISTRY[name]
    except KeyError:
        raise UnknownTaskError(name) from None


def all_tasks() -> list[AnyTask]:
    return list(_REGISTRY.values())
