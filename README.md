# YOU(th) Wearables Platform

Wearable data integration for the YOU(th) app, built on [Junction](https://docs.junction.com) as the wearable data provider. Users connect WHOOP / Oura / Garmin / Fitbit / Apple Watch; the platform ingests biometrics (heart rate, HRV, SpO2, respiratory rate, blood pressure) via signed Junction webhooks, normalizes them into one time series model, and serves web and mobile timeline charts that update live over SSE.

Live: dashboard at https://app.youth.luminik.io, API docs at https://api.youth.luminik.io/docs.

What is in the box beyond ingestion and charts:

- **Two doors, two worlds.** Try the demo mints an anonymous guest with a demo wearable attached and a timeline that fills within minutes; signing in (Clerk) is Live, with real devices on the account. No mode switching inside the web app.
- **Real wearable reality.** Demo wearables emit direct biomarker streams; real Oura and WHOOP deliver heart rate, HRV, and breathing rate inside nightly sleep summaries. The pipeline normalizes both shapes into the same samples.
- **Triple auth.** Service key for machines, Clerk JWTs for people, one-time guest tokens for anonymous sessions; ownership scoping answers 404, never 403.
- **Consent ledger and erasure.** `device_events` records every connect, disconnect, and identity change with actor attribution; one service call erases a user locally and at Junction.
- **Both Junction environments through one deployment.** Users carry their environment; webhooks, clients, and secrets resolve per environment.

## Repository layout

| Path | What it is |
|---|---|
| `backend/` | FastAPI service: Junction webhook ingestion, user/device management, timeseries query API |
| `web/` | Web dashboard: connect-device flow, device list, timeline charts |
| `app/` | Expo (React Native) mobile app mirroring the YOU(th) Figma flows |
| `packages/health-core` | Shared TypeScript package: metric metadata, provider capability map, insight math, API contract types |
| `docs/` | Architecture (Mermaid + draw.io), auth model, scaling strategy, runbook, presentation notes |
| `scripts/` | Junction link URLs, demo seeding, Apple Watch pairing codes |
| `postman/` | Postman collection for the public API |
| `infra/` | Deployment configuration (AWS) |

## Quick start

```bash
cp .env.example .env   # fill in Junction credentials
docker compose up --build
```

API docs at http://localhost:8000/docs once running. Backend tests: `cd backend && .venv/bin/python -m pytest tests/ -q` (83 tests against real Postgres). Web: `cd web && npm run dev`. Mobile: `cd app && npx expo start`.

Deploys run from GitHub Actions on every merge to main (backend to ECS, web to CloudFront via S3); `infra/` holds the full Terraform stack.

## Architecture (MVP)

```
Junction ──webhooks──▶ FastAPI /webhooks/junction ──▶ queue ──▶ worker ──▶ Postgres (timeseries)
                                                                              ▲
Web / Expo app ◀──── REST /v1/timeseries, /v1/devices, /v1/link ─────────────┘
```

See [docs/architecture.md](docs/architecture.md) for the full system diagrams and the 10k to 50M user scaling strategy, [docs/authentication.md](docs/authentication.md) for the auth model and its production hardening queue, [docs/insights.md](docs/insights.md) for how the typical range and insight sentences are computed, and [docs/demo-runbook.md](docs/demo-runbook.md) for every manual step.
