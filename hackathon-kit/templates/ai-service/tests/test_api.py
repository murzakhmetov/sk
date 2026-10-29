from __future__ import annotations

from collections.abc import Iterator

import pytest

# Example-task tests: skipped once the `moderation` example is deleted (see README, «Новая задача»).
pytest.importorskip("app.tasks.moderation", reason="example task removed")
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def test_health_reports_mock_mode(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["mock"] is True
    assert "moderation" in body["tasks"]


def test_playground_is_served(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "Playground" in response.text


def test_task_list_exposes_schemas_and_examples(client: TestClient) -> None:
    tasks = {t["name"]: t for t in client.get("/v1/tasks").json()}
    moderation = tasks["moderation"]
    assert moderation["input_schema"]["required"] == ["text"]
    assert set(moderation["output_schema"]["properties"]) == {"label", "severity", "action", "rationale"}
    assert moderation["examples"]


def test_moderation_single_call(client: TestClient) -> None:
    response = client.post("/v1/tasks/moderation", json={"text": "иди нах*й, урод"})
    assert response.status_code == 200
    body = response.json()
    assert body["task"] == "moderation"
    assert body["output"]["label"] == "insult"
    assert body["output"]["action"] in {"warn", "mute"}
    assert body["meta"]["source"] == "mock"
    assert body["meta"]["latency_ms"] >= 0


@pytest.mark.parametrize("payload", [{"text": ""}, {"text": "привет", "channel": "radio"}, {}])
def test_moderation_rejects_invalid_input(client: TestClient, payload: dict[str, object]) -> None:
    assert client.post("/v1/tasks/moderation", json=payload).status_code == 422


def test_batch_keeps_order_and_summarizes(client: TestClient) -> None:
    items = [{"text": "го на капт в 20:00"}, {"text": "скинь логин и пароль"}, {"text": "ты дебил?"}]
    response = client.post("/v1/tasks/moderation/batch", json={"items": items})
    assert response.status_code == 200
    body = response.json()
    assert [r["index"] for r in body["results"]] == [0, 1, 2]
    assert [r["output"]["label"] for r in body["results"]] == ["ok", "scam", "insult"]
    assert body["summary"]["total"] == 3
    assert body["summary"]["failed"] == 0
    assert body["summary"]["usage"]["by_source"] == {"mock": 3}


def test_batch_rejects_empty_list(client: TestClient) -> None:
    assert client.post("/v1/tasks/moderation/batch", json={"items": []}).status_code == 422


@pytest.mark.parametrize("path", ["/v1/tasks/nope", "/v1/tasks/nope/batch"])
def test_unknown_task_is_404_with_hint(client: TestClient, path: str) -> None:
    response = client.post(path, json={"text": "x"})
    assert response.status_code == 404
    assert "moderation" in response.json()["detail"]


def test_openapi_has_typed_task_routes(client: TestClient) -> None:
    spec = client.get("/openapi.json").json()
    assert {"/v1/tasks/moderation", "/v1/tasks/moderation/batch"} <= set(spec["paths"])
    assert "ModerationInput" in spec["components"]["schemas"]


def test_usage_counts_calls(client: TestClient) -> None:
    client.post("/v1/tasks/moderation", json={"text": "привет"})
    usage = client.get("/v1/usage").json()
    assert usage["calls"] >= 1
    assert usage["by_source"]["mock"] >= 1
    assert usage["cost_usd"] == 0
