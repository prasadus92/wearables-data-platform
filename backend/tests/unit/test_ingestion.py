"""Unit tests for webhook event normalization (pure parsing, no I/O).

Fixture payloads mirror Junction's documented envelope:
``{event_type, data, user_id, client_user_id, team_id}`` with timeseries
samples at ``$.data.data`` and source at ``$.data.source``.
"""

from datetime import UTC, datetime

from app.models import ConnectionStatus, Metric
from app.services.ingestion import parse_event

JUNCTION_USER = "8e837b56-26ab-4347-9d4a-be9b2f5a78c4"


def _ts_event(resource: str, points: list[dict], provider: str = "oura") -> dict:
    return {
        "event_type": f"daily.data.{resource}.created",
        "user_id": JUNCTION_USER,
        "client_user_id": "youth-user-1",
        "team_id": "team-1",
        "data": {"data": points, "source": {"name": "Oura", "slug": provider}},
    }


class TestTimeseriesEvents:
    def test_heartrate_samples_normalized(self):
        plan = parse_event(
            _ts_event(
                "heartrate",
                [
                    {"timestamp": "2026-06-09T10:00:00+00:00", "value": 62, "unit": "bpm"},
                    {"timestamp": "2026-06-09T10:01:00Z", "value": 65.5, "unit": "bpm"},
                ],
            )
        )
        assert len(plan.samples) == 2
        first = plan.samples[0]
        assert first.metric is Metric.heartrate
        assert first.value == 62.0
        assert first.unit == "bpm"
        assert first.provider == "oura"
        assert first.ts == datetime(2026, 6, 9, 10, 0, tzinfo=UTC)

    def test_blood_oxygen_maps_to_spo2(self):
        plan = parse_event(
            _ts_event("blood_oxygen", [{"timestamp": "2026-06-09T03:00:00Z", "value": 97}])
        )
        assert plan.samples[0].metric is Metric.spo2

    def test_blood_pressure_compound_shape(self):
        plan = parse_event(
            _ts_event(
                "blood_pressure",
                [{"timestamp": "2026-06-09T08:00:00Z", "systolic": 121, "diastolic": 79}],
                provider="apple_health_kit",
            )
        )
        sample = plan.samples[0]
        assert sample.metric is Metric.blood_pressure
        assert sample.value == 121.0
        assert sample.value_secondary == 79.0
        assert sample.unit == "mmHg"  # default applied

    def test_blood_pressure_simple_value_shape(self):
        """Tolerate a flat {value} shape too — provider payloads vary."""
        plan = parse_event(
            _ts_event("blood_pressure", [{"timestamp": "2026-06-09T08:00:00Z", "value": 120}])
        )
        assert plan.samples[0].value == 120.0
        assert plan.samples[0].value_secondary is None

    def test_epoch_timestamps_accepted(self):
        plan = parse_event(_ts_event("hrv", [{"timestamp": 1781085600, "value": 48, "unit": "ms"}]))
        assert plan.samples[0].ts.tzinfo is not None

    def test_points_without_value_are_dropped(self):
        plan = parse_event(
            _ts_event(
                "heartrate",
                [
                    {"timestamp": "2026-06-09T10:00:00Z", "value": None},
                    {"timestamp": "2026-06-09T10:01:00Z", "value": 70},
                    {"value": 71},  # no timestamp
                ],
            )
        )
        assert len(plan.samples) == 1
        assert plan.samples[0].value == 70.0

    def test_updated_events_also_parsed(self):
        payload = _ts_event("heartrate", [{"timestamp": "2026-06-09T10:00:00Z", "value": 70}])
        payload["event_type"] = "daily.data.heartrate.updated"
        assert len(parse_event(payload).samples) == 1

    def test_irrelevant_resource_is_noop(self):
        plan = parse_event(_ts_event("steps", [{"timestamp": "2026-06-09T10:00:00Z", "value": 1}]))
        assert plan.is_noop


class TestLifecycleEvents:
    def test_connection_created(self):
        plan = parse_event(
            {
                "event_type": "provider.connection.created",
                "user_id": JUNCTION_USER,
                "data": {
                    "user_id": JUNCTION_USER,
                    "provider": {"name": "Oura", "slug": "oura", "logo": "https://..."},
                    "resource_availability": {"heartrate": "available"},
                },
            }
        )
        change = plan.connection_change
        assert change is not None
        assert change.provider == "oura"
        assert change.status is ConnectionStatus.connected
        assert change.device_meta["name"] == "Oura"

    def test_connection_error_marks_expired(self):
        plan = parse_event(
            {
                "event_type": "provider.connection.error",
                "user_id": JUNCTION_USER,
                "data": {"provider": {"slug": "whoop_v2"}},
            }
        )
        assert plan.connection_change.status is ConnectionStatus.expired
        assert plan.connection_change.provider == "whoop_v2"

    def test_historical_event_schedules_backfill(self):
        plan = parse_event(
            {
                "event_type": "historical.data.heartrate.created",
                "user_id": JUNCTION_USER,
                "data": {
                    "user_id": JUNCTION_USER,
                    "provider": "oura",
                    "start_date": "2026-05-10",
                    "end_date": "2026-06-09",
                },
            }
        )
        assert plan.backfill is not None
        assert plan.backfill.resource == "heartrate"
        assert plan.backfill.start_date == "2026-05-10"
        assert not plan.samples

    def test_unknown_event_is_noop_not_error(self):
        plan = parse_event({"event_type": "team.new.shiny.event", "data": {}})
        assert plan.is_noop
