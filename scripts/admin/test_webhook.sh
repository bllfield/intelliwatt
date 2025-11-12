#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/admin/test_webhook.sh [URL] [SECRET]

Sends a JSON ping to the droplet webhook to confirm it accepts the shared secret
and returns a 200 OK.

Defaults:
  URL    <- env DROPLET_WEBHOOK_URL (or INTELLIWATT_WEBHOOK_URL)
  SECRET <- env INTELLIWATT_WEBHOOK_SECRET (or DROPLET_WEBHOOK_SECRET)

Example:
  DROPLET_WEBHOOK_URL=http://64.225.25.54:8787/trigger/smt-now \
  INTELLIWATT_WEBHOOK_SECRET=sk_xyz \
    scripts/admin/test_webhook.sh
USAGE
}

URL="${1:-${DROPLET_WEBHOOK_URL:-${INTELLIWATT_WEBHOOK_URL:-}}}"
SECRET="${2:-${INTELLIWATT_WEBHOOK_SECRET:-${DROPLET_WEBHOOK_SECRET:-}}}"

if [[ -z "$URL" || -z "$SECRET" ]]; then
  usage >&2
  exit 1
fi

payload=$(jq -n --arg reason "webhook_smoke" --argjson ts "$(date +%s000)" '{reason: $reason, ts: $ts, ping: true}')

printf 'POST %s\n' "$URL"
response=$(printf '%s' "$payload" | curl -sS -D - -o - \
  -H "content-type: application/json" \
  -H "x-intelliwatt-secret: $SECRET" \
  -H "x-smt-secret: $SECRET" \
  -H "x-webhook-secret: $SECRET" \
  --data-binary @- \
  "$URL")

printf '%s\n' "$response"
