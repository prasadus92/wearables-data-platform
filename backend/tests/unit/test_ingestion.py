"""Unit tests for webhook event normalization (pure parsing, no I/O).

Fixture payloads mirror Aggregator's documented envelope:
``{event_type, data, user_id, client_user_id, team_id}`` with timeseries
samples at ``$.data.data`` and source at ``$.data.source``.
"""

from datetime import UTC, datetime

from app.models import ConnectionStatus, Metric
from app.services.ingestion import parse_event

AGGREGATOR_USER = "8e837b56-26ab-4347-9d4a-be9b2f5a78c4"


def _ts_event(resource: str, points: list[dict], provider: str = "oura") -> dict:
    return {
        "event_type": f"daily.data.{resource}.created",
        "user_id": AGGREGATOR_USER,
        "client_user_id": "wearables-user-1",
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
        """Tolerate a flat {value} shape too, since provider payloads vary."""
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


# Field shapes verbatim from a production GET /v2/summary/sleep response.
WHOOP_SLEEP = {
    "id": "fb49aac3-4574-5716-bb8e-1e70cc50bbe7",
    "user_id": AGGREGATOR_USER,
    "date": "2026-05-10T00:00:00+00:00",
    "calendar_date": "2026-05-10",
    "bedtime_start": "2026-05-09T23:21:43+00:00",
    "bedtime_stop": "2026-05-10T06:56:35+00:00",
    "type": "long_sleep",
    "timezone_offset": 7200,
    "duration": 27291,
    "total": 24892,
    "awake": 2400,
    "light": 8781,
    "rem": 7710,
    "deep": 8401,
    "score": 85,
    "recovery_readiness_score": 63,
    "hr_lowest": None,
    "hr_average": None,
    "hr_resting": 53,
    "efficiency": 91.20556,
    "latency": None,
    "temperature_delta": None,
    "skin_temperature": None,
    "hr_dip": None,
    "state": None,
    "average_hrv": 39.68,
    "respiratory_rate": 15.04,
    "source": {
        "provider": "whoop_v2",
        "type": "unknown",
        "app_id": None,
        "device_id": None,
        "sport": None,
        "workout_id": None,
        "name": "Whoop V2",
        "slug": "whoop_v2",
        "logo": "https://storage.googleapis.com/vital-assets/whoop.png",
    },
    "sleep_stream": None,
    "created_at": "2026-06-10T13:05:06+00:00",
    "updated_at": "2026-06-10T13:05:06+00:00",
}

OURA_SLEEP = {
    "id": "c38dad60-dc8f-51c3-93cd-415d766456da",
    "user_id": AGGREGATOR_USER,
    "date": "2026-05-08T00:00:00+00:00",
    "calendar_date": "2026-05-08",
    "bedtime_start": "2026-05-07T23:09:00+00:00",
    "bedtime_stop": "2026-05-08T06:12:43+00:00",
    "type": "long_sleep",
    "timezone_offset": 7200,
    "duration": 25423,
    "total": 22050,
    "awake": 3373,
    "light": 11190,
    "rem": 4350,
    "deep": 6510,
    "score": 73,
    "recovery_readiness_score": 83,
    "hr_lowest": 43,
    "hr_average": 49,
    "hr_resting": None,
    "efficiency": 87.0,
    "latency": 690,
    "temperature_delta": -0.22,
    "skin_temperature": None,
    "hr_dip": None,
    "state": None,
    "average_hrv": 43.0,
    "respiratory_rate": 14.62,
    "source": {
        "provider": "oura",
        "type": "ring",
        "app_id": None,
        "device_id": "36b44550-37e5-5aee-a006-626e304f5e4b",
        "sport": None,
        "workout_id": None,
        "name": "Oura",
        "slug": "oura",
        "logo": "https://storage.googleapis.com/vital-assets/oura.png",
    },
    "sleep_stream": None,
    "created_at": "2026-06-10T10:37:05+00:00",
    "updated_at": "2026-06-10T10:37:05+00:00",
}


def _sleep_event(data: dict | list, event_type: str = "daily.data.sleep.created") -> dict:
    return {
        "event_type": event_type,
        "user_id": AGGREGATOR_USER,
        "client_user_id": "wearables-user-1",
        "team_id": "team-1",
        "data": data,
    }


class TestSleepEvents:
    def test_whoop_session_falls_back_to_hr_resting(self):
        """WHOOP reports no hr_average for sleep; hr_resting is the value."""
        plan = parse_event(_sleep_event(WHOOP_SLEEP))
        by_metric = {s.metric: s for s in plan.samples}
        assert set(by_metric) == {Metric.heartrate, Metric.hrv, Metric.respiratory_rate}
        hr = by_metric[Metric.heartrate]
        assert hr.value == 53.0
        assert hr.unit == "bpm"
        assert hr.provider == "whoop_v2"
        assert hr.ts == datetime(2026, 5, 10, 6, 56, 35, tzinfo=UTC)  # bedtime_stop
        assert by_metric[Metric.hrv].value == 39.68
        assert by_metric[Metric.hrv].unit == "ms"
        assert by_metric[Metric.respiratory_rate].value == 15.04
        assert by_metric[Metric.respiratory_rate].unit == "breaths/min"

    def test_oura_session_uses_vendor_headline_hr(self):
        plan = parse_event(_sleep_event(OURA_SLEEP))
        hr = next(s for s in plan.samples if s.metric is Metric.heartrate)
        assert hr.value == 43.0  # hr_average, never hr_lowest
        assert hr.provider == "oura"
        assert hr.ts == datetime(2026, 5, 8, 6, 12, 43, tzinfo=UTC)

    def test_none_fields_produce_no_samples_without_error(self):
        bare = {
            **WHOOP_SLEEP,
            "hr_average": None,
            "hr_resting": None,
            "average_hrv": None,
            "respiratory_rate": None,
        }
        plan = parse_event(_sleep_event(bare))
        assert plan.samples == []
        assert plan.is_noop

    def test_missing_bedtime_stop_falls_back_to_date(self):
        plan = parse_event(_sleep_event({**OURA_SLEEP, "bedtime_stop": None}))
        assert plan.samples
        assert plan.samples[0].ts == datetime(2026, 5, 8, tzinfo=UTC)

    def test_list_payload_parses_every_session(self):
        plan = parse_event(_sleep_event([WHOOP_SLEEP, OURA_SLEEP]))
        assert len(plan.samples) == 6
        assert {s.provider for s in plan.samples} == {"whoop_v2", "oura"}

    def test_wrapped_list_payload_also_accepted(self):
        plan = parse_event(_sleep_event({"data": [OURA_SLEEP]}))
        assert len(plan.samples) == 3

    def test_updated_event_also_parsed(self):
        plan = parse_event(_sleep_event(WHOOP_SLEEP, event_type="daily.data.sleep.updated"))
        assert len(plan.samples) == 3

    def test_historical_sleep_event_schedules_backfill(self):
        plan = parse_event(
            {
                "event_type": "historical.data.sleep.created",
                "user_id": AGGREGATOR_USER,
                "data": {
                    "user_id": AGGREGATOR_USER,
                    "provider": "whoop_v2",
                    "start_date": "2025-12-13",
                    "end_date": "2026-05-10",
                },
            }
        )
        assert plan.backfill is not None
        assert plan.backfill.resource == "sleep"
        assert plan.backfill.provider == "whoop_v2"
        assert plan.backfill.start_date == "2025-12-13"
        assert plan.backfill.end_date == "2026-05-10"
        assert not plan.samples


class TestLifecycleEvents:
    def test_connection_created(self):
        plan = parse_event(
            {
                "event_type": "provider.connection.created",
                "user_id": AGGREGATOR_USER,
                "data": {
                    "user_id": AGGREGATOR_USER,
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
                "user_id": AGGREGATOR_USER,
                "data": {"provider": {"slug": "whoop_v2"}},
            }
        )
        assert plan.connection_change.status is ConnectionStatus.expired
        assert plan.connection_change.provider == "whoop_v2"

    def test_historical_event_schedules_backfill(self):
        plan = parse_event(
            {
                "event_type": "historical.data.heartrate.created",
                "user_id": AGGREGATOR_USER,
                "data": {
                    "user_id": AGGREGATOR_USER,
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
