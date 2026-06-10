"""Shared FastAPI dependencies."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import User
from app.services.aggregator import AggregatorClient

DbSession = Annotated[AsyncSession, Depends(get_db)]

_aggregator_client: AggregatorClient | None = None


def get_aggregator_client() -> AggregatorClient:
    """Process-wide Aggregator client (shared connection pool)."""
    global _aggregator_client
    if _aggregator_client is None:
        _aggregator_client = AggregatorClient()
    return _aggregator_client


Aggregator = Annotated[AggregatorClient, Depends(get_aggregator_client)]


async def get_user_or_404(user_id: uuid.UUID, db: DbSession) -> User:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


CurrentUser = Annotated[User, Depends(get_user_or_404)]
