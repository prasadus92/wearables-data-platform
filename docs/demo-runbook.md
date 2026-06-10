# Demo Runbook

Every manual step in the system, written so the demo never depends on memory or chat
history. All commands run from the repo root. `$TOKEN` is `API_AUTH_TOKEN` from `.env`.

## 0. Pre-demo checklist (run the morning of)

```bash
curl -s https://api.examplehealth.example.com/health            # expect {"status":"ok",...}
docker compose up -d && curl -s localhost:8000/health  # local fallback stack
cd web && npm run dev                                  # dashboard on :5173
```

If AWS is down or unreachable, the entire demo runs locally: same compose stack, same
dashboard, simulated webhooks from the Postman collection.

## 1. Connecting a REAL wearable (production, physical device)

The provider dashboards (oura.com, whoop.com) are irrelevant here. Connections happen
through Aggregator's hosted Link page:

```bash
./scripts/make-link.sh oura       # or whoop_v2, garmin, fitbit
```

1. The script prints a `https://link.tryvital.io/?token=...` URL. **It expires in 60
   minutes**; regenerate freely, old ones simply stop working.
2. Open it in a browser. Aggregator forwards to the provider's OAuth consent screen.
3. Sign in with the device account (e.g. `nigrofilippo95@gmail.com`) if not already
   logged in, then click **Accept / Authorize** on the consent screen.
4. Success screen appears; the connection now exists in the Aggregator team.
5. Verify data server-side:

```bash
KEY=$(grep '^AGGREGATOR_PROD_API_KEY=' .env | cut -d= -f2)
curl -s "https://api.eu.aggregator.com/v2/user/resolve/prasad-prod-real-devices" \
  -H "x-vital-api-key: $KEY"     # shows connected_sources
```

Failure modes:
- WHOOP consent page errors out: WHOOP needs BYOO custom credentials in the team
  (Dashboard, Config, Custom Credentials, Whoop V2). See architecture notes.
- "Token expired": regenerate with the script.

## 2. Demo flow on the deployed stack (sandbox, no physical device)

This is the fully automated path and the core demo. One command-equivalent each:

```bash
API=https://api.examplehealth.example.com
# 1. Create a user (registers with Aggregator automatically)
curl -s -X POST $API/v1/users -H "X-API-Key: $TOKEN" \
  -H 'content-type: application/json' -d '{"client_user_id": "demo-live-1"}'
# 2. Attach a demo wearable (oura or fitbit) with 30 days of synthetic data
curl -s -X POST $API/v1/users/<id>/devices/demo -H "X-API-Key: $TOKEN" \
  -H 'content-type: application/json' -d '{"provider": "oura"}'
# 3. Wait ~2 minutes. Aggregator sends provider.connection.created, then
#    historical.data.* webhooks; workers backfill automatically.
# 4. Chart it
curl -s "$API/v1/users/<id>/timeseries/heartrate?resolution=day" -H "X-API-Key: $TOKEN"
```

Or do all of it from the dashboard UI (Connect, then watch the chart fill via SSE).
If data seems slow, the "sync now" button (or `POST /v1/users/<id>/sync`) forces it.

## 3. Webhook registration (one-time per environment, already done for sandbox)

Aggregator Dashboard, team "Prasad's Onsite", pick environment (Sandbox/Production):
Webhooks → Add Endpoint → `https://api.examplehealth.example.com/webhooks/aggregator` →
subscribe to all event types → copy the **Signing Secret** (`whsec_...`).

Then store it and roll the services:

```bash
# put the secret in .env as AGGREGATOR_WEBHOOK_SECRET, then:
AWS_PROFILE=default APPLY=1 ./infra/deploy.sh
```

## 4. Useful inspection commands during the demo

```bash
# Watch webhooks arriving live (CloudWatch)
AWS_PROFILE=default aws logs tail /ecs/wearables-data-platform-api --region eu-central-1 --follow

# Watch the worker processing
AWS_PROFILE=default aws logs tail /ecs/wearables-data-platform-worker --region eu-central-1 --follow

# SSE stream (shows update events as data lands)
curl -N "https://api.examplehealth.example.com/v1/users/<id>/stream?api_key=$TOKEN"
```

## 5. Teardown (after the challenge)

```bash
cd infra/terraform
AWS_PROFILE=default terraform destroy   # removes ALB, ECS, RDS, Redis, everything
```

Also rotate/delete afterwards: the Aggregator API keys, the WHOOP/Oura account password
shared during the challenge, and the GitHub repo visibility if it stays private.

## Known traps

- Link URLs die after 60 minutes. Regenerate, do not debug.
- Aggregator sandbox caps at 50 users; demo users expire after 7 days.
- WHOOP and Garmin have NO sandbox demo data; sandbox demos use oura/fitbit.
- `POST /v2/user/refresh` is limited to 8/hour/user; the sync endpoint tolerates this.
- EventSource cannot send headers; the SSE URL carries `?api_key=`.
