# AGENTS.md

Guidance for AI coding agents (Codex, Cursor, and friends). Same content as CLAUDE.md; keep the two in sync when editing.

## What this is

Wearable data platform for the YOU(th) app on Junction (formerly Vital): FastAPI
ingestion/API backend, React web dashboard, Expo mobile app, Terraform AWS infra.
Live at https://api.youth.luminik.io. Architecture: docs/architecture.md. Auth model:
docs/authentication.md. Demo procedures: docs/demo-runbook.md. One-time setup history:
docs/setup-journal.md.

## Commands

- Backend tests: `cd backend && .venv/bin/python -m pytest tests/ -q` (needs
  `docker compose up -d db redis`; integration tests use real Postgres, never sqlite;
  84 tests at last count)
- Lint: `.venv/bin/ruff check app tests --fix && .venv/bin/ruff format app tests`
- Web: `cd web && npm run build` (tsc + vite; must pass before any commit)
- Mobile: `cd app && npx tsc --noEmit && npx expo export --platform ios` (both gates)
- Local stack: `docker compose up -d` (api :8000, worker, TimescaleDB, Redis)
- Deploy: `AWS_PROFILE=luminik ./infra/deploy.sh` (add `APPLY=1` when Terraform changed)
- Migrations: alembic, autogenerate from models, applied on container start
- Junction link URLs: `./scripts/make-link.sh <provider>` (expire in 60 minutes)
- Seed sample account: `./scripts/seed-sample.sh` (idempotent; `API=` env for deployed)

## Hard rules

- NO em dashes (U+2014) or en dashes (U+2013) anywhere: code, comments, docs, commits.
  No "not X but Y" rhetorical constructions. No AI attribution or co-author trailers.
- All commits SSH-signed as Prasad Subrahmanya <prasadus92@gmail.com>; a global
  commit-msg hook strips AI trailers as a safety net.
- Ship via feature branch + PR + squash merge (gh pr create / gh pr merge --squash).
- User-facing copy never names vendors ("Junction") or environments ("sandbox");
  the product words are Demo and Live. Empty states must carry a working CTA.
- Insight copy stays non-diagnostic: describe data, never judge health.

## Domain knowledge that will save you hours

- Junction: webhook receiver must ACK in <15s (8 retries, then endpoint disabled);
  we persist raw then queue. Everything idempotent: events dedupe on svix-id, samples
  upsert on (user, metric, ts, provider). `daily.data.*` is a stream, never a digest.
- WHOOP is BYOO-only (own OAuth app in team Custom Credentials); WHOOP and Garmin have
  NO sandbox demo data; demo with oura/fitbit. Sandbox demo users expire after 7 days.
- The providers list endpoint is `/v2/user/providers/{id}`; the docs' shape returns 405.
- Dual environment: users carry junction_environment; clients/webhook secrets resolve
  per env. Webhook URL is intentionally unversioned (sender owns payload versioning).
- Expo Go: react-native-reanimated must match the Expo Go native version exactly
  (currently 4.3.1); newer JS crashes at launch with no Metro logs. Phone and Mac must
  share a network; cellular or AP-isolated WiFi shows zero Metro connections.
- Real wearables deliver heart rate, HRV, and breathing rate inside Junction
  `sleep` summaries; demo wearables emit direct biomarker resources. The parser
  treats a resource as an input shape (sleep fans out to three metrics). A pipeline
  tested only on demo data ingests nothing from a real device.
- Demo mode seeds synthetic breathing rate and blood pressure at demo connect
  (app/services/demo_seed.py); Junction demo data covers only HR/HRV/SpO2.
- npm on macOS omits Linux natives for nested package instances even on npm 11;
  the four Linux bindings the web build needs are pinned as explicit
  optionalDependencies in web/package.json. Keep them in sync on major bumps.
- React runs passive effects children-first: register API credentials in a layout
  effect or the child's first fetch goes out unauthenticated. And never write an
  effect that sets its own dependency state while registering a cancelling
  cleanup; it discards its own result (the chart-probe bug, fixed on web and app).
- asyncpg caps one statement at 32767 bind parameters; sample upserts chunk
  via the SAMPLE_UPSERT_CHUNK_ROWS setting (clamped to 4000 rows). The first
  dense intraday backfill (Apple Watch) found this in production.
- arq refuses to enqueue a job id while a previous result for it is retained,
  including FAILED results; backfill ids fold in the full date range so a
  user sync always runs. Never key a dedupe id coarser than the retry intent.
- Connection events trigger our own backfills (immediate plus deferred 5
  minutes); first data does not depend on historical webhooks arriving.
- The Vital Connect bridge app requests a limited HealthKit type set decided
  on the phone, never via dashboard or API (the scope requirements API
  excludes HealthKit). Full type coverage means the Junction Health SDK in
  our own app. No wearable measures blood pressure; Withings and Omron cuffs
  are Junction providers and the real BP path.
- This machine: Intel Mac, no GNU `timeout`, zsh eats `$VAR:l` (use `${VAR}`),
  use /bin/sleep. Python via uv (.venv in backend/). Terraform state is local.

## Layout

backend/app: api -> services -> models layering; parsing pure in services/ingestion.py.
packages/health-core: shared workspace package (@youth/health-core) with metric
metadata, pure insight math, and API contract types mirroring backend/app/schemas.py;
plain TS source, no build step; root package.json declares the npm workspaces.
web/src: shadcn/ui + Tailwind v4 + motion; insights/metrics come from @youth/health-core.
app/src: Expo + NativeWind + victory-native Skia charts; shares @youth/health-core with
web. infra/terraform: full AWS stack. postman/: API collection.
