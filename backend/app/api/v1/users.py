"""User endpoints: registration, Aggregator identity mapping, manual sync."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession, Aggregator, aggregator_client_for
from app.core.config import AggregatorEnvironment, get_settings
from app.core.logging import get_logger
from app.models import Connection, ConnectionStatus, User
from app.schemas import MeCreate, UserCreate, UserOut
from app.services.ingestion import (
    RESOURCE_TO_METRIC,
    ConnectionChange,
    IngestPlan,
    apply_plan,
)
from app.services.aggregator import AggregatorError
from app.workers.queue import enqueue_backfill

logger = get_logger(__name__)
router = APIRouter(prefix="/users", tags=["users"])
# /me lives outside the /users prefix; included in main.py with the same auth.
me_router = APIRouter(tags=["users"])


async def get_or_create_user(
    db: AsyncSession, client_user_id: str, environment: AggregatorEnvironment
) -> User:
    """Look up a user by ``client_user_id``, creating and registering them
    with Aggregator when absent. Idempotent: re-running with the same id
    returns the existing user."""
    existing = (
        await db.execute(select(User).where(User.client_user_id == client_user_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    aggregator = aggregator_client_for(environment)
    user = User(client_user_id=client_user_id, aggregator_environment=str(environment))

    try:
        aggregator_user = await aggregator.create_user(client_user_id)
        user.aggregator_user_id = aggregator_user.get("user_id")
    except AggregatorError as exc:
        # 400 on duplicate client_user_id includes the existing user_id, so
        # recover the mapping instead of failing registration.
        if exc.status_code == 400 and "user_id" in exc.detail:
            resolved = await aggregator.resolve_user(client_user_id)
            user.aggregator_user_id = resolved.get("user_id")
        else:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, detail=f"Aggregator user creation failed: {exc.detail}"
            ) from exc

    db.add(user)
    await db.commit()
    await db.refresh(user)
    logger.info("user_created", user_id=str(user.id), aggregator_user_id=user.aggregator_user_id)
    return user


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, db: DbSession, _aggregator: Aggregator) -> User:
    """Create an app user and register them with Aggregator.

    Idempotent on ``client_user_id``: re-posting the same id returns the
    existing user (200 semantics kept simple for the challenge scope).
    """
    environment = AggregatorEnvironment(body.environment or get_settings().aggregator_environment)
    return await get_or_create_user(db, body.client_user_id, environment)


@me_router.post("/me", response_model=UserOut)
async def create_me(request: Request, db: DbSession, body: MeCreate | None = None) -> User:
    """Bootstrap the signed-in caller's identity (Demo/Live mode).

    Requires Clerk user auth; the service API key gets a 403 because it has
    no single identity to bind. Get-or-creates the user whose client_user_id
    is `clerk:{sub}` (sandbox) or `clerk:{sub}:production` (production),
    registering with Aggregator exactly like POST /v1/users.
    """
    auth = getattr(request.state, "auth", None)
    if auth is None or auth.get("kind") != "user":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="POST /v1/me requires a Clerk user token. Service API keys manage "
            "arbitrary users via POST /v1/users instead.",
        )

    requested = body.environment if body is not None else None
    environment = AggregatorEnvironment(requested or get_settings().aggregator_environment)
    client_user_id = f"clerk:{auth['subject']}"
    if environment == AggregatorEnvironment.production:
        client_user_id = f"{client_user_id}:production"
    return await get_or_create_user(db, client_user_id, environment)


@router.get("/{user_id}", response_model=UserOut)
async def get_user(user: CurrentUser) -> User:
    return user


@router.post("/{user_id}/sync", status_code=status.HTTP_202_ACCEPTED)
async def sync_user(user: CurrentUser, db: DbSession, _default: Aggregator) -> dict:
    """Manual sync (pull-to-refresh): ask Aggregator for fresh data and enqueue
    a reconciliation backfill for every connected provider and metric.

    Webhooks remain the primary ingestion path. This endpoint covers gaps:
    a user pulling to refresh, recovery after webhook downtime, and demos.
    Aggregator rate-limits refresh to 8/hour/user; backfills are idempotent,
    so overlapping syncs are harmless.
    """
    if not user.aggregator_user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="User not registered with Aggregator")

    aggregator = aggregator_client_for(user.aggregator_environment)
    try:
        await aggregator.refresh_user(user.aggregator_user_id)
    except AggregatorError as exc:
        # Refresh quota (429) just means Aggregator already has fresh data;
        # proceed to backfill either way.
        if exc.status_code != 429:
            logger.warning("sync_refresh_failed", user_id=str(user.id), detail=exc.detail)

    # Reconcile connections from Aggregator first. A device may have been
    # linked while webhooks were not yet registered (or were missed); sync
    # is the recovery path, so Aggregator's view wins over local state.
    try:
        remote = await aggregator.get_user_connections(user.aggregator_user_id)
        for item in remote.get("providers", []):
            slug = item.get("slug")
            if not slug:
                continue
            status_str = item.get("status", "connected")
            change = ConnectionChange(
                provider=slug,
                status=ConnectionStatus.expired
                if status_str == "error"
                else ConnectionStatus.connected,
                device_meta={
                    "name": item.get("name"),
                    "logo": item.get("logo"),
                    "resource_availability": item.get("resource_availability"),
                },
            )
            await apply_plan(
                db,
                user.id,
                IngestPlan(
                    event_type="local.sync.reconcile",
                    aggregator_user_id=user.aggregator_user_id,
                    client_user_id=user.client_user_id,
                    connection_change=change,
                ),
            )
        await db.commit()
    except AggregatorError as exc:
        logger.warning("sync_reconcile_failed", user_id=str(user.id), detail=exc.detail)

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
