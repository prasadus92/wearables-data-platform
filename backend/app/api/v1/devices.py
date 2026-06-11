"""Device (wearable connection) endpoints: link, list, demo-connect, disconnect."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, junction_client_for
from app.core.logging import get_logger
from app.models import Connection, ConnectionStatus, DeviceEventActor, DeviceEventType, User
from app.schemas import ConnectionOut, LinkOut, LinkRequest
from app.services.demo_seed import seed_demo_extras
from app.services.ingestion import ConnectionChange, IngestPlan, apply_plan
from app.services.junction import JunctionError
from app.services.ledger import record_device_event

logger = get_logger(__name__)
router = APIRouter(prefix="/users/{user_id}/devices", tags=["devices"])


def _require_junction_id(user: User) -> str:
    if not user.junction_user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="User is not registered with Junction")
    return user.junction_user_id


@router.post("/link", response_model=LinkOut)
async def create_link(body: LinkRequest, user: CurrentUser) -> LinkOut:
    """Start the connect flow: returns a hosted Junction Link URL.

    The app opens it in a browser/webview; the user OAuths into their
    wearable account; Junction redirects back to ``redirect_url`` with
    ``?state=success`` (or ``?state=error&error_type=...``). The token
    expires in 60 minutes.
    """
    junction_user_id = _require_junction_id(user)
    junction = junction_client_for(user.junction_environment)
    try:
        token = await junction.create_link_token(
            junction_user_id, provider=body.provider, redirect_url=body.redirect_url
        )
    except JunctionError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.detail) from exc
    link_url = token.get("link_web_url") or ""
    return LinkOut(link_token=token["link_token"], link_url=link_url)


@router.post("/demo", response_model=dict, tags=["sandbox"])
async def connect_demo(body: LinkRequest, user: CurrentUser, db: DbSession) -> dict:
    """Sandbox only: attach a demo provider (oura / fitbit / apple_health_kit)
    with 30 days of synthetic data and a simulated webhook lifecycle."""
    junction_user_id = _require_junction_id(user)
    junction = junction_client_for(user.junction_environment)
    try:
        result = await junction.connect_demo_provider(junction_user_id, body.provider)
    except JunctionError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.detail) from exc

    # Record the connection immediately. The provider.connection.created
    # webhook will arrive too (and idempotently upsert the same row), but the
    # UI should reflect the device without waiting on webhook delivery.
    await apply_plan(
        db,
        user.id,
        IngestPlan(
            event_type="local.demo.connected",
            junction_user_id=junction_user_id,
            client_user_id=user.client_user_id,
            connection_change=ConnectionChange(
                provider=body.provider, status=ConnectionStatus.connected
            ),
        ),
    )
    # The user asked for this connection, so the ledger entry is theirs;
    # the webhook that follows logs its own entry as the delivery channel.
    record_device_event(
        db,
        user.id,
        DeviceEventType.connected,
        DeviceEventActor.user,
        provider=body.provider,
        junction_user_id=junction_user_id,
    )
    await db.commit()
    # Demo wearables never deliver breathing rate or blood pressure; demo
    # mode is synthetic end to end, so those two come from our own seeder.
    await seed_demo_extras(db, user.id, user.client_user_id)
    logger.info("demo_connected", user_id=str(user.id), provider=body.provider)
    return {"connected": True, "provider": body.provider, "junction_response": result}


@router.post("/apple-pairing-code", response_model=dict)
async def create_apple_pairing_code(user: CurrentUser) -> dict:
    """Mint a single-use pairing code for connecting an Apple Watch.

    HealthKit data leaves an iPhone only through an app with HealthKit
    entitlements, so Apple Watch connects through the Vital Connect bridge
    app instead of hosted OAuth: install it, enter this code, grant access.
    Readings then flow through the normal webhook pipeline as the
    apple_health_kit provider. Codes are single-use and short-lived.
    """
    junction_user_id = _require_junction_id(user)
    junction = junction_client_for(user.junction_environment)
    try:
        result = await junction.create_link_code(junction_user_id)
    except JunctionError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.detail) from exc
    return {"code": result.get("code"), "expires_at": result.get("expires_at")}


@router.get("", response_model=list[ConnectionOut])
async def list_devices(user: CurrentUser, db: DbSession) -> list[Connection]:
    """All of the user's wearable connections, oldest first. Disconnected
    and expired rows are included; the ``status`` field tells them apart."""
    rows = (
        await db.execute(
            select(Connection)
            .where(Connection.user_id == user.id)
            .order_by(Connection.connected_at)
        )
    ).scalars()
    return list(rows)


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_device(provider: str, user: CurrentUser, db: DbSession) -> None:
    """Disconnect flow: deregister at Junction, mark locally. Historical
    samples are retained (product decision: data belongs to the user)."""
    connection = (
        await db.execute(
            select(Connection).where(Connection.user_id == user.id, Connection.provider == provider)
        )
    ).scalar_one_or_none()
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not connected")

    junction = junction_client_for(user.junction_environment)
    try:
        await junction.deregister_provider(_require_junction_id(user), provider)
    except JunctionError as exc:
        if exc.status_code != 404:  # already gone at Junction is fine
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.detail) from exc

    connection.status = ConnectionStatus.disconnected
    connection.disconnected_at = datetime.now(UTC)
    record_device_event(
        db,
        user.id,
        DeviceEventType.disconnected,
        DeviceEventActor.user,
        provider=provider,
        junction_user_id=user.junction_user_id,
    )
    await db.commit()
    logger.info("device_disconnected", user_id=str(user.id), provider=provider)
