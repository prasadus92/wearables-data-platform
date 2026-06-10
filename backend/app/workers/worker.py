"""ARQ worker: webhook event processing and historical backfills.

Run with: ``arq app.workers.worker.WorkerSettings``

Horizontal scaling story: workers are stateless consumers. Under load you
add worker replicas, not API replicas. Idempotent sample upserts make ARQ's
at-least-once delivery safe.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.session import db_session
from app.models import User, WebhookEvent, WebhookEventStatus
from app.services.events import publish_samples_written
from app.services.ingestion import (
    RESOURCE_TO_METRIC,
    IngestPlan,
    apply_plan,
    parse_event,
)
from app.services.junction import JunctionClient
from app.workers.queue import enqueue_backfill, redis_settings

logger = get_logger(__name__)


async def _resolve_user(session, plan: IngestPlan) -> User | None:
    if plan.junction_user_id:
        user = (
            await session.execute(
                select(User).where(User.junction_user_id == plan.junction_user_id)
            )
        ).scalar_one_or_none()
        if user:
            return user
    if plan.client_user_id:
        return (
            await session.execute(select(User).where(User.client_user_id == plan.client_user_id))
        ).scalar_one_or_none()
    return None


async def process_webhook_event(ctx: dict[str, Any], webhook_event_id: str) -> str:
    """Parse a persisted raw event and apply it to the domain model."""
    async with db_session() as session:
        event = (
            await session.execute(
                select(WebhookEvent).where(WebhookEvent.id == uuid.UUID(webhook_event_id))
            )
        ).scalar_one_or_none()
        if event is None:
            return "missing"
        if event.status == WebhookEventStatus.processed:
            return "already-processed"

        try:
            plan = parse_event(event.payload)

            if plan.is_noop:
                event.status = WebhookEventStatus.skipped
                event.processed_at = datetime.now(UTC)
                await session.commit()
                return "skipped"

            user = await _resolve_user(session, plan)
            if user is None:
                # Data for a user we don't know (e.g. created directly in the
                # Junction dashboard). Park it as failed for replay once the
                # user exists. Never drop silently.
                event.status = WebhookEventStatus.failed
                event.error = (
                    f"unknown user junction={plan.junction_user_id} client={plan.client_user_id}"
                )
                await session.commit()
                logger.warning("webhook_unknown_user", event_type=plan.event_type)
                return "unknown-user"

            written = await apply_plan(session, user.id, plan)

            if plan.backfill is not None:
                await enqueue_backfill(
                    str(user.id),
                    plan.backfill.resource,
                    plan.backfill.provider,
                    plan.backfill.start_date,
                    plan.backfill.end_date,
                )

            event.status = WebhookEventStatus.processed
            event.processed_at = datetime.now(UTC)
            await session.commit()

            if written:
                await publish_samples_written(
                    ctx["redis"], user.id, {s.metric for s in plan.samples}, written
                )

            logger.info(
                "event_processed",
                event_type=plan.event_type,
                samples=written,
                user_id=str(user.id),
            )
            return f"processed:{written}"
        except Exception as exc:
            await session.rollback()
            event.status = WebhookEventStatus.failed
            event.error = str(exc)[:1000]
            await session.commit()
            logger.exception("event_failed", event_id=str(event.id))
            raise  # let ARQ retry


async def process_backfill(
    ctx: dict[str, Any],
    user_id: str,
    resource: str,
    provider: str,
    start_date: str,
    end_date: str,
) -> str:
    """Pull historical timeseries from Junction's REST API and upsert it.

    Triggered by ``historical.data.{resource}.created`` events, which are
    data-less notifications. Pages through the cursor until exhausted.
    """
    total = 0
    cursor: str | None = None

    async with db_session() as session:
        user = (
            await session.execute(select(User).where(User.id == uuid.UUID(user_id)))
        ).scalar_one_or_none()
        if user is None or not user.junction_user_id:
            return "missing-user"

        # Pull from the Junction environment this user lives in.
        junction: JunctionClient = ctx["junction_clients"][user.junction_environment]

        while True:
            page = await junction.get_timeseries(
                user.junction_user_id,
                resource,
                start_date,
                end_date,
                provider=provider,
                next_cursor=cursor,
            )
            # Grouped response: {"groups": {provider: [{"data": [...], "source": {...}}]}}
            groups = page.get("groups", {}) if isinstance(page, dict) else {}
            for provider_slug, series_list in groups.items():
                for series in series_list:
                    plan = parse_event(
                        {
                            "event_type": f"daily.data.{resource}.created",
                            "user_id": user.junction_user_id,
                            "data": {
                                "data": series.get("data", []),
                                "source": {"slug": provider_slug},
                            },
                        }
                    )
                    total += await apply_plan(session, user.id, plan)
            await session.commit()

            cursor = page.get("next_cursor") if isinstance(page, dict) else None
            if not cursor:
                break

    if total and resource in RESOURCE_TO_METRIC:
        await publish_samples_written(ctx["redis"], user_id, {RESOURCE_TO_METRIC[resource]}, total)

    logger.info("backfill_done", resource=resource, provider=provider, samples=total)
    return f"backfilled:{total}"


async def startup(ctx: dict[str, Any]) -> None:
    configure_logging()
    from app.core.config import JunctionEnvironment

    ctx["junction_clients"] = {
        str(env): JunctionClient(environment=env) for env in JunctionEnvironment
    }
    logger.info("worker_started", environment=get_settings().environment)


async def shutdown(ctx: dict[str, Any]) -> None:
    for client in ctx["junction_clients"].values():
        await client.aclose()


class WorkerSettings:
    functions = [process_webhook_event, process_backfill]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = redis_settings()
    max_jobs = 50
    job_timeout = 120
    max_tries = 5
    health_check_interval = 30


# Sanity guard: every resource we normalize must have a metric mapping.
assert all(r in RESOURCE_TO_METRIC for r in RESOURCE_TO_METRIC)
