#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:?Set BASE_URL}"
: "${ADMIN_TOKEN:?Set ADMIN_TOKEN}"
: "${CRON_SECRET:?Set CRON_SECRET}"

pp() { if command -v jq >/dev/null 2>&1; then jq -c .; else cat; fi; }
sc() { awk 'NR==1 {print $2}'; }

req() {
  local method="$1" url="$2";
  shift 2
  curl -sS -D /tmp/h.$$ -o /tmp/b.$$ -X "$method" "$url" "$@"
  echo "Status: $(sc </tmp/h.$$)"
  cat /tmp/b.$$ | pp
  rm -f /tmp/h.$$ /tmp/b.$$
}

echo ">> PING (no token)"
req GET "$BASE_URL/api/ping"

echo -e "\n>> ENV HEALTH (admin token)"
req GET "$BASE_URL/api/admin/env-health" -H "x-admin-token: $ADMIN_TOKEN"

echo -e "\n>> CRON ECHO (cron secret)"
req GET "$BASE_URL/api/admin/ercot/debug/echo-cron" -H "x-cron-secret: $CRON_SECRET"

echo -e "\n>> ERCOT CRON (manual trigger)"
req GET "$BASE_URL/api/admin/ercot/cron" -H "x-cron-secret: $CRON_SECRET"

echo -e "\n>> WATTBUY PROBE (admin)"
req POST "$BASE_URL/api/admin/wattbuy/probe-offers" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"zip5":"76107","state":"TX"}'

echo -e "\n>> PUBLIC OFFERS (no token)"
req GET "$BASE_URL/api/offers?zip5=76107"

echo -e "\n>> RECENT OFFERS (admin)"
req GET "$BASE_URL/api/admin/offers/recent?limit=25" -H "x-admin-token: $ADMIN_TOKEN"
