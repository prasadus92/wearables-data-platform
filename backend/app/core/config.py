"""Application configuration.

All runtime configuration comes from environment variables (12-factor), with
`.env` support for local development. Secrets (Junction API key, webhook
secret) must never be committed (see `.env.example` at the repo root).
"""

from enum import StrEnum
from functools import lru_cache

from pydantic import field_validator
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
    # Primary (default) environment, used for new users unless they request
    # another one. The challenge demo defaults to sandbox.
    junction_api_key: str = ""
    junction_environment: JunctionEnvironment = JunctionEnvironment.sandbox
    junction_region: JunctionRegion = JunctionRegion.eu
    # Svix signing secret for inbound webhooks (per webhook endpoint, from the
    # Junction dashboard). Empty disables verification, allowed only in tests.
    junction_webhook_secret: str = ""

    # Optional second environment (production) so real devices and sandbox
    # demo data can flow through one deployment at the same time. Each
    # Junction environment has its own API key and webhook signing secret.
    junction_prod_api_key: str = ""
    junction_prod_webhook_secret: str = ""

    @field_validator(
        "junction_api_key",
        "junction_webhook_secret",
        "junction_prod_api_key",
        "junction_prod_webhook_secret",
        "api_auth_token",
        "clerk_issuer",
        mode="before",
    )
    @classmethod
    def _normalize_unset(cls, value: str) -> str:
        # SSM SecureString parameters cannot be empty, so absent secrets are
        # stored as the literal placeholder "unset".
        return "" if value == "unset" else value

    def junction_api_key_for(self, environment: "JunctionEnvironment") -> str:
        if environment == JunctionEnvironment.production and (
            self.junction_environment != JunctionEnvironment.production
        ):
            return self.junction_prod_api_key
        return self.junction_api_key

    def junction_base_url_for(self, environment: "JunctionEnvironment") -> str:
        env_prefix = "sandbox." if environment == JunctionEnvironment.sandbox else ""
        return f"https://api.{env_prefix}{self.junction_region}.junction.com"

    @property
    def webhook_secrets(self) -> list[str]:
        """All configured signing secrets. Inbound events may originate from
        any registered environment, so verification tries each one."""
        secrets = [self.junction_webhook_secret, self.junction_prod_webhook_secret]
        return [s for s in secrets if s]

    # --- Storage ---
    database_url: str = "postgresql+asyncpg://youth:youth@localhost:5432/wearables"
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
