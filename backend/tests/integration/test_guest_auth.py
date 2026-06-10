"""Guest session tokens: minted once at POST /v1/guests, scoped to one user.

The public guest endpoint returns an opaque token alongside the new user;
only its SHA-256 lands in the database. These tests cover the full keyless
flow: the token authenticates the guest's own resources across header and
query transports, never anyone else's, garbage is a 401, the service key
keeps full access, and creation still writes the lifecycle ledger.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.v1 import users as users_module
from app.core.config import get_settings
from app.models import DeviceEvent

pytestmark = pytest.mark.integration

SERVICE_TOKEN = "test-service-token-1234"


@pytest.fixture
def with_auth(monkeypatch):
    monkeypatch.setenv("API_AUTH_TOKEN", SERVICE_TOKEN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class StubAggregator:
    async def create_user(self, client_user_id: str) -> dict:
        return {"user_id": f"jnc-{client_user_id}"}


@pytest.fixture
def stub_aggregator(monkeypatch):
    monkeypatch.setattr(users_module, "aggregator_client_for", lambda env: StubAggregator())


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _mint_guest(client) -> dict:
    response = await client.post("/v1/guests")
    assert response.status_code == 201
    return response.json()


async def test_guest_token_issued_once_and_grants_own_access(
    with_auth, stub_aggregator, client, engine
):
    body = await _mint_guest(client)
    token = body["guest_token"]
    assert len(token) >= 43  # token_urlsafe(32)
    assert body["client_user_id"].startswith("guest:")
    user_id = body["id"]

    # The token authenticates reads of the guest's own resources.
    me = await client.get(f"/v1/users/{user_id}", headers=bearer(token))
    assert me.status_code == 200
    # ...and is never echoed back after creation.
    assert "guest_token" not in me.json()

    devices = await client.get(f"/v1/users/{user_id}/devices", headers=bearer(token))
    assert devices.status_code == 200
    assert devices.json() == []

    series = await client.get(f"/v1/users/{user_id}/timeseries/heartrate", headers=bearer(token))
    assert series.status_code == 200
    assert series.json()["points"] == []

    # Query-parameter transport (the SSE stream's form) works too.
    via_query = await client.get(f"/v1/users/{user_id}/devices?api_key={token}")
    assert via_query.status_code == 200


async def test_guest_token_cannot_read_another_user(with_auth, stub_aggregator, client):
    first = await _mint_guest(client)
    second = await _mint_guest(client)
    other = await client.post(
        "/v1/users",
        json={"client_user_id": "someone-else"},
        headers={"X-API-Key": SERVICE_TOKEN},
    )
    assert other.status_code == 201

    token = first["guest_token"]
    for foreign_id in (second["id"], other.json()["id"]):
        # Reads as absent, never as forbidden, so existence is not leaked.
        user = await client.get(f"/v1/users/{foreign_id}", headers=bearer(token))
        assert user.status_code == 404
        devices = await client.get(f"/v1/users/{foreign_id}/devices", headers=bearer(token))
        assert devices.status_code == 404


async def test_garbage_token_rejected(with_auth, stub_aggregator, client):
    guest = await _mint_guest(client)
    response = await client.get(
        f"/v1/users/{guest['id']}",
        headers=bearer("definitely-not-a-real-guest-token-aaaaaaaaa"),
    )
    assert response.status_code == 401


async def test_guest_token_rejected_on_me(with_auth, stub_aggregator, client):
    guest = await _mint_guest(client)
    response = await client.post("/v1/me", headers=bearer(guest["guest_token"]))
    assert response.status_code == 403


async def test_guest_token_cannot_erase_own_user(with_auth, stub_aggregator, client):
    """Erasure is service-side in this version: the guest's own token gets a
    403 pointing at support, and the user survives."""
    guest = await _mint_guest(client)

    response = await client.delete(f"/v1/users/{guest['id']}", headers=bearer(guest["guest_token"]))
    assert response.status_code == 403
    assert "support" in response.json()["detail"].lower()

    still_there = await client.get(f"/v1/users/{guest['id']}", headers={"X-API-Key": SERVICE_TOKEN})
    assert still_there.status_code == 200


async def test_service_key_unaffected(with_auth, stub_aggregator, client):
    guest = await _mint_guest(client)
    via_service = await client.get(f"/v1/users/{guest['id']}", headers={"X-API-Key": SERVICE_TOKEN})
    assert via_service.status_code == 200
    devices = await client.get(
        f"/v1/users/{guest['id']}/devices", headers={"X-API-Key": SERVICE_TOKEN}
    )
    assert devices.status_code == 200


async def test_guest_creation_still_writes_ledger(with_auth, stub_aggregator, client, engine):
    guest = await _mint_guest(client)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        entries = (
            (
                await session.execute(
                    select(DeviceEvent).where(DeviceEvent.user_id == uuid.UUID(guest["id"]))
                )
            )
            .scalars()
            .all()
        )
    assert [(e.event, e.actor) for e in entries] == [("guest_created", "user")]
