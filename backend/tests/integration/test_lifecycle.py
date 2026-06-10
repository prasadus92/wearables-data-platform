"""Lifecycle ledger: every device/identity transition leaves a row.

Covers the write points end to end against Postgres: guest and user
creation, demo connect, disconnect, webhook-driven connection changes
(including reconnect detection), and admin identity remap. Aggregator is
stubbed; the ledger and HTTP layers are real.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.v1 import devices as devices_module
from app.api.v1 import users as users_module
from app.models import DeviceEvent, User
from app.services.ingestion import apply_plan, parse_event

pytestmark = pytest.mark.integration

AGGREGATOR_USER = "8e837b56-26ab-4347-9d4a-be9b2f5a78c4"


class StubAggregator:
    async def create_user(self, client_user_id: str) -> dict:
        return {"user_id": f"jnc-{client_user_id}"}

    async def connect_demo_provider(self, aggregator_user_id: str, provider: str) -> dict:
        return {"success": True}

    async def deregister_provider(self, aggregator_user_id: str, provider: str) -> dict:
        return {"success": True}


@pytest.fixture
def stub_aggregator(monkeypatch):
    stub = StubAggregator()
    monkeypatch.setattr(users_module, "aggregator_client_for", lambda env: stub)
    monkeypatch.setattr(devices_module, "aggregator_client_for", lambda env: stub)
    return stub


async def _ledger(engine, user_id=None) -> list[DeviceEvent]:
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        query = select(DeviceEvent).order_by(DeviceEvent.occurred_at, DeviceEvent.id)
        if user_id is not None:
            query = query.where(DeviceEvent.user_id == uuid.UUID(str(user_id)))
        return list((await session.execute(query)).scalars().all())


class TestGuests:
    async def test_guest_minted_server_side_and_registered(self, stub_aggregator, client, engine):
        response = await client.post("/v1/guests")
        assert response.status_code == 201
        body = response.json()
        assert body["client_user_id"].startswith("guest:")
        assert body["aggregator_user_id"] == f"jnc-{body['client_user_id']}"

        entries = await _ledger(engine, body["id"])
        # Birth entry plus the auto-attached demo wearable.
        assert [(e.event, e.actor) for e in entries] == [
            ("guest_created", "user"),
            ("connected", "service"),
        ]
        assert entries[0].aggregator_user_id == body["aggregator_user_id"]

    async def test_each_guest_gets_a_fresh_identity(self, stub_aggregator, client):
        first = (await client.post("/v1/guests")).json()
        second = (await client.post("/v1/guests")).json()
        assert first["client_user_id"] != second["client_user_id"]
        assert first["id"] != second["id"]

    async def test_guest_environment_is_selectable(self, stub_aggregator, client):
        response = await client.post("/v1/guests", json={"environment": "production"})
        assert response.status_code == 201
        assert response.json()["aggregator_environment"] == "production"


class TestCreationLedger:
    async def test_user_created_recorded_once(self, stub_aggregator, client, engine):
        created = await client.post("/v1/users", json={"client_user_id": "team-x"})
        assert created.status_code == 201
        user_id = created.json()["id"]

        # Idempotent re-post: no second ledger entry.
        again = await client.post("/v1/users", json={"client_user_id": "team-x"})
        assert again.json()["id"] == user_id

        entries = await _ledger(engine, user_id)
        assert [(e.event, e.actor) for e in entries] == [("user_created", "service")]


class TestDeviceLedger:
    async def test_demo_connect_then_disconnect(self, stub_aggregator, client, engine):
        user = (await client.post("/v1/users", json={"client_user_id": "demo-user"})).json()

        connected = await client.post(
            f"/v1/users/{user['id']}/devices/demo", json={"provider": "oura"}
        )
        assert connected.status_code == 200

        disconnected = await client.delete(f"/v1/users/{user['id']}/devices/oura")
        assert disconnected.status_code == 204

        entries = await _ledger(engine, user["id"])
        assert [(e.event, e.actor, e.provider) for e in entries] == [
            ("user_created", "service", None),
            ("connected", "user", "oura"),
            ("disconnected", "user", "oura"),
        ]

    async def test_webhook_connection_lifecycle(self, session):
        """provider.connection.* events write ledger rows as actor webhook,
        and a connect after an error reads as a reconnect."""
        user = User(client_user_id="hook-user", aggregator_user_id=AGGREGATOR_USER)
        session.add(user)
        await session.commit()

        created = {
            "event_type": "provider.connection.created",
            "user_id": AGGREGATOR_USER,
            "data": {"provider": {"name": "Oura", "slug": "oura"}},
        }
        errored = {
            "event_type": "provider.connection.error",
            "user_id": AGGREGATOR_USER,
            "data": {"provider": {"slug": "oura"}},
        }
        for payload in (created, errored, created):
            await apply_plan(session, user.id, parse_event(payload))
            await session.commit()

        entries = (
            (
                await session.execute(
                    select(DeviceEvent).order_by(DeviceEvent.occurred_at, DeviceEvent.id)
                )
            )
            .scalars()
            .all()
        )
        assert [(e.event, e.actor, e.provider) for e in entries] == [
            ("connected", "webhook", "oura"),
            ("expired", "webhook", "oura"),
            ("reconnected", "webhook", "oura"),
        ]
        assert all(e.aggregator_user_id == AGGREGATOR_USER for e in entries)

    async def test_demo_connect_does_not_double_log_via_apply_plan(
        self, stub_aggregator, client, engine
    ):
        """The local.demo.connected plan must not also trigger the webhook
        seam; exactly one connected entry per demo connect."""
        user = (await client.post("/v1/users", json={"client_user_id": "demo-once"})).json()
        await client.post(f"/v1/users/{user['id']}/devices/demo", json={"provider": "fitbit"})

        entries = await _ledger(engine, user["id"])
        connected = [e for e in entries if e.event == "connected"]
        assert len(connected) == 1
        assert connected[0].actor == "user"


class TestRemapLedger:
    async def test_remap_records_identity_remapped(self, client, engine):
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            source = User(client_user_id="guest:abc123", aggregator_user_id=AGGREGATOR_USER)
            target = User(client_user_id="clerk:user_real", aggregator_user_id=None)
            session.add_all([source, target])
            await session.commit()
            target_id = target.id

        response = await client.post(
            "/v1/users/admin/remap-aggregator-identity",
            json={"from_client_user_id": "guest:abc123", "to_client_user_id": "clerk:user_real"},
        )
        assert response.status_code == 200
        assert response.json()["aggregator_user_id"] == AGGREGATOR_USER

        entries = await _ledger(engine, target_id)
        assert [(e.event, e.actor) for e in entries] == [("identity_remapped", "service")]
        assert entries[0].detail == {"from": "guest:abc123", "to": "clerk:user_real"}
        assert entries[0].aggregator_user_id == AGGREGATOR_USER
