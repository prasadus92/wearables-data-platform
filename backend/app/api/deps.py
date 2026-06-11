"""Shared FastAPI dependencies."""

import hashlib
import secrets
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clerk import ClerkAuthError, verify_clerk_token
from app.core.config import JunctionEnvironment, get_settings
from app.db.session import get_db
from app.models import User
from app.services.junction import JunctionClient


def _provided_credential(request: Request) -> str:
    """Extract the caller's credential from any of the three transports.

    `X-API-Key: <token>`, `Authorization: Bearer <token>`, or an `api_key`
    query parameter (EventSource cannot set headers, so the SSE stream
    authenticates via query string).
    """
    provided = request.headers.get("x-api-key", "")
    if not provided:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            provided = auth[7:]
    if not provided:
        provided = request.query_params.get("api_key", "")
    return provided


async def require_auth(request: Request, db: AsyncSession = Depends(get_db)) -> None:
    """Triple auth for the /v1 API: static service key, Clerk session JWT,
    or a guest session token.

    Sets ``request.state.auth`` to ``{"kind": "service"}`` when the static
    API key matches (constant-time compare; an empty configured key disables
    the check, allowed only for local development), to ``{"kind": "user",
    "subject": <clerk sub>}`` when the credential is a valid Clerk JWT and
    CLERK_ISSUER is configured, or to ``{"kind": "guest", "user_id": <id>}``
    when the credential's SHA-256 matches a guest token minted by
    POST /v1/guests. Anything else is a 401. Order matters: service key
    first, JWT shape second, guest lookup last.

    Webhooks are NOT covered by this: they authenticate via the Svix
    signature instead.
    """
    expected = get_settings().api_auth_token
    if not expected:
        request.state.auth = {"kind": "service"}
        return

    provided = _provided_credential(request)
    if provided and secrets.compare_digest(provided, expected):
        request.state.auth = {"kind": "service"}
        return

    # A JWT has exactly two dots (header.payload.signature). Only attempt
    # Clerk verification when the shape matches and Clerk is configured.
    if provided.count(".") == 2 and get_settings().clerk_issuer:
        try:
            subject = verify_clerk_token(provided)
        except ClerkAuthError as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        request.state.auth = {"kind": "user", "subject": subject}
        return

    # Guest session token: an opaque urlsafe secret issued once by
    # POST /v1/guests. Only its SHA-256 is stored, so this is a single
    # indexed lookup; a match authenticates as exactly that user.
    if provided:
        digest = hashlib.sha256(provided.encode()).hexdigest()
        guest_id = (
            await db.execute(select(User.id).where(User.guest_token_hash == digest))
        ).scalar_one_or_none()
        if guest_id is not None:
            request.state.auth = {"kind": "guest", "user_id": str(guest_id)}
            return

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing credentials")


DbSession = Annotated[AsyncSession, Depends(get_db)]

_junction_clients: dict[JunctionEnvironment, JunctionClient] = {}


def junction_client_for(environment: str | JunctionEnvironment) -> JunctionClient:
    """Process-wide Junction client per environment (shared connection pools)."""
    env = JunctionEnvironment(environment)
    if env not in _junction_clients:
        _junction_clients[env] = JunctionClient(environment=env)
    return _junction_clients[env]


def get_junction_client() -> JunctionClient:
    """Client for the default environment (used at user creation)."""
    return junction_client_for(get_settings().junction_environment)


async def close_junction_clients() -> None:
    for client in _junction_clients.values():
        await client.aclose()
    _junction_clients.clear()


Junction = Annotated[JunctionClient, Depends(get_junction_client)]


async def get_user_or_404(request: Request, user_id: uuid.UUID, db: DbSession) -> User:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")

    # Clerk-authenticated callers only see their own users: client_user_id
    # is `clerk:{sub}` (sandbox) or `clerk:{sub}:production`. A mismatch is
    # a 404, identical to a missing user, so existence is never leaked.
    # Guest tokens are scoped even tighter: exactly the one user they were
    # minted for. Service auth keeps full access.
    auth = getattr(request.state, "auth", None)
    if auth is not None and auth.get("kind") == "user":
        owned = f"clerk:{auth['subject']}"
        if user.client_user_id != owned and not user.client_user_id.startswith(f"{owned}:"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    if auth is not None and auth.get("kind") == "guest" and str(user.id) != auth["user_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


CurrentUser = Annotated[User, Depends(get_user_or_404)]
