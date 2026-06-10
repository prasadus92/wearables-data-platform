"""Clerk JWT auth: dual auth on /v1, /v1/me bootstrap, ownership scoping.

A locally generated RSA keypair stands in for Clerk's JWKS: the signing-key
lookup in app/core/clerk.py is patched to return the test public key, so
verification exercises the real PyJWT path (signature, exp/nbf, issuer)
without any network access.
"""

import time

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.api.v1 import users as users_module
from app.core import clerk
from app.core.config import get_settings

pytestmark = pytest.mark.integration

SERVICE_TOKEN = "test-service-token-1234"
ISSUER = "https://test-instance.clerk.accounts.dev"
SUB = "user_2abcDEFghiJKLmno"


@pytest.fixture(scope="module")
def rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_jwt(
    private_key,
    sub: str = SUB,
    issuer: str = ISSUER,
    expires_in: int = 3600,
    not_before: int = -30,
) -> str:
    now = int(time.time())
    claims = {
        "sub": sub,
        "iss": issuer,
        "iat": now,
        "nbf": now + not_before,
        "exp": now + expires_in,
    }
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


class StubJunction:
    # junction_user_id is unique per user, so derive it from the input.
    async def create_user(self, client_user_id: str) -> dict:
        return {"user_id": f"jnc-test-{client_user_id}"}

    async def connect_demo_provider(self, junction_user_id: str, provider: str) -> dict:
        return {"success": True, "provider": provider}


@pytest.fixture
def stub_junction(monkeypatch):
    monkeypatch.setattr(users_module, "junction_client_for", lambda env: StubJunction())


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_valid_jwt_bootstraps_me(with_clerk, stub_junction, client, rsa_key):
    response = await client.post("/v1/me", headers=bearer(make_jwt(rsa_key)))
    assert response.status_code == 200
    body = response.json()
    assert body["client_user_id"] == f"clerk:{SUB}"
    assert body["junction_user_id"] == f"jnc-test-clerk:{SUB}"
    assert body["junction_environment"] == "sandbox"

    # Idempotent: same identity, same user.
    again = await client.post("/v1/me", headers=bearer(make_jwt(rsa_key)))
    assert again.status_code == 200
    assert again.json()["id"] == body["id"]


async def test_me_production_gets_suffixed_identity(with_clerk, stub_junction, client, rsa_key):
    response = await client.post(
        "/v1/me",
        json={"environment": "production"},
        headers=bearer(make_jwt(rsa_key)),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["client_user_id"] == f"clerk:{SUB}:production"
    assert body["junction_environment"] == "production"


async def test_expired_jwt_rejected(with_clerk, client, rsa_key):
    token = make_jwt(rsa_key, expires_in=-3600)
    response = await client.post("/v1/me", headers=bearer(token))
    assert response.status_code == 401


async def test_wrong_issuer_rejected(with_clerk, client, rsa_key):
    token = make_jwt(rsa_key, issuer="https://evil.example.com")
    response = await client.post("/v1/me", headers=bearer(token))
    assert response.status_code == 401


async def test_garbage_token_rejected(with_clerk, client):
    response = await client.post("/v1/me", headers=bearer("not.a.jwt"))
    assert response.status_code == 401


async def test_user_token_scoped_to_own_user(with_clerk, stub_junction, client, rsa_key):
    # Another person's user, created via the service key.
    other = await client.post(
        "/v1/users",
        json={"client_user_id": "someone-else"},
        headers={"X-API-Key": SERVICE_TOKEN},
    )
    assert other.status_code == 201
    other_id = other.json()["id"]

    # Own user, bootstrapped via /me.
    own = await client.post("/v1/me", headers=bearer(make_jwt(rsa_key)))
    own_id = own.json()["id"]

    token = make_jwt(rsa_key)
    mine = await client.get(f"/v1/users/{own_id}", headers=bearer(token))
    assert mine.status_code == 200
    assert mine.json()["client_user_id"] == f"clerk:{SUB}"

    # Someone else's user reads as absent, never as forbidden.
    theirs = await client.get(f"/v1/users/{other_id}", headers=bearer(token))
    assert theirs.status_code == 404

    # A different Clerk subject cannot see this user either.
    stranger = make_jwt(rsa_key, sub="user_stranger")
    assert (await client.get(f"/v1/users/{own_id}", headers=bearer(stranger))).status_code == 404


async def test_service_key_keeps_full_access(with_clerk, stub_junction, client, rsa_key):
    own = await client.post("/v1/me", headers=bearer(make_jwt(rsa_key)))
    own_id = own.json()["id"]

    via_service = await client.get(f"/v1/users/{own_id}", headers={"X-API-Key": SERVICE_TOKEN})
    assert via_service.status_code == 200

    devices = await client.get(f"/v1/users/{own_id}/devices", headers={"X-API-Key": SERVICE_TOKEN})
    assert devices.status_code == 200


async def test_user_token_cannot_erase_even_own_user(with_clerk, stub_junction, client, rsa_key):
    """Erasure is service-side in this version: a Clerk session gets a 403
    pointing at support, and the user survives."""
    own = await client.post("/v1/me", headers=bearer(make_jwt(rsa_key)))
    own_id = own.json()["id"]

    response = await client.delete(f"/v1/users/{own_id}", headers=bearer(make_jwt(rsa_key)))
    assert response.status_code == 403
    assert "support" in response.json()["detail"].lower()

    still_there = await client.get(f"/v1/users/{own_id}", headers={"X-API-Key": SERVICE_TOKEN})
    assert still_there.status_code == 200


async def test_me_rejects_service_key(with_clerk, client):
    response = await client.post("/v1/me", headers={"X-API-Key": SERVICE_TOKEN})
    assert response.status_code == 403


async def test_jwt_ignored_when_clerk_unconfigured(monkeypatch, client, rsa_key):
    monkeypatch.setenv("API_AUTH_TOKEN", SERVICE_TOKEN)
    monkeypatch.delenv("CLERK_ISSUER", raising=False)
    get_settings.cache_clear()
    try:
        response = await client.post("/v1/me", headers=bearer(make_jwt(rsa_key)))
        assert response.status_code == 401
    finally:
        get_settings.cache_clear()
