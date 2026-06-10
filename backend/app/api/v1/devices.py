"""Device (wearable connection) endpoints: link, list, demo-connect, disconnect."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, Junction
from app.core.logging import get_logger
from app.models import Connection, ConnectionStatus
from app.schemas import ConnectionOut, LinkOut, LinkRequest
from app.services.junction import JunctionError

logger = get_logger(__name__)
router = APIRouter(prefix="/users/{user_id}/devices", tags=["devices"])


def _require_junction_id(user) -> str:
    if not user.junction_user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="User is not registered with Junction")
    return user.junction_user_id


@router.post("/link", response_model=LinkOut)
async def create_link(body: LinkRequest, user: CurrentUser, junction: Junction) -> LinkOut:
    """Start the connect flow: returns a hosted Junction Link URL.

    The app opens it in a browser/webview; the user OAuths into their
    wearable account; Junction redirects back to ``redirect_url`` with
    ``?state=success`` (or ``?state=error&error_type=...``). The token
    expires in 60 minutes.
    """
    junction_user_id = _require_junction_id(user)
    try:
        token = await junction.create_link_token(
            junction_user_id, provider=body.provider, redirect_url=body.redirect_url
        )
    except JunctionError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.detail) from exc
    link_url = token.get("link_web_url") or ""
    return LinkOut(link_token=token["link_token"], link_url=link_url)


@router.post("/demo", response_model=dict, tags=["sandbox"])
async def connect_demo(body: LinkRequest, user: CurrentUser, junction: Junction) -> dict:
    """Sandbox only: attach a demo provider (oura / fitbit / apple_health_kit)
    with 30 days of synthetic data and a simulated webhook lifecycle."""
    junction_user_id = _require_junction_id(user)
    try:
        result = await junction.connect_demo_provider(junction_user_id, body.provider)
    except JunctionError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.detail) from exc
    logger.info("demo_connected", user_id=str(user.id), provider=body.provider)
    return {"connected": True, "provider": body.provider, "junction_response": result}


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
    provider: str, user: CurrentUser, db: DbSession, junction: Junction
) -> None:
    """Disconnect flow: deregister at Junction, mark locally. Historical
    samples are retained (product decision: data belongs to the user)."""
    connection = (
        await db.execute(
            select(Connection).where(Connection.user_id == user.id, Connection.provider == provider)
        )
    ).scalar_one_or_none()
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not connected")

    try:
        await junction.deregister_provider(_require_junction_id(user), provider)
    except JunctionError as exc:
        if exc.status_code != 404:  # already gone at Junction is fine
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=exc.detail) from exc

    from datetime import UTC, datetime

    connection.status = ConnectionStatus.disconnected
    connection.disconnected_at = datetime.now(UTC)
    await db.commit()
    logger.info("device_disconnected", user_id=str(user.id), provider=provider)
