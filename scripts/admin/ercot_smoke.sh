#!/usr/bin/env bash
set -euo pipefail

ADMIN_TOKEN="${ADMIN_TOKEN:-}"
CRON_SECRET="${CRON_SECRET:-}"
BASE_URL="${BASE_URL:-https://intelliwatt.com}"
MANUAL_FILE_URL="${MANUAL_FILE_URL:-}" 

if [[ -z "$ADMIN_TOKEN" || -z "$CRON_SECRET" ]]; then
  echo "Usage: ADMIN_TOKEN=... CRON_SECRET=... BASE_URL=https://intelliwatt.com MANUAL_FILE_URL='' ./scripts/admin/ercot_smoke.sh"
  exit 1
fi

echo "== ERCOT Smoke (bash) =="
echo "Base: $BASE_URL"

echo
echo "[A] Trigger cron (GET)"
curl -sS -X GET "$BASE_URL/api/admin/ercot/cron" -H "x-cron-secret: $CRON_SECRET" | jq .

echo
echo "[B] Recent ingests"
curl -sS "$BASE_URL/api/admin/ercot/ingests" -H "x-admin-token: $ADMIN_TOKEN" | jq .

if [[ -n "$MANUAL_FILE_URL" ]]; then
  echo
  echo "[C] Manual fetch"
  ENC_URL="$(python3 - <<'PY'
import urllib.parse, os
print(urllib.parse.quote(os.environ.get('MANUAL_FILE_URL', ''), safe=''))
PY
)"
  curl -sS -X POST "$BASE_URL/api/admin/ercot/fetch-latest?url=$ENC_URL&notes=manual%20smoke" -H "x-admin-token: $ADMIN_TOKEN" | jq .
fi
