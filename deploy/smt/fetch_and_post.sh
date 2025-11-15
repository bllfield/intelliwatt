#!/usr/bin/env bash
set -euo pipefail

SOURCE_TAG="${SOURCE_TAG:-adhocusage}"
METER_DEFAULT="${METER_DEFAULT:-M1}"

log() {
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    log "Missing env: ${name}"
    exit 1
  fi
}

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    log "Required command not found: $name"
    exit 1
  fi
}

require ADMIN_TOKEN
require INTELLIWATT_BASE_URL
require SMT_HOST
require SMT_USER
require SMT_KEY
require SMT_REMOTE_DIR
require SMT_LOCAL_DIR

require_cmd sftp
require_cmd jq
require_cmd curl
require_cmd sha256sum
require_cmd base64
require_cmd find
require_cmd stat

mkdir -p "$SMT_LOCAL_DIR"
cd "$SMT_LOCAL_DIR"

SEEN_FILE=".posted_sha256"
if [[ ! -f "$SEEN_FILE" ]]; then
  touch "$SEEN_FILE"
fi

BATCH_FILE="$(mktemp)"
RESP_FILE="$(mktemp)"
trap 'rm -f "$BATCH_FILE" "$RESP_FILE"' EXIT

log "Starting SFTP sync from ${SMT_USER}@${SMT_HOST}:${SMT_REMOTE_DIR}"
cat >"$BATCH_FILE" <<BATCH
cd ${SMT_REMOTE_DIR}
lcd ${SMT_LOCAL_DIR}
mget -p -r *
BATCH
if ! sftp -i "$SMT_KEY" -oStrictHostKeyChecking=accept-new "${SMT_USER}@${SMT_HOST}" <"$BATCH_FILE"; then
  log "WARN: sftp returned non-zero; continuing with any downloaded files"
fi

mapfile -t FILES < <(find "$SMT_LOCAL_DIR" -maxdepth 2 -type f -name '*.csv' -print | sort)
if (( ${#FILES[@]} == 0 )); then
  log "No CSV files discovered; exiting"
  exit 0
fi

for f in "${FILES[@]}"; do
  sha256=$(sha256sum "$f" | awk '{print $1}')
  if grep -qx "$sha256" "$SEEN_FILE"; then
    log "Skipping already-posted file: $f"
    continue
  fi

  bn="$(basename "$f")"
  esiid_guess=$(echo "$bn" | grep -oE '10[0-9]{16}' || true)
  meter_guess=$(echo "$bn" | grep -oE 'M[0-9]+' || true)

  esiid="${esiid_guess:-$(printf '%s' "${ESIID_DEFAULT:-}" | tr -d $'\r\n')}"
  meter="${meter_guess:-$METER_DEFAULT}"

  captured_at=$(date -u -d @"$(stat -c %Y "$f")" +"%Y-%m-%dT%H:%M:%SZ")
  size_bytes=$(stat -c %s "$f")

  url="${INTELLIWATT_BASE_URL%/}/api/admin/smt/pull"
  log "Posting inline payload: $bn → $url (esiid=${esiid:-N/A}, meter=$meter, size=$size_bytes)"

  # Build the JSON body via python3 to avoid jq argument-length limits
  json=$(
    SMT_FILE_PATH="$f" \
    SMT_SOURCE_TAG="$SOURCE_TAG" \
    SMT_ESIID="$esiid" \
    SMT_METER="$meter" \
    SMT_CAPTURED_AT="$captured_at" \
    SMT_SIZE_BYTES="$size_bytes" \
    python3 - << 'PY'
import base64, json, os, sys

path      = os.environ["SMT_FILE_PATH"]
source    = os.environ.get("SMT_SOURCE_TAG", "")
esiid     = os.environ.get("SMT_ESIID", "")
meter     = os.environ.get("SMT_METER", "")
captured  = os.environ.get("SMT_CAPTURED_AT", "")
size_str  = os.environ.get("SMT_SIZE_BYTES", "0")

with open(path, "rb") as fh:
    data = fh.read()

body = {
    "mode": "inline",
    "source": source,
    "filename": os.path.basename(path),
    "mime": "text/csv",
    "encoding": "base64",
    "sizeBytes": int(size_str),
    "esiid": esiid,
    "meter": meter,
    "captured_at": captured,
    "content_b64": base64.b64encode(data).decode("ascii"),
}

# Compact JSON since this can be large
print(json.dumps(body, separators=(",", ":")))
PY
  )

  http_code=$(
    printf '%s' "$json" | curl -sS -o "$RESP_FILE" -w "%{http_code}" \
      -X POST "$url" \
      -H "x-admin-token: $ADMIN_TOKEN" \
      -H "content-type: application/json" \
      --data-binary @- 2>/dev/null || echo "000"
  )

  if [[ "$http_code" == "200" || "$http_code" == "201" ]]; then
    log "POST success ($http_code): $(jq -c '.' "$RESP_FILE" 2>/dev/null || cat "$RESP_FILE")"
    echo "$sha256" >>"$SEEN_FILE"
  else
    log "POST failed ($http_code): $(cat "$RESP_FILE")"
  fi

done

log "Ingest run complete"
