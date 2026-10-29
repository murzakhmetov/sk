"""Provider-agnostic LLM errors. Providers translate their SDK/HTTP errors into these."""

from __future__ import annotations


class LLMError(Exception):
    """An LLM call failed. `retryable` tells the client whether another attempt may succeed."""

    retryable: bool = False

    def __init__(self, message: str, *, retryable: bool | None = None, retry_after: float | None = None):
        super().__init__(message)
        if retryable is not None:
            self.retryable = retryable
        self.retry_after = retry_after


class LLMTransientError(LLMError):
    """Rate limit, overload, 5xx, timeout or network problem — worth retrying."""

    retryable = True


class LLMOutputError(LLMError):
    """The model answered, but the answer is not valid for the requested schema."""

    retryable = True


class LLMRefusalError(LLMError):
    """The model declined the request (stop_reason == "refusal")."""


class LLMConfigError(LLMError):
    """Misconfiguration: bad API key, unknown model, wrong base URL, etc."""
