#!/usr/bin/env bash
# Mint a Aggregator Connect pairing code so an iPhone (and its Apple Watch) can
# join a user via the App Store "Aggregator Connect" app: Settings, enter code.
# Codes are single-use and expire quickly; mint right before pairing.
#
# Usage: ./scripts/make-apple-code.sh [client_user_id]   (default: the demo identity)
set -euo pipefail

cd "$(dirname "$0")/.."
CLIENT_USER_ID=${1:-prasad-prod-real-devices}
KEY=${AGGREGATOR_PROD_API_KEY:-$(grep '^AGGREGATOR_PROD_API_KEY=' .env | cut -d= -f2)}
BASE=https://api.eu.aggregator.com

JUID=$(curl -s "$BASE/v2/user/resolve/$CLIENT_USER_ID" -H "x-vital-api-key: $KEY" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('user_id',''))")
if [[ -z "$JUID" ]]; then
  JUID=$(curl -s -X POST "$BASE/v2/user" -H "x-vital-api-key: $KEY" \
    -H 'content-type: application/json' -d "{\"client_user_id\": \"$CLIENT_USER_ID\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['user_id'])")
fi

curl -s -X POST "$BASE/v2/link/code/create?user_id=$JUID" -H "x-vital-api-key: $KEY" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('Pairing code:', d['code']); print('Expires:', d['expires_at'])"
