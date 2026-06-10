"""Shared FastAPI dependencies."""

import secrets
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import AggregatorEnvironment, get_settings
from app.db.session import get_db
from app.models import User
from app.services.aggregator import AggregatorClient


async def require_api_key(request: Request) -> None:
    """Static-token auth for the /v1 API.

    Accepts `X-API-Key: <token>`, `Authorization: Bearer <token>`, or an
    `api_key` query parameter (EventSource cannot set headers, so the SSE
    stream authenticates via query string). An empty configured token
    disables the check, which is allowed only for local development.

    Webhooks are NOT covered by this: they authenticate via the Svix
    signature instead. Production evolves this into per-user JWTs so a
    token only grants access to its own user's data.
    """
    expected = get_settings().api_auth_token
    if not expected:
        return

    provided = request.headers.get("x-api-key", "")
    if not provided:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            provided = auth[7:]
    if not provided:
        provided = request.query_params.get("api_key", "")

    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key")


DbSession = Annotated[AsyncSession, Depends(get_db)]

_aggregator_clients: dict[str, AggregatorClient] = {}


def aggregator_client_for(environment: str | AggregatorEnvironment) -> AggregatorClient:
    """Process-wide Aggregator client per environment (shared connection pools)."""
    env = AggregatorEnvironment(environment)
    if env not in _aggregator_clients:
        _aggregator_clients[env] = AggregatorClient(environment=env)
    return _aggregator_clients[env]


def get_aggregator_client() -> AggregatorClient:
    """Client for the default environment (used at user creation)."""
    return aggregator_client_for(get_settings().aggregator_environment)


async def close_aggregator_clients() -> None:
    for client in _aggregator_clients.values():
        await client.aclose()
    _aggregator_clients.clear()


Aggregator = Annotated[AggregatorClient, Depends(get_aggregator_client)]


async def get_user_or_404(user_id: uuid.UUID, db: DbSession) -> User:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


CurrentUser = Annotated[User, Depends(get_user_or_404)]
