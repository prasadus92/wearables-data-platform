"""Lifecycle ledger writes.

One tiny seam shared by every code path that changes a user's device or
identity state. Entries are appended to ``device_events`` inside the
caller's transaction; the caller commits, so a transition and its ledger
entry land (or roll back) together.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DeviceEvent, DeviceEventActor, DeviceEventType


def record_device_event(
    session: AsyncSession,
    user_id: uuid.UUID,
    event: DeviceEventType | str,
    actor: DeviceEventActor | str,
    *,
    provider: str | None = None,
    junction_user_id: str | None = None,
    detail: dict | None = None,
) -> DeviceEvent:
    """Append one transition to the ledger. No commit; the caller owns it."""
    entry = DeviceEvent(
        user_id=user_id,
        event=str(event),
        actor=str(actor),
        provider=provider,
        junction_user_id=junction_user_id,
        detail=detail,
    )
    session.add(entry)
    return entry
