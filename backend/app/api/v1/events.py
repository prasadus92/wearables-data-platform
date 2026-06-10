"""Activity endpoints: a user's recent ingestion events, summarized."""

from fastapi import APIRouter, Query
from sqlalchemy import or_, select

from app.api.deps import CurrentUser, DbSession
from app.models import WebhookEvent
from app.schemas import EventOut
from app.services.activity import summarize_event

router = APIRouter(prefix="/users/{user_id}/events", tags=["events"])


@router.get("", response_model=list[EventOut])
async def list_events(
    user: CurrentUser,
    db: DbSession,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[EventOut]:
    """Recent raw ingestion events relevant to this user, newest first.

    ``webhook_events`` stores events for every user; ownership lives inside
    the payload, so the filter matches the payload's identity fields against
    this user's Junction identity (either alias).
    """
    conditions = [WebhookEvent.payload["client_user_id"].astext == user.client_user_id]
    if user.junction_user_id:
        conditions.append(WebhookEvent.payload["user_id"].astext == user.junction_user_id)

    rows = (
        (
            await db.execute(
                select(WebhookEvent)
                .where(or_(*conditions))
                .order_by(WebhookEvent.received_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [
        EventOut(
            id=event.id,
            event_type=event.event_type,
            status=event.status,
            received_at=event.received_at,
            processed_at=event.processed_at,
            summary=summarize_event(event.payload),
        )
        for event in rows
    ]
