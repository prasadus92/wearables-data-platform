#!/usr/bin/env bash
# Seed the shared sample account: a sandbox user named "wearables-sample" with a
# demo wearable connected and a synced 30-day history. Safe to rerun.
#
# Usage:
#   ./scripts/seed-sample.sh                          # local backend
#   API=https://api.wearables.example.com ./scripts/seed-sample.sh   # deployed
set -euo pipefail

cd "$(dirname "$0")/.."
API=${API:-http://localhost:8000}
TOKEN=$(grep '^API_AUTH_TOKEN=' .env | cut -d= -f2)
H=(-H "X-API-Key: $TOKEN" -H 'content-type: application/json')

USER_JSON=$(curl -s "${H[@]}" -X POST "$API/v1/users" -d '{"client_user_id": "wearables-sample"}')
USER_ID=$(echo "$USER_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
echo "sample user: $USER_ID"

# Demo connects are idempotent enough for reruns; ignore already-connected noise.
curl -s "${H[@]}" -X POST "$API/v1/users/$USER_ID/devices/demo" -d '{"provider": "oura"}' > /dev/null || true
curl -s "${H[@]}" -X POST "$API/v1/users/$USER_ID/devices/demo" -d '{"provider": "fitbit"}' > /dev/null || true

curl -s "${H[@]}" -X POST "$API/v1/users/$USER_ID/sync" | python3 -m json.tool
echo "Seeded. Charts populate within a minute or two."
