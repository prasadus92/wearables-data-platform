"""Device (wearable connection) endpoints: link, list, demo-connect, disconnect."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, Aggregator
from app.core.logging import get_logger
from app.models import Connection, ConnectionStatus
from app.schemas import ConnectionOut, LinkOut, LinkRequest
from app.services.aggregator import AggregatorError

logger = get_logger(__name__)
router = APIRouter(prefix="/users/{user_id}/devices", tags=["devices"])


def _require_aggregator_id(user) -> str:
    if not user.aggregator_user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="User is not registered with Aggregator")
    return user.aggregator_user_id


@router.post("/link", response_model=LinkOut)
async def create_link(body: LinkRequest, user: CurrentUser, aggregator: Aggregator) -> LinkOut:
    """Start the connect flow: returns a hosted Aggregator Link URL.

    The app opens it in a browser/webview; the user OAuths into their
    wearable account; Aggregator redirects back to ``redirect_url`` with
    ``?state=success`` (or ``?state=error&error_type=...``). The token
    expires in 60 minutes.
    """
    aggregator_user_id = _require_aggregator_id(user)
    try:
        token = await aggregator.create_link_token(
            aggregator_user_id, provider=body.provider, redirect_url=body.redirect_url
        )
    except AggregatorError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.detail) from exc
    link_url = token.get("link_web_url") or ""
    return LinkOut(link_token=token["link_token"], link_url=link_url)


@router.post("/demo", response_model=dict, tags=["sandbox"])
async def connect_demo(
    body: LinkRequest, user: CurrentUser, db: DbSession, aggregator: Aggregator
) -> dict:
    """Sandbox only: attach a demo provider (oura / fitbit / apple_health_kit)
    with 30 days of synthetic data and a simulated webhook lifecycle."""
    aggregator_user_id = _require_aggregator_id(user)
    try:
        result = await aggregator.connect_demo_provider(aggregator_user_id, body.provider)
    except AggregatorError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.detail) from exc

    # Record the connection immediately. The provider.connection.created
    # webhook will arrive too (and idempotently upsert the same row), but the
    # UI should reflect the device without waiting on webhook delivery.
    from app.models import ConnectionStatus
    from app.services.ingestion import ConnectionChange, IngestPlan, apply_plan

    await apply_plan(
        db,
        user.id,
        IngestPlan(
            event_type="local.demo.connected",
            aggregator_user_id=aggregator_user_id,
            client_user_id=user.client_user_id,
            connection_change=ConnectionChange(
                provider=body.provider, status=ConnectionStatus.connected
            ),
        ),
    )
    await db.commit()
    logger.info("demo_connected", user_id=str(user.id), provider=body.provider)
    return {"connected": True, "provider": body.provider, "aggregator_response": result}


@router.get("", response_model=list[ConnectionOut])
async def list_devices(user: CurrentUser, db: DbSession) -> list[Connection]:
    rows = (
        await db.execute(
            select(Connection)
            .where(Connection.user_id == user.id)
            .order_by(Connection.connected_at)
        )
    ).scalars()
    return list(rows)


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_device(
    provider: str, user: CurrentUser, db: DbSession, aggregator: Aggregator
) -> None:
    """Disconnect flow: deregister at Aggregator, mark locally. Historical
    samples are retained (product decision: data belongs to the user)."""
    connection = (
        await db.execute(
            select(Connection).where(Connection.user_id == user.id, Connection.provider == provider)
        )
    ).scalar_one_or_none()
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not connected")

    try:
        await aggregator.deregister_provider(_require_aggregator_id(user), provider)
    except AggregatorError as exc:
        if exc.status_code != 404:  # already gone at Aggregator is fine
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.detail) from exc

    from datetime import UTC, datetime

    connection.status = ConnectionStatus.disconnected
    connection.disconnected_at = datetime.now(UTC)
    await db.commit()
    logger.info("device_disconnected", user_id=str(user.id), provider=provider)
