"""Normalization of Junction webhook events into our domain model.

Split into two halves:

1. **Pure parsing** (`parse_event`): takes a raw Junction event payload and
   returns an :class:`IngestPlan` describing what should happen (samples to
   upsert, connection changes, backfills to schedule). No I/O, so it is
   trivially unit-testable against payload fixtures.
2. **Persistence** (`apply_plan`): executes a plan against the database with
   idempotent ``INSERT … ON CONFLICT`` writes, so Junction's webhook retries
   (8 attempts) and overlapping backfills never duplicate data.

Junction event reference (see docs/junction-notes.md):

- ``daily.data.{resource}.created|updated``: incremental samples, batched at
  ``$.data.data`` as ``{timestamp, timezone_offset, unit, value}``; source at
  ``$.data.source {name, slug}``. NB: "daily" is a misnomer (this is a
  stream, multiple events per resource per day).
- ``historical.data.{resource}.created``: data-less backfill notification
  (``data: {user_id, start_date, end_date, provider}``); data must be pulled
  via the REST timeseries endpoint.
- ``daily.data.sleep.created|updated``: sleep summary objects. Real rings and
  straps (Oura, WHOOP) deliver sleeping HR, HRV and breathing rate inside the
  sleep summary, never as standalone timeseries resources, so each session is
  flattened into up to three nightly samples stamped at wake time.
- ``provider.connection.created`` / ``provider.connection.error``: connection
  lifecycle.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models import (
    Connection,
    ConnectionStatus,
    DeviceEventActor,
    DeviceEventType,
    Metric,
    Sample,
)
from app.services.ledger import record_device_event

logger = get_logger(__name__)

# Junction resource slug -> our metric. blood_oxygen is Junction's name for SpO2.
RESOURCE_TO_METRIC: dict[str, Metric] = {
    "heartrate": Metric.heartrate,
    "hrv": Metric.hrv,
    "blood_oxygen": Metric.spo2,
    "respiratory_rate": Metric.respiratory_rate,
    "blood_pressure": Metric.blood_pressure,
}

DEFAULT_UNITS: dict[Metric, str] = {
    Metric.heartrate: "bpm",
    Metric.hrv: "ms",
    Metric.spo2: "%",
    Metric.respiratory_rate: "breaths/min",
    Metric.blood_pressure: "mmHg",
}

# Sleep summaries are a resource of their own: not in RESOURCE_TO_METRIC
# because one session fans out into several metrics.
SLEEP_RESOURCE = "sleep"


@dataclass(frozen=True)
class NormalizedSample:
    metric: Metric
    ts: datetime
    value: float
    value_secondary: float | None
    unit: str
    provider: str


@dataclass(frozen=True)
class ConnectionChange:
    provider: str
    status: ConnectionStatus
    device_meta: dict | None = None


@dataclass(frozen=True)
class BackfillRequest:
    resource: str
    provider: str
    start_date: str
    end_date: str


@dataclass
class IngestPlan:
    """Everything a single webhook event implies. ``junction_user_id`` /
    ``client_user_id`` identify whose data this is."""

    event_type: str
    junction_user_id: str | None
    client_user_id: str | None
    samples: list[NormalizedSample] = field(default_factory=list)
    connection_change: ConnectionChange | None = None
    backfill: BackfillRequest | None = None

    @property
    def is_noop(self) -> bool:
        return not self.samples and self.connection_change is None and self.backfill is None


def _parse_timestamp(raw: str | int | float) -> datetime:
    if isinstance(raw, int | float):  # epoch seconds
        return datetime.fromtimestamp(raw, tz=UTC)
    dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _parse_samples(resource: str, data: dict, provider: str) -> list[NormalizedSample]:
    metric = RESOURCE_TO_METRIC[resource]
    default_unit = DEFAULT_UNITS[metric]
    out: list[NormalizedSample] = []
    for point in data.get("data", []):
        if "timestamp" not in point:
            continue
        ts = _parse_timestamp(point["timestamp"])
        unit = point.get("unit") or default_unit
        if metric is Metric.blood_pressure and "systolic" in point:
            # Compound shape: {timestamp, systolic, diastolic, unit}
            out.append(
                NormalizedSample(
                    metric=metric,
                    ts=ts,
                    value=float(point["systolic"]),
                    value_secondary=(
                        float(point["diastolic"]) if point.get("diastolic") is not None else None
                    ),
                    unit=unit,
                    provider=provider,
                )
            )
        elif point.get("value") is not None:
            out.append(
                NormalizedSample(
                    metric=metric,
                    ts=ts,
                    value=float(point["value"]),
                    value_secondary=None,
                    unit=unit,
                    provider=provider,
                )
            )
    return out


def _sleep_payload_sessions(data: object) -> list[dict]:
    """Extract sleep summary objects from a webhook ``data`` payload.

    Junction has shipped both a bare sleep object and a wrapped
    ``{"data": [...]}`` batch for summary resources, so accept a single
    object, a list, or a wrapped list/object.
    """
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        inner = data.get("data")
        if isinstance(inner, list):
            return [item for item in inner if isinstance(item, dict)]
        if isinstance(inner, dict):
            return [inner]
        return [data]
    return []


def _sleep_session_samples(sleep: dict) -> list[NormalizedSample]:
    """Flatten one sleep summary into up to three nightly samples.

    Timestamped at ``bedtime_stop`` (wake time), falling back to ``date``.
    Heart rate prefers ``hr_lowest``, then ``hr_resting``, then ``hr_average``
    because WHOOP reports only the resting figure for sleep sessions.
    Every field can be None per provider; missing values simply yield no
    sample for that metric.
    """
    raw_ts = sleep.get("bedtime_stop") or sleep.get("date")
    if not raw_ts:
        return []
    try:
        ts = _parse_timestamp(raw_ts)
    except (TypeError, ValueError):
        return []

    source = sleep.get("source") or {}
    provider = source.get("provider") or _extract_provider(sleep)

    # The vendor's own app headlines its resting number (Oura: lowest,
    # WHOOP: resting); charting the same value keeps every comparison a
    # user makes against their device app exact. Averages are the last
    # resort, never the preference.
    heartrate = sleep.get("hr_lowest")
    if heartrate is None:
        heartrate = sleep.get("hr_resting")
    if heartrate is None:
        heartrate = sleep.get("hr_average")

    candidates: list[tuple[Metric, object, str]] = [
        (Metric.heartrate, heartrate, "bpm"),
        (Metric.hrv, sleep.get("average_hrv"), "ms"),
        (Metric.respiratory_rate, sleep.get("respiratory_rate"), "breaths/min"),
    ]
    return [
        NormalizedSample(
            metric=metric,
            ts=ts,
            value=float(value),  # type: ignore[arg-type]
            value_secondary=None,
            unit=unit,
            provider=provider,
        )
        for metric, value, unit in candidates
        if value is not None
    ]


def parse_event(payload: dict) -> IngestPlan:
    """Translate one raw Junction webhook payload into an :class:`IngestPlan`.

    Unknown or irrelevant event types yield a no-op plan (recorded as
    ``skipped``), never an error. Junction adds event types over time and an
    unknown event must not poison the queue.
    """
    event_type: str = payload.get("event_type", "")
    data: dict = payload.get("data") or {}
    junction_user_id = payload.get("user_id") or data.get("user_id")
    client_user_id = payload.get("client_user_id")
    plan = IngestPlan(
        event_type=event_type,
        junction_user_id=junction_user_id,
        client_user_id=client_user_id,
    )

    parts = event_type.split(".")

    # daily.data.{resource}.{created|updated}: incremental samples
    if len(parts) == 4 and parts[0] == "daily" and parts[1] == "data":
        resource = parts[2]
        if resource == SLEEP_RESOURCE:
            sessions = _sleep_payload_sessions(data)
            plan.samples = [
                sample for sleep in sessions for sample in _sleep_session_samples(sleep)
            ]
            logger.info(
                "sleep_sessions_parsed",
                event_type=event_type,
                sessions=len(sessions),
                samples=len(plan.samples),
            )
        elif resource in RESOURCE_TO_METRIC:
            provider = _extract_provider(data)
            plan.samples = _parse_samples(resource, data, provider)
        return plan

    # historical.data.{resource}.created: schedule a REST backfill
    if len(parts) == 4 and parts[0] == "historical" and parts[1] == "data":
        resource = parts[2]
        if (
            (resource in RESOURCE_TO_METRIC or resource == SLEEP_RESOURCE)
            and data.get("start_date")
            and data.get("end_date")
        ):
            plan.backfill = BackfillRequest(
                resource=resource,
                provider=_extract_provider(data),
                start_date=str(data["start_date"]),
                end_date=str(data["end_date"]),
            )
        return plan

    if event_type == "provider.connection.created":
        provider_info = data.get("provider") or {}
        plan.connection_change = ConnectionChange(
            provider=provider_info.get("slug") or _extract_provider(data),
            status=ConnectionStatus.connected,
            device_meta={
                "name": provider_info.get("name"),
                "logo": provider_info.get("logo"),
                "resource_availability": data.get("resource_availability"),
            },
        )
        return plan

    if event_type == "provider.connection.error":
        plan.connection_change = ConnectionChange(
            provider=_extract_provider(data),
            status=ConnectionStatus.expired,
        )
        return plan

    return plan  # unknown event -> no-op


def _extract_provider(data: dict) -> str:
    source = data.get("source") or {}
    provider = data.get("provider")
    if isinstance(provider, dict):
        return provider.get("slug") or "unknown"
    return source.get("slug") or source.get("provider") or provider or "unknown"


# --- Persistence ---


async def apply_plan(session: AsyncSession, user_id: uuid.UUID, plan: IngestPlan) -> int:
    """Execute a plan for our internal ``user_id``. Returns samples written.

    All sample writes are idempotent upserts on the natural key
    (user_id, metric, ts, provider).
    """
    written = 0
    if plan.samples:
        rows = [
            {
                "user_id": user_id,
                "metric": s.metric,
                "ts": s.ts,
                "provider": s.provider,
                "value": s.value,
                "value_secondary": s.value_secondary,
                "unit": s.unit,
                "source_type": "wearable",
            }
            for s in plan.samples
        ]
        stmt = pg_insert(Sample).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["user_id", "metric", "ts", "provider"],
            set_={
                "value": stmt.excluded.value,
                "value_secondary": stmt.excluded.value_secondary,
                "unit": stmt.excluded.unit,
            },
        )
        await session.execute(stmt)
        written = len(rows)

        # Freshness drives the app's "sync issues" banner.
        latest = max(s.ts for s in plan.samples)
        providers = {s.provider for s in plan.samples}
        await session.execute(
            update(Connection)
            .where(Connection.user_id == user_id, Connection.provider.in_(providers))
            .values(last_data_at=latest)
        )

    if plan.connection_change is not None:
        change = plan.connection_change
        now = datetime.now(UTC)

        # Junction-delivered connection events go into the lifecycle ledger
        # (actor: webhook). Local event types (demo connect, sync reconcile)
        # are excluded here; the endpoints that own those transitions write
        # their own entries with the right actor.
        ledger_event: DeviceEventType | None = None
        if plan.event_type == "provider.connection.created":
            prior = (
                await session.execute(
                    select(Connection.status).where(
                        Connection.user_id == user_id,
                        Connection.provider == change.provider,
                    )
                )
            ).scalar_one_or_none()
            ledger_event = (
                DeviceEventType.reconnected
                if prior in (ConnectionStatus.expired, ConnectionStatus.disconnected)
                else DeviceEventType.connected
            )
        elif plan.event_type == "provider.connection.error":
            ledger_event = DeviceEventType.expired
        if ledger_event is not None:
            record_device_event(
                session,
                user_id,
                ledger_event,
                DeviceEventActor.webhook,
                provider=change.provider,
                junction_user_id=plan.junction_user_id,
            )

        stmt = pg_insert(Connection).values(
            user_id=user_id,
            provider=change.provider,
            status=change.status,
            device_meta=change.device_meta,
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_connection_user_provider",
            set_={
                "status": change.status,
                "device_meta": change.device_meta
                if change.device_meta is not None
                else Connection.device_meta,
                "disconnected_at": now if change.status == ConnectionStatus.disconnected else None,
            },
        )
        await session.execute(stmt)

    return written
