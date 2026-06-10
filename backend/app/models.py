"""Database schema.

Four tables, designed for write-heavy ingestion and range-scan reads:

- ``users``            — app users mapped 1:1 to a Junction user.
- ``connections``      — a user's link to one wearable provider (whoop, oura…).
- ``webhook_events``   — raw inbound Junction events. Source of truth for
                         idempotency (unique event id) and replay/debugging.
- ``samples``          — normalized biometric time series. One row per
                         (user, metric, timestamp, provider); webhook retries
                         and overlapping backfills upsert harmlessly.

``samples`` is the hot table. It is partition-friendly (composite PK leads
with ``user_id``; time-range queries hit the ``ix_samples_query`` index) and
maps directly onto a TimescaleDB hypertable when we outgrow vanilla Postgres.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Metric(enum.StrEnum):
    """Biomarkers in scope for the MVP (challenge requirement)."""

    heartrate = "heartrate"
    hrv = "hrv"
    spo2 = "spo2"
    respiratory_rate = "respiratory_rate"
    blood_pressure = "blood_pressure"  # value=systolic, value_secondary=diastolic


class ConnectionStatus(enum.StrEnum):
    connected = "connected"
    expired = "expired"
    disconnected = "disconnected"


class WebhookEventStatus(enum.StrEnum):
    received = "received"
    processed = "processed"
    failed = "failed"
    skipped = "skipped"  # not a data event we care about


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Stable external identifier we hand to Junction as client_user_id.
    client_user_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    # Junction's id for this user; set after we register them with Junction.
    junction_user_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    connections: Mapped[list["Connection"]] = relationship(back_populates="user")


class Connection(Base):
    """A user's link to a wearable provider via Junction."""

    __tablename__ = "connections"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_connection_user_provider"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(64))  # junction provider slug, e.g. "whoop_v2"
    status: Mapped[ConnectionStatus] = mapped_column(
        Enum(ConnectionStatus, native_enum=False, length=32),
        default=ConnectionStatus.connected,
    )
    # Device metadata (model, OS version…) for the "track device meta" requirement.
    device_meta: Mapped[dict | None] = mapped_column(JSONB)
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Updated on every ingested sample; drives "sync issues" detection
    # (no data for N hours => surface a banner in the app).
    last_data_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disconnected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="connections")


class WebhookEvent(Base):
    """Raw Junction webhook payloads, persisted before processing.

    Persist-then-process gives us: idempotency (unique ``event_id``), an audit
    trail, and free replay when a normalizer bug needs a backfill.
    """

    __tablename__ = "webhook_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Svix message id (or provider event id) — webhook retries dedupe on this.
    event_id: Mapped[str] = mapped_column(String(255), unique=True)
    event_type: Mapped[str] = mapped_column(String(128), index=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[WebhookEventStatus] = mapped_column(
        Enum(WebhookEventStatus, native_enum=False, length=32),
        default=WebhookEventStatus.received,
        index=True,
    )
    error: Mapped[str | None] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Sample(Base):
    """One normalized biometric reading.

    The natural key (user, metric, ts, provider) is the primary key — there is
    no surrogate id to keep the hot table narrow. All writes are
    ``INSERT … ON CONFLICT DO UPDATE`` so retried webhooks and overlapping
    backfills are idempotent.
    """

    __tablename__ = "samples"
    __table_args__ = (
        # Serves the chart query: user's metric over a time range.
        Index("ix_samples_query", "user_id", "metric", "ts"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    metric: Mapped[Metric] = mapped_column(
        Enum(Metric, native_enum=False, length=32), primary_key=True
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), primary_key=True)

    value: Mapped[float] = mapped_column(Float)
    # Second component for compound metrics (blood pressure diastolic).
    value_secondary: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(32))
    # wearable | smartphone | lab — chart filter labels from the product spec.
    source_type: Mapped[str] = mapped_column(String(32), default="wearable")
