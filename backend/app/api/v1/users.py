"""User endpoints: registration, guests, Aggregator identity mapping, sync."""

import hashlib
import secrets as pysecrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession, Aggregator, aggregator_client_for
from app.core.config import AggregatorEnvironment, get_settings
from app.core.logging import get_logger
from app.models import Connection, ConnectionStatus, DeviceEventActor, DeviceEventType, User
from app.schemas import GuestCreate, GuestOut, MeCreate, UserCreate, UserOut
from app.services.ingestion import (
    RESOURCE_TO_METRIC,
    SLEEP_RESOURCE,
    ConnectionChange,
    IngestPlan,
    apply_plan,
)
from app.services.aggregator import AggregatorError
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
    environment: AggregatorEnvironment,
    actor: DeviceEventActor = DeviceEventActor.service,
    guest_token_hash: str | None = None,
) -> User:
    """Look up a user by ``client_user_id``, creating and registering them
    with Aggregator when absent. Idempotent: re-running with the same id
    returns the existing user. First creation is recorded in the lifecycle
    ledger (``guest_created`` or ``user_created``)."""
    existing = (
        await db.execute(select(User).where(User.client_user_id == client_user_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    aggregator = aggregator_client_for(environment)
    user = User(
        client_user_id=client_user_id,
        aggregator_environment=str(environment),
        guest_token_hash=guest_token_hash,
    )

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
    await db.flush()  # assign user.id so the ledger entry can reference it
    record_device_event(
        db,
        user.id,
        DeviceEventType.guest_created
        if client_user_id.startswith(GUEST_PREFIX)
        else DeviceEventType.user_created,
        actor,
        aggregator_user_id=user.aggregator_user_id,
    )
    await db.commit()
    await db.refresh(user)
    logger.info("user_created", user_id=str(user.id), aggregator_user_id=user.aggregator_user_id)
    return user


async def attach_demo_wearable(db: AsyncSession, user: User, provider: str = "oura") -> None:
    """Attach a demo provider to a fresh sandbox user, best effort.

    Demo mode should show data without a manual connect step, so new sandbox
    identities (guests and first-time Demo sign-ins) get a demo wearable at
    creation. Aggregator then replays ~30 days of synthetic history through the
    normal webhook pipeline. Failures are logged and swallowed: a missing
    demo device must never block account creation.
    """
    if user.aggregator_environment != str(AggregatorEnvironment.sandbox) or not user.aggregator_user_id:
        return
    aggregator = aggregator_client_for(user.aggregator_environment)
    try:
        await aggregator.connect_demo_provider(user.aggregator_user_id, provider)
    except AggregatorError as exc:
        logger.warning(
            "demo_autoconnect_failed",
            user_id=str(user.id),
            provider=provider,
            detail=exc.detail,
        )
        return
    await apply_plan(
        db,
        user.id,
        IngestPlan(
            event_type="local.demo.connected",
            aggregator_user_id=user.aggregator_user_id,
            client_user_id=user.client_user_id,
            connection_change=ConnectionChange(
                provider=provider, status=ConnectionStatus.connected
            ),
        ),
    )
    record_device_event(
        db,
        user.id,
        DeviceEventType.connected,
        DeviceEventActor.service,
        provider=provider,
        aggregator_user_id=user.aggregator_user_id,
    )
    await db.commit()
    from app.services.demo_seed import seed_demo_extras

    await seed_demo_extras(db, user.id, user.client_user_id)
    logger.info("demo_autoconnected", user_id=str(user.id), provider=provider)


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

    Requires Clerk user auth; the service API key and guest tokens get a 403
    because neither carries a Clerk subject to bind. Get-or-creates the user
    whose client_user_id is `clerk:{sub}` (sandbox) or
    `clerk:{sub}:production` (production), registering with Aggregator exactly
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
    environment = AggregatorEnvironment(requested or get_settings().aggregator_environment)
    client_user_id = f"clerk:{auth['subject']}"
    if environment == AggregatorEnvironment.production:
        client_user_id = f"{client_user_id}:production"
    user = await get_or_create_user(db, client_user_id, environment, actor=DeviceEventActor.user)
    if environment == AggregatorEnvironment.sandbox:
        has_history = (
            await db.execute(select(Connection.id).where(Connection.user_id == user.id).limit(1))
        ).scalar_one_or_none()
        if has_history is None:
            await attach_demo_wearable(db, user)
    return user


@guest_router.post("/guests", response_model=GuestOut, status_code=status.HTTP_201_CREATED)
async def create_guest(db: DbSession, body: GuestCreate | None = None) -> GuestOut:
    """Start an explicit guest session: mint a server-side ``guest:<random>``
    identity, register it with Aggregator, and record ``guest_created``.

    Guests are first-class: same Aggregator registration and data pipeline as
    any user, just an anonymous identity. Signing in later moves their
    devices via the identity remap endpoint.

    The response carries ``guest_token`` exactly once. Only its SHA-256 is
    stored server-side, so it cannot be retrieved again; the client must
    persist it. Presenting the token (X-API-Key, Bearer, or api_key query)
    authenticates as this user and scopes access to this user only.
    """
    requested = body.environment if body is not None else None
    environment = AggregatorEnvironment(requested or get_settings().aggregator_environment)
    client_user_id = f"{GUEST_PREFIX}{pysecrets.token_hex(8)}"
    guest_token = pysecrets.token_urlsafe(32)
    user = await get_or_create_user(
        db,
        client_user_id,
        environment,
        actor=DeviceEventActor.user,
        guest_token_hash=hashlib.sha256(guest_token.encode()).hexdigest(),
    )
    await attach_demo_wearable(db, user)
    return GuestOut(**UserOut.model_validate(user).model_dump(), guest_token=guest_token)


@router.get("/{user_id}", response_model=UserOut)
async def get_user(user: CurrentUser) -> User:
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def erase_user(request: Request, user: CurrentUser, db: DbSession) -> None:
    """Right to erasure (GDPR Article 17). Service credential only.

    Order of operations: deregister every non-disconnected provider at
    Aggregator (revoking the upstream data flow first), delete the Aggregator
    user, then delete the local row. ``connections``, ``samples`` and
    ``device_events`` go with it via FK cascade. 404s from Aggregator are
    tolerated at both steps: already gone upstream is the desired end state.

    ``webhook_events`` rows are deliberately retained. They are the raw
    ingestion audit log, matched to users by payload rather than FK, and the
    GDPR position is that raw inbound events carrying provider identifiers
    are kept for N days under the retention policy before deletion (see the
    hardening queue in docs/authentication.md).

    Clerk and guest callers get a 403: in this version account deletion is
    performed via support, which verifies the request out of band and calls
    this endpoint with the service credential.
    """
    auth = getattr(request.state, "auth", None)
    if auth is None or auth.get("kind") != "service":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Account deletion is performed via support in this version.",
        )

    user_id = user.id
    providers = (
        (
            await db.execute(
                select(Connection.provider).where(
                    Connection.user_id == user_id,
                    Connection.status != ConnectionStatus.disconnected,
                )
            )
        )
        .scalars()
        .all()
    )

    deregistered = 0
    aggregator_deleted = False
    if user.aggregator_user_id:
        aggregator = aggregator_client_for(user.aggregator_environment)
        for provider in providers:
            try:
                await aggregator.deregister_provider(user.aggregator_user_id, provider)
            except AggregatorError as exc:
                if exc.status_code != 404:  # already gone at Aggregator is fine
                    raise HTTPException(
                        status.HTTP_502_BAD_GATEWAY,
                        detail=f"Aggregator provider deregistration failed: {exc.detail}",
                    ) from exc
            deregistered += 1
        try:
            await aggregator.delete_user(user.aggregator_user_id)
            aggregator_deleted = True
        except AggregatorError as exc:
            if exc.status_code != 404:  # already gone at Aggregator is fine
                raise HTTPException(
                    status.HTTP_502_BAD_GATEWAY,
                    detail=f"Aggregator user deletion failed: {exc.detail}",
                ) from exc

    # Core delete so the database-level ON DELETE CASCADE handles children;
    # an ORM session.delete would try to null out connections.user_id first.
    await db.execute(delete(User).where(User.id == user_id))
    await db.commit()
    logger.info(
        "user_erased",
        user_id=str(user_id),
        providers_deregistered=deregistered,
        aggregator_deleted=aggregator_deleted,
    )


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

    # Sleep summaries carry the real devices' sleeping HR, HRV and breathing
    # rate. A 180-day window makes missed historical sleep webhooks
    # recoverable with a single sync call.
    sleep_start = end - timedelta(days=180)
    for provider in providers:
        await enqueue_backfill(str(user.id), SLEEP_RESOURCE, provider, str(sleep_start), str(end))
        jobs += 1

    logger.info("sync_requested", user_id=str(user.id), providers=list(providers), jobs=jobs)
    return {"status": "syncing", "providers": list(providers), "jobs": jobs}


@router.post("/admin/remap-aggregator-identity", status_code=status.HTTP_200_OK, tags=["ops"])
async def remap_aggregator_identity(request: Request, body: dict, db: DbSession) -> dict:
    """Move a Aggregator identity (and with it all provider connections held at
    Aggregator) from one of our users to another. Service credential only.

    This exists for identity migrations: e.g. devices were linked under a
    bootstrap identity and the person later signs in properly. Aggregator has
    no connection-transfer API; the Aggregator user IS the unit of ownership,
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
    if source is None or target is None or not source.aggregator_user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User or mapping not found")

    aggregator_user_id = source.aggregator_user_id
    environment = source.aggregator_environment
    source.aggregator_user_id = None
    await db.flush()  # release the unique index before re-assigning
    target.aggregator_user_id = aggregator_user_id
    target.aggregator_environment = environment
    record_device_event(
        db,
        target.id,
        DeviceEventType.identity_remapped,
        DeviceEventActor.service,
        aggregator_user_id=aggregator_user_id,
        detail={"from": from_id, "to": to_id},
    )
    await db.commit()

    logger.info("aggregator_identity_remapped", source=from_id, target=to_id)
    return {"remapped": True, "aggregator_user_id": aggregator_user_id, "environment": environment}
