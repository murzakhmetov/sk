from __future__ import annotations

from pathlib import Path

import pytest

pd = pytest.importorskip("pandas")
pytest.importorskip("sklearn")

from ml.baseline import main, train_baseline  # noqa: E402
from ml.make_sample_telemetry import generate  # noqa: E402

SAMPLE = Path(__file__).parents[1] / "ml" / "sample_telemetry.csv"


def test_classification_baseline_beats_dummy() -> None:
    result = train_baseline(pd.read_csv(SAMPLE), "is_bot")
    assert result.kind == "classification"
    assert "player_id" in result.dropped  # ID-like column removed
    assert "server" in result.features  # text column kept as categorical
    assert result.metrics["roc_auc"] > 0.8 > result.dummy_metrics["roc_auc"]
    assert len(result.importance) == len(result.features)


def test_regression_is_detected_for_continuous_targets() -> None:
    result = train_baseline(pd.read_csv(SAMPLE), "money_earned_per_hour", drop=["player_id"])
    assert result.kind == "regression"
    assert result.dropped == {"player_id": "указана в --drop"}
    assert set(result.metrics) == set(result.dummy_metrics) == {"rmse", "mae", "r2"}
    assert result.importance_metric == "neg_root_mean_squared_error"


def test_cli_writes_a_report(tmp_path: Path) -> None:
    assert main(["--csv", str(SAMPLE), "--target", "is_bot", "--out", str(tmp_path)]) == 0
    (report,) = tmp_path.glob("*.md")
    assert "ROC" in report.read_text(encoding="utf-8") or "roc_auc" in report.read_text(encoding="utf-8")


def test_sample_generator_is_deterministic() -> None:
    assert generate(50, seed=1).equals(generate(50, seed=1))
