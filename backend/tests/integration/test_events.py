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
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import DeviceEvent, User, WebhookEvent, WebhookEventStatus
from tests.conftest import ISSUER, SERVICE_TOKEN

pytestmark = pytest.mark.integration

JUNCTION_USER = "8e837b56-26ab-4347-9d4a-be9b2f5a78c4"
CLIENT_USER = "youth-user-1"
SUB = "user_2abcDEFghiJKLmno"


def _daily_payload(count: int, resource: str = "heartrate", slug: str = "oura") -> dict:
    base = datetime(2026, 6, 9, 10, 0, tzinfo=UTC)
    return {
        "event_type": f"daily.data.{resource}.created",
        "user_id": JUNCTION_USER,
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


async def _seed(engine, *, client_user_id: str = CLIENT_USER, junction_user_id: str | None = None):
    """Create a user plus a varied set of webhook events, oldest first.

    Returns (user_id, [event payloads in insertion order]).
    """
    t0 = datetime(2026, 6, 9, 12, 0, tzinfo=UTC)
    payloads = [
        _daily_payload(42),
        {
            "event_type": "historical.data.heartrate.created",
            "user_id": junction_user_id or JUNCTION_USER,
            "client_user_id": client_user_id,
            "data": {
                "user_id": junction_user_id or JUNCTION_USER,
                "start_date": "2026-05-10",
                "end_date": "2026-06-09",
                "provider": "oura",
            },
        },
        {
            "event_type": "provider.connection.created",
            "user_id": junction_user_id or JUNCTION_USER,
            "client_user_id": client_user_id,
            "data": {"provider": {"name": "Oura", "slug": "oura"}},
        },
        {
            "event_type": "provider.connection.error",
            "user_id": junction_user_id or JUNCTION_USER,
            "client_user_id": client_user_id,
            "data": {"provider": {"slug": "oura"}},
        },
        {
            "event_type": "some.future.event",
            "user_id": junction_user_id or JUNCTION_USER,
            "client_user_id": client_user_id,
            "data": {},
        },
    ]
    # Rewrite the daily payload's identity for non-default users.
    payloads[0]["user_id"] = junction_user_id or JUNCTION_USER
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
            junction_user_id=junction_user_id or JUNCTION_USER,
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
        engine, client_user_id="someone-else", junction_user_id=str(uuid.uuid4())
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
        user = User(client_user_id=CLIENT_USER, junction_user_id=None)
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


# --- Lifecycle ledger entries merged into the feed ---


async def _seed_ledger(engine, user_id, entries: list[tuple[str, str | None, datetime]]) -> None:
    """Insert (event, provider, occurred_at) ledger rows for a user."""
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        for event, provider, occurred_at in entries:
            session.add(
                DeviceEvent(
                    user_id=user_id,
                    event=event,
                    actor="webhook",
                    provider=provider,
                    occurred_at=occurred_at,
                )
            )
        await session.commit()


async def test_ledger_entries_merge_in_time_order(client, engine):
    """Lifecycle rows interleave with webhook events by timestamp, rendered
    in the same EventOut shape with lifecycle.* event types."""
    user_id, _ = await _seed(engine)  # webhook events at 12:00 .. 12:04
    await _seed_ledger(
        engine,
        user_id,
        [
            ("connected", "oura", datetime(2026, 6, 9, 12, 2, 30, tzinfo=UTC)),
            ("identity_remapped", None, datetime(2026, 6, 9, 12, 10, tzinfo=UTC)),
        ],
    )

    response = await client.get(f"/v1/users/{user_id}/events")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 7

    received = [item["received_at"] for item in body]
    assert received == sorted(received, reverse=True)

    types = [item["event_type"] for item in body]
    assert types[0] == "lifecycle.identity_remapped"  # newest overall
    assert types.index("lifecycle.connected") == 3  # slots between 12:03 and 12:02

    remap = body[0]
    assert remap["summary"] == "Identity migrated"
    assert remap["status"] == "processed"

    connected = body[3]
    assert connected["summary"] == "Oura connected"


async def test_limit_applies_to_merged_feed(client, engine):
    user_id, _ = await _seed(engine)
    await _seed_ledger(
        engine,
        user_id,
        [("identity_remapped", None, datetime(2026, 6, 9, 12, 10, tzinfo=UTC))],
    )

    response = await client.get(f"/v1/users/{user_id}/events", params={"limit": 2})
    body = response.json()
    assert len(body) == 2
    assert [item["event_type"] for item in body] == [
        "lifecycle.identity_remapped",
        "some.future.event",
    ]


async def test_ledger_entries_scoped_to_owner(client, engine):
    user_id, _ = await _seed(engine)
    other_id, _ = await _seed(
        engine, client_user_id="someone-else", junction_user_id=str(uuid.uuid4())
    )
    await _seed_ledger(
        engine,
        other_id,
        [("connected", "oura", datetime(2026, 6, 9, 12, 10, tzinfo=UTC))],
    )

    mine = (await client.get(f"/v1/users/{user_id}/events")).json()
    assert all(not item["event_type"].startswith("lifecycle.") for item in mine)


# --- Ownership scoping under Clerk auth ---


def make_jwt(private_key, sub: str = SUB) -> str:
    now = int(time.time())
    claims = {"sub": sub, "iss": ISSUER, "iat": now, "nbf": now - 30, "exp": now + 3600}
    return pyjwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "test-kid"})


async def test_clerk_token_scoped_to_own_events(with_clerk, client, engine, rsa_key):
    own_id, _ = await _seed(engine, client_user_id=f"clerk:{SUB}")
    other_id, _ = await _seed(
        engine, client_user_id="someone-else", junction_user_id=str(uuid.uuid4())
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
