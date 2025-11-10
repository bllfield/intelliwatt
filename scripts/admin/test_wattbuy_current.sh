#!/usr/bin/env bash

set -euo pipefail

: "${BASE_URL:?Set BASE_URL}"
: "${ADMIN_TOKEN:?Set ADMIN_TOKEN}"
: "${CRON_SECRET:?Set CRON_SECRET}"

pp() { if command -v jq >/dev/null 2>&1; then jq -c .; else cat; fi; }
sc() { awk 'NR==1 {print $2}'; }
req() {
  local method="$1" url="$2";
  shift 2 || true
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

# --------- WATTBUY (current) ---------

ADDR="9514 Santa Paula Dr"
CITY="Fort Worth"
STATE="tx"
ZIP="76116"

echo -e "\n>> WATTBUY ELECTRICITY (robust)"
req GET "$BASE_URL/api/admin/wattbuy/electricity-probe?address=$(python - <<<'import urllib.parse,sys;print(urllib.parse.quote(sys.stdin.read().strip()))' <<<"$ADDR")&city=$(python - <<<'import urllib.parse,sys;print(urllib.parse.quote(sys.stdin.read().strip()))' <<<"$CITY")&state=$STATE&zip=$ZIP" \
  -H "x-admin-token: $ADMIN_TOKEN"

# NOTE: electricity-save endpoint does not exist yet - uncomment when implemented
# echo -e "\n>> WATTBUY ELECTRICITY SAVE (persists snapshot)"
# req GET "$BASE_URL/api/admin/wattbuy/electricity-save?address=$(python - <<<'import urllib.parse,sys;print(urllib.parse.quote(sys.stdin.read().strip()))' <<<"$ADDR")&city=$(python - <<<'import urllib.parse,sys;print(urllib.parse.quote(sys.stdin.read().strip()))' <<<"$CITY")&state=$STATE&zip=$ZIP" \
#   -H "x-admin-token: $ADMIN_TOKEN"

echo -e "\n>> RETAIL RATES (explicit Oncor 44372)"
req GET "$BASE_URL/api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx" -H "x-admin-token: $ADMIN_TOKEN"

echo -e "\n>> RETAIL RATES (by address w/ alternates)"
req GET "$BASE_URL/api/admin/wattbuy/retail-rates-by-address?address=$(python - <<<'import urllib.parse,sys;print(urllib.parse.quote(sys.stdin.read().strip()))' <<<"$ADDR")&city=$(python - <<<'import urllib.parse,sys;print(urllib.parse.quote(sys.stdin.read().strip()))' <<<"$CITY")&state=$STATE&zip=$ZIP" \
  -H "x-admin-token: $ADMIN_TOKEN"

echo -e "\n>> RETAIL RATES (zip auto-derive)"
req GET "$BASE_URL/api/admin/wattbuy/retail-rates-zip?zip=75201" -H "x-admin-token: $ADMIN_TOKEN"

