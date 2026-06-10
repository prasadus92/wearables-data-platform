"""Integration: webhook receipt → worker processing → timeseries query.

Exercises the real pipeline against Postgres: persist raw event, normalize,
idempotent upsert, then read back through the chart API.
"""

import uuid

import pytest
from sqlalchemy import func, select

from app.models import Sample, User, WebhookEvent, WebhookEventStatus
from app.services.ingestion import apply_plan, parse_event

pytestmark = pytest.mark.integration

AGGREGATOR_USER = "8e837b56-26ab-4347-9d4a-be9b2f5a78c4"


def _hr_payload(values: list[tuple[str, float]]) -> dict:
    return {
        "event_type": "daily.data.heartrate.created",
        "user_id": AGGREGATOR_USER,
        "client_user_id": "wearables-user-1",
        "data": {
            "data": [{"timestamp": ts, "value": v, "unit": "bpm"} for ts, v in values],
            "source": {"name": "Oura", "slug": "oura"},
        },
    }


async def _make_user(session) -> User:
    user = User(client_user_id="wearables-user-1", aggregator_user_id=AGGREGATOR_USER)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


class TestWebhookEndpoint:
    async def test_event_persisted_and_enqueued(self, client):
        response = await client.post(
            "/webhooks/aggregator",
            json=_hr_payload([("2026-06-09T10:00:00Z", 62)]),
            headers={"svix-id": "msg_abc"},
        )
        assert response.status_code == 202
        assert response.json() == {"status": "accepted"}
        assert len(client.enqueued) == 1

    async def test_retry_with_same_svix_id_dedupes(self, client):
        payload = _hr_payload([("2026-06-09T10:00:00Z", 62)])
        first = await client.post(
            "/webhooks/aggregator", json=payload, headers={"svix-id": "msg_retry"}
        )
        second = await client.post(
            "/webhooks/aggregator", json=payload, headers={"svix-id": "msg_retry"}
        )
        assert first.json()["status"] == "accepted"
        assert second.json()["status"] == "duplicate"
        assert len(client.enqueued) == 1  # not re-enqueued

    async def test_invalid_json_rejected(self, client):
        response = await client.post(
            "/webhooks/aggregator",
            content=b"not-json",
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 400


class TestIngestionPipeline:
    async def test_samples_upserted_idempotently(self, session):
        user = await _make_user(session)
        plan = parse_event(
            _hr_payload([("2026-06-09T10:00:00Z", 62), ("2026-06-09T10:01:00Z", 64)])
        )

        written_first = await apply_plan(session, user.id, plan)
        await session.commit()
        # Re-apply the same event (webhook retry) — no duplicates.
        written_again = await apply_plan(session, user.id, plan)
        await session.commit()

        assert written_first == written_again == 2
        count = (await session.execute(select(func.count()).select_from(Sample))).scalar_one()
        assert count == 2

    async def test_reprocessed_event_updates_value(self, session):
        """daily.data.*.updated re-sends a corrected value for the same ts."""
        user = await _make_user(session)
        await apply_plan(session, user.id, parse_event(_hr_payload([("2026-06-09T10:00:00Z", 62)])))
        await apply_plan(session, user.id, parse_event(_hr_payload([("2026-06-09T10:00:00Z", 65)])))
        await session.commit()

        row = (await session.execute(select(Sample))).scalar_one()
        assert row.value == 65.0

    async def test_connection_created_then_expired(self, session):
        user = await _make_user(session)
        created = parse_event(
            {
                "event_type": "provider.connection.created",
                "user_id": AGGREGATOR_USER,
                "data": {"provider": {"name": "Oura", "slug": "oura"}},
            }
        )
        await apply_plan(session, user.id, created)
        await session.commit()

        errored = parse_event(
            {
                "event_type": "provider.connection.error",
                "user_id": AGGREGATOR_USER,
                "data": {"provider": {"slug": "oura"}},
            }
        )
        await apply_plan(session, user.id, errored)
        await session.commit()

        from app.models import Connection, ConnectionStatus

        conn = (await session.execute(select(Connection))).scalar_one()
        assert conn.status is ConnectionStatus.expired


class TestEndToEnd:
    async def test_webhook_to_chart(self, client, engine):
        """Full path: user exists → webhook lands → worker logic runs →
        chart endpoint returns bucketed points."""
        from sqlalchemy.ext.asyncio import async_sessionmaker

        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            user = await _make_user(session)
            user_id = user.id

        # 1. Webhook arrives
        response = await client.post(
            "/webhooks/aggregator",
            json=_hr_payload(
                [
                    ("2026-06-09T10:00:00Z", 60),
                    ("2026-06-09T10:30:00Z", 70),
                    ("2026-06-09T11:00:00Z", 80),
                ]
            ),
            headers={"svix-id": "msg_e2e"},
        )
        assert response.status_code == 202

        # 2. Worker processes the persisted event (invoked directly — the
        #    queue transport is not what's under test here).
        async with factory() as session:
            event = (await session.execute(select(WebhookEvent))).scalar_one()
            plan = parse_event(event.payload)
            await apply_plan(session, user_id, plan)
            event.status = WebhookEventStatus.processed
            await session.commit()

        # 3. App fetches the timeline
        response = await client.get(
            f"/v1/users/{user_id}/timeseries/heartrate",
            params={
                "start": "2026-06-09T00:00:00Z",
                "end": "2026-06-10T00:00:00Z",
                "resolution": "hour",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["unit"] == "bpm"
        assert len(body["points"]) == 2  # 10:00 bucket (avg 65) + 11:00 bucket (80)
        assert body["points"][0]["value"] == 65.0
        assert body["points"][1]["value"] == 80.0

    async def test_unknown_user_404(self, client):
        response = await client.get(f"/v1/users/{uuid.uuid4()}/timeseries/heartrate")
        assert response.status_code == 404

    async def test_raw_resolution_window_capped(self, client, engine):
        from sqlalchemy.ext.asyncio import async_sessionmaker

        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            user = await _make_user(session)

        response = await client.get(
            f"/v1/users/{user.id}/timeseries/heartrate",
            params={
                "start": "2026-01-01T00:00:00Z",
                "end": "2026-06-01T00:00:00Z",
                "resolution": "raw",
            },
        )
        assert response.status_code == 422
