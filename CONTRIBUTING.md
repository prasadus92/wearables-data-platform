# Contributing

## Workflow

Feature branch, PR, squash merge. CI runs the backend suite on every PR;
merging to main deploys backend (ECS) and web (CloudFront) automatically.
Mobile ships over EAS Update from `app/` (`npx eas-cli update --branch
production --environment production`).

## Gates before any PR

- Backend: `cd backend && .venv/bin/ruff check app tests && .venv/bin/python -m pytest tests/ -q`
  (compose Postgres and Redis must be up; tests never use sqlite)
- Web: `cd web && npm run build`
- Mobile: `cd app && npx tsc --noEmit && npx expo export --platform ios`

## Conventions that are enforced socially, not by tooling

- Tests are value-bearing: they exist to catch a real failure mode, never for
  coverage numbers. Integration tests run against real Postgres.
- Webhook ingestion stays idempotent end to end: dedupe on the Svix message
  id, samples upsert on (user, metric, ts, provider). Any new resource parser
  must keep replays safe.
- User-facing copy never names vendors or environments; the product words are
  Demo and Live. Empty states carry a working CTA. Insight copy describes
  data relative to the person's own history and never judges health.
- The shared contract lives in packages/health-core and mirrors
  backend/app/schemas.py; change them together.

## Where to start reading

README.md, then docs/architecture.md (system and scaling),
docs/authentication.md (auth model and hardening queue), docs/insights.md
(the math behind the words), docs/recommendation-system.md (where this goes).
