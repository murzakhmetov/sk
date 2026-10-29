"""Tiny content-addressed disk cache for LLM answers.

Why: identical requests during demos and eval re-runs return instantly, deterministically
and for free. One JSON file per entry, so the cache is easy to inspect and to delete.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

from pydantic import BaseModel

log = logging.getLogger(__name__)

CACHE_VERSION = 1  # bump to invalidate every entry after a breaking change in the format


def cache_key(
    *,
    provider: str,
    model: str,
    system: str,
    user: str,
    schema: type[BaseModel],
    effort: str | None,
) -> str:
    """Stable SHA-256 over everything that can change the answer."""
    material = {
        "v": CACHE_VERSION,
        "provider": provider,
        "model": model,
        "system": system,
        "user": user,
        "schema": schema.model_json_schema(),
        "effort": effort,
    }
    blob = json.dumps(material, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class DiskCache:
    def __init__(self, root: Path, *, enabled: bool = True) -> None:
        self.root = root
        self.enabled = enabled

    def _path(self, key: str) -> Path:
        return self.root / key[:2] / f"{key}.json"

    def get(self, key: str) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        path = self._path(key)
        try:
            data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("ignoring unreadable cache entry %s: %s", path, exc)
            return None
        return data

    def set(self, key: str, value: dict[str, Any]) -> None:
        if not self.enabled:
            return
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write: concurrent batch requests never observe a half-written file.
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(value, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
