# Presentation: Wearables Integration MVP

Working notes for the onsite presentation. Target: 15-20 minutes plus demo.

## 1. What was built (2 minutes)

End-to-end wearable platform on Aggregator, live at `api.examplehealth.example.com`:

- Users connect Oura / WHOOP / Garmin / Fitbit via Aggregator's hosted OAuth Link;
  Apple Watch documented as an SDK-based path (it never goes through Link).
- Biometrics ingested via signed webhooks: heart rate, HRV, SpO2, respiratory rate,
  blood pressure. Historical backfills pulled via REST with cursor pagination.
- Timeline API with server-side bucketing feeds a web dashboard and an Expo app;
  SSE pushes chart updates the moment a webhook lands.
- Both Aggregator environments at once: sandbox demo data and real production devices
  (a real Oura ring is connected) through one deployment.
- AWS: ECS Fargate, RDS Postgres, ElastiCache, ALB + ACM, SSM secrets. One
  `terraform apply`, one `deploy.sh`.

## 2. Live demo script (5 minutes)

1. Dashboard: create user, connect demo Oura, watch the chart fill live (SSE).
2. Terminal split-screen: `aws logs tail /ecs/wearables-data-platform-api --follow` showing
   Aggregator webhooks arriving while the chart updates. This is the central moment of the demo.
3. Real device: the production user with the real Oura ring and WHOOP strap; same charts, real data.
4. Expo app on the phone: connect flow per the Figma, timeline chart.
5. Postman: the API contract their backend would consume.

Fallback if WiFi/AWS misbehaves: identical local compose stack + simulated webhooks
(docs/demo-runbook.md has the exact steps).

## 3. How it is built (4 minutes)

Walk docs/architecture.md diagram 1, emphasizing the three invariants:

1. **ACK fast, process async.** Aggregator gives 15 seconds and 8 retries; the receiver
   persists the raw event and returns 202 in milliseconds. Parsing happens in workers
   behind a Redis queue.
2. **Idempotent everywhere.** Dedupe on Svix message id; samples upsert on
   (user, metric, ts, provider). Retries, replays, and overlapping backfills are safe
   by construction. 100 requests/minute today, and the same design absorbs bursts of
   thousands because the queue decouples ingestion from processing.
3. **Provider-agnostic core.** One normalized sample model; adding wearable N+1 is a
   parser, never a schema change. The dual-environment work landed in an afternoon
   because of this seam.

Code layering: `api -> services -> models`, parsing pure and unit-tested, workers
stateless. 33 tests: normalizers, Svix signatures (valid/tampered/cross-env), auth,
idempotency, full webhook-to-chart integration against real Postgres.

## 4. Scaling story (4 minutes)

Walk docs/architecture.md section 3 (10k now, 50k, 1M, 50M) and the draw.io ideal
architecture. Key beats per tier: Timescale hypertables + continuous aggregates at
50k; Kafka front door, storage split hot/cold, service split at 1M; cell-based
multi-region with a dedicated TSDB and precomputed aggregates at 50M. The four
invariants above survive every tier.

## 5. Criticalities and edge cases found (3 minutes)

- The challenge API key was dead (401 from Aggregator): probed and reported day one.
- WHOOP is BYOO-only: no aggregator-shared OAuth. Verified live (the consent exchange
  401s without team credentials); their production team has it configured, onsite
  teams do not. This is the single biggest "wearables integration" gotcha for them.
- WHOOP and Garmin have no sandbox demo data: teams must test against Oura/Fitbit.
- Aggregator docs vs reality: the providers endpoint path in the docs returns 405; the
  live shape differs. Verified against production and noted in code.
- Link tokens expire in 60 minutes; reconnect flows must regenerate, never cache.
- `daily.data.*` is a stream, not a daily digest: dedupe is mandatory or double
  ingestion corrupts averages.
- Webhook endpoints get auto-disabled after sustained failures: ACK-fast is not a
  nicety, it is survival. Same for the 8/hour refresh limit on manual sync.
- Security observations: API keys shared in plaintext docs should be rotated after
  the challenge; biometric endpoints need auth from day one (implemented here).

## 6. What I would do next (1 minute)

Per-user JWT auth (Clerk), Apple Watch via the Aggregator mobile SDK, Timescale
hypertables, webhook-event archival to S3, CI/CD via GitHub Actions deploy job,
status page on queue depth and webhook failure rate.

## Links

- Repo: github.com/prasadus92/wearables-data-platform (modules, tests, infra, docs)
- Live API docs: https://api.examplehealth.example.com/docs
- Architecture: docs/architecture.md, docs/ideal-architecture.drawio
- White-label strategy: docs/white-label-strategy.md
- Runbook: docs/demo-runbook.md
