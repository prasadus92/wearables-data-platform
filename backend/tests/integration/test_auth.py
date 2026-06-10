"""API authentication: /v1 requires the token, webhooks and health do not."""

import pytest

from app.core.config import get_settings

pytestmark = pytest.mark.integration

TOKEN = "test-api-token-1234"


@pytest.fixture
def with_auth(monkeypatch):
    monkeypatch.setenv("API_AUTH_TOKEN", TOKEN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_v1_rejected_without_token(with_auth, client):
    response = await client.post("/v1/users", json={"client_user_id": "x"})
    assert response.status_code == 401


async def test_v1_rejected_with_wrong_token(with_auth, client):
    response = await client.get(
        "/v1/users/00000000-0000-0000-0000-000000000000",
        headers={"X-API-Key": "wrong"},
    )
    assert response.status_code == 401


async def test_v1_accepts_header_token(with_auth, client):
    response = await client.get(
        "/v1/users/00000000-0000-0000-0000-000000000000",
        headers={"X-API-Key": TOKEN},
    )
    assert response.status_code == 404  # authenticated; user simply absent


async def test_v1_accepts_bearer_and_query(with_auth, client):
    bearer = await client.get(
        "/v1/users/00000000-0000-0000-0000-000000000000",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    query = await client.get(f"/v1/users/00000000-0000-0000-0000-000000000000?api_key={TOKEN}")
    assert bearer.status_code == 404
    assert query.status_code == 404


async def test_health_and_webhooks_stay_open(with_auth, client):
    health = await client.get("/health")
    assert health.status_code == 200
    # Webhooks authenticate via Svix signature, not the API token.
    webhook = await client.post(
        "/webhooks/junction",
        json={"event_type": "noop.event", "data": {}},
        headers={"svix-id": "msg_auth_check"},
    )
    assert webhook.status_code == 202
