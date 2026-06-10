"""Live update notifications (server-sent events).

Workers publish a small notification to Redis pub/sub whenever new samples
land for a user. The API streams those to connected clients over SSE, so a
timeline chart updates the moment a webhook is processed instead of polling.

SSE over WebSockets is a deliberate choice: the flow is strictly
server-to-client, SSE rides plain HTTP (ALB-friendly, auto-reconnect built
into EventSource), and there is no client state to manage.
"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator

import redis.asyncio as aioredis

from app.core.config import get_settings
from app.models import Metric

CHANNEL_PREFIX = "user-updates:"
HEARTBEAT_SECONDS = 15


def channel_for(user_id: uuid.UUID | str) -> str:
    return f"{CHANNEL_PREFIX}{user_id}"


async def publish_samples_written(
    redis: aioredis.Redis, user_id: uuid.UUID | str, metrics: set[Metric], count: int
) -> None:
    """Notify listeners that fresh samples were written for these metrics."""
    payload = json.dumps(
        {"type": "samples", "metrics": sorted(m.value for m in metrics), "count": count}
    )
    await redis.publish(channel_for(user_id), payload)


async def sse_stream(user_id: uuid.UUID) -> AsyncIterator[str]:
    """Yield SSE frames for a user's update channel, with heartbeats.

    Heartbeats keep the connection alive through the ALB's idle timeout and
    let EventSource detect dead connections quickly.
    """
    client = aioredis.from_url(get_settings().redis_url, decode_responses=True)
    pubsub = client.pubsub()
    await pubsub.subscribe(channel_for(user_id))
    listener = pubsub.listen()
    try:
        yield "event: connected\ndata: {}\n\n"
        while True:
            try:
                message = await asyncio.wait_for(anext(listener), timeout=HEARTBEAT_SECONDS)
            except TimeoutError:
                yield ": heartbeat\n\n"
                continue
            if message["type"] == "message":
                yield f"event: update\ndata: {message['data']}\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        await pubsub.unsubscribe()
        await pubsub.aclose()
        await client.aclose()
