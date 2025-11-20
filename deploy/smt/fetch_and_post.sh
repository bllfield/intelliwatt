#!/usr/bin/env bash
set -euo pipefail

SOURCE_TAG="${SOURCE_TAG:-adhocusage}"
METER_DEFAULT="${METER_DEFAULT:-M1}"

log() {
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

MATERIALIZED_TMP_DIR=""

materialize_csv_from_pgp_zip() {
  local asc_path="$1"
  MATERIALIZED_TMP_DIR=""

  if [[ ! "$asc_path" =~ \.asc$ ]]; then
    echo "$asc_path"
    return 0
  fi

  if ! grep -q "BEGIN PGP MESSAGE" "$asc_path" 2>/dev/null; then
    echo "$asc_path"
    return 0
  fi

  local tmp_dir dec_zip inner_name inner_path
  tmp_dir=$(mktemp -d "${SMT_LOCAL_DIR%/}/pgp_tmp.XXXXXX") || {
    log "WARN: materialize_csv_from_pgp_zip: mktemp failed for $asc_path"
    echo "$asc_path"
    return 1
  }

  dec_zip="$tmp_dir/decrypted.zip"
  if ! gpg --batch --yes -o "$dec_zip" -d "$asc_path" >/dev/null 2>&1; then
    log "WARN: materialize_csv_from_pgp_zip: gpg decrypt failed for $asc_path"
    rm -rf "$tmp_dir"
    echo "$asc_path"
    return 1
  }

  inner_name=$(unzip -Z1 "$dec_zip" 2>/dev/null | head -n 1)
  if [ -z "$inner_name" ]; then
    log "WARN: materialize_csv_from_pgp_zip: empty archive for $asc_path"
    rm -rf "$tmp_dir"
    echo "$asc_path"
    return 1
  }

  if ! unzip -p "$dec_zip" "$inner_name" >"$tmp_dir/$inner_name" 2>/dev/null; then
    log "WARN: materialize_csv_from_pgp_zip: unzip failed for $asc_path"
    rm -rf "$tmp_dir"
    echo "$asc_path"
    return 1
  }

  MATERIALIZED_TMP_DIR="$tmp_dir"
  inner_path="$tmp_dir/$inner_name"
  log "Decoded PGP ZIP file: $asc_path -> $inner_path"
  echo "$inner_path"
  return 0
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

  materialized_file_path="$(materialize_csv_from_pgp_zip "$file_path")"
  cleanup_dir="$MATERIALIZED_TMP_DIR"
  MATERIALIZED_TMP_DIR=""

  size_bytes=$(stat -c %s "$materialized_file_path" 2>/dev/null || wc -c <"$materialized_file_path" | tr -d ' ')
  if captured_epoch=$(stat -c %Y "$materialized_file_path" 2>/dev/null); then
    captured_at=$(date -u -d @"$captured_epoch" +"%Y-%m-%dT%H:%M:%SZ")
  else
    captured_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  fi

  url="${INTELLIWATT_BASE_URL%/}/api/admin/smt/pull"
  log "Posting inline payload: $(basename "$materialized_file_path") → $url (esiid=${esiid:-N/A}, meter=$meter, size=$size_bytes)"

  json=(
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
import sys
from pathlib import Path

file_path = os.environ.get("SMT_FILE_PATH")
source_tag = os.environ.get("SMT_SOURCE_TAG", "smt-ingest")
esiid = os.environ.get("SMT_ESIID")
meter = os.environ.get("SMT_METER")
captured_at = os.environ.get("SMT_CAPTURED_AT")
size_bytes = os.environ.get("SMT_SIZE_BYTES")

missing = []
if not file_path:
    missing.append("SMT_FILE_PATH")
if not esiid:
    missing.append("SMT_ESIID")
if not meter:
    missing.append("SMT_METER")
if not captured_at:
    missing.append("SMT_CAPTURED_AT")
if not size_bytes:
    missing.append("SMT_SIZE_BYTES")
if missing:
    print("Missing required SMT env vars: " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)

path = Path(file_path)
raw_bytes = path.read_bytes()
gzipped = gzip.compress(raw_bytes)

payload = {
    "mode": "inline",
    "source": source_tag,
    "filename": path.name,
    "mime": "text/csv",
    "encoding": "base64+gzip",
    "sizeBytes": int(size_bytes),
    "compressedBytes": len(gzipped),
    "esiid": esiid,
    "meter": meter,
    "captured_at": captured_at,
    "content_b64": base64.b64encode(gzipped).decode("ascii"),
}

sys.stdout.write(json.dumps(payload, separators=(",", ":")))
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

  if [[ -n "$cleanup_dir" && -d "$cleanup_dir" ]]; then
    rm -rf "$cleanup_dir"
  fi

done

log "Ingest run complete"
