"""Queue plumbing (ARQ on Redis).

The API process only enqueues; the worker process (``app.workers.worker``)
consumes. Job functions are referenced by name so the API never imports
worker code.
"""

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.core.config import get_settings

_pool: ArqRedis | None = None


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(get_settings().redis_url)


async def get_queue() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(redis_settings())
    return _pool


async def enqueue_process_event(webhook_event_id: str) -> None:
    """Queue normalization of one persisted raw webhook event."""
    queue = await get_queue()
    # Job id = event id -> a double-enqueue collapses into one job.
    await queue.enqueue_job(
        "process_webhook_event", webhook_event_id, _job_id=f"evt-{webhook_event_id}"
    )


async def enqueue_backfill(
    user_id: str,
    resource: str,
    provider: str,
    start_date: str,
    end_date: str,
    defer_seconds: int = 0,
) -> None:
    """Queue a historical pull of one resource/provider over a date range.

    The job id folds in user, resource, provider and the full date range.
    Webhook-driven backfills carry the vendor's fixed range, so delivery
    retries still collapse into one job; user-initiated syncs carry a fresh
    end timestamp and therefore always run, even when an earlier identical
    window failed (the queue refuses re-enqueues while a previous result for
    the same id is retained). The upserts keep any overlap idempotent.
    """
    queue = await get_queue()
    await queue.enqueue_job(
        "process_backfill",
        user_id,
        resource,
        provider,
        start_date,
        end_date,
        _job_id=f"bf-{user_id}-{resource}-{provider}-{start_date}-{end_date}-d{defer_seconds}",
        _defer_by=defer_seconds or None,
    )
