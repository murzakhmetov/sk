"""Application settings, read from environment variables and an optional `.env` file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

Provider = Literal["anthropic", "openai_compat"]
Effort = Literal["low", "medium", "high", "xhigh", "max"]


class Settings(BaseSettings):
    """All runtime configuration. Every field maps to an UPPER_CASE env var."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,  # `ANTHROPIC_API_KEY=` in .env means "not set"
        extra="ignore",
    )

    # --- Provider selection -------------------------------------------------
    llm_provider: Provider = "anthropic"
    llm_model: str = "claude-sonnet-5-5"
    llm_fast_model: str = "claude-haiku-5-5"
    llm_effort: Effort | None = Field(default=None, description="Global effort override; empty = per-task default.")

    # --- Credentials ----------------------------------------------------------
    anthropic_api_key: SecretStr | None = None
    openai_compat_base_url: str = "https://openrouter.ai/api/v1"
    openai_compat_api_key: SecretStr | None = None
    openai_compat_json_schema: bool = Field(
        default=True, description="Send response_format=json_schema (disable for servers that reject it)."
    )

    # --- Behaviour ------------------------------------------------------------
    llm_mock: bool = Field(default=False, description="Force mock mode even if a key is set.")
    llm_timeout_s: float = Field(default=60.0, gt=0)
    llm_max_retries: int = Field(default=2, ge=0, le=10)
    llm_degrade_on_error: bool = Field(
        default=True, description="On LLM failure return the task heuristic (marked source=fallback)."
    )
    llm_refusal_fallback: bool = Field(
        default=True, description="Anthropic server-side fallback model on refusals (supported models only)."
    )

    cache_dir: Path = Path(".cache/llm")
    cache_enabled: bool = True
    batch_concurrency: int = Field(default=8, ge=1, le=64)
    cors_origins: list[str] = Field(default=["*"], description='JSON list, e.g. ["https://my-front.app"].')
    log_level: str = "INFO"

    @property
    def api_key(self) -> str | None:
        """API key of the active provider, or None when it is not configured."""
        secret = self.anthropic_api_key if self.llm_provider == "anthropic" else self.openai_compat_api_key
        value = secret.get_secret_value().strip() if secret else ""
        return value or None

    @property
    def mock_mode(self) -> bool:
        """Mock mode is forced by LLM_MOCK or automatic when the active provider has no key."""
        return self.llm_mock or self.api_key is None


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings singleton (tests call `get_settings.cache_clear()`)."""
    return Settings()
