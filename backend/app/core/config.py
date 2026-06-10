"""Application configuration.

All runtime configuration comes from environment variables (12-factor), with
`.env` support for local development. Secrets (Junction API key, webhook
secret) must never be committed (see `.env.example` at the repo root).
"""

from enum import StrEnum
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class JunctionEnvironment(StrEnum):
    sandbox = "sandbox"
    production = "production"


class JunctionRegion(StrEnum):
    eu = "eu"
    us = "us"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Junction ---
    junction_api_key: str = ""
    junction_environment: JunctionEnvironment = JunctionEnvironment.sandbox
    junction_region: JunctionRegion = JunctionRegion.eu
    # Svix signing secret for inbound webhooks (per webhook endpoint, from the
    # Junction dashboard). Empty disables verification, allowed only in tests.
    junction_webhook_secret: str = ""

    # --- Storage ---
    database_url: str = "postgresql+asyncpg://youth:youth@localhost:5432/wearables"
    redis_url: str = "redis://localhost:6379/0"

    # --- Service ---
    log_level: str = "INFO"
    environment: str = "local"  # local | staging | production

    @property
    def junction_base_url(self) -> str:
        """Junction REST base URL for the configured region + environment.

        Junction (formerly Vital) hosts separate sandbox and production stacks
        per region; the EU sandbox is `api.sandbox.eu.junction.com`.
        """
        env_prefix = "sandbox." if self.junction_environment == JunctionEnvironment.sandbox else ""
        return f"https://api.{env_prefix}{self.junction_region}.junction.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
