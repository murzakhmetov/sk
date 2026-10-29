"""Task-agnostic checks: they keep working whatever tasks the project registers."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.tasks import all_tasks


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def test_health_and_playground(client: TestClient) -> None:
    health = client.get("/health").json()
    assert health["status"] == "ok"
    assert set(health["tasks"]) == {t.name for t in all_tasks()}
    assert client.get("/").status_code == 200


@pytest.mark.parametrize("task", all_tasks(), ids=lambda t: t.name)
def test_every_task_answers_its_examples_in_mock_mode(task, client: TestClient) -> None:  # type: ignore[no-untyped-def]
    assert task.examples, f"task {task.name!r} needs `examples` (playground, docs, smoke test)"
    for example in task.examples:
        result = asyncio.run(task.run(example, use_cache=False))
        task.output_model.model_validate(result.output.model_dump())
        response = client.post(f"/v1/tasks/{task.name}", json=example.model_dump(mode="json"))
        assert response.status_code == 200, response.text
