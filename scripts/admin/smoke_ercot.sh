#!/usr/bin/env bash
# Smoke test for ERCOT daily ingest routes.
# Usage:
#   BASE="https://intelliwatt.com" CRON_SECRET="..." ./scripts/admin/smoke_ercot.sh

set -euo pipefail

BASE="${BASE:-}"
CRON_SECRET="${CRON_SECRET:-}"

if [[ -z "${BASE}" ]]; then
  echo "ERROR: Set BASE (e.g., https://intelliwatt.com)" >&2
  exit 1
fi

echo "== Health (vercel-cron header simulation) =="
curl -sS -H "x-vercel-cron: 1" "$BASE/api/admin/ercot/cron/health" | jq

if [[ -n "${CRON_SECRET}" ]]; then
  echo
  echo "== Health (token mode) =="
  curl -sS "$BASE/api/admin/ercot/cron/health?token=${CRON_SECRET}" | jq

  echo
  echo "== Manual run (token mode) =="
  curl -sS "$BASE/api/admin/ercot/cron?token=${CRON_SECRET}" | jq
else
  echo
  echo "NOTE: CRON_SECRET not provided; skipping token-mode calls."
fi

