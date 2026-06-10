"""Integration: SSE live-update stream.

The stream is tested at the generator seam (real Redis pub/sub) because
httpx's ASGITransport buffers responses and cannot consume an infinite
event-stream. The HTTP layer above it is a one-line StreamingResponse.
"""

import asyncio
import uuid

import pytest
import redis.asyncio as aioredis

from app.core.config import get_settings
from app.models import Metric
from app.services.events import publish_samples_written, sse_stream

pytestmark = pytest.mark.integration


async def test_update_event_reaches_subscriber():
    user_id = uuid.uuid4()
    redis = aioredis.from_url(get_settings().redis_url)

    async def consume() -> list[str]:
        frames: list[str] = []
        async for frame in sse_stream(user_id):
            frames.append(frame)
            if frame.startswith("event: update"):
                return frames
        return frames

    async def produce() -> None:
        await asyncio.sleep(0.3)  # let the subscriber attach
        await publish_samples_written(redis, user_id, {Metric.heartrate}, 42)

    frames, _ = await asyncio.wait_for(asyncio.gather(consume(), produce()), timeout=10)
    await redis.aclose()

    assert frames[0].startswith("event: connected")
    update = frames[-1]
    assert update.startswith("event: update")
    assert '"heartrate"' in update
    assert '"count": 42' in update


async def test_no_cross_user_leakage():
    """Events published for one user never reach another user's stream."""
    listener_id, other_id = uuid.uuid4(), uuid.uuid4()
    redis = aioredis.from_url(get_settings().redis_url)

    async def consume() -> list[str]:
        frames: list[str] = []
        stream = sse_stream(listener_id)
        async for frame in stream:
            frames.append(frame)
            if frame.startswith("event: update"):
                return frames  # would mean leakage
            if len(frames) >= 2:
                return frames
        return frames

    async def produce() -> None:
        await asyncio.sleep(0.2)
        await publish_samples_written(redis, other_id, {Metric.hrv}, 7)
        # Then one legit event so the consumer terminates deterministically.
        await asyncio.sleep(0.2)
        await publish_samples_written(redis, listener_id, {Metric.spo2}, 1)

    frames, _ = await asyncio.wait_for(asyncio.gather(consume(), produce()), timeout=10)
    await redis.aclose()

    updates = [f for f in frames if f.startswith("event: update")]
    assert len(updates) == 1
    assert '"spo2"' in updates[0]
    assert '"hrv"' not in updates[0]
