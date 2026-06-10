"""Inbound Aggregator webhooks.

Design constraints (from Aggregator's delivery semantics):

- 15-second response timeout, 8 retries, endpoint auto-disabled after
  sustained failures → we must ACK fast. The handler does the minimum:
  verify signature, persist the raw event, enqueue, return 202.
- Retries redeliver with the same ``svix-id`` → unique constraint on
  ``event_id`` makes redelivery a cheap no-op.
- Heart-rate events can batch thousands of samples (multi-MB bodies) →
  parsing/normalization happens in the worker, never in the request path.
"""

import json

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy.dialects.postgresql import insert as pg_insert
from svix.webhooks import Webhook, WebhookVerificationError

from app.api.deps import DbSession
from app.core.config import get_settings
from app.core.logging import get_logger
from app.models import WebhookEvent
from app.workers.queue import enqueue_process_event

logger = get_logger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def verify_signature(raw_body: bytes, headers) -> None:
    """Svix HMAC-SHA256 verification. Raises 401 on bad/missing signature.

    Aggregator signs per webhook endpoint, and each environment (sandbox,
    production) registers its own endpoint with its own secret. Both point
    at this route, so verification accepts a signature from any configured
    secret. Skipped only when no secret is configured (local tests).
    """
    secrets = get_settings().webhook_secrets
    if not secrets:
        return
    header_dict = dict(headers)
    for secret in secrets:
        try:
            Webhook(secret).verify(raw_body, header_dict)
            return
        except WebhookVerificationError:
            continue
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook signature")


@router.post("/aggregator", status_code=status.HTTP_202_ACCEPTED)
async def aggregator_webhook(request: Request, db: DbSession) -> dict:
    raw_body = await request.body()
    verify_signature(raw_body, request.headers)

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid JSON") from exc

    event_type = payload.get("event_type", "unknown")
    # Svix message id is stable across retries; fall back to a payload hash
    # so unsigned local testing still dedupes.
    event_id = request.headers.get("svix-id") or f"sha:{hash(raw_body)}"

    stmt = (
        pg_insert(WebhookEvent)
        .values(event_id=event_id, event_type=event_type, payload=payload)
        .on_conflict_do_nothing(index_elements=["event_id"])
        .returning(WebhookEvent.id)
    )
    inserted_id = (await db.execute(stmt)).scalar_one_or_none()
    await db.commit()

    if inserted_id is None:  # retry of an event we already have
        logger.info("webhook_duplicate", event_id=event_id, event_type=event_type)
        return {"status": "duplicate"}

    await enqueue_process_event(str(inserted_id))
    logger.info("webhook_accepted", event_id=event_id, event_type=event_type)
    return {"status": "accepted"}
