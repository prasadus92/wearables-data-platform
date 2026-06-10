"""Timeseries read path: range queries with optional time bucketing.

Charts never need 10,000 raw heart-rate points — the API buckets server-side
(``date_trunc`` on vanilla Postgres; swaps 1:1 for TimescaleDB
``time_bucket`` + continuous aggregates at scale). Blood pressure averages
systolic and diastolic independently.
"""

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Metric, Sample
from app.schemas import Resolution, TimeseriesPoint

_TRUNC = {Resolution.hour: "hour", Resolution.day: "day", Resolution.week: "week"}


async def query_timeseries(
    session: AsyncSession,
    user_id: uuid.UUID,
    metric: Metric,
    start: datetime,
    end: datetime,
    resolution: Resolution,
    provider: str | None = None,
) -> tuple[list[TimeseriesPoint], str]:
    """Return chart-ready points and the unit for the range."""
    filters = [
        Sample.user_id == user_id,
        Sample.metric == metric,
        Sample.ts >= start,
        Sample.ts < end,
    ]
    if provider:
        filters.append(Sample.provider == provider)

    if resolution == Resolution.raw:
        stmt = (
            select(Sample.ts, Sample.value, Sample.value_secondary, Sample.unit)
            .where(*filters)
            .order_by(Sample.ts)
            .limit(10_000)  # hard cap; clients should bucket beyond this
        )
        rows = (await session.execute(stmt)).all()
        points = [
            TimeseriesPoint(ts=ts, value=value, value_secondary=secondary)
            for ts, value, secondary, _unit in rows
        ]
        unit = rows[0][3] if rows else _default_unit(metric)
        return points, unit

    bucket = func.date_trunc(_TRUNC[resolution], Sample.ts).label("bucket")
    stmt = (
        select(
            bucket,
            func.avg(Sample.value),
            func.avg(Sample.value_secondary),
            func.max(Sample.unit),
        )
        .where(*filters)
        .group_by(bucket)
        .order_by(bucket)
    )
    rows = (await session.execute(stmt)).all()
    points = [
        TimeseriesPoint(
            ts=ts,
            value=round(value, 2),
            value_secondary=round(secondary, 2) if secondary is not None else None,
        )
        for ts, value, secondary, _unit in rows
    ]
    unit = rows[0][3] if rows else _default_unit(metric)
    return points, unit


def _default_unit(metric: Metric) -> str:
    from app.services.ingestion import DEFAULT_UNITS

    return DEFAULT_UNITS[metric]
