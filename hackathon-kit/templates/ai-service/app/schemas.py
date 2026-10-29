"""HTTP request/response models. Generic over each task's input/output models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.llm import CallMeta, UsageTotals

MAX_BATCH_ITEMS = 100


class TaskResponse[OutT: BaseModel](BaseModel):
    task: str
    output: OutT
    meta: CallMeta


class BatchRequest[InT: BaseModel](BaseModel):
    items: list[InT] = Field(min_length=1, max_length=MAX_BATCH_ITEMS)


class BatchItem[OutT: BaseModel](BaseModel):
    index: int
    output: OutT | None = None
    meta: CallMeta | None = None
    error: str | None = None


class BatchSummary(BaseModel):
    total: int
    succeeded: int
    failed: int
    wall_time_ms: float
    usage: UsageTotals


class BatchResponse[OutT: BaseModel](BaseModel):
    task: str
    results: list[BatchItem[OutT]]
    summary: BatchSummary


class TaskInfo(BaseModel):
    name: str
    title: str
    description: str
    model: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    examples: list[dict[str, Any]]


class HealthResponse(BaseModel):
    status: str = "ok"
    provider: str
    model: str
    fast_model: str
    mock: bool
    tasks: list[str]
