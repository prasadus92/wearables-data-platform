"""Human-readable summaries of activity feed entries.

Pure functions: take one raw webhook payload (or one lifecycle ledger row)
and return a short sentence describing what happened. Copy stays
vendor-free (no platform names), except wearable provider names, which
users recognize.
"""

from datetime import date

from app.models import DeviceEventType, Metric
from app.services.ingestion import RESOURCE_TO_METRIC

METRIC_FRIENDLY: dict[Metric, str] = {
    Metric.heartrate: "heart rate",
    Metric.hrv: "HRV",
    Metric.spo2: "blood oxygen",
    Metric.respiratory_rate: "breathing rate",
    Metric.blood_pressure: "blood pressure",
}

PROVIDER_NAMES: dict[str, str] = {
    "whoop": "WHOOP",
    "whoop_v2": "WHOOP",
    "oura": "Oura",
    "fitbit": "Fitbit",
    "garmin": "Garmin",
    "apple_health_kit": "Apple Health",
}


def _provider_name(slug: str | None, fallback: str | None = None) -> str | None:
    if slug and slug in PROVIDER_NAMES:
        return PROVIDER_NAMES[slug]
    if fallback:
        return fallback
    if slug:
        return slug.replace("_", " ").title()
    return None


def _resource_friendly(resource: str) -> str:
    metric = RESOURCE_TO_METRIC.get(resource)
    if metric is not None:
        return METRIC_FRIENDLY[metric]
    return resource.replace("_", " ")


def _format_date(raw: object) -> str | None:
    try:
        parsed = date.fromisoformat(str(raw)[:10])
    except (TypeError, ValueError):
        return None
    return f"{parsed:%b} {parsed.day}"


def summarize_event(payload: dict) -> str:
    """Describe one raw ingestion event in plain language.

    Examples: "42 heart rate readings received from Oura",
    "Backfill notification for heart rate (May 10 to Jun 9)",
    "Oura connected". Unknown event types fall back to a generic line,
    never an error: the feed must render whatever the pipeline stored.
    """
    event_type: str = payload.get("event_type", "")
    data: dict = payload.get("data") or {}
    parts = event_type.split(".")

    # daily.data.{resource}.{created|updated}: a batch of incremental readings.
    if len(parts) == 4 and parts[0] == "daily" and parts[1] == "data":
        resource = _resource_friendly(parts[2])
        count = len(data.get("data") or [])
        source = data.get("source") or {}
        provider = _provider_name(source.get("slug"), source.get("name"))
        noun = "reading" if count == 1 else "readings"
        sentence = f"{count} {resource} {noun} received"
        if provider:
            sentence = f"{sentence} from {provider}"
        return sentence

    # historical.data.{resource}.created: an older range is being pulled in.
    if len(parts) == 4 and parts[0] == "historical" and parts[1] == "data":
        resource = _resource_friendly(parts[2])
        start = _format_date(data.get("start_date"))
        end = _format_date(data.get("end_date"))
        if start and end:
            return f"Backfill notification for {resource} ({start} to {end})"
        return f"Backfill notification for {resource}"

    if event_type == "provider.connection.created":
        provider_info = data.get("provider") or {}
        provider = _provider_name(provider_info.get("slug"), provider_info.get("name"))
        return f"{provider} connected" if provider else "Device connected"

    if event_type == "provider.connection.error":
        return "Connection issue reported"

    return "Update received"


def summarize_device_event(event: str, provider: str | None) -> str:
    """Describe one lifecycle ledger entry in plain language.

    Examples: "Oura connected", "WHOOP disconnected", "Identity migrated",
    "Guest session started". Unknown transitions fall back to a generic
    line, never an error.
    """
    name = _provider_name(provider) or "Device"
    if event == DeviceEventType.connected:
        return f"{name} connected"
    if event == DeviceEventType.reconnected:
        return f"{name} reconnected"
    if event == DeviceEventType.disconnected:
        return f"{name} disconnected"
    if event == DeviceEventType.expired:
        return f"{name} connection expired"
    if event == DeviceEventType.identity_remapped:
        return "Identity migrated"
    if event == DeviceEventType.guest_created:
        return "Guest session started"
    if event == DeviceEventType.user_created:
        return "Account created"
    return "Account update"
