#!/usr/bin/env bash
set -euo pipefail

: "${ADMIN_TOKEN:?set ADMIN_TOKEN}"
: "${BASE_URL:?set BASE_URL}"
: "${ZIP5:?set ZIP5}"

CITY="${CITY:-}"
STATE="${STATE:-TX}"

HDR=(-H "x-admin-token: $ADMIN_TOKEN")

echo "== WattBuy Offers Smoke (bash) =="
echo "Base:  $BASE_URL"
echo "ZIP5:  $ZIP5"
[[ -n "$CITY" ]] && echo "City:  $CITY"
echo "State: $STATE"

echo
echo "[PROBE]"
curl -sS -X POST "$BASE_URL/api/admin/wattbuy/probe-offers" "${HDR[@]}" \
  -H "content-type: application/json" \
  -d "{\"zip5\":\"$ZIP5\",\"city\":\"$CITY\",\"state\":\"$STATE\"}" | jq .

echo
echo "[OFFERS]"
curl -sS "$BASE_URL/api/offers?zip5=$ZIP5&city=$CITY&state=$STATE" | jq .

# Optional: admin offers listing if available
# curl -sS "$BASE_URL/api/admin/offers/recent" "${HDR[@]}" | jq .

