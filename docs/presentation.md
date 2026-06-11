# Presentation: Wearables Integration MVP

Working notes for the onsite presentation. Target: 15-20 minutes plus demo.

## 1. What was built (2 minutes)

End-to-end wearable platform on Junction, live at `api.youth.luminik.io`:

- Users connect Oura / WHOOP / Garmin / Fitbit via Junction's hosted OAuth Link;
  Apple Watch pairs through the Vital Connect app with a single-use code (HealthKit).
- Biometrics ingested via signed webhooks: heart rate, HRV, SpO2, respiratory rate,
  blood pressure. Historical backfills pulled via REST with cursor pagination.
- Timeline API with server-side bucketing feeds the web dashboard at
  `app.youth.luminik.io` and an Expo app sharing one TypeScript core package;
  SSE pushes chart updates the moment a webhook lands.
- Real product auth: Clerk sign-in, anonymous guest sessions for the zero-friction
  demo path, and a service key for machine callers. Ownership scoping returns 404,
  never 403, so existence never leaks.
- Consent ledger and GDPR erasure: device_events records every connect, disconnect,
  and identity change with actor attribution; one service call erases a user locally
  and at Junction.
- Both Junction environments at once: demo data and real production devices (a real
  Oura ring and WHOOP strap are connected) through one deployment.
- AWS: ECS Fargate, RDS Postgres, ElastiCache, ALB + ACM, CloudFront, SSM secrets.
  One `terraform apply`; GitHub Actions deploys on every merge to main via OIDC.

## 2. Live demo script (5 minutes)

1. Dashboard: Try the demo as a guest. A demo wearable attaches itself and the
   chart fills live (SSE). Zero accounts, zero clicks.
2. Terminal split-screen: `aws logs tail /ecs/youth-wearables-api --follow` showing
   Junction webhooks arriving while the chart updates. This is the central moment of the demo.
3. Real device: the WHOOP strap and Oura ring connected through the product's
   own flow; same charts, real data.
4. Expo app on the phone: connect flow per the Figma, haptics, timeline chart.
   Apple Watch via the Vital Connect pairing code if it landed beforehand.
5. Postman: the API contract their backend would consume.

Fallback if WiFi/AWS misbehaves: identical local compose stack + simulated webhooks
(docs/demo-runbook.md has the exact steps).

## 3. How it is built (4 minutes)

Walk docs/architecture.md diagram 1, emphasizing the three invariants:

1. **ACK fast, process async.** Junction gives 15 seconds and 8 retries; the receiver
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
stateless. 83 tests: normalizers, Svix signatures (valid/tampered/cross-env), the
three auth branches and their scoping, idempotency, erasure with cascade
verification, full webhook-to-chart integration against real Postgres.

## 4. Scaling story (4 minutes)

Walk docs/architecture.md section 3 (10k now, 50k, 1M, 50M) and the draw.io ideal
architecture. Key beats per tier: Timescale hypertables + continuous aggregates at
50k; Kafka front door, storage split hot/cold, service split at 1M; cell-based
multi-region with a dedicated TSDB and precomputed aggregates at 50M. The four
invariants above survive every tier.

## 5. Criticalities and edge cases found (3 minutes)

- The challenge API key was dead (401 from Junction): probed and reported day one.
- **Demo data and real data have different shapes.** Demo wearables emit direct
  biomarker resources; real Oura and WHOOP deliver heart rate, HRV, and breathing
  rate inside sleep summaries. A pipeline tested only against sandbox demo data
  ingests nothing from a real ring. Found against production, fixed with a sleep
  parser, verified with 68 real nights backfilled.
- The first dense device found two production limits in one afternoon: a 90
  day Apple Watch backfill (a reading every few minutes) exceeded the
  Postgres 32767 bind parameter cap in one statement, and the failed job's
  retained result then blocked every retry sharing its dedupe id. Chunked
  upserts and range-complete job ids fixed both; idempotency meant the
  repairs were deploys plus a resync, never data surgery.
- A wearable's vendor cloud only has what the device synced to the vendor's phone
  app over Bluetooth; web sign-ins cannot trigger a sync. Demo prep has to include
  physically syncing devices, and the charts say honestly when data is stale.
- WHOOP is BYOO-only: no aggregator-shared OAuth. Verified live (the consent exchange
  401s without team credentials); their production team has it configured, onsite
  teams do not. This is the single biggest "wearables integration" gotcha for them.
- WHOOP and Garmin have no sandbox demo data: teams must test against Oura/Fitbit.
- Junction docs vs reality: the providers endpoint path in the docs returns 405; the
  live shape differs. Verified against production and noted in code.
- Link tokens expire in 60 minutes; reconnect flows must regenerate, never cache.
- `daily.data.*` is a stream, not a daily digest: dedupe is mandatory or double
  ingestion corrupts averages.
- Webhook endpoints get auto-disabled after sustained failures: ACK-fast is not a
  nicety, it is survival. Same for the 8/hour refresh limit on manual sync.
- Security observations: API keys shared in plaintext docs should be rotated after
  the challenge; biometric endpoints need auth from day one (implemented here).

## 6. From here to production (1 minute)

Already production-shaped: CI/CD on merge, IaC, idempotent ingestion, consent
ledger, erasure, dual environments. The queue to call it production-ready:
Timescale hypertables and continuous aggregates, webhook-event retention sweep and
S3 archival, the authentication hardening queue (docs/authentication.md: Clerk
production instance, per-IP rate limits on guest minting), native HealthKit via the
Junction mobile SDK instead of the Vital Connect bridge app, EAS release builds in
the stores instead of Expo Go, and a status page on queue depth and webhook failure
rate.

## Links

- Repo: github.com/prasadus92/youth-wearables (modules, tests, infra, docs)
- Live API docs: https://api.youth.luminik.io/docs
- Architecture: docs/architecture.md, docs/ideal-architecture.drawio
- White-label strategy: docs/white-label-strategy.md
- Recommendation and action system proposal: docs/recommendation-system.md
- Insight math: docs/insights.md
- Runbook: docs/demo-runbook.md
