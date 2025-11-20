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

mapfile -t FILES < <(
  find "$SMT_LOCAL_DIR" -maxdepth 2 -type f \
    \( -iname '*.csv' -o -iname '*.csv.*' \) \
    -print | sort
)
if (( ${#FILES[@]} == 0 )); then
  log "No CSV files discovered; exiting"
  exit 0
fi

for file_path in "${FILES[@]}"; do
  sha256=$(sha256sum "$file_path" | awk '{print $1}')
  if grep -qx "$sha256" "$SEEN_FILE"; then
    log "Skipping already-posted file: $file_path"
    continue
  fi

  base="$(basename "$file_path")"
  esiid_guess=$(echo "$base" | grep -oE '10[0-9]{16}' || true)
  meter_guess=$(echo "$base" | grep -oE 'M[0-9]+' || true)

  esiid="${esiid_guess:-$(printf '%s' "${ESIID_DEFAULT:-}" | tr -d $'\r\n')}"
  meter="${meter_guess:-$METER_DEFAULT}"

  captured_at=$(date -u -d @"$(stat -c %Y "$file_path")" +"%Y-%m-%dT%H:%M:%SZ")
  size_bytes=$(stat -c %s "$file_path")
  materialized_file_path="$file_path"
  cleanup_paths=()

  if [[ "$base" == DailyMeterUsage*.asc ]]; then
    log "Materializing daily billing CSV from PGP+ZIP: $base"

    tmp_zip="$(mktemp -p "$SMT_LOCAL_DIR" 'daily_zip_XXXXXX.zip')" || {
      log "Failed to create temp ZIP for $base"
      continue
    }

    tmp_csv="$(mktemp -p "$SMT_LOCAL_DIR" 'daily_csv_XXXXXX.csv')" || {
      log "Failed to create temp CSV for $base"
      rm -f "$tmp_zip"
      continue
    }

    if ! gpg --batch --yes -o "$tmp_zip" -d "$file_path" >/dev/null 2>&1; then
      log "GPG decrypt failed for $base"
      rm -f "$tmp_zip" "$tmp_csv"
      continue
    fi

    if ! unzip -p "$tmp_zip" >"$tmp_csv" 2>/dev/null; then
      log "unzip failed for $base"
      rm -f "$tmp_zip" "$tmp_csv"
      continue
    fi

    materialized_file_path="$tmp_csv"
    cleanup_paths+=("$tmp_zip" "$tmp_csv")

    if size_from_stat=$(stat -c '%s' "$tmp_csv" 2>/dev/null); then
      size_bytes="$size_from_stat"
    else
      size_bytes="$(wc -c < "$tmp_csv" | tr -d ' ')"
    fi

    captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi

  url="${INTELLIWATT_BASE_URL%/}/api/admin/smt/pull"
  log "Posting inline payload: $base → $url (esiid=${esiid:-N/A}, meter=$meter, size=$size_bytes)"

  json=$(
    SMT_SOURCE_TAG="$SOURCE_TAG" \
    SMT_ESIID="$esiid" \
    SMT_METER="$meter" \
    SMT_CAPTURED_AT="$captured_at" \
    SMT_SIZE_BYTES="$size_bytes" \
    SMT_FILE_PATH="$materialized_file_path" \
    python3 << 'PY'
import os
import json
import gzip
import base64
from pathlib import Path

source_tag = os.environ.get("SMT_SOURCE_TAG", "smt-ingest")
esiid = os.environ.get("SMT_ESIID", "")
meter = os.environ.get("SMT_METER", "")
captured_at = os.environ.get("SMT_CAPTURED_AT", "")
try:
    size_bytes = int(os.environ.get("SMT_SIZE_BYTES", "0"))
except ValueError:
    size_bytes = 0

file_path = os.environ["SMT_FILE_PATH"]
path = Path(file_path)
raw_bytes = path.read_bytes()
gzipped = gzip.compress(raw_bytes)

payload = {
    "mode": "inline",
    "source": source_tag,
    "filename": path.name,
    "mime": "text/csv",
    "encoding": "base64+gzip",
    "sizeBytes": size_bytes,
    "compressedBytes": len(gzipped),
    "esiid": esiid,
    "meter": meter,
    "captured_at": captured_at,
    "content_b64": base64.b64encode(gzipped).decode("ascii"),
}

print(json.dumps(payload, separators=(",", ":")), end="")
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

  if ((${#cleanup_paths[@]})); then
    rm -f "${cleanup_paths[@]}"
  fi

done

log "Ingest run complete"
