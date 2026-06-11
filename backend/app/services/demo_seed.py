"""Synthetic readings so a fresh demo dashboard is full at first paint.

Demo mode is synthetic end to end. Junction's demo wearable streams heart
rate, HRV, and blood oxygen through the real webhook pipeline, which takes
up to a minute to backfill; seeding all five biomarkers here means the
charts carry data the moment the demo identity exists, and the live webhook
stream then lands on top. Values follow a small deterministic walk derived
from the user id, so reseeding is stable and the idempotent sample upsert
makes repeat calls harmless.
"""

import hashlib
import math
import uuid
from datetime import UTC, datetime, time, timedelta

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models import Metric
from app.services.events import publish_samples_written
from app.services.ingestion import IngestPlan, NormalizedSample, apply_plan

logger = get_logger(__name__)

DEMO_PROVIDER = "demo"
SEED_DAYS = 30


def _walk(seed: int, day: int, amplitude: float) -> float:
    """Smooth deterministic wobble in [-amplitude, amplitude]."""
    return amplitude * (
        0.6 * math.sin(day / 2.9 + seed % 7) + 0.4 * math.sin(day / 1.3 + seed % 13)
    )


def synth_samples(user_key: str, now: datetime | None = None) -> list[NormalizedSample]:
    """Thirty days of all five biomarkers, plus hourly heart rate for the
    last two days so the 24h view has texture."""
    now = now or datetime.now(UTC)
    seed = int(hashlib.sha256(user_key.encode()).hexdigest()[:8], 16)
    samples: list[NormalizedSample] = []
    for day in range(SEED_DAYS, 0, -1):
        date = (now - timedelta(days=day)).date()
        wake = datetime.combine(date, time(7, 12), tzinfo=UTC)
        daily = [
            (
                Metric.respiratory_rate,
                wake,
                round(14.6 + _walk(seed, day, 0.9), 2),
                None,
                "breaths/min",
            ),
            (
                Metric.blood_pressure,
                datetime.combine(date, time(8, 0), tzinfo=UTC),
                round(117 + _walk(seed + 1, day, 5.0)),
                round(76 + _walk(seed + 2, day, 3.5)),
                "mmHg",
            ),
            (
                Metric.heartrate,
                datetime.combine(date, time(7, 30), tzinfo=UTC),
                round(62 + _walk(seed + 3, day, 7.0)),
                None,
                "bpm",
            ),
            (Metric.hrv, wake, round(48 + _walk(seed + 4, day, 12.0), 1), None, "ms"),
            (Metric.spo2, wake, round(97.6 + _walk(seed + 5, day, 0.8), 1), None, "%"),
        ]
        for metric, ts, value, secondary, unit in daily:
            samples.append(
                NormalizedSample(
                    metric=metric,
                    ts=ts,
                    value=float(value),
                    value_secondary=float(secondary) if secondary is not None else None,
                    unit=unit,
                    provider=DEMO_PROVIDER,
                )
            )
    # Hourly heart rate for the last 48 hours: the 24h view needs texture.
    hour_cursor = now.replace(minute=0, second=0, microsecond=0)
    for h in range(48, 0, -1):
        ts = hour_cursor - timedelta(hours=h)
        circadian = 8 * math.sin((ts.hour - 4) / 24 * 2 * math.pi)
        samples.append(
            NormalizedSample(
                metric=Metric.heartrate,
                ts=ts,
                value=round(68 + circadian + _walk(seed + 6, h, 5.0)),
                value_secondary=None,
                unit="bpm",
                provider=DEMO_PROVIDER,
            )
        )
    return samples


async def seed_demo_extras(db: AsyncSession, user_id: uuid.UUID, client_user_id: str) -> int:
    """Upsert the synthetic extras for one demo user. Returns samples written."""
    plan = IngestPlan(
        event_type="local.demo.seeded",
        junction_user_id=None,
        client_user_id=client_user_id,
        samples=synth_samples(client_user_id),
    )
    written = await apply_plan(db, user_id, plan)
    await db.commit()
    if written:
        # Nudge any open timeline so the seeded charts fill immediately.
        client = aioredis.from_url(get_settings().redis_url, decode_responses=True)
        try:
            await publish_samples_written(client, user_id, set(Metric), written)
        finally:
            await client.aclose()
    logger.info("demo_extras_seeded", user_id=str(user_id), samples=written)
    return written
