# Setup Journal: How This Was Wired Together

Every one-time setup action taken outside the codebase, in order, with the reasoning.
Useful for "how did you build it", for reproducing the setup, and for teardown.

## 1. Junction team

- Own team "Prasad's Onsite" (org: YOU(th) Junction org, Prasad as Org Admin), under
  prasadus92@gmail.com. Sandbox and Production environments, EU region.
- API keys generated from the dashboard: sandbox `sk_eu_...`, production `pk_eu_...`
  (key prefix encodes the environment; both live in the repo `.env`, never committed).
- The challenge doc's shared key turned out to be dead (401 "not authorized"), which is
  why a fresh team was the right move.

## 2. Webhooks (both environments)

Dashboard → team → environment → Webhooks → Add Endpoint:

- URL (same for both): `https://api.youth.luminik.io/webhooks/junction`
- Subscribed to all event types (connection lifecycle, daily.data.*, historical.data.*).
- Copied each environment's Svix signing secret into `.env`
  (`JUNCTION_WEBHOOK_SECRET` = sandbox, `JUNCTION_PROD_WEBHOOK_SECRET` = production),
  then `APPLY=1 ./infra/deploy.sh` to push them into SSM and roll ECS.
- The service verifies inbound signatures against both secrets, since both environments
  target the same route.

## 3. WHOOP BYOO (the provider that needs its own OAuth app)

WHOOP refuses aggregator-shared credentials, so every Junction team needs its own WHOOP
developer app before the WHOOP connect flow works at all. Steps taken:

1. developer.whoop.com → signed in with the founder-provided WHOOP account.
2. Created app "Prasad's Onsite (Test App)" with:
   - Redirect URIs (must exactly match what Junction sends):
     `https://api.eu.junction.com/v2/link/connect/whoop_v2`
     plus the legacy-domain and sandbox variants for safety.
   - Scopes: `read:recovery`, `read:cycles`, `read:sleep`, `read:workout`,
     `read:profile`, `read:body_measurement`, and `offline` (refresh tokens; without it
     connections die at first token expiry).
   - Webhook URL: left empty (WHOOP-to-Junction delivery is Junction's concern).
3. Junction Dashboard → Production → Config → Custom Credentials → Whoop V2 → Setup:
   pasted the WHOOP client ID + secret. Row flipped to Active.
4. Note: unapproved WHOOP apps cap at 10 connected members (fine for a demo); WHOOP
   reviews apps monthly for the cap lift.

## 4. Real device connections (production)

- Connections happen via Junction's hosted Link page, never the provider dashboards:
  `./scripts/make-link.sh <provider>` prints a URL (60-minute expiry), open, sign in
  with the device account, Accept.
- Oura: connected first try with the founder's account.
- WHOOP: 401 at the OAuth exchange before BYOO was configured (expected; this verified
  the BYOO requirement), connected cleanly after step 3.
- Garmin: skipped, no physical device available.
- Data availability depends on the provider cloud having recent wear data from the
  physical device; connections can be live while timeseries are still empty.

## 5. AWS

- Account: existing org SSO (`AWS_PROFILE=luminik`), region eu-central-1 to match the
  Junction EU data residency.
- Everything via Terraform (`infra/terraform`): ECS Fargate (api x2, worker), RDS
  Postgres 16 (db.t4g.micro), ElastiCache Redis, ALB + ACM cert, Route53 record
  `api.youth.luminik.io` on an existing hosted zone, ECR, SSM SecureString secrets,
  CloudWatch logs.
- Deploys: `./infra/deploy.sh` (build, push, roll); `APPLY=1` prefix when Terraform
  changed. Cost ~$3.50/day; teardown is `terraform destroy`.

## 6. Teardown list (after the challenge)

- `terraform destroy` (infra), delete the WHOOP dev app (or rotate its secret), rotate
  or delete both Junction API keys, change the shared device-account password, remove
  the webhook endpoints, delete sandbox demo users.
