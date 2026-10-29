"""Generic eval runner: run a registered task over a labelled JSONL dataset, score it, write a report.

    python -m evals.run_eval --task moderation --dataset evals/datasets/moderation_sample.jsonl

Dataset: one JSON object per line —
    {"id": "ins-02", "input": {<task input>}, "expected": {"label": "insult", "action": "mute"},
     "tags": ["obfuscation"]}

The target field (task.eval_target or --target, default: first `expected` key) gets accuracy,
macro-F1, per-class precision/recall and a confusion matrix; other `expected` keys get accuracy.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.llm import CallMeta, LLMError, UsageTotals, get_llm
from app.tasks import AnyTask, get_task
from evals.metrics import (
    ERROR_LABEL,
    BinaryReport,
    ClassificationReport,
    binary_report,
    classification_report,
    percentile,
)

DEFAULT_OUT_DIR = Path("evals/reports")


@dataclass(frozen=True, slots=True)
class Example:
    id: str
    input: BaseModel
    expected: dict[str, Any]
    tags: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class Prediction:
    example: Example
    output: dict[str, Any] | None
    meta: CallMeta | None
    error: str | None = None

    def value(self, key: str) -> str:
        return ERROR_LABEL if self.output is None else str(self.output.get(key))


@dataclass(frozen=True, slots=True)
class EvalResult:
    task: str
    dataset: Path
    target: str
    mode: str
    model: str
    predictions: list[Prediction]
    report: ClassificationReport
    binary: BinaryReport | None
    field_accuracy: dict[str, float]
    tag_accuracy: dict[str, tuple[int, float]]
    latency_p50_ms: float
    latency_p95_ms: float
    usage: UsageTotals
    cost_without_cache_usd: float | None

    @property
    def errors(self) -> list[Prediction]:
        return [p for p in self.predictions if p.error is not None]


def load_dataset(path: Path, task: AnyTask, limit: int | None = None) -> list[Example]:
    examples: list[Example] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            examples.append(
                Example(
                    id=str(row.get("id", line_no)),
                    input=task.input_model.model_validate(row["input"]),
                    expected=dict(row["expected"]),
                    tags=list(row.get("tags", [])),
                )
            )
        except (json.JSONDecodeError, KeyError, TypeError, ValidationError) as exc:
            raise ValueError(f"{path}:{line_no}: bad dataset row: {exc}") from exc
        if limit is not None and len(examples) >= limit:
            break
    if not examples:
        raise ValueError(f"{path}: dataset is empty")
    return examples


async def predict(task: AnyTask, examples: list[Example], *, concurrency: int, use_cache: bool) -> list[Prediction]:
    semaphore = asyncio.Semaphore(concurrency)

    async def one(example: Example) -> Prediction:
        async with semaphore:
            try:
                # degrade_on_error=False: an LLM failure must count as an error, not as a heuristic answer.
                result = await task.run(example.input, use_cache=use_cache, degrade_on_error=False)
            except LLMError as exc:
                return Prediction(example, None, None, f"{type(exc).__name__}: {exc}")
            return Prediction(example, result.output.model_dump(mode="json"), result.meta)

    return list(await asyncio.gather(*(one(e) for e in examples)))


def evaluate(task: AnyTask, dataset: Path, predictions: list[Prediction], target: str | None = None) -> EvalResult:
    target = target or task.eval_target or next(iter(predictions[0].example.expected))
    scored = [p for p in predictions if target in p.example.expected]
    if not scored:
        raise ValueError(f"no example has expected[{target!r}]")
    y_true = [str(p.example.expected[target]) for p in scored]
    y_pred = [p.value(target) for p in scored]

    field_accuracy = {}
    for key in sorted({k for p in predictions for k in p.example.expected} - {target}):
        rows = [p for p in predictions if key in p.example.expected]
        field_accuracy[key] = sum(p.value(key) == str(p.example.expected[key]) for p in rows) / len(rows)

    by_tag: dict[str, list[bool]] = defaultdict(list)
    for p, truth, pred in zip(scored, y_true, y_pred, strict=True):
        for tag in p.example.tags:
            by_tag[tag].append(truth == pred)
    tag_accuracy = {tag: (len(hits), sum(hits) / len(hits)) for tag, hits in sorted(by_tag.items())}

    metas = [p.meta for p in predictions if p.meta is not None]
    usage = UsageTotals()
    for m in metas:
        usage.add(m)
    paid = [m.cost_usd for m in metas if m.source in ("llm", "cache")]
    settings = get_settings()
    return EvalResult(
        task=task.name,
        dataset=dataset,
        target=target,
        mode="MOCK (эвристика, без LLM)" if get_llm().mock else f"LLM ({settings.llm_provider})",
        model=task.model,
        predictions=predictions,
        report=classification_report(y_true, y_pred),
        binary=binary_report(y_true, y_pred, task.negative_label) if task.negative_label else None,
        field_accuracy=field_accuracy,
        tag_accuracy=tag_accuracy,
        latency_p50_ms=percentile([m.latency_ms for m in metas], 50),
        latency_p95_ms=percentile([m.latency_ms for m in metas], 95),
        usage=usage,
        cost_without_cache_usd=None if any(c is None for c in paid) else sum(c for c in paid if c is not None),
    )


# --- Report ------------------------------------------------------------------------------------


def _cell(value: Any, limit: int = 90) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    text = " ".join(text.split()).replace("|", "\\|")
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _preview(model: BaseModel) -> str:
    data = model.model_dump(mode="json")
    return next((v for v in data.values() if isinstance(v, str)), json.dumps(data, ensure_ascii=False))


def _money(usd: float | None) -> str:
    return "n/a" if usd is None else f"${usd:.4f}"


def render_markdown(r: EvalResult) -> str:
    rep, lines = r.report, []
    lines += [
        f"# Eval: `{r.task}` — {datetime.now():%Y-%m-%d %H:%M}",
        "",
        "| Параметр | Значение |",
        "|---|---|",
        f"| Датасет | `{r.dataset}` ({len(r.predictions)} примеров) |",
        f"| Режим | {r.mode} |",
        f"| Модель | `{r.model}` |",
        f"| Целевое поле | `{r.target}` |",
        "",
        "## Итог",
        "",
        "| Метрика | Значение |",
        "|---|---|",
        f"| Accuracy | **{rep.accuracy:.3f}** |",
        f"| Macro-F1 | **{rep.macro_f1:.3f}** |",
    ]
    if r.binary:
        b = r.binary
        lines += [
            f"| Нарушение vs `{b.negative}`: precision | {b.precision:.3f} |",
            f"| Нарушение vs `{b.negative}`: recall | {b.recall:.3f} |",
            f"| Ложные срабатывания на `{b.negative}` (FPR, n={b.negatives}) | {b.false_positive_rate:.3f} |",
        ]
    lines += [f"| Accuracy поля `{k}` | {v:.3f} |" for k, v in r.field_accuracy.items()]
    sources = ", ".join(f"{k}: {v}" for k, v in sorted(r.usage.by_source.items())) or "—"
    lines += [
        f"| Latency p50 / p95 | {r.latency_p50_ms:.1f} / {r.latency_p95_ms:.1f} мс |",
        f"| Токены (вход / выход), живые вызовы | {r.usage.input_tokens} / {r.usage.output_tokens} |",
        f"| Потрачено в этом прогоне | {_money(r.usage.cost_usd)} |",
        f"| Стоимость прогона без кэша (оценка) | {_money(r.cost_without_cache_usd)} |",
        f"| Источники ответов | {sources} |",
        f"| Ошибки вызова | {len(r.errors)} |",
        "",
        "## По классам",
        "",
        "| Класс | Precision | Recall | F1 | Support |",
        "|---|---|---|---|---|",
    ]
    lines += [f"| `{c.label}` | {c.precision:.2f} | {c.recall:.2f} | {c.f1:.2f} | {c.support} |" for c in rep.per_class]

    columns = list(next(iter(rep.confusion.values())).keys())
    lines += [
        "",
        "## Матрица ошибок",
        "",
        "Строки — эталон, столбцы — предсказание.",
        "",
        "| эталон \\ предсказание | " + " | ".join(f"`{c}`" for c in columns) + " |",
        "|---|" + "---|" * len(columns),
    ]
    for truth, row in rep.confusion.items():
        cells = [f"**{n}**" if truth == pred and n else (str(n) if n else "·") for pred, n in row.items()]
        lines.append(f"| `{truth}` | " + " | ".join(cells) + " |")

    if r.tag_accuracy:
        lines += ["", "## По тегам", "", "| Тег | N | Accuracy |", "|---|---|---|"]
        lines += [f"| `{tag}` | {n} | {acc:.2f} |" for tag, (n, acc) in r.tag_accuracy.items()]

    misses = [p for p in r.predictions if p.value(r.target) != str(p.example.expected.get(r.target))]
    lines += ["", f"## Ошибки модели ({len(misses)})", ""]
    if misses:
        lines += [
            "Разберите их: это готовый список правок для промпта, эвристики или разметки.",
            "",
            "| id | Вход | Эталон | Предсказание | Ответ целиком |",
            "|---|---|---|---|---|",
        ]
        for p in misses:
            answer = p.error or {k: v for k, v in (p.output or {}).items() if k != r.target}
            expected = p.example.expected.get(r.target)
            lines.append(
                f"| {p.example.id} | {_cell(_preview(p.example.input), 70)} | `{expected}` "
                f"| `{p.value(r.target)}` | {_cell(answer, 120)} |"
            )
    else:
        lines.append("Нет — все примеры размечены верно.")
    return "\n".join(lines) + "\n"


def write_outputs(r: EvalResult, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{datetime.now():%Y%m%d-%H%M%S}_{r.task}"
    report = out_dir / f"{stem}.md"
    report.write_text(render_markdown(r), encoding="utf-8")
    with (out_dir / f"{stem}.jsonl").open("w", encoding="utf-8") as fh:  # raw predictions, for diffing runs
        for p in r.predictions:
            row = {
                "id": p.example.id,
                "expected": p.example.expected,
                "output": p.output,
                "meta": p.meta.model_dump() if p.meta else None,
                "error": p.error,
            }
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    return report


def summary_line(r: EvalResult, report: Path) -> str:
    parts = [
        f"Eval {r.task}: {len(r.predictions)} примеров, {r.mode}, модель {r.model}",
        f"  accuracy {r.report.accuracy:.3f} | macro-F1 {r.report.macro_f1:.3f}"
        + (f" | FPR({r.binary.negative}) {r.binary.false_positive_rate:.3f}" if r.binary else "")
        + "".join(f" | {k} acc {v:.3f}" for k, v in r.field_accuracy.items()),
        f"  latency p50 {r.latency_p50_ms:.1f} мс, p95 {r.latency_p95_ms:.1f} мс | токены "
        f"{r.usage.input_tokens}/{r.usage.output_tokens} | потрачено {_money(r.usage.cost_usd)}"
        f" | ошибок вызова {len(r.errors)}",
        f"  отчёт: {report}",
    ]
    return "\n".join(parts)


async def run_eval(
    task_name: str,
    dataset: Path,
    *,
    limit: int | None = None,
    concurrency: int = 4,
    use_cache: bool = True,
    target: str | None = None,
    out_dir: Path = DEFAULT_OUT_DIR,
) -> tuple[EvalResult, Path]:
    task = get_task(task_name)
    examples = load_dataset(dataset, task, limit)
    try:
        predictions = await predict(task, examples, concurrency=concurrency, use_cache=use_cache)
    finally:
        await get_llm().aclose()
    result = evaluate(task, dataset, predictions, target)
    return result, write_outputs(result, out_dir)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a task over a labelled dataset and write a report.")
    parser.add_argument("--task", required=True, help="registered task name, e.g. moderation")
    parser.add_argument("--dataset", required=True, type=Path, help="JSONL with id/input/expected/tags")
    parser.add_argument("--limit", type=int, help="only the first N examples")
    parser.add_argument("--concurrency", type=int, default=4, help="parallel LLM calls (default 4)")
    parser.add_argument("--target", help="expected field to score (default: task.eval_target)")
    parser.add_argument("--no-cache", action="store_true", help="bypass the disk cache (honest latency)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR, help="report directory")
    parser.add_argument("--fail-under", type=float, help="exit 1 if macro-F1 is below this (CI gate)")
    parser.add_argument("-v", "--verbose", action="store_true", help="log every LLM call")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s %(message)s")
    result, report = asyncio.run(
        run_eval(
            args.task,
            args.dataset,
            limit=args.limit,
            concurrency=args.concurrency,
            use_cache=not args.no_cache,
            target=args.target,
            out_dir=args.out,
        )
    )
    print(summary_line(result, report))
    if args.fail_under is not None and result.report.macro_f1 < args.fail_under:
        print(f"FAIL: macro-F1 {result.report.macro_f1:.3f} < {args.fail_under}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
