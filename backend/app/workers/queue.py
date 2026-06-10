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
    queue = await get_queue()
    # Job id = event id -> a double-enqueue collapses into one job.
    await queue.enqueue_job(
        "process_webhook_event", webhook_event_id, _job_id=f"evt-{webhook_event_id}"
    )


async def enqueue_backfill(
    user_id: str, resource: str, provider: str, start_date: str, end_date: str
) -> None:
    queue = await get_queue()
    await queue.enqueue_job(
        "process_backfill",
        user_id,
        resource,
        provider,
        start_date,
        end_date,
        _job_id=f"bf-{user_id}-{resource}-{provider}-{start_date}",
    )
