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

## 5. Founder session script (2026-06-11, arrive 08:00-09:30, demo 10:45)

The goal of the morning block: Filippo runs the WHOOP and Oura flow end to end on his
own, Johannes pairs his Apple Watch, and by 10:45 the dashboard shows real readings.

### 08:00 warm-up (solo, before founders arrive)

```bash
curl -s https://api.examplehealth.example.com/health        # API up
./scripts/seed-sample.sh API=https://api.examplehealth.example.com   # fresh sample account
```

Open app.examplehealth.example.com in a private window: landing shows Sign in and Try the demo.
Click Try the demo once; the guest path must land on Devices with working connect
buttons. Open Expo Go on the phone, force quit and reopen to pull the latest update.

### 08:30 reset for Filippo (he runs the WHOLE flow himself)

My real devices are currently connected under my Google sign-in. Disconnect them in
the UI (Devices, Disconnect on each) so Filippo starts from zero. If a stray test
user needs to go away entirely, erase it server-side:

```bash
curl -s -X DELETE "https://api.examplehealth.example.com/v1/users/<id>" -H "X-API-Key: $TOKEN" -i
# 204: providers deregistered at Aggregator, local data gone, audit log retained
```

Then hand Filippo the laptop or phone and stay hands-off:

1. He signs in (or uses my session if accounts are a distraction).
2. Devices, Connect, picks WHOOP. Aggregator Link opens; he signs in with his WHOOP
   account and accepts the consent screen.
3. Repeat for Oura.
4. **Data unlock, the one step software cannot do:** he opens the WHOOP app and the
   Oura app on HIS phone so the devices sync to the vendor cloud. Aggregator only sees
   what the vendor cloud has. Until this happens, charts honestly say they are waiting.
5. Back in our app: Sync now, then watch the timeline fill. SSE pushes new points
   without a refresh.

### 09:00 Apple Watch with Johannes

```bash
./scripts/make-apple-code.sh     # mints a single-use pairing code, mint it fresh
```

1. Johannes installs **Aggregator Connect** from the App Store on his iPhone.
2. He enters the pairing code in the app, then grants HealthKit access (read).
3. Apple Watch data flows through HealthKit; first readings usually arrive within
   minutes of granting access while the app is foregrounded.

### 10:45 the demo itself (15 to 20 minutes)

1. **Open with the live dashboard**, real WHOOP and Oura data from the morning. The
   story: this morning Filippo connected his own devices in under two minutes.
2. **Guest demo path**: private window, Try the demo, connect a demo wearable, watch
   the backfill stream in over SSE. This shows the product works with zero setup.
3. **Mobile**: same account on Expo Go, haptics and charts. Hand the phone over.
4. **Engine room** (for the technical thread): one terminal tailing the API logs
   while a webhook lands, then the architecture walkthrough from docs/architecture.md
   and the scaling story from docs/presentation.md.
5. **Close with the ledger**: device_events shows every consent transition with actor
   attribution, and erasure is one service call. Health data demands this on day one.

If WiFi or AWS fails: `docker compose up -d`, `cd web && npm run dev`, and replay
webhooks from the Postman collection. The demo survives offline.

## 6. Teardown (after the challenge)

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
