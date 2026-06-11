"""Shared fixtures.

Integration tests run against a real Postgres (``wearables_test`` database on
the docker-compose ``db`` service). Per the challenge constraint, no sqlite.
Each test function gets freshly created tables for isolation.
"""

import os

# Configure BEFORE any app import (settings are cached at import time).
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://wearables:wearables@localhost:5432/wearables_test"
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/1")
os.environ.setdefault("AGGREGATOR_API_KEY", "sk_eu_test_key")
os.environ.setdefault("AGGREGATOR_WEBHOOK_SECRET", "")  # signature tests set their own

import asyncpg
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import clerk
from app.core.config import get_settings
from app.models import Base

get_settings.cache_clear()
TEST_DB_URL = os.environ["DATABASE_URL"]

# Shared auth test credentials. The values are arbitrary; test modules import
# them to build request headers matching the with_auth / with_clerk fixtures.
SERVICE_TOKEN = "test-service-token-1234"
ISSUER = "https://test-instance.clerk.accounts.dev"


def bearer(token: str) -> dict[str, str]:
    """Authorization header for a Bearer credential."""
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def with_auth(monkeypatch):
    """Enable static service-key auth on /v1 (present SERVICE_TOKEN)."""
    monkeypatch.setenv("API_AUTH_TOKEN", SERVICE_TOKEN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(scope="module")
def rsa_key():
    """Local stand-in for Clerk's signing key (one keypair per test module)."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def with_clerk(monkeypatch, rsa_key):
    """Enable static + Clerk auth and route JWKS lookups to the test key."""
    monkeypatch.setenv("API_AUTH_TOKEN", SERVICE_TOKEN)
    monkeypatch.setenv("CLERK_ISSUER", ISSUER)
    get_settings.cache_clear()
    public_key = rsa_key.public_key()
    monkeypatch.setattr(clerk, "_signing_key", lambda token, issuer: public_key)
    yield
    get_settings.cache_clear()


@pytest.fixture(scope="session", autouse=True)
def _create_test_database():
    """Create the wearables_test database if missing (idempotent)."""
    import asyncio

    async def ensure() -> None:
        conn = await asyncpg.connect("postgresql://wearables:wearables@localhost:5432/postgres")
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = 'wearables_test'")
        if not exists:
            await conn.execute("CREATE DATABASE wearables_test")
        await conn.close()

    asyncio.run(ensure())


@pytest.fixture
async def engine():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture
async def session(engine):
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest.fixture
async def client(engine, monkeypatch):
    """HTTP client against the app, with the DB wired to the test engine and
    the queue replaced by an in-memory recorder."""
    from app.api import webhooks
    from app.db.session import get_db
    from app.main import app

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _get_test_db():
        async with factory() as s:
            yield s

    enqueued: list[str] = []

    async def _fake_enqueue(event_id: str) -> None:
        enqueued.append(event_id)

    monkeypatch.setattr(webhooks, "enqueue_process_event", _fake_enqueue)
    app.dependency_overrides[get_db] = _get_test_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        http.enqueued = enqueued  # type: ignore[attr-defined]
        yield http

    app.dependency_overrides.clear()
