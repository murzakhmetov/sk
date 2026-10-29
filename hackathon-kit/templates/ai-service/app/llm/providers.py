"""LLM providers. Each one turns a `CompletionRequest` into JSON text + usage, or raises an `LLMError`.

Providers stay dumb on purpose: no retries, no caching, no validation — `LLMClient` does that
once for all of them, so adding a provider means writing one `complete()` method.
"""

from __future__ import annotations

import json
from typing import Any, Protocol

import anthropic
import httpx
from anthropic.types.beta import BetaOutputConfigParam

from app.llm.errors import LLMConfigError, LLMError, LLMOutputError, LLMRefusalError, LLMTransientError
from app.llm.types import Completion, CompletionRequest


class Provider(Protocol):
    name: str

    async def complete(self, request: CompletionRequest) -> Completion: ...

    async def aclose(self) -> None: ...


def _retry_after(headers: httpx.Headers | Any) -> float | None:
    """Parse a `retry-after` header given in seconds (HTTP-date form is ignored)."""
    try:
        return float(headers.get("retry-after"))
    except (TypeError, ValueError):
        return None


# --- Anthropic (official SDK) ---------------------------------------------------------------

# Models that accept server-side refusal fallback (`fallbacks: "default"`). Haiku 5.5 does not.
_SERVER_FALLBACK_MODELS = frozenset({"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"})
_SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AnthropicProvider:
    """Claude via the `anthropic` SDK with structured outputs (`output_config.format`)."""

    name = "anthropic"

    def __init__(
        self,
        *,
        api_key: str,
        timeout_s: float,
        refusal_fallback: bool = True,
        http_client: anthropic.DefaultAsyncHttpxClient | None = None,
    ) -> None:
        # max_retries=0: LLMClient retries every provider uniformly; SDK retries would multiply them.
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key, timeout=timeout_s, max_retries=0, http_client=http_client
        )
        self._refusal_fallback = refusal_fallback

    async def complete(self, request: CompletionRequest) -> Completion:
        output_config: BetaOutputConfigParam = {
            # Constrained decoding: the text block is guaranteed to be JSON for this schema.
            "format": {"type": "json_schema", "schema": anthropic.transform_schema(request.schema)},
        }
        if request.effort:
            output_config["effort"] = request.effort
        # On a safety-classifier refusal the API re-runs the request on a recommended model.
        use_fallback = self._refusal_fallback and request.model in _SERVER_FALLBACK_MODELS

        try:
            response = await self._client.beta.messages.create(
                model=request.model,
                max_tokens=request.max_tokens,
                # The system prompt is identical for every call of a task -> cache it.
                system=[{"type": "text", "text": request.system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": request.user}],
                output_config=output_config,
                betas=[_SERVER_FALLBACK_BETA] if use_fallback else anthropic.omit,
                fallbacks="default" if use_fallback else anthropic.omit,
            )
        except anthropic.AuthenticationError as exc:
            raise LLMConfigError("Anthropic rejected the API key (check ANTHROPIC_API_KEY)") from exc
        except anthropic.PermissionDeniedError as exc:
            raise LLMConfigError(f"Anthropic: permission denied: {exc.message}") from exc
        except anthropic.NotFoundError as exc:
            raise LLMConfigError(f"Anthropic: model not found (LLM_MODEL={request.model!r})") from exc
        except anthropic.RateLimitError as exc:
            raise LLMTransientError("Anthropic: rate limited", retry_after=_retry_after(exc.response.headers)) from exc
        except anthropic.APIStatusError as exc:
            if exc.status_code >= 500 or exc.status_code in (408, 409):
                raise LLMTransientError(
                    f"Anthropic: server error {exc.status_code}", retry_after=_retry_after(exc.response.headers)
                ) from exc
            raise LLMError(f"Anthropic: request rejected ({exc.status_code}): {exc.message}") from exc
        except anthropic.APIConnectionError as exc:  # includes APITimeoutError
            raise LLMTransientError(f"Anthropic: connection problem: {exc}") from exc

        # Check stop_reason before reading content.
        if response.stop_reason == "refusal":
            category = response.stop_details.category if response.stop_details else None
            raise LLMRefusalError(f"Anthropic: model refused (category={category})")
        if response.stop_reason == "max_tokens":
            raise LLMOutputError("Anthropic: answer truncated by max_tokens", retryable=False)

        usage = response.usage
        return Completion(
            text="".join(block.text for block in response.content if block.type == "text"),
            model=response.model,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cache_read_tokens=usage.cache_read_input_tokens or 0,
            cache_write_tokens=usage.cache_creation_input_tokens or 0,
        )

    async def aclose(self) -> None:
        await self._client.close()


# --- OpenAI-compatible (OpenRouter, vLLM, LM Studio, Ollama, ...) via plain httpx ----------


class OpenAICompatProvider:
    """Any server exposing `POST {base_url}/chat/completions` in the OpenAI format."""

    name = "openai_compat"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        timeout_s: float,
        json_schema: bool = True,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout_s,
            transport=transport,
        )
        self._json_schema = json_schema

    async def complete(self, request: CompletionRequest) -> Completion:
        schema = request.schema.model_json_schema()
        body: dict[str, Any] = {
            "model": request.model,
            "max_tokens": request.max_tokens,
            "messages": [
                # Schema in the prompt too: not every server enforces response_format.
                {"role": "system", "content": f"{request.system}\n\n{_json_instruction(schema)}"},
                {"role": "user", "content": request.user},
            ],
        }
        if self._json_schema:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": request.schema.__name__, "schema": schema},
            }

        try:
            response = await self._client.post("chat/completions", json=body)
        except httpx.TimeoutException as exc:
            raise LLMTransientError(f"openai_compat: timeout: {exc}") from exc
        except httpx.TransportError as exc:
            raise LLMTransientError(f"openai_compat: connection problem: {exc}") from exc

        status = response.status_code
        if status in (401, 403):
            raise LLMConfigError(f"openai_compat: auth failed ({status}), check OPENAI_COMPAT_API_KEY")
        if status == 404:
            raise LLMConfigError(f"openai_compat: 404, check OPENAI_COMPAT_BASE_URL and LLM_MODEL={request.model!r}")
        if status == 429 or status >= 500:
            raise LLMTransientError(f"openai_compat: HTTP {status}", retry_after=_retry_after(response.headers))
        if response.is_error:
            raise LLMError(f"openai_compat: HTTP {status}: {response.text[:300]}")

        try:
            data = response.json()
            choice = data["choices"][0]
            text = choice["message"].get("content") or ""
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LLMOutputError(f"openai_compat: unexpected response shape: {response.text[:300]}") from exc
        if choice.get("finish_reason") == "length":
            raise LLMOutputError("openai_compat: answer truncated by max_tokens", retryable=False)

        usage = data.get("usage") or {}
        return Completion(
            text=text,
            model=str(data.get("model") or request.model),
            input_tokens=int(usage.get("prompt_tokens") or 0),
            output_tokens=int(usage.get("completion_tokens") or 0),
        )

    async def aclose(self) -> None:
        await self._client.aclose()


def _json_instruction(schema: dict[str, Any]) -> str:
    return "Ответь ТОЛЬКО одним JSON-объектом без пояснений и markdown, строго по этой JSON Schema:\n" + json.dumps(
        schema, ensure_ascii=False
    )
