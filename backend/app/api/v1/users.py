"""User endpoints: registration, guests, Junction identity mapping, sync."""

import hashlib
import secrets as pysecrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession, Junction, junction_client_for
from app.core.config import JunctionEnvironment, get_settings
from app.core.logging import get_logger
from app.models import Connection, ConnectionStatus, DeviceEventActor, DeviceEventType, User
from app.schemas import GuestCreate, GuestOut, MeCreate, UserCreate, UserOut
from app.services.ingestion import (
    RESOURCE_TO_METRIC,
    ConnectionChange,
    IngestPlan,
    apply_plan,
)
from app.services.junction import JunctionError
from app.services.ledger import record_device_event
from app.workers.queue import enqueue_backfill

logger = get_logger(__name__)
router = APIRouter(prefix="/users", tags=["users"])
# /me lives outside the /users prefix; included in main.py with
# the same auth.
me_router = APIRouter(tags=["users"])
# Guest creation is public by design: it mints a fresh sandbox-scoped
# identity and grants access to nothing else. Production-hardening note:
# add per-IP rate limiting before wide distribution (documented in
# docs/authentication.md).
guest_router = APIRouter(tags=["users"])

# Server-issued anonymous identities. The prefix is the contract: everything
# downstream (ownership checks, UI labels) recognizes a guest by it.
GUEST_PREFIX = "guest:"


async def get_or_create_user(
    db: AsyncSession,
    client_user_id: str,
    environment: JunctionEnvironment,
    actor: DeviceEventActor = DeviceEventActor.service,
    guest_token_hash: str | None = None,
) -> User:
    """Look up a user by ``client_user_id``, creating and registering them
    with Junction when absent. Idempotent: re-running with the same id
    returns the existing user. First creation is recorded in the lifecycle
    ledger (``guest_created`` or ``user_created``)."""
    existing = (
        await db.execute(select(User).where(User.client_user_id == client_user_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    junction = junction_client_for(environment)
    user = User(
        client_user_id=client_user_id,
        junction_environment=str(environment),
        guest_token_hash=guest_token_hash,
    )

    try:
        junction_user = await junction.create_user(client_user_id)
        user.junction_user_id = junction_user.get("user_id")
    except JunctionError as exc:
        # 400 on duplicate client_user_id includes the existing user_id, so
        # recover the mapping instead of failing registration.
        if exc.status_code == 400 and "user_id" in exc.detail:
            resolved = await junction.resolve_user(client_user_id)
            user.junction_user_id = resolved.get("user_id")
        else:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, detail=f"Junction user creation failed: {exc.detail}"
            ) from exc

    db.add(user)
    await db.flush()  # assign user.id so the ledger entry can reference it
    record_device_event(
        db,
        user.id,
        DeviceEventType.guest_created
        if client_user_id.startswith(GUEST_PREFIX)
        else DeviceEventType.user_created,
        actor,
        junction_user_id=user.junction_user_id,
    )
    await db.commit()
    await db.refresh(user)
    logger.info("user_created", user_id=str(user.id), junction_user_id=user.junction_user_id)
    return user


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, db: DbSession, _junction: Junction) -> User:
    """Create an app user and register them with Junction.

    Idempotent on ``client_user_id``: re-posting the same id returns the
    existing user (200 semantics kept simple for the challenge scope).
    """
    environment = JunctionEnvironment(body.environment or get_settings().junction_environment)
    return await get_or_create_user(db, body.client_user_id, environment)


@me_router.post("/me", response_model=UserOut)
async def create_me(request: Request, db: DbSession, body: MeCreate | None = None) -> User:
    """Bootstrap the signed-in caller's identity (Demo/Live mode).

    Requires Clerk user auth; the service API key and guest tokens get a 403
    because neither carries a Clerk subject to bind. Get-or-creates the user
    whose client_user_id is `clerk:{sub}` (sandbox) or
    `clerk:{sub}:production` (production), registering with Junction exactly
    like POST /v1/users.
    """
    auth = getattr(request.state, "auth", None)
    if auth is None or auth.get("kind") != "user":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="POST /v1/me requires a Clerk user token. Service API keys manage "
            "arbitrary users via POST /v1/users instead.",
        )

    requested = body.environment if body is not None else None
    environment = JunctionEnvironment(requested or get_settings().junction_environment)
    client_user_id = f"clerk:{auth['subject']}"
    if environment == JunctionEnvironment.production:
        client_user_id = f"{client_user_id}:production"
    return await get_or_create_user(db, client_user_id, environment, actor=DeviceEventActor.user)


@guest_router.post("/guests", response_model=GuestOut, status_code=status.HTTP_201_CREATED)
async def create_guest(db: DbSession, body: GuestCreate | None = None) -> GuestOut:
    """Start an explicit guest session: mint a server-side ``guest:<random>``
    identity, register it with Junction, and record ``guest_created``.

    Guests are first-class: same Junction registration and data pipeline as
    any user, just an anonymous identity. Signing in later moves their
    devices via the identity remap endpoint.

    The response carries ``guest_token`` exactly once. Only its SHA-256 is
    stored server-side, so it cannot be retrieved again; the client must
    persist it. Presenting the token (X-API-Key, Bearer, or api_key query)
    authenticates as this user and scopes access to this user only.
    """
    requested = body.environment if body is not None else None
    environment = JunctionEnvironment(requested or get_settings().junction_environment)
    client_user_id = f"{GUEST_PREFIX}{pysecrets.token_hex(8)}"
    guest_token = pysecrets.token_urlsafe(32)
    user = await get_or_create_user(
        db,
        client_user_id,
        environment,
        actor=DeviceEventActor.user,
        guest_token_hash=hashlib.sha256(guest_token.encode()).hexdigest(),
    )
    return GuestOut(**UserOut.model_validate(user).model_dump(), guest_token=guest_token)


@router.get("/{user_id}", response_model=UserOut)
async def get_user(user: CurrentUser) -> User:
    return user


@router.post("/{user_id}/sync", status_code=status.HTTP_202_ACCEPTED)
async def sync_user(user: CurrentUser, db: DbSession, _default: Junction) -> dict:
    """Manual sync (pull-to-refresh): ask Junction for fresh data and enqueue
    a reconciliation backfill for every connected provider and metric.

    Webhooks remain the primary ingestion path. This endpoint covers gaps:
    a user pulling to refresh, recovery after webhook downtime, and demos.
    Junction rate-limits refresh to 8/hour/user; backfills are idempotent,
    so overlapping syncs are harmless.
    """
    if not user.junction_user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="User not registered with Junction")

    junction = junction_client_for(user.junction_environment)
    try:
        await junction.refresh_user(user.junction_user_id)
    except JunctionError as exc:
        # Refresh quota (429) just means Junction already has fresh data;
        # proceed to backfill either way.
        if exc.status_code != 429:
            logger.warning("sync_refresh_failed", user_id=str(user.id), detail=exc.detail)

    # Reconcile connections from Junction first. A device may have been
    # linked while webhooks were not yet registered (or were missed); sync
    # is the recovery path, so Junction's view wins over local state.
    try:
        remote = await junction.get_user_connections(user.junction_user_id)
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
                    junction_user_id=user.junction_user_id,
                    client_user_id=user.client_user_id,
                    connection_change=change,
                ),
            )
        await db.commit()
    except JunctionError as exc:
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


@router.post("/admin/remap-junction-identity", status_code=status.HTTP_200_OK, tags=["ops"])
async def remap_junction_identity(request: Request, body: dict, db: DbSession) -> dict:
    """Move a Junction identity (and with it all provider connections held at
    Junction) from one of our users to another. Service credential only.

    This exists for identity migrations: e.g. devices were linked under a
    bootstrap identity and the person later signs in properly. Junction has
    no connection-transfer API; the Junction user IS the unit of ownership,
    so re-pointing our alias is the correct move. Follow with a sync on the
    target user to reconcile connections and pull history.
    """
    auth = getattr(request.state, "auth", None)
    if auth is None or auth.get("kind") != "service":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Service credential required")

    from_id, to_id = body.get("from_client_user_id"), body.get("to_client_user_id")
    if not from_id or not to_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="from_client_user_id and to_client_user_id are required",
        )

    source = (
        await db.execute(select(User).where(User.client_user_id == from_id))
    ).scalar_one_or_none()
    target = (
        await db.execute(select(User).where(User.client_user_id == to_id))
    ).scalar_one_or_none()
    if source is None or target is None or not source.junction_user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User or mapping not found")

    junction_user_id = source.junction_user_id
    environment = source.junction_environment
    source.junction_user_id = None
    await db.flush()  # release the unique index before re-assigning
    target.junction_user_id = junction_user_id
    target.junction_environment = environment
    record_device_event(
        db,
        target.id,
        DeviceEventType.identity_remapped,
        DeviceEventActor.service,
        junction_user_id=junction_user_id,
        detail={"from": from_id, "to": to_id},
    )
    await db.commit()

    logger.info("junction_identity_remapped", source=from_id, target=to_id)
    return {"remapped": True, "junction_user_id": junction_user_id, "environment": environment}
