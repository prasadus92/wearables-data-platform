"""Shared FastAPI dependencies."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import User
from app.services.junction import JunctionClient

DbSession = Annotated[AsyncSession, Depends(get_db)]

_junction_client: JunctionClient | None = None


def get_junction_client() -> JunctionClient:
    """Process-wide Junction client (shared connection pool)."""
    global _junction_client
    if _junction_client is None:
        _junction_client = JunctionClient()
    return _junction_client


Junction = Annotated[JunctionClient, Depends(get_junction_client)]


async def get_user_or_404(user_id: uuid.UUID, db: DbSession) -> User:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


CurrentUser = Annotated[User, Depends(get_user_or_404)]
