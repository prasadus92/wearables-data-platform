"""Timeseries endpoints: the read path behind the app's timeline charts."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession
from app.models import Metric
from app.schemas import Resolution, TimeseriesOut
from app.services.timeseries import query_timeseries

router = APIRouter(prefix="/users/{user_id}/timeseries", tags=["timeseries"])

MAX_RAW_WINDOW = timedelta(days=7)


@router.get("/{metric}", response_model=TimeseriesOut)
async def get_timeseries(
    metric: Metric,
    user: CurrentUser,
    db: DbSession,
    start: datetime | None = Query(
        default=None, description="Range start (ISO 8601, default: end - 7d)"
    ),
    end: datetime | None = Query(default=None, description="Range end (ISO 8601, default: now)"),
    resolution: Resolution = Query(default=Resolution.hour),
    provider: str | None = Query(default=None, description="Filter to one provider slug"),
) -> TimeseriesOut:
    end = (end or datetime.now(UTC)).astimezone(UTC)
    start = (start or end - timedelta(days=7)).astimezone(UTC)
    if start >= end:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="start must be before end"
        )
    if resolution == Resolution.raw and end - start > MAX_RAW_WINDOW:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"raw resolution is limited to {MAX_RAW_WINDOW.days} days; use hour/day/week",
        )

    points, unit = await query_timeseries(
        db, user.id, metric, start, end, resolution, provider=provider
    )
    return TimeseriesOut(
        metric=metric, unit=unit, resolution=resolution, start=start, end=end, points=points
    )
