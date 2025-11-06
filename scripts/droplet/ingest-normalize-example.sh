#!/usr/bin/env bash
set -euo pipefail

set -a
. /home/deploy/smt_ingest/.env
set +a

API="https://intelliwatt.com/api/internal/smt/ingest-normalize"
HDRS=(-H "x-shared-secret: ${SHARED_INGEST_SECRET}" -H "Content-Type: application/json")

# OPTION A: send rows directly (fastest)
cat > /home/deploy/smt_ingest/ingest_rows.json <<'JSON'
{
  "esiid": "1044...AAA",
  "meter": "M1",
  "rows": [
    { "timestamp": "2025-10-30T13:15:00-05:00", "kwh": 0.25 },
    { "start": "2025-10-30T18:00:00-05:00", "end": "2025-10-30T18:15:00-05:00", "value": "0.30" }
  ],
  "saveFilled": true
}
JSON

curl -sS -X POST "$API" "${HDRS[@]}" --data-binary @/home/deploy/smt_ingest/ingest_rows.json | tee /home/deploy/smt_ingest/ingest_rows_resp.json; echo

