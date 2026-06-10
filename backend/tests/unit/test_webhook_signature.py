"""Webhook signature verification (Svix HMAC-SHA256 scheme)."""

import base64
import hashlib
import hmac
import json
import time

import pytest
from fastapi import HTTPException

from app.api.webhooks import verify_signature
from app.core.config import get_settings

SECRET_BYTES = b"test-secret-test-secret-test-1234"
SECRET = "whsec_" + base64.b64encode(SECRET_BYTES).decode()


def _sign(msg_id: str, timestamp: int, body: bytes) -> str:
    signed = f"{msg_id}.{timestamp}.".encode() + body
    digest = hmac.new(SECRET_BYTES, signed, hashlib.sha256).digest()
    return "v1," + base64.b64encode(digest).decode()


@pytest.fixture
def with_secret(monkeypatch):
    monkeypatch.setenv("JUNCTION_WEBHOOK_SECRET", SECRET)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_valid_signature_passes(with_secret):
    body = json.dumps({"event_type": "daily.data.heartrate.created"}).encode()
    msg_id, ts = "msg_123", int(time.time())
    headers = {
        "svix-id": msg_id,
        "svix-timestamp": str(ts),
        "svix-signature": _sign(msg_id, ts, body),
    }
    verify_signature(body, headers)  # should not raise


def test_tampered_body_rejected(with_secret):
    body = b'{"event_type": "daily.data.heartrate.created"}'
    msg_id, ts = "msg_123", int(time.time())
    headers = {
        "svix-id": msg_id,
        "svix-timestamp": str(ts),
        "svix-signature": _sign(msg_id, ts, body),
    }
    with pytest.raises(HTTPException) as exc:
        verify_signature(b'{"event_type": "evil"}', headers)
    assert exc.value.status_code == 401


def test_missing_headers_rejected(with_secret):
    with pytest.raises(HTTPException):
        verify_signature(b"{}", {})


def test_no_secret_configured_skips_verification(monkeypatch):
    monkeypatch.setenv("JUNCTION_WEBHOOK_SECRET", "")
    get_settings.cache_clear()
    verify_signature(b"{}", {})  # should not raise
    get_settings.cache_clear()


def test_second_environment_secret_also_accepted(monkeypatch):
    """Sandbox and production endpoints both target this route; a signature
    from either configured secret must verify."""
    monkeypatch.setenv("JUNCTION_WEBHOOK_SECRET", "whsec_" + base64.b64encode(b"a" * 32).decode())
    monkeypatch.setenv("JUNCTION_PROD_WEBHOOK_SECRET", SECRET)
    get_settings.cache_clear()
    try:
        body = b'{"event_type": "daily.data.heartrate.created"}'
        msg_id, ts = "msg_prod", int(time.time())
        headers = {
            "svix-id": msg_id,
            "svix-timestamp": str(ts),
            "svix-signature": _sign(msg_id, ts, body),  # signed with the PROD secret
        }
        verify_signature(body, headers)  # should not raise
    finally:
        get_settings.cache_clear()
