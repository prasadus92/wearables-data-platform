"""Shared FastAPI dependencies."""

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


async def require_auth(request: Request) -> None:
    """Dual auth for the /v1 API: static service key or Clerk session JWT.

    Sets ``request.state.auth`` to ``{"kind": "service"}`` when the static
    API key matches (constant-time compare; an empty configured key disables
    the check, allowed only for local development), or to ``{"kind": "user",
    "subject": <clerk sub>}`` when the credential is a valid Clerk JWT and
    CLERK_ISSUER is configured. Anything else is a 401.

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

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing credentials")


# Backwards-compatible name for the pre-Clerk dependency.
require_api_key = require_auth


DbSession = Annotated[AsyncSession, Depends(get_db)]

_junction_clients: dict[str, JunctionClient] = {}


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
    # Service auth keeps full access.
    auth = getattr(request.state, "auth", None)
    if auth is not None and auth.get("kind") == "user":
        owned = f"clerk:{auth['subject']}"
        if user.client_user_id != owned and not user.client_user_id.startswith(f"{owned}:"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


CurrentUser = Annotated[User, Depends(get_user_or_404)]
