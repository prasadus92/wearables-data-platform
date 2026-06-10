"""Pydantic schemas for the public API (request/response contracts)."""

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from app.models import ConnectionStatus, Metric, WebhookEventStatus


class Resolution(StrEnum):
    """Timeline chart bucket sizes."""

    raw = "raw"
    hour = "hour"
    day = "day"
    week = "week"


# --- Users ---


class AggregatorEnv(StrEnum):
    sandbox = "sandbox"
    production = "production"


class UserCreate(BaseModel):
    client_user_id: str = Field(min_length=1, max_length=255, examples=["wearables-app-user-42"])
    environment: AggregatorEnv | None = Field(
        default=None,
        description="Aggregator environment for this user (default: the service's primary one). "
        "sandbox = demo data, production = real devices.",
    )


class MeCreate(BaseModel):
    environment: AggregatorEnv | None = Field(
        default=None,
        description="Aggregator environment for this identity (default: the service's primary "
        "one). sandbox = demo data, production = real devices.",
    )


class GuestCreate(BaseModel):
    """Optional body for POST /v1/guests. The identity itself is always
    minted server-side; only the environment is selectable."""

    environment: AggregatorEnv | None = Field(
        default=None,
        description="Aggregator environment for the guest (default: the service's primary one).",
    )


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_user_id: str
    aggregator_user_id: str | None
    aggregator_environment: str
    created_at: datetime


class GuestOut(UserOut):
    """POST /v1/guests response: the new user plus its session token.

    ``guest_token`` is returned exactly once, here. Only its SHA-256 is
    stored, so it cannot be recovered later; the client must persist it.
    The token authenticates requests scoped to this single user.
    """

    guest_token: str = Field(
        description="One-time-issued session token; shown only in this response and "
        "scoped to this user only."
    )


# --- Devices / connections ---


class LinkRequest(BaseModel):
    provider: str = Field(examples=["whoop_v2", "oura", "garmin"])
    redirect_url: str | None = Field(
        default=None,
        description="Where Aggregator Link sends the user after connecting (deep link for mobile).",
    )


class LinkOut(BaseModel):
    link_token: str
    link_url: str = Field(description="Hosted Aggregator Link URL to open in a browser/webview.")


class ConnectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    provider: str
    status: ConnectionStatus
    device_meta: dict | None
    connected_at: datetime
    last_data_at: datetime | None


# --- Timeseries ---


class TimeseriesPoint(BaseModel):
    ts: datetime
    value: float
    value_secondary: float | None = Field(
        default=None, description="Diastolic for blood_pressure; null otherwise."
    )


class TimeseriesOut(BaseModel):
    metric: Metric
    unit: str
    resolution: Resolution
    start: datetime
    end: datetime
    points: list[TimeseriesPoint]


# --- Activity ---


class EventOut(BaseModel):
    """One ingestion event in a user's activity feed."""

    id: uuid.UUID
    event_type: str
    status: WebhookEventStatus
    received_at: datetime
    processed_at: datetime | None
    summary: str = Field(description="Human-readable description of the event, built server-side.")


# --- Health ---


class HealthOut(BaseModel):
    status: str = "ok"
    environment: str
