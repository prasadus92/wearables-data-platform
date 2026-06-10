"""Activity endpoints: a user's recent activity, summarized.

The feed is a union of two sources rendered into one shape:

- ``webhook_events``: raw ingestion events (readings, backfills) whose
  ownership lives inside the JSONB payload.
- ``device_events``: the lifecycle ledger (connects, disconnects, identity
  transitions), keyed by user_id and surfaced as ``lifecycle.*`` entries.
"""

from fastapi import APIRouter, Query
from sqlalchemy import or_, select

from app.api.deps import CurrentUser, DbSession
from app.models import DeviceEvent, WebhookEvent, WebhookEventStatus
from app.schemas import EventOut
from app.services.activity import summarize_device_event, summarize_event

router = APIRouter(prefix="/users/{user_id}/events", tags=["events"])


@router.get("", response_model=list[EventOut])
async def list_events(
    user: CurrentUser,
    db: DbSession,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[EventOut]:
    """Recent activity relevant to this user, newest first.

    ``webhook_events`` stores events for every user; ownership lives inside
    the payload, so the filter matches the payload's identity fields against
    this user's Aggregator identity (either alias). Ledger entries already
    carry user_id and merge in as ``lifecycle.*`` rows.
    """
    conditions = [WebhookEvent.payload["client_user_id"].astext == user.client_user_id]
    if user.aggregator_user_id:
        conditions.append(WebhookEvent.payload["user_id"].astext == user.aggregator_user_id)

    webhook_rows = (
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
    ledger_rows = (
        (
            await db.execute(
                select(DeviceEvent)
                .where(DeviceEvent.user_id == user.id)
                .order_by(DeviceEvent.occurred_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    merged = [
        EventOut(
            id=event.id,
            event_type=event.event_type,
            status=event.status,
            received_at=event.received_at,
            processed_at=event.processed_at,
            summary=summarize_event(event.payload),
        )
        for event in webhook_rows
    ] + [
        EventOut(
            id=entry.id,
            event_type=f"lifecycle.{entry.event}",
            status=WebhookEventStatus.processed,
            received_at=entry.occurred_at,
            processed_at=entry.occurred_at,
            summary=summarize_device_event(entry.event, entry.provider),
        )
        for entry in ledger_rows
    ]
    merged.sort(key=lambda e: e.received_at, reverse=True)
    return merged[:limit]
