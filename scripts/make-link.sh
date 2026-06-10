#!/usr/bin/env bash
# Generate a Aggregator Link URL for connecting a real wearable account.
#
# Usage:
#   ./scripts/make-link.sh oura            (production, default user)
#   ./scripts/make-link.sh whoop_v2
#   ./scripts/make-link.sh garmin my-user-id
#
# The URL expires in 60 minutes. Open it in a browser, sign in to the
# provider with the device account, and click Approve on the consent screen.
set -euo pipefail

PROVIDER=${1:?usage: make-link.sh <provider> [client_user_id]}
CLIENT_USER_ID=${2:-prasad-prod-real-devices}

# Production EU key, from .env (AGGREGATOR_PROD_API_KEY) or environment.
cd "$(dirname "$0")/.."
KEY=${AGGREGATOR_PROD_API_KEY:-$(grep '^AGGREGATOR_PROD_API_KEY=' .env | cut -d= -f2)}
BASE=https://api.eu.aggregator.com

# Resolve or create the Aggregator user for this client_user_id.
JUID=$(curl -s "$BASE/v2/user/resolve/$CLIENT_USER_ID" -H "x-vital-api-key: $KEY" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('user_id',''))")
if [[ -z "$JUID" ]]; then
  JUID=$(curl -s -X POST "$BASE/v2/user" -H "x-vital-api-key: $KEY" \
    -H 'content-type: application/json' -d "{\"client_user_id\": \"$CLIENT_USER_ID\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['user_id'])")
fi

curl -s -X POST "$BASE/v2/link/token" -H "x-vital-api-key: $KEY" \
  -H 'content-type: application/json' \
  -d "{\"user_id\": \"$JUID\", \"provider\": \"$PROVIDER\"}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('link_web_url') or json.dumps(d))"
