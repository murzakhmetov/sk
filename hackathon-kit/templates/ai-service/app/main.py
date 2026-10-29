"""FastAPI app: /health, one router per registered task, /v1/usage, /docs, playground at /.

NB: no `from __future__ import annotations` here — the per-task routes annotate request
bodies with models known only at runtime, and FastAPI must be able to evaluate them.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.config import get_settings
from app.llm import LLMError, UsageTotals, get_llm
from app.schemas import (
    MAX_BATCH_ITEMS,
    BatchItem,
    BatchRequest,
    BatchResponse,
    BatchSummary,
    HealthResponse,
    TaskInfo,
    TaskResponse,
)
from app.tasks import AnyTask, all_tasks

STATIC_DIR = Path(__file__).parent / "static"

settings = get_settings()  # startup-time config only (logging, CORS); handlers call get_settings()
logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
for _noisy in ("httpx", "httpx2"):  # one INFO line per HTTP request is too chatty
    logging.getLogger(_noisy).setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await get_llm().aclose()


app = FastAPI(
    title="AI Service — hackathon template",
    version="0.1.0",
    description="LLM-задачи для игровой студии: структурированный JSON, кэш, mock-режим, evals.",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(LLMError)
async def llm_error_handler(_: Request, exc: LLMError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": f"{type(exc).__name__}: {exc}"})


@app.get("/health", tags=["service"])
async def health() -> HealthResponse:
    current = get_settings()
    return HealthResponse(
        provider=current.llm_provider,
        model=current.llm_model,
        fast_model=current.llm_fast_model,
        mock=get_llm().mock,
        tasks=[t.name for t in all_tasks()],
    )


@app.get("/v1/tasks", tags=["service"])
async def list_tasks() -> list[TaskInfo]:
    return [
        TaskInfo(
            name=t.name,
            title=t.title,
            description=t.description,
            model=t.model,
            input_schema=t.input_model.model_json_schema(),
            output_schema=t.output_model.model_json_schema(),
            examples=[e.model_dump(mode="json") for e in t.examples],
        )
        for t in all_tasks()
    ]


@app.get("/v1/usage", tags=["service"])
async def usage() -> UsageTotals:
    """Totals since process start: calls by source, tokens, estimated spend."""
    return get_llm().usage


@app.get("/", include_in_schema=False)
async def playground() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


def task_router(task: AnyTask) -> APIRouter:
    """POST /v1/tasks/<name> and /v1/tasks/<name>/batch with the task's own typed schemas.

    The models are only known at runtime, so static type checkers can't follow the
    annotations below (hence the `type: ignore`s); FastAPI evaluates them for validation and docs.
    """
    input_model, output_model = task.input_model, task.output_model
    single_response = TaskResponse[output_model]  # type: ignore[valid-type]
    batch_request = BatchRequest[input_model]  # type: ignore[valid-type]
    batch_item = BatchItem[output_model]  # type: ignore[valid-type]
    batch_response = BatchResponse[output_model]  # type: ignore[valid-type]
    examples = [e.model_dump(mode="json") for e in task.examples]
    router = APIRouter(prefix=f"/v1/tasks/{task.name}", tags=[task.title])

    async def run_one(payload: Annotated[input_model, Body(examples=examples)]) -> Any:  # type: ignore[valid-type]
        result = await task.run(payload)
        return single_response(task=task.name, output=result.output, meta=result.meta)

    async def run_batch(request: batch_request) -> Any:
        started = time.perf_counter()
        semaphore = asyncio.Semaphore(get_settings().batch_concurrency)

        async def run_item(index: int, item: Any) -> Any:
            async with semaphore:
                try:
                    result = await task.run(item)
                except LLMError as exc:  # one bad item must not fail the whole batch
                    return batch_item(index=index, error=f"{type(exc).__name__}: {exc}")
                return batch_item(index=index, output=result.output, meta=result.meta)

        results = await asyncio.gather(*(run_item(i, item) for i, item in enumerate(request.items)))
        totals = UsageTotals()
        for item in results:
            if item.meta is not None:
                totals.add(item.meta)
        failed = sum(item.error is not None for item in results)
        summary = BatchSummary(
            total=len(results),
            succeeded=len(results) - failed,
            failed=failed,
            wall_time_ms=round((time.perf_counter() - started) * 1000, 2),
            usage=totals,
        )
        return batch_response(task=task.name, results=results, summary=summary)

    router.add_api_route(
        "", run_one, methods=["POST"], response_model=single_response, summary=task.title,
        description=task.description,
    )  # fmt: skip
    router.add_api_route(
        "/batch", run_batch, methods=["POST"], response_model=batch_response,
        summary=f"{task.title} — пакетом", description=f"До {MAX_BATCH_ITEMS} элементов за запрос.",
    )  # fmt: skip
    return router


for _task in all_tasks():
    app.include_router(task_router(_task))


# Registered after the task routers, so it only catches names that don't exist.
@app.post("/v1/tasks/{task_name}", include_in_schema=False)
@app.post("/v1/tasks/{task_name}/batch", include_in_schema=False)
async def unknown_task(task_name: str) -> None:
    available = [t.name for t in all_tasks()]
    raise HTTPException(status_code=404, detail=f"Unknown task {task_name!r}. Available: {available}")
