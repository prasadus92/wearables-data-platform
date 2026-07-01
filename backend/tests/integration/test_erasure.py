"""Right to erasure: DELETE /v1/users/{user_id}, service credential only.

Covers the full service-side flow against Postgres: providers are
deregistered at Aggregator (non-disconnected only), the Aggregator user is
deleted, and the local row cascades connections, samples, and device
events. webhook_events rows are payload-matched rather than FK'd and
deliberately survive as the ingestion audit log. Aggregator 404s are
tolerated at both upstream steps. The Clerk and guest 403 paths live in
test_clerk_auth.py and test_guest_auth.py alongside their auth fixtures.
"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.v1 import users as users_module
from app.models import (
    Connection,
    ConnectionStatus,
    DeviceEvent,
    Sample,
    User,
    WebhookEvent,
)
from app.services.aggregator import AggregatorError
from tests.conftest import SERVICE_TOKEN

pytestmark = pytest.mark.integration

SERVICE = {"X-API-Key": SERVICE_TOKEN}


class StubAggregator:
    """Records erasure-relevant calls; optionally raises 404s upstream."""

    def __init__(self, gone_upstream: bool = False):
        self.gone_upstream = gone_upstream
        self.deregistered: list[tuple[str, str]] = []
        self.deleted: list[str] = []

    async def create_user(self, client_user_id: str) -> dict:
        return {"user_id": f"jnc-{client_user_id}"}

    async def connect_demo_provider(self, aggregator_user_id: str, provider: str) -> dict:
        return {"success": True, "provider": provider}

    async def deregister_provider(self, aggregator_user_id: str, provider: str) -> dict:
        self.deregistered.append((aggregator_user_id, provider))
        if self.gone_upstream:
            raise AggregatorError(404, "user not found")
        return {"success": True}

    async def delete_user(self, aggregator_user_id: str) -> dict:
        self.deleted.append(aggregator_user_id)
        if self.gone_upstream:
            raise AggregatorError(404, "user not found")
        return {"success": True}


@pytest.fixture
def stub_aggregator(monkeypatch):
    stub = StubAggregator()
    monkeypatch.setattr(users_module, "aggregator_client_for", lambda env: stub)
    return stub


async def _seed_user_with_data(client, engine) -> dict:
    """A user with two connections (one disconnected), samples, and a
    payload-matched webhook event."""
    created = await client.post("/v1/users", json={"client_user_id": "erase-me"}, headers=SERVICE)
    assert created.status_code == 201
    body = created.json()
    user_id = uuid.UUID(body["id"])

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        session.add_all(
            [
                Connection(user_id=user_id, provider="oura"),
                Connection(
                    user_id=user_id,
                    provider="fitbit",
                    status=ConnectionStatus.disconnected,
                    disconnected_at=datetime.now(UTC),
                ),
                Sample(
                    user_id=user_id,
                    metric="heartrate",
                    ts=datetime(2026, 6, 1, 12, tzinfo=UTC),
                    provider="oura",
                    value=61.0,
                    unit="bpm",
                ),
                Sample(
                    user_id=user_id,
                    metric="hrv",
                    ts=datetime(2026, 6, 1, 12, tzinfo=UTC),
                    provider="oura",
                    value=48.0,
                    unit="ms",
                ),
                WebhookEvent(
                    event_id="msg_erasure_test",
                    event_type="daily.data.heartrate.created",
                    payload={"user_id": body["aggregator_user_id"]},
                ),
            ]
        )
        await session.commit()
    return body


async def _count(engine, model, user_id) -> int:
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        return (
            await session.execute(
                select(func.count()).select_from(model).where(model.user_id == uuid.UUID(user_id))
            )
        ).scalar_one()


async def test_service_key_erases_user_and_cascades(with_auth, stub_aggregator, client, engine):
    body = await _seed_user_with_data(client, engine)
    user_id = body["id"]

    response = await client.delete(f"/v1/users/{user_id}", headers=SERVICE)
    assert response.status_code == 204

    # Aggregator cleanup: only the non-disconnected provider, then the user.
    assert stub_aggregator.deregistered == [(body["aggregator_user_id"], "oura")]
    assert stub_aggregator.deleted == [body["aggregator_user_id"]]

    # Local erasure: the user reads as absent even to the service key,
    # and every FK-cascaded table is empty for them.
    assert (await client.get(f"/v1/users/{user_id}", headers=SERVICE)).status_code == 404
    assert await _count(engine, Connection, user_id) == 0
    assert await _count(engine, Sample, user_id) == 0
    assert await _count(engine, DeviceEvent, user_id) == 0

    # The raw ingestion audit log is deliberately retained (payload-matched,
    # not FK'd; swept by retention policy, not by erasure).
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        kept = (
            await session.execute(
                select(WebhookEvent).where(WebhookEvent.event_id == "msg_erasure_test")
            )
        ).scalar_one_or_none()
    assert kept is not None


async def test_erasure_tolerates_aggregator_404s(with_auth, monkeypatch, client, engine):
    stub = StubAggregator(gone_upstream=True)
    monkeypatch.setattr(users_module, "aggregator_client_for", lambda env: stub)

    body = await _seed_user_with_data(client, engine)
    response = await client.delete(f"/v1/users/{body['id']}", headers=SERVICE)
    assert response.status_code == 204
    assert stub.deleted == [body["aggregator_user_id"]]
    assert (await client.get(f"/v1/users/{body['id']}", headers=SERVICE)).status_code == 404


async def test_erasing_unknown_user_is_404(with_auth, stub_aggregator, client):
    response = await client.delete(f"/v1/users/{uuid.uuid4()}", headers=SERVICE)
    assert response.status_code == 404
    assert stub_aggregator.deregistered == []
    assert stub_aggregator.deleted == []


async def test_user_without_aggregator_mapping_still_erased(
    with_auth, stub_aggregator, client, engine
):
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        user = User(client_user_id="never-registered", aggregator_user_id=None)
        session.add(user)
        await session.commit()
        user_id = str(user.id)

    response = await client.delete(f"/v1/users/{user_id}", headers=SERVICE)
    assert response.status_code == 204
    assert stub_aggregator.deleted == []
    assert (await client.get(f"/v1/users/{user_id}", headers=SERVICE)).status_code == 404
