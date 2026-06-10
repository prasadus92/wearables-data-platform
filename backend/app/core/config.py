"""Application configuration.

All runtime configuration comes from environment variables (12-factor), with
`.env` support for local development. Secrets (Aggregator API key, webhook
secret) must never be committed (see `.env.example` at the repo root).
"""

from enum import StrEnum
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class AggregatorEnvironment(StrEnum):
    sandbox = "sandbox"
    production = "production"


class AggregatorRegion(StrEnum):
    eu = "eu"
    us = "us"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Aggregator ---
    aggregator_api_key: str = ""
    aggregator_environment: AggregatorEnvironment = AggregatorEnvironment.sandbox
    aggregator_region: AggregatorRegion = AggregatorRegion.eu
    # Svix signing secret for inbound webhooks (per webhook endpoint, from the
    # Aggregator dashboard). Empty disables verification, allowed only in tests.
    aggregator_webhook_secret: str = ""

    # --- Storage ---
    database_url: str = "postgresql+asyncpg://wearables:wearables@localhost:5432/wearables"
    redis_url: str = "redis://localhost:6379/0"

    # --- Service ---
    log_level: str = "INFO"
    environment: str = "local"  # local | staging | production
    # Static bearer token for the /v1 API (app/Postman traffic). Empty
    # disables auth (local development only). Production replaces this
    # with per-user JWTs; see docs/architecture.md security notes.
    api_auth_token: str = ""

    @property
    def aggregator_base_url(self) -> str:
        """Aggregator REST base URL for the configured region + environment.

        Aggregator hosts separate sandbox and production stacks
        per region; the EU sandbox is `api.sandbox.eu.aggregator.com`.
        """
        env_prefix = "sandbox." if self.aggregator_environment == AggregatorEnvironment.sandbox else ""
        return f"https://api.{env_prefix}{self.aggregator_region}.aggregator.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
