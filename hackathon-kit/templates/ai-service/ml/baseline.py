"""Generic tabular baseline: CSV + target -> HistGradientBoosting -> metrics + importance -> report.

    python -m ml.baseline --csv ml/sample_telemetry.csv --target is_bot

Classification vs regression is detected from the target; ID-like text columns are dropped,
other text columns become categorical, missing values are handled natively by the model.
Always compare against the dummy baseline in the report: that is the "no model" level.
"""

from __future__ import annotations

import argparse
import pickle
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    f1_score,
    mean_absolute_error,
    r2_score,
    roc_auc_score,
    root_mean_squared_error,
)
from sklearn.model_selection import train_test_split

TaskKind = Literal["classification", "regression"]
DEFAULT_OUT_DIR = Path("ml/reports")
MAX_CATEGORIES = 255  # HistGradientBoosting limit per categorical feature
MAX_CLASSES_FOR_INT_TARGET = 20


@dataclass
class BaselineResult:
    target: str
    kind: TaskKind
    rows: int
    features: list[str]
    dropped: dict[str, str]
    target_summary: str
    metrics: dict[str, float]
    dummy_metrics: dict[str, float]
    importance: list[tuple[str, float, float]]
    importance_metric: str
    model: Any = field(repr=False)


def detect_kind(y: pd.Series) -> TaskKind:
    if not pd.api.types.is_numeric_dtype(y) or pd.api.types.is_bool_dtype(y):
        return "classification"
    if pd.api.types.is_integer_dtype(y) and y.nunique() <= MAX_CLASSES_FOR_INT_TARGET:
        return "classification"
    return "regression"


def prepare_features(df: pd.DataFrame, target: str, drop: list[str]) -> tuple[pd.DataFrame, dict[str, str]]:
    """Drop useless columns (with a reason) and make text columns categorical."""
    dropped = {c: "указана в --drop" for c in drop if c in df.columns}
    X = df.drop(columns=[target, *dropped])
    for col in list(X.columns):
        s = X[col]
        if s.nunique(dropna=True) <= 1:
            dropped[col] = "константа"
        elif pd.api.types.is_datetime64_any_dtype(s):
            dropped[col] = "дата/время — сделайте признаки вручную"
        elif not pd.api.types.is_numeric_dtype(s) or pd.api.types.is_bool_dtype(s):
            if s.nunique() > 0.5 * len(s):
                dropped[col] = "ID-подобная (почти все значения уникальны)"
                continue
            top = s.value_counts().index[: MAX_CATEGORIES - 1]
            X[col] = s.where(s.isin(top) | s.isna(), "__other__").astype("category")
    return X.drop(columns=[c for c in dropped if c in X.columns]), dropped


def _classification_metrics(
    y_true: pd.Series, proba: np.ndarray, pred: np.ndarray, classes: np.ndarray
) -> dict[str, float]:
    if len(classes) == 2:
        return {
            "roc_auc": float(roc_auc_score(y_true, proba[:, 1])),
            "pr_auc": float(average_precision_score(y_true, proba[:, 1], pos_label=classes[1])),
            "f1": float(f1_score(y_true, pred, pos_label=classes[1], zero_division=0)),
            "accuracy": float(accuracy_score(y_true, pred)),
        }
    return {
        "roc_auc_ovr_macro": float(roc_auc_score(y_true, proba, multi_class="ovr", average="macro", labels=classes)),
        "f1_macro": float(f1_score(y_true, pred, average="macro", zero_division=0)),
        "accuracy": float(accuracy_score(y_true, pred)),
    }


def _regression_metrics(y_true: pd.Series, pred: np.ndarray) -> dict[str, float]:
    return {
        "rmse": float(root_mean_squared_error(y_true, pred)),
        "mae": float(mean_absolute_error(y_true, pred)),
        "r2": float(r2_score(y_true, pred)),
    }


def train_baseline(
    df: pd.DataFrame,
    target: str,
    *,
    kind: TaskKind | None = None,
    test_size: float = 0.2,
    seed: int = 42,
    drop: list[str] | None = None,
) -> BaselineResult:
    if target not in df.columns:
        raise ValueError(f"target column {target!r} not found; columns: {list(df.columns)}")
    df = df.dropna(subset=[target])
    y = df[target]
    kind = kind or detect_kind(y)
    X, dropped = prepare_features(df, target, drop or [])
    if X.empty:
        raise ValueError("no usable feature columns left")

    stratify = y if kind == "classification" and y.value_counts().min() >= 2 else None
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size, random_state=seed, stratify=stratify)

    if kind == "classification":
        model = HistGradientBoostingClassifier(random_state=seed, categorical_features="from_dtype")
        dummy = DummyClassifier(strategy="prior")
        model.fit(X_train, y_train)
        dummy.fit(X_train, y_train)
        classes = model.classes_
        metrics = _classification_metrics(y_test, model.predict_proba(X_test), model.predict(X_test), classes)
        dummy_metrics = _classification_metrics(y_test, dummy.predict_proba(X_test), dummy.predict(X_test), classes)
        scoring = "roc_auc" if len(classes) == 2 else "f1_macro"
        shares = y.value_counts(normalize=True).sort_index()
        target_summary = ", ".join(f"`{k}`: {v:.1%}" for k, v in shares.items())
    else:
        model = HistGradientBoostingRegressor(random_state=seed, categorical_features="from_dtype")
        dummy = DummyRegressor(strategy="mean")
        model.fit(X_train, y_train)
        dummy.fit(X_train, y_train)
        metrics = _regression_metrics(y_test, model.predict(X_test))
        dummy_metrics = _regression_metrics(y_test, dummy.predict(X_test))
        scoring = "neg_root_mean_squared_error"
        target_summary = f"mean {y.mean():.3g}, std {y.std():.3g}, min {y.min():.3g}, max {y.max():.3g}"

    # Permutation importance on held-out data: how much the score drops when a feature is shuffled.
    perm = permutation_importance(model, X_test, y_test, scoring=scoring, n_repeats=5, random_state=seed)
    importance = sorted(zip(X.columns, perm.importances_mean, perm.importances_std, strict=True), key=lambda t: -t[1])
    return BaselineResult(
        target=target,
        kind=kind,
        rows=len(df),
        features=list(X.columns),
        dropped=dropped,
        target_summary=target_summary,
        metrics=metrics,
        dummy_metrics=dummy_metrics,
        importance=[(str(n), float(m), float(s)) for n, m, s in importance],
        importance_metric=scoring,
        model=model,
    )


def render_markdown(r: BaselineResult, csv: Path, test_size: float, seed: int) -> str:
    model_name = type(r.model).__name__
    lines = [
        f"# ML baseline: `{r.target}` — {datetime.now():%Y-%m-%d %H:%M}",
        "",
        "| Параметр | Значение |",
        "|---|---|",
        f"| Данные | `{csv}`, {r.rows} строк |",
        f"| Задача | {'классификация' if r.kind == 'classification' else 'регрессия'} |",
        f"| Целевая переменная | {r.target_summary} |",
        f"| Признаки ({len(r.features)}) | {', '.join(f'`{f}`' for f in r.features)} |",
        f"| Модель | `{model_name}`, test_size={test_size}, seed={seed} |",
    ]
    if r.dropped:
        lines.append("| Удалены | " + "; ".join(f"`{c}` — {why}" for c, why in r.dropped.items()) + " |")
    lines += ["", "## Метрики на тесте", "", "| Метрика | Модель | Dummy baseline |", "|---|---|---|"]
    lines += [f"| {name} | **{value:.3f}** | {r.dummy_metrics[name]:.3f} |" for name, value in r.metrics.items()]
    lines += [
        "",
        f"## Важность признаков (permutation importance, падение `{r.importance_metric}`)",
        "",
        "| Признак | Среднее | ± std |",
        "|---|---|---|",
    ]
    lines += [f"| `{name}` | {mean:.4f} | {std:.4f} |" for name, mean, std in r.importance[:15]]
    lines += [
        "",
        "## Как читать",
        "",
        "- Сравнивайте с dummy baseline: это уровень «без модели» (ROC-AUC 0.5, предсказание среднего).",
        "- Важность ≈ 0 или < 0 — признак не помогает на тесте; большой разброс — нестабильный сигнал.",
        "- Слишком хорошие метрики — ищите утечку: признак, посчитанный после события, или один игрок",
        "  в train и test. Для временных данных делите по времени, а не случайно.",
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Tabular baseline with HistGradientBoosting.")
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--target", required=True, help="target column")
    parser.add_argument("--task", choices=["auto", "classification", "regression"], default="auto")
    parser.add_argument("--drop", default="", help="comma-separated columns to ignore (ids, leaks)")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR, help="report directory")
    parser.add_argument("--save-model", type=Path, help="pickle the fitted model to this path")
    args = parser.parse_args(argv)

    df = pd.read_csv(args.csv)
    result = train_baseline(
        df,
        args.target,
        kind=None if args.task == "auto" else args.task,
        test_size=args.test_size,
        seed=args.seed,
        drop=[c.strip() for c in args.drop.split(",") if c.strip()],
    )
    args.out.mkdir(parents=True, exist_ok=True)
    report = args.out / f"{datetime.now():%Y%m%d-%H%M%S}_{args.target}.md"
    report.write_text(render_markdown(result, args.csv, args.test_size, args.seed), encoding="utf-8")
    if args.save_model:
        args.save_model.write_bytes(pickle.dumps(result.model))

    print(f"ML baseline {args.target}: {result.kind}, {result.rows} rows, {len(result.features)} features")
    print("  " + " | ".join(f"{k} {v:.3f} (dummy {result.dummy_metrics[k]:.3f})" for k, v in result.metrics.items()))
    print("  top features: " + ", ".join(name for name, _, _ in result.importance[:3]))
    print(f"  отчёт: {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
