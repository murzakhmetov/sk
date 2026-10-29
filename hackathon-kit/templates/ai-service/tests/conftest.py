"""Every test runs offline: mock mode is forced and the cache lives in a temp dir."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from app.config import get_settings
from app.llm import reset_llm


@pytest.fixture(autouse=True)
def offline_settings(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[None]:
    monkeypatch.setenv("LLM_MOCK", "true")
    monkeypatch.setenv("CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("LLM_EFFORT", raising=False)
    get_settings.cache_clear()
    reset_llm()
    yield
    get_settings.cache_clear()
    reset_llm()
