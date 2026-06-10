# YOU(th) Wearables Platform

Wearable data integration for the YOU(th) app, built on [Junction](https://docs.junction.com) as the wearable data provider. Users connect WHOOP / Oura / Garmin / Apple Watch; the platform ingests biometrics (heart rate, HRV, SpO₂, respiratory rate, blood pressure) via Junction webhooks, stores them as time series, and serves them to the app for timeline charts.

## Repository layout

| Path | What it is |
|---|---|
| `backend/` | FastAPI service: Junction webhook ingestion, user/device management, timeseries query API |
| `web/` | Web dashboard: connect-device flow, device list, timeline charts |
| `app/` | Expo (React Native) mobile app mirroring the YOU(th) Figma flows |
| `docs/` | Architecture diagrams (draw.io), scaling strategy, presentation notes |
| `postman/` | Postman collection for the public API |
| `infra/` | Deployment configuration (AWS) |

## Quick start

```bash
cp .env.example .env   # fill in Junction credentials
docker compose up --build
```

API docs at http://localhost:8000/docs once running.

## Architecture (MVP)

```
Junction ──webhooks──▶ FastAPI /webhooks/junction ──▶ queue ──▶ worker ──▶ Postgres (timeseries)
                                                                              ▲
Web / Expo app ◀──── REST /v1/timeseries, /v1/devices, /v1/link ─────────────┘
```

See `docs/` for the full system diagrams and the 10k → 50M user scaling strategy.
