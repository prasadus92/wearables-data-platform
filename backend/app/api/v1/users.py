"""User endpoints: registration, Junction identity mapping, manual sync."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, Junction
from app.core.logging import get_logger
from app.models import Connection, ConnectionStatus, User
from app.schemas import UserCreate, UserOut
from app.services.ingestion import RESOURCE_TO_METRIC
from app.services.junction import JunctionError
from app.workers.queue import enqueue_backfill

logger = get_logger(__name__)
router = APIRouter(prefix="/users", tags=["users"])


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, db: DbSession, junction: Junction) -> User:
    """Create an app user and register them with Junction.

    Idempotent on ``client_user_id``: re-posting the same id returns the
    existing user (200 semantics kept simple for the challenge scope).
    """
    existing = (
        await db.execute(select(User).where(User.client_user_id == body.client_user_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    user = User(client_user_id=body.client_user_id)

    try:
        junction_user = await junction.create_user(body.client_user_id)
        user.junction_user_id = junction_user.get("user_id")
    except JunctionError as exc:
        # 400 on duplicate client_user_id includes the existing user_id, so
        # recover the mapping instead of failing registration.
        if exc.status_code == 400 and "user_id" in exc.detail:
            resolved = await junction.resolve_user(body.client_user_id)
            user.junction_user_id = resolved.get("user_id")
        else:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, detail=f"Junction user creation failed: {exc.detail}"
            ) from exc

    db.add(user)
    await db.commit()
    await db.refresh(user)
    logger.info("user_created", user_id=str(user.id), junction_user_id=user.junction_user_id)
    return user


@router.get("/{user_id}", response_model=UserOut)
async def get_user(user: CurrentUser) -> User:
    return user


@router.post("/{user_id}/sync", status_code=status.HTTP_202_ACCEPTED)
async def sync_user(user: CurrentUser, db: DbSession, junction: Junction) -> dict:
    """Manual sync (pull-to-refresh): ask Junction for fresh data and enqueue
    a reconciliation backfill for every connected provider and metric.

    Webhooks remain the primary ingestion path. This endpoint covers gaps:
    a user pulling to refresh, recovery after webhook downtime, and demos.
    Junction rate-limits refresh to 8/hour/user; backfills are idempotent,
    so overlapping syncs are harmless.
    """
    if not user.junction_user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="User not registered with Junction")

    try:
        await junction.refresh_user(user.junction_user_id)
    except JunctionError as exc:
        # Refresh quota (429) just means Junction already has fresh data;
        # proceed to backfill either way.
        if exc.status_code != 429:
            logger.warning("sync_refresh_failed", user_id=str(user.id), detail=exc.detail)

    providers = (
        (
            await db.execute(
                select(Connection.provider).where(
                    Connection.user_id == user.id,
                    Connection.status != ConnectionStatus.disconnected,
                )
            )
        )
        .scalars()
        .all()
    )
    end = datetime.now(UTC).date() + timedelta(days=1)
    start = end - timedelta(days=31)
    jobs = 0
    for provider in providers:
        for resource in RESOURCE_TO_METRIC:
            await enqueue_backfill(str(user.id), resource, provider, str(start), str(end))
            jobs += 1

    logger.info("sync_requested", user_id=str(user.id), providers=list(providers), jobs=jobs)
    return {"status": "syncing", "providers": list(providers), "jobs": jobs}
