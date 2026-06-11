"""Application configuration.

All runtime configuration comes from environment variables (12-factor), with
`.env` support for local development. Secrets (Aggregator API key, webhook
secret) must never be committed (see `.env.example` at the repo root).
"""

from enum import StrEnum
from functools import lru_cache

from pydantic import field_validator
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
    # Primary (default) environment, used for new users unless they request
    # another one. The challenge demo defaults to sandbox.
    aggregator_api_key: str = ""
    aggregator_environment: AggregatorEnvironment = AggregatorEnvironment.sandbox
    aggregator_region: AggregatorRegion = AggregatorRegion.eu
    # Svix signing secret for inbound webhooks (per webhook endpoint, from the
    # Aggregator dashboard). Empty disables verification, allowed only in tests.
    aggregator_webhook_secret: str = ""

    # Optional second environment (production) so real devices and sandbox
    # demo data can flow through one deployment at the same time. Each
    # Aggregator environment has its own API key and webhook signing secret.
    aggregator_prod_api_key: str = ""
    aggregator_prod_webhook_secret: str = ""

    @field_validator(
        "aggregator_api_key",
        "aggregator_webhook_secret",
        "aggregator_prod_api_key",
        "aggregator_prod_webhook_secret",
        "api_auth_token",
        "clerk_issuer",
        mode="before",
    )
    @classmethod
    def _normalize_unset(cls, value: str) -> str:
        # SSM SecureString parameters cannot be empty, so absent secrets are
        # stored as the literal placeholder "unset".
        return "" if value == "unset" else value

    def aggregator_api_key_for(self, environment: "AggregatorEnvironment") -> str:
        if environment == AggregatorEnvironment.production and (
            self.aggregator_environment != AggregatorEnvironment.production
        ):
            return self.aggregator_prod_api_key
        return self.aggregator_api_key

    def aggregator_base_url_for(self, environment: "AggregatorEnvironment") -> str:
        env_prefix = "sandbox." if environment == AggregatorEnvironment.sandbox else ""
        return f"https://api.{env_prefix}{self.aggregator_region}.aggregator.com"

    @property
    def webhook_secrets(self) -> list[str]:
        """All configured signing secrets. Inbound events may originate from
        any registered environment, so verification tries each one."""
        secrets = [self.aggregator_webhook_secret, self.aggregator_prod_webhook_secret]
        return [s for s in secrets if s]

    # --- Storage ---
    database_url: str = "postgresql+asyncpg://wearables:wearables@localhost:5432/wearables"
    redis_url: str = "redis://localhost:6379/0"

    # Sample upsert batch size. The Postgres wire protocol caps a statement
    # at 32767 bind parameters (4095 rows at 8 per row); this stays well
    # under it while keeping batches large enough to be efficient. An ops
    # lever, never a correctness one: idempotent upserts make any chunking
    # safe.
    sample_upsert_chunk_rows: int = 2000

    # --- Service ---
    log_level: str = "INFO"
    environment: str = "local"  # local | staging | production
    # Static bearer token for the /v1 API (app/Postman traffic). Empty
    # disables auth (local development only). Signed-in clients use Clerk
    # session JWTs and anonymous clients use guest session tokens instead;
    # any of the three credentials is accepted on /v1 routes.
    api_auth_token: str = ""
    # Clerk instance issuer, e.g. https://xxx.clerk.accounts.dev (no trailing
    # slash). JWKS is fetched from {issuer}/.well-known/jwks.json. Empty
    # disables Clerk JWT auth, leaving only the static API key.
    clerk_issuer: str = ""

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
