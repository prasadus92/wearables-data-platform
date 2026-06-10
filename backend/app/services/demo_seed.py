"""Synthetic readings for the metrics demo wearables never deliver.

Aggregator's demo wearables generate heart rate, HRV, and blood oxygen only.
Demo mode is synthetic end to end, so the remaining two biomarkers come from
here: thirty days of plausible breathing rate and blood pressure, seeded when
a demo wearable attaches. Values follow a small deterministic walk derived
from the user id, so reseeding is stable and the idempotent sample upsert
makes repeat calls harmless.
"""

import hashlib
import math
from datetime import UTC, datetime, time, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models import Metric
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
    """Thirty days of nightly breathing rate and morning blood pressure."""
    now = now or datetime.now(UTC)
    seed = int(hashlib.sha256(user_key.encode()).hexdigest()[:8], 16)
    samples: list[NormalizedSample] = []
    for day in range(SEED_DAYS, 0, -1):
        date = (now - timedelta(days=day)).date()
        wake = datetime.combine(date, time(7, 12), tzinfo=UTC)
        samples.append(
            NormalizedSample(
                metric=Metric.respiratory_rate,
                ts=wake,
                value=round(14.6 + _walk(seed, day, 0.9), 2),
                value_secondary=None,
                unit="breaths/min",
                provider=DEMO_PROVIDER,
            )
        )
        samples.append(
            NormalizedSample(
                metric=Metric.blood_pressure,
                ts=datetime.combine(date, time(8, 0), tzinfo=UTC),
                value=round(117 + _walk(seed + 1, day, 5.0)),
                value_secondary=round(76 + _walk(seed + 2, day, 3.5)),
                unit="mmHg",
                provider=DEMO_PROVIDER,
            )
        )
    return samples


async def seed_demo_extras(db: AsyncSession, user_id, client_user_id: str) -> int:
    """Upsert the synthetic extras for one demo user. Returns samples written."""
    plan = IngestPlan(
        event_type="local.demo.seeded",
        aggregator_user_id=None,
        client_user_id=client_user_id,
        samples=synth_samples(client_user_id),
    )
    written = await apply_plan(db, user_id, plan)
    await db.commit()
    logger.info("demo_extras_seeded", user_id=str(user_id), samples=written)
    return written
