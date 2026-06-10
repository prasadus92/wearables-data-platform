"""Activity feed endpoint: filtering, ordering, limit, scoping, summaries.

``webhook_events`` has no user_id column; ownership lives inside the JSONB
payload. These tests seed raw events for two users and assert that the feed
returns only the caller's events, newest first, with server-built summaries.
"""

import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core import clerk
from app.core.config import get_settings
from app.models import User, WebhookEvent, WebhookEventStatus

pytestmark = pytest.mark.integration

AGGREGATOR_USER = "8e837b56-26ab-4347-9d4a-be9b2f5a78c4"
CLIENT_USER = "wearables-user-1"
SERVICE_TOKEN = "test-service-token-1234"
ISSUER = "https://test-instance.clerk.accounts.dev"
SUB = "user_2abcDEFghiJKLmno"


def _daily_payload(count: int, resource: str = "heartrate", slug: str = "oura") -> dict:
    base = datetime(2026, 6, 9, 10, 0, tzinfo=UTC)
    return {
        "event_type": f"daily.data.{resource}.created",
        "user_id": AGGREGATOR_USER,
        "client_user_id": CLIENT_USER,
        "data": {
            "data": [
                {"timestamp": (base + timedelta(minutes=i)).isoformat(), "value": 60 + i}
                for i in range(count)
            ],
            "source": {"name": "Oura", "slug": slug},
        },
    }


def _event(
    payload: dict,
    received_at: datetime,
    status: WebhookEventStatus = WebhookEventStatus.processed,
) -> WebhookEvent:
    return WebhookEvent(
        event_id=f"msg_{uuid.uuid4().hex[:12]}",
        event_type=payload.get("event_type", ""),
        payload=payload,
        status=status,
        received_at=received_at,
        processed_at=received_at if status == WebhookEventStatus.processed else None,
    )


async def _seed(engine, *, client_user_id: str = CLIENT_USER, aggregator_user_id: str | None = None):
    """Create a user plus a varied set of webhook events, oldest first.

    Returns (user_id, [event payloads in insertion order]).
    """
    t0 = datetime(2026, 6, 9, 12, 0, tzinfo=UTC)
    payloads = [
        _daily_payload(42),
        {
            "event_type": "historical.data.heartrate.created",
            "user_id": aggregator_user_id or AGGREGATOR_USER,
            "client_user_id": client_user_id,
            "data": {
                "user_id": aggregator_user_id or AGGREGATOR_USER,
                "start_date": "2026-05-10",
                "end_date": "2026-06-09",
                "provider": "oura",
            },
        },
        {
            "event_type": "provider.connection.created",
            "user_id": aggregator_user_id or AGGREGATOR_USER,
            "client_user_id": client_user_id,
            "data": {"provider": {"name": "Oura", "slug": "oura"}},
        },
        {
            "event_type": "provider.connection.error",
            "user_id": aggregator_user_id or AGGREGATOR_USER,
            "client_user_id": client_user_id,
            "data": {"provider": {"slug": "oura"}},
        },
        {
            "event_type": "some.future.event",
            "user_id": aggregator_user_id or AGGREGATOR_USER,
            "client_user_id": client_user_id,
            "data": {},
        },
    ]
    # Rewrite the daily payload's identity for non-default users.
    payloads[0]["user_id"] = aggregator_user_id or AGGREGATOR_USER
    payloads[0]["client_user_id"] = client_user_id

    statuses = [
        WebhookEventStatus.processed,
        WebhookEventStatus.received,
        WebhookEventStatus.processed,
        WebhookEventStatus.failed,
        WebhookEventStatus.skipped,
    ]
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        user = User(
            client_user_id=client_user_id,
            aggregator_user_id=aggregator_user_id or AGGREGATOR_USER,
        )
        session.add(user)
        for i, (payload, event_status) in enumerate(zip(payloads, statuses, strict=True)):
            session.add(_event(payload, t0 + timedelta(minutes=i), event_status))
        await session.commit()
        return user.id, payloads


async def test_events_newest_first_with_summaries(client, engine):
    user_id, _ = await _seed(engine)
    response = await client.get(f"/v1/users/{user_id}/events")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 5

    received = [item["received_at"] for item in body]
    assert received == sorted(received, reverse=True)

    summaries = [item["summary"] for item in body]
    assert summaries == [
        "Update received",
        "Connection issue reported",
        "Oura connected",
        "Backfill notification for heart rate (May 10 to Jun 9)",
        "42 heart rate readings received from Oura",
    ]

    daily = body[-1]
    assert daily["event_type"] == "daily.data.heartrate.created"
    assert daily["status"] == "processed"
    assert daily["processed_at"] is not None

    statuses = [item["status"] for item in body]
    assert statuses == ["skipped", "failed", "processed", "received", "processed"]


async def test_limit_caps_and_keeps_newest(client, engine):
    user_id, _ = await _seed(engine)
    response = await client.get(f"/v1/users/{user_id}/events", params={"limit": 2})
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert [item["event_type"] for item in body] == [
        "some.future.event",
        "provider.connection.error",
    ]


async def test_only_own_events_returned(client, engine):
    user_id, _ = await _seed(engine)
    other_id, _ = await _seed(
        engine, client_user_id="someone-else", aggregator_user_id=str(uuid.uuid4())
    )

    mine = (await client.get(f"/v1/users/{user_id}/events")).json()
    theirs = (await client.get(f"/v1/users/{other_id}/events")).json()
    assert len(mine) == 5
    assert len(theirs) == 5
    assert {item["id"] for item in mine}.isdisjoint({item["id"] for item in theirs})


async def test_matches_on_client_user_id_alone(client, engine):
    """Events lacking a top-level user_id still match via client_user_id."""
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        user = User(client_user_id=CLIENT_USER, aggregator_user_id=None)
        session.add(user)
        payload = _daily_payload(1)
        del payload["user_id"]
        session.add(_event(payload, datetime(2026, 6, 9, 12, 0, tzinfo=UTC)))
        await session.commit()
        user_id = user.id

    response = await client.get(f"/v1/users/{user_id}/events")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["summary"] == "1 heart rate reading received from Oura"


# --- Ownership scoping under Clerk auth ---


@pytest.fixture(scope="module")
def rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_jwt(private_key, sub: str = SUB) -> str:
    now = int(time.time())
    claims = {"sub": sub, "iss": ISSUER, "iat": now, "nbf": now - 30, "exp": now + 3600}
    return pyjwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "test-kid"})


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


async def test_clerk_token_scoped_to_own_events(with_clerk, client, engine, rsa_key):
    own_id, _ = await _seed(engine, client_user_id=f"clerk:{SUB}")
    other_id, _ = await _seed(
        engine, client_user_id="someone-else", aggregator_user_id=str(uuid.uuid4())
    )

    headers = {"Authorization": f"Bearer {make_jwt(rsa_key)}"}
    mine = await client.get(f"/v1/users/{own_id}/events", headers=headers)
    assert mine.status_code == 200
    assert len(mine.json()) == 5

    # Someone else's feed reads as absent, never as forbidden.
    theirs = await client.get(f"/v1/users/{other_id}/events", headers=headers)
    assert theirs.status_code == 404

    # The service credential keeps full access.
    service = await client.get(f"/v1/users/{other_id}/events", headers={"X-API-Key": SERVICE_TOKEN})
    assert service.status_code == 200
    assert len(service.json()) == 5
