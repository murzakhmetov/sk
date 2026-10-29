"""Dependency-free classification metrics (same definitions as scikit-learn's defaults)."""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

ERROR_LABEL = "<error>"
"""Placeholder prediction when a call failed: counts as wrong, shows up in the confusion matrix."""


@dataclass(frozen=True, slots=True)
class ClassStats:
    label: str
    precision: float
    recall: float
    f1: float
    support: int


@dataclass(frozen=True, slots=True)
class ClassificationReport:
    labels: list[str]
    accuracy: float
    macro_f1: float
    per_class: list[ClassStats]
    confusion: dict[str, dict[str, int]]
    """confusion[true][predicted] = count; predicted may include ERROR_LABEL."""


def _safe_div(num: float, den: float) -> float:
    return num / den if den else 0.0


def classification_report(y_true: Sequence[str], y_pred: Sequence[str]) -> ClassificationReport:
    """Accuracy, macro-F1 and per-class precision/recall/F1 over the union of seen labels."""
    if len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred must have the same length")
    if not y_true:
        raise ValueError("empty input")
    labels = sorted(set(y_true) | (set(y_pred) - {ERROR_LABEL}))
    pairs = Counter(zip(y_true, y_pred, strict=True))
    per_class = []
    for label in labels:
        tp = pairs[(label, label)]
        predicted = sum(n for (_, p), n in pairs.items() if p == label)
        support = sum(n for (t, _), n in pairs.items() if t == label)
        precision, recall = _safe_div(tp, predicted), _safe_div(tp, support)
        per_class.append(
            ClassStats(label, precision, recall, _safe_div(2 * precision * recall, precision + recall), support)
        )
    columns = labels + ([ERROR_LABEL] if ERROR_LABEL in y_pred else [])
    confusion = {t: {p: pairs[(t, p)] for p in columns} for t in labels}
    return ClassificationReport(
        labels=labels,
        accuracy=sum(t == p for t, p in zip(y_true, y_pred, strict=True)) / len(y_true),
        macro_f1=sum(c.f1 for c in per_class) / len(per_class),
        per_class=per_class,
        confusion=confusion,
    )


@dataclass(frozen=True, slots=True)
class BinaryReport:
    """Binary view: anything flagged vs `negative` (e.g. any violation vs ok in moderation)."""

    negative: str
    precision: float
    recall: float
    false_positive_rate: float
    """Share of truly-negative items that got flagged (false bans, in moderation terms)."""
    negatives: int


def binary_report(y_true: Sequence[str], y_pred: Sequence[str], negative: str) -> BinaryReport:
    tp = fp = fn = tn = 0
    for t, p in zip(y_true, y_pred, strict=True):
        actual, flagged = t != negative, p not in (negative, ERROR_LABEL)
        tp += actual and flagged
        fp += (not actual) and flagged
        fn += actual and not flagged
        tn += (not actual) and not flagged
    return BinaryReport(
        negative=negative,
        precision=_safe_div(tp, tp + fp),
        recall=_safe_div(tp, tp + fn),
        false_positive_rate=_safe_div(fp, fp + tn),
        negatives=fp + tn,
    )


def percentile(values: Sequence[float], q: float) -> float:
    """Linear-interpolated percentile (numpy's default method); q in [0, 100]."""
    if not values:
        return math.nan
    ordered = sorted(values)
    rank = (len(ordered) - 1) * q / 100
    low, high = math.floor(rank), math.ceil(rank)
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)
