from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

# Example-task tests: skipped once the `moderation` example is deleted (see README, «Новая задача»).
pytest.importorskip("app.tasks.moderation", reason="example task removed")

from evals.metrics import ERROR_LABEL, binary_report, classification_report, percentile
from evals.run_eval import main, run_eval

DATASET = Path(__file__).parents[1] / "evals" / "datasets" / "moderation_sample.jsonl"


def test_classification_report_matches_hand_computation() -> None:
    report = classification_report(["a", "a", "b", "b"], ["a", "b", "b", "b"])
    stats = {c.label: c for c in report.per_class}
    assert report.accuracy == 0.75
    assert (stats["a"].precision, stats["a"].recall) == (1.0, 0.5)
    assert stats["b"].precision == pytest.approx(2 / 3)
    assert report.macro_f1 == pytest.approx((2 / 3 + 0.8) / 2)
    assert report.confusion == {"a": {"a": 1, "b": 1}, "b": {"a": 0, "b": 2}}


def test_failed_calls_count_as_wrong_and_get_their_own_column() -> None:
    report = classification_report(["a", "b"], ["a", ERROR_LABEL])
    assert report.accuracy == 0.5
    assert report.confusion["b"][ERROR_LABEL] == 1
    assert ERROR_LABEL not in report.labels


def test_binary_report_tracks_false_positives() -> None:
    b = binary_report(["ok", "ok", "spam", "insult"], ["spam", "ok", "spam", "ok"], negative="ok")
    assert b.false_positive_rate == 0.5  # one of two clean messages flagged
    assert b.precision == 0.5
    assert b.recall == 0.5


def test_percentile_interpolates_like_numpy() -> None:
    assert percentile([1, 2, 3, 4], 50) == 2.5
    assert percentile([1, 2, 3, 4], 95) == pytest.approx(3.85)


def test_run_eval_writes_report_and_predictions(tmp_path: Path) -> None:
    result, report = asyncio.run(run_eval("moderation", DATASET, limit=8, concurrency=2, out_dir=tmp_path))
    assert len(result.predictions) == 8
    assert result.usage.by_source == {"mock": 8}
    assert result.binary is not None
    text = report.read_text(encoding="utf-8")
    for heading in ("Macro-F1", "По классам", "Матрица ошибок", "Latency p50 / p95"):
        assert heading in text
    assert report.with_suffix(".jsonl").exists()


def test_cli_fail_under_gate(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    args = ["--task", "moderation", "--dataset", str(DATASET), "--limit", "5", "--out", str(tmp_path)]
    assert main(args) == 0
    assert main([*args, "--fail-under", "1.01"]) == 1
    assert "macro-F1" in capsys.readouterr().out
