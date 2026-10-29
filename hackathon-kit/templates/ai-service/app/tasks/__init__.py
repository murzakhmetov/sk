"""Task registry. Every module in this package is imported here, so its `@register` runs.

Add a task by dropping a new module next to `moderation.py` — no other file needs editing.
"""

import importlib
import pkgutil

from app.tasks.base import AnyTask, Task, UnknownTaskError, all_tasks, get_task, register

for _module in pkgutil.iter_modules(__path__):
    if _module.name != "base" and not _module.name.startswith("_"):
        importlib.import_module(f"{__name__}.{_module.name}")

__all__ = ["AnyTask", "Task", "UnknownTaskError", "all_tasks", "get_task", "register"]
