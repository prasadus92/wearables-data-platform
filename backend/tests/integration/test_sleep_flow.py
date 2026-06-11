"""Integration: sleep summary ingestion against Postgres.

Real rings and straps (Oura, WHOOP) deliver sleeping HR, HRV and breathing
rate inside Junction's sleep summaries, never as standalone timeseries
resources. These tests cover the full recovery surface: the daily webhook
path, the historical notification that schedules a backfill, the backfill
worker pulling summaries over REST, and the manual sync that enqueues
sleep backfills.

Sleep objects mirror a production GET /v2/summary/sleep response verbatim.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.v1 import users as users_module
from app.models import Metric, Sample, User, WebhookEvent, WebhookEventStatus
from app.services.ingestion import apply_plan, parse_event
from app.workers import worker as worker_module

pytestmark = pytest.mark.integration

JUNCTION_USER = "8e837b56-26ab-4347-9d4a-be9b2f5a78c4"

WHOOP_SLEEP = {
    "id": "fb49aac3-4574-5716-bb8e-1e70cc50bbe7",
    "user_id": JUNCTION_USER,
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
    "user_id": JUNCTION_USER,
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


async def _make_user(session) -> User:
    user = User(client_user_id="youth-user-1", junction_user_id=JUNCTION_USER)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


class StubRedis:
    def __init__(self) -> None:
        self.published: list[tuple[str, str]] = []

    async def publish(self, channel: str, payload: str) -> None:
        self.published.append((channel, payload))


@pytest.fixture
async def worker_db(engine):
    """Reset the worker's process-global engine around each test.

    Worker entrypoints open sessions via ``app.db.session.db_session``; the
    test ``engine`` fixture drops and recreates tables, so a pooled global
    connection from an earlier test would carry stale prepared statements.
    """
    from app.db import session as db

    async def _reset() -> None:
        if db._engine is not None:
            await db._engine.dispose()
        db._engine = None
        db._session_factory = None

    await _reset()
    yield
    await _reset()


class TestDailySleepWebhook:
    async def test_webhook_to_samples(self, client, engine):
        """daily.data.sleep.created lands via the webhook endpoint, the worker
        logic normalizes it, and nightly samples are queryable."""
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            user = await _make_user(session)
            user_id = user.id

        response = await client.post(
            "/webhooks/junction",
            json={
                "event_type": "daily.data.sleep.created",
                "user_id": JUNCTION_USER,
                "client_user_id": "youth-user-1",
                "data": WHOOP_SLEEP,
            },
            headers={"svix-id": "msg_sleep_e2e"},
        )
        assert response.status_code == 202
        assert len(client.enqueued) == 1

        async with factory() as session:
            event = (await session.execute(select(WebhookEvent))).scalar_one()
            plan = parse_event(event.payload)
            written = await apply_plan(session, user_id, plan)
            event.status = WebhookEventStatus.processed
            await session.commit()
        assert written == 3

        async with factory() as session:
            rows = list((await session.execute(select(Sample))).scalars().all())
        by_metric = {row.metric: row for row in rows}
        assert set(by_metric) == {Metric.heartrate, Metric.hrv, Metric.respiratory_rate}
        assert by_metric[Metric.heartrate].value == 53.0  # hr_resting fallback
        assert by_metric[Metric.hrv].value == 39.68
        assert by_metric[Metric.respiratory_rate].value == 15.04
        assert all(row.provider == "whoop_v2" for row in rows)
        assert all(row.ts == datetime(2026, 5, 10, 6, 56, 35, tzinfo=UTC) for row in rows)


class TestHistoricalSleepEvent:
    async def test_enqueues_sleep_backfill(self, engine, worker_db, monkeypatch):
        """historical.data.sleep.created is data-less; the worker must
        schedule a sleep backfill instead of skipping the event."""
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            await _make_user(session)
            event = WebhookEvent(
                event_id="msg_hist_sleep",
                event_type="historical.data.sleep.created",
                payload={
                    "event_type": "historical.data.sleep.created",
                    "user_id": JUNCTION_USER,
                    "data": {
                        "user_id": JUNCTION_USER,
                        "provider": "whoop_v2",
                        "start_date": "2025-12-13",
                        "end_date": "2026-05-10",
                    },
                },
            )
            session.add(event)
            await session.commit()
            event_id = str(event.id)

        enqueued: list[tuple] = []

        async def _record(*args) -> None:
            enqueued.append(args)

        monkeypatch.setattr(worker_module, "enqueue_backfill", _record)

        result = await worker_module.process_webhook_event({"redis": StubRedis()}, event_id)
        assert result == "processed:0"
        assert len(enqueued) == 1
        _user_id, resource, provider, start, end = enqueued[0]
        assert resource == "sleep"
        assert provider == "whoop_v2"
        assert (start, end) == ("2025-12-13", "2026-05-10")

        async with factory() as session:
            stored = (await session.execute(select(WebhookEvent))).scalar_one()
        assert stored.status is WebhookEventStatus.processed


class TestSleepBackfillWorker:
    async def test_backfill_parses_summary_and_is_idempotent(self, engine, worker_db):
        """process_backfill pulls GET /v2/summary/sleep and upserts samples;
        a second run changes nothing."""
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            user = await _make_user(session)
            user_id = str(user.id)
            environment = user.junction_environment

        calls: list[dict] = []

        class StubJunction:
            async def get_sleep_summary(
                self, junction_user_id, start_date, end_date, provider=None, next_cursor=None
            ):
                calls.append(
                    {
                        "junction_user_id": junction_user_id,
                        "start_date": start_date,
                        "end_date": end_date,
                        "provider": provider,
                        "next_cursor": next_cursor,
                    }
                )
                return {"sleep": [WHOOP_SLEEP, OURA_SLEEP]}

        redis = StubRedis()
        ctx = {"junction_clients": {environment: StubJunction()}, "redis": redis}

        first = await worker_module.process_backfill(
            ctx, user_id, "sleep", "whoop_v2", "2025-12-13", "2026-05-10"
        )
        second = await worker_module.process_backfill(
            ctx, user_id, "sleep", "whoop_v2", "2025-12-13", "2026-05-10"
        )
        # 2 sessions x 3 metrics, upserted both times.
        assert first == second == "backfilled:6"

        async with factory() as session:
            count = (await session.execute(select(func.count()).select_from(Sample))).scalar_one()
        assert count == 6  # second run upserted, never duplicated

        assert calls[0]["junction_user_id"] == JUNCTION_USER
        assert calls[0]["provider"] == "whoop_v2"
        assert len(redis.published) == 2  # fresh-samples notification per run


class TestSyncEnqueuesSleepBackfill:
    async def test_sync_covers_last_180_days_of_sleep(self, client, engine, monkeypatch):
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            user = await _make_user(session)
            user_id = user.id

        class StubJunction:
            async def refresh_user(self, junction_user_id: str) -> dict:
                return {"success": True}

            async def get_user_connections(self, junction_user_id: str) -> dict:
                return {"providers": [{"slug": "whoop_v2", "status": "connected"}]}

        enqueued: list[tuple] = []

        async def _record(*args) -> None:
            enqueued.append(args)

        monkeypatch.setattr(users_module, "junction_client_for", lambda env: StubJunction())
        monkeypatch.setattr(users_module, "enqueue_backfill", _record)

        response = await client.post(f"/v1/users/{user_id}/sync")
        assert response.status_code == 202
        body = response.json()
        assert body["providers"] == ["whoop_v2"]

        sleep_jobs = [job for job in enqueued if job[1] == "sleep"]
        assert len(sleep_jobs) == 1
        assert body["jobs"] == len(enqueued)
        _uid, _resource, provider, start, end = sleep_jobs[0]
        assert provider == "whoop_v2"
        end_date = datetime.now(UTC).date() + timedelta(days=1)
        assert end == str(end_date)
        assert start == str(end_date - timedelta(days=180))

    async def test_sync_unregistered_user_conflicts(self, client, engine):
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            user = User(client_user_id=f"youth-{uuid.uuid4().hex[:8]}", junction_user_id=None)
            session.add(user)
            await session.commit()
            await session.refresh(user)

        response = await client.post(f"/v1/users/{user.id}/sync")
        assert response.status_code == 409


async def test_dense_backfill_exceeding_parameter_cap(with_auth, client, engine, monkeypatch):
    """A single plan with more rows than one statement can bind (32767
    params / 8 per row) must write completely via chunked upserts. This is
    the Apple Watch case: intraday heart rate at a reading every few
    minutes for months."""
    import uuid as uuidlib
    from datetime import UTC, datetime, timedelta

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import Metric
    from app.services.ingestion import IngestPlan, NormalizedSample, apply_plan
    from tests.conftest import SERVICE_TOKEN

    class StubJunction:
        async def create_user(self, client_user_id: str) -> dict:
            return {"user_id": f"jnc-{client_user_id}"}

        async def connect_demo_provider(self, junction_user_id: str, provider: str) -> dict:
            return {"success": True}

    monkeypatch.setattr(users_module, "junction_client_for", lambda env: StubJunction())
    created = await client.post(
        "/v1/users",
        headers={"X-API-Key": SERVICE_TOKEN},
        json={"client_user_id": f"dense-{uuidlib.uuid4().hex[:8]}"},
    )
    assert created.status_code == 201
    user_id = created.json()["id"]

    base = datetime(2026, 3, 1, tzinfo=UTC)
    samples = [
        NormalizedSample(
            metric=Metric.heartrate,
            ts=base + timedelta(minutes=3 * i),
            value=60.0 + (i % 30),
            value_secondary=None,
            unit="bpm",
            provider="apple_health_kit",
        )
        for i in range(5000)
    ]
    plan = IngestPlan(
        event_type="daily.data.heartrate.created",
        junction_user_id=None,
        client_user_id=None,
        samples=samples,
    )
    async with AsyncSession(engine) as session:
        written = await apply_plan(session, uuidlib.UUID(user_id), plan)
        await session.commit()
    assert written == 5000

    # Raw resolution is capped at 7 days by design; hour buckets verify the
    # full span persisted (5000 samples at 3 minute spacing cover ~250 hours).
    series = await client.get(
        f"/v1/users/{user_id}/timeseries/heartrate"
        "?resolution=hour&start=2026-03-01T00:00:00Z&end=2026-03-12T00:00:00Z",
        headers={"X-API-Key": SERVICE_TOKEN},
    )
    assert series.status_code == 200
    assert len(series.json()["points"]) >= 240


async def test_connection_event_triggers_own_backfills(
    with_auth, client, engine, worker_db, monkeypatch
):
    """A provider.connection.created event must enqueue our own history
    pulls, immediate and deferred, instead of trusting the provider's
    historical webhooks to arrive."""
    import uuid as uuidlib

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import WebhookEvent, WebhookEventStatus
    from tests.conftest import SERVICE_TOKEN

    class StubJunction:
        async def create_user(self, client_user_id: str) -> dict:
            return {"user_id": f"jnc-{client_user_id}"}

        async def connect_demo_provider(self, junction_user_id: str, provider: str) -> dict:
            return {"success": True}

    monkeypatch.setattr(users_module, "junction_client_for", lambda env: StubJunction())
    created = await client.post(
        "/v1/users",
        headers={"X-API-Key": SERVICE_TOKEN},
        json={"client_user_id": f"connbf-{uuidlib.uuid4().hex[:8]}"},
    )
    assert created.status_code == 201
    body = created.json()

    enqueued: list[tuple] = []

    async def _record(*args, **kwargs) -> None:
        enqueued.append((args, kwargs))

    monkeypatch.setattr(worker_module, "enqueue_backfill", _record)

    event_id = uuidlib.uuid4()
    async with AsyncSession(engine) as session:
        session.add(
            WebhookEvent(
                id=event_id,
                event_id=f"svix-{event_id}",
                event_type="provider.connection.created",
                status=WebhookEventStatus.received,
                payload={
                    "event_type": "provider.connection.created",
                    "user_id": body["junction_user_id"],
                    "client_user_id": body["client_user_id"],
                    "data": {"provider": {"slug": "whoop_v2", "name": "WHOOP"}},
                },
            )
        )
        await session.commit()

    result = await worker_module.process_webhook_event({}, str(event_id))
    assert result.startswith("processed")

    # 5 metrics + sleep, twice (immediate and deferred five minutes).
    assert len(enqueued) == 12
    defers = {kw.get("defer_seconds") for _, kw in enqueued}
    assert defers == {0, 300}
    resources = {a[1] for a, _ in enqueued}
    assert "sleep" in resources and "heartrate" in resources
