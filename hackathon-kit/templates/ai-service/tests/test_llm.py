"""LLM client behaviour with fake/mocked transports — no network, no API key."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Coroutine
from pathlib import Path
from typing import Any, Literal

import anthropic
import httpx
import httpx2
import pytest
from pydantic import BaseModel

from app.config import Settings
from app.llm import LLMClient, LLMConfigError, LLMRefusalError, LLMTransientError, placeholder
from app.llm.client import parse_output
from app.llm.errors import LLMOutputError
from app.llm.pricing import estimate_cost
from app.llm.providers import AnthropicProvider, OpenAICompatProvider
from app.llm.types import Completion, CompletionRequest


class Verdict(BaseModel):
    label: Literal["ok", "bad"]
    score: int


class FakeProvider:
    """Returns (or raises) the scripted responses in order and counts calls."""

    name = "fake"

    def __init__(self, *responses: str | Exception) -> None:
        self.responses = list(responses)
        self.calls = 0

    async def complete(self, request: CompletionRequest) -> Completion:
        self.calls += 1
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return Completion(text=response, model=request.model, input_tokens=100, output_tokens=20)

    async def aclose(self) -> None:
        return None


async def _no_sleep(_: float) -> None:
    return None


def run[T](coro: Coroutine[Any, Any, T]) -> T:
    return asyncio.run(coro)


def make_client(tmp_path: Path, provider: Any, **overrides: Any) -> LLMClient:
    settings = Settings(_env_file=None, cache_dir=tmp_path / "cache", **overrides)
    return LLMClient(settings, provider=provider, sleep=_no_sleep)


GOOD = '{"label": "bad", "score": 2}'


# --- mock mode -------------------------------------------------------------------------------


def test_mock_mode_uses_the_fallback() -> None:
    client = LLMClient(Settings(_env_file=None, llm_mock=True))
    result = run(client.structured("sys", "user", Verdict, fallback=lambda: Verdict(label="bad", score=1)))
    assert result.output == Verdict(label="bad", score=1)
    assert result.meta.source == "mock"
    assert client.usage.by_source == {"mock": 1}


def test_mock_mode_without_fallback_returns_a_schema_valid_placeholder() -> None:
    client = LLMClient(Settings(_env_file=None, llm_mock=True))
    result = run(client.structured("sys", "user", Verdict))
    assert result.output == Verdict(label="ok", score=0)


def test_missing_key_means_mock_mode() -> None:
    settings = Settings(_env_file=None, llm_mock=False, anthropic_api_key=None)
    assert settings.mock_mode
    assert not Settings(_env_file=None, llm_mock=False, anthropic_api_key="sk-test").mock_mode


def test_placeholder_handles_nested_models() -> None:
    class Outer(BaseModel):
        verdict: Verdict
        tags: list[str]
        note: str | None

    assert placeholder(Outer) == Outer(verdict=Verdict(label="ok", score=0), tags=[], note=None)


# --- live path with a fake provider -----------------------------------------------------------


def test_answers_are_cached(tmp_path: Path) -> None:
    provider = FakeProvider(GOOD)
    client = make_client(tmp_path, provider)
    first = run(client.structured("sys", "user", Verdict))
    second = run(client.structured("sys", "user", Verdict))
    assert provider.calls == 1
    assert (first.meta.source, second.meta.source) == ("llm", "cache")
    assert first.output == second.output == Verdict(label="bad", score=2)
    assert first.meta.cost_usd is not None and first.meta.cost_usd > 0
    assert client.usage.input_tokens == 100  # the cache hit cost nothing


def test_cache_key_includes_the_prompt(tmp_path: Path) -> None:
    provider = FakeProvider(GOOD, GOOD)
    client = make_client(tmp_path, provider)
    run(client.structured("sys", "user A", Verdict))
    run(client.structured("sys", "user B", Verdict))
    assert provider.calls == 2


def test_transient_errors_are_retried(tmp_path: Path) -> None:
    provider = FakeProvider(LLMTransientError("429"), LLMTransientError("503"), GOOD)
    result = run(make_client(tmp_path, provider, llm_max_retries=2).structured("s", "u", Verdict))
    assert result.meta.attempts == 3
    assert result.meta.source == "llm"


def test_invalid_output_is_retried(tmp_path: Path) -> None:
    provider = FakeProvider("sorry, I cannot answer in JSON", '{"label": "ok"}', GOOD)
    result = run(make_client(tmp_path, provider, llm_max_retries=2).structured("s", "u", Verdict))
    assert result.meta.attempts == 3
    assert result.output.score == 2


def test_exhausted_retries_raise_when_not_degrading(tmp_path: Path) -> None:
    provider = FakeProvider(*(LLMTransientError("overloaded") for _ in range(3)))
    client = make_client(tmp_path, provider, llm_max_retries=2)
    with pytest.raises(LLMTransientError):
        run(client.structured("s", "u", Verdict, degrade_on_error=False))
    assert provider.calls == 3


def test_non_retryable_error_degrades_to_the_fallback(tmp_path: Path) -> None:
    provider = FakeProvider(LLMConfigError("bad key"))
    client = make_client(tmp_path, provider, llm_degrade_on_error=True)
    result = run(client.structured("s", "u", Verdict, fallback=lambda: Verdict(label="ok", score=9)))
    assert provider.calls == 1  # config errors are not retried
    assert result.meta.source == "fallback"
    assert result.meta.error is not None and "LLMConfigError" in result.meta.error
    assert result.output.score == 9


def test_parse_output_accepts_fenced_json() -> None:
    assert parse_output('```json\n{"label": "ok", "score": 1}\n```', Verdict) == Verdict(label="ok", score=1)
    assert parse_output('Here you go: {"label": "ok", "score": 1}', Verdict).score == 1
    with pytest.raises(LLMOutputError):
        parse_output('{"label": "maybe", "score": 1}', Verdict)


def test_cost_estimates() -> None:
    assert estimate_cost("claude-haiku-5-5", input_tokens=1_000_000, output_tokens=1_000_000) == pytest.approx(0.60)
    assert estimate_cost("anthropic/claude-sonnet-5.5", input_tokens=1_000_000, output_tokens=0) == pytest.approx(2.0)
    assert estimate_cost("some-local-model", input_tokens=10, output_tokens=10) is None


# --- OpenAI-compatible provider over a mocked httpx transport ---------------------------------


def _openai_transport(seen: list[httpx.Request], content: str, status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if status != 200:
            return httpx.Response(status, headers={"retry-after": "2"}, json={"error": "nope"})
        return httpx.Response(
            200,
            json={
                "model": "local-model",
                "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 5},
            },
        )

    return httpx.MockTransport(handler)


def test_openai_compat_provider_end_to_end(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []
    provider = OpenAICompatProvider(
        base_url="http://llm.test/v1",
        api_key="test-key",
        timeout_s=5,
        transport=_openai_transport(seen, '```json\n{"label": "ok", "score": 1}\n```'),
    )
    result = run(make_client(tmp_path, provider).structured("system", "user", Verdict, model="local-model"))
    assert result.output == Verdict(label="ok", score=1)
    assert (result.meta.input_tokens, result.meta.output_tokens) == (12, 5)
    request = seen[0]
    assert str(request.url) == "http://llm.test/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer test-key"
    body = json.loads(request.content)
    assert body["response_format"]["type"] == "json_schema"
    assert body["messages"][1] == {"role": "user", "content": "user"}


@pytest.mark.parametrize(
    ("status", "error"), [(401, LLMConfigError), (429, LLMTransientError), (503, LLMTransientError)]
)
def test_openai_compat_maps_http_errors(status: int, error: type[Exception]) -> None:
    provider = OpenAICompatProvider(
        base_url="http://llm.test/v1", api_key="k", timeout_s=5, transport=_openai_transport([], "", status)
    )
    request = CompletionRequest(system="s", user="u", schema=Verdict, model="m", max_tokens=10)
    with pytest.raises(error):
        run(provider.complete(request))


# --- Anthropic provider: real SDK, mocked HTTP --------------------------------------------------


def _anthropic_provider(seen: list[httpx2.Request], response: dict[str, Any], status: int = 200) -> AnthropicProvider:
    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(status, json=response, headers={"retry-after": "3"} if status == 429 else {})

    http_client = anthropic.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(handler))
    return AnthropicProvider(api_key="sk-test", timeout_s=5, http_client=http_client)


def _message(text: str, stop_reason: str = "end_turn") -> dict[str, Any]:
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5-5",
        "content": [{"type": "text", "text": text}] if text else [],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {
            "input_tokens": 50,
            "output_tokens": 10,
            "cache_read_input_tokens": 40,
            "cache_creation_input_tokens": 0,
        },
    }


def test_anthropic_request_shape_and_parsing(tmp_path: Path) -> None:
    seen: list[httpx2.Request] = []
    provider = _anthropic_provider(seen, _message('{"label": "bad", "score": 3}'))
    client = make_client(tmp_path, provider)
    result = run(client.structured("system prompt", "user msg", Verdict, model="claude-sonnet-5-5", effort="low"))

    assert result.output == Verdict(label="bad", score=3)
    assert (result.meta.input_tokens, result.meta.output_tokens, result.meta.cache_read_tokens) == (50, 10, 40)
    body = json.loads(seen[0].content)
    assert body["model"] == "claude-sonnet-5-5"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["output_config"]["effort"] == "low"
    assert body["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert body["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in seen[0].headers["anthropic-beta"]
    assert not {"temperature", "top_p", "top_k"} & body.keys()


def test_anthropic_fallbacks_only_for_supported_models() -> None:
    seen: list[httpx2.Request] = []
    provider = _anthropic_provider(seen, _message('{"label": "ok", "score": 0}'))
    request = CompletionRequest(system="s", user="u", schema=Verdict, model="claude-haiku-5-5", max_tokens=100)
    run(provider.complete(request))
    assert "fallbacks" not in json.loads(seen[0].content)


@pytest.mark.parametrize(
    ("response", "status", "error"),
    [
        (_message("", stop_reason="refusal"), 200, LLMRefusalError),
        (_message('{"label": "o', stop_reason="max_tokens"), 200, LLMOutputError),
        ({"type": "error", "error": {"type": "rate_limit_error", "message": "slow down"}}, 429, LLMTransientError),
        ({"type": "error", "error": {"type": "authentication_error", "message": "bad key"}}, 401, LLMConfigError),
    ],
)
def test_anthropic_error_mapping(response: dict[str, Any], status: int, error: type[Exception]) -> None:
    provider = _anthropic_provider([], response, status)
    request = CompletionRequest(system="s", user="u", schema=Verdict, model="claude-sonnet-5-5", max_tokens=100)
    with pytest.raises(error) as excinfo:
        run(provider.complete(request))
    if status == 429:
        assert getattr(excinfo.value, "retry_after", None) == 3.0
