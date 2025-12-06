#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
SOURCE_TAG="${SOURCE_TAG:-adhocusage}"
METER_DEFAULT="${METER_DEFAULT:-M1}"

log() {
  # Send logs to stderr so helpers that return values via stdout remain clean
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" >&2
}

# Will hold a tmp dir path when we decrypt a PGP payload
MATERIALIZED_TMP_DIR=""

# Track whether we're posting to droplet upload server vs inline
SMT_UPLOAD_URL="${SMT_UPLOAD_URL:-}"
USE_DROPLET_UPLOAD="true"
if [[ -z "$SMT_UPLOAD_URL" ]]; then
  USE_DROPLET_UPLOAD="false"
fi

# -----------------------------------------------------------------------------
# materialize_csv_from_pgp_zip
# -----------------------------------------------------------------------------
materialize_csv_from_pgp_zip() {
  local asc_path="$1"
  MATERIALIZED_TMP_DIR=""

  case "$asc_path" in
    *.asc) ;;
    *) printf '%s\n' "$asc_path"; return 0 ;;
  esac

  if ! grep -q "BEGIN PGP MESSAGE" "$asc_path" 2>/dev/null; then
    printf '%s\n' "$asc_path"
    return 0
  fi

  local tmp_dir dec_zip inner_name inner_path
  tmp_dir="$(mktemp -d "${SMT_LOCAL_DIR%/}/pgp_tmp.XXXXXX")"
  if [[ -z "$tmp_dir" || ! -d "$tmp_dir" ]]; then
    log "WARN: materialize_csv_from_pgp_zip: mktemp failed for $asc_path"
    printf '%s\n' "$asc_path"
    return 1
  fi

  dec_zip="$tmp_dir/decrypted.zip"
  if ! gpg --batch --yes -o "$dec_zip" -d "$asc_path" >/dev/null 2>&1; then
    log "WARN: materialize_csv_from_pgp_zip: gpg decrypt failed for $asc_path"
    rm -rf "$tmp_dir"
    printf '%s\n' "$asc_path"
    return 1
  fi

  inner_name="$(unzip -Z1 "$dec_zip" 2>/dev/null | head -n 1)"
  if [[ -z "$inner_name" ]]; then
    log "WARN: materialize_csv_from_pgp_zip: empty archive for $asc_path"
    rm -rf "$tmp_dir"
    printf '%s\n' "$asc_path"
    return 1
  fi

  if ! unzip -p "$dec_zip" "$inner_name" >"$tmp_dir/$inner_name" 2>/dev/null; then
    log "WARN: materialize_csv_from_pgp_zip: unzip failed for $asc_path"
    rm -rf "$tmp_dir"
    printf '%s\n' "$asc_path"
    return 1
  fi

  MATERIALIZED_TMP_DIR="$tmp_dir"
  inner_path="$tmp_dir/$inner_name"
  log "Decoded PGP ZIP file: $asc_path -> $inner_path"
  printf '%s\n' "$inner_path"
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

# -----------------------------------------------------------------------------
# Env requirements
# -----------------------------------------------------------------------------
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
require_cmd gpg
require_cmd unzip
require_cmd python3

mkdir -p "$SMT_LOCAL_DIR"
cd "$SMT_LOCAL_DIR"

# Validate droplet upload configuration
if [[ "$USE_DROPLET_UPLOAD" == "false" ]]; then
  log "WARN: SMT_UPLOAD_URL not configured; will attempt legacy inline POST (not recommended for large files)"
  log "HINT: Set SMT_UPLOAD_URL to the droplet upload server URL for big-file support"
else
  log "INFO: Using droplet upload server at $SMT_UPLOAD_URL"
fi

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
    \( -iname '*.csv' -o -iname '*.csv.*' -o -iname '*DailyMeterUsage*.asc' -o -iname '*IntervalMeterUsage*.asc' \) \
    -print | sort
)

if (( ${#FILES[@]} == 0 )); then
  log "No CSV files discovered; exiting"
  exit 0
fi

rate_limited="false"
rate_limit_reset=""

for file_path in "${FILES[@]}"; do
  sha256="$(sha256sum "$file_path" | awk '{print $1}')"
  if grep -qx "$sha256" "$SEEN_FILE"; then
    log "Skipping already-posted file: $file_path"
    continue
  fi

  # Decrypt first if needed
  effective_path="$(materialize_csv_from_pgp_zip "$file_path" || printf '%s\n' "$file_path")"

  # Try to extract ESIID from filename first
  base="$(basename "$file_path")"
  esiid_guess="$(printf '%s\n' "$base" | grep -oE '10[0-9]{16}' || true)"
  meter_guess="$(printf '%s\n' "$base" | grep -oE 'M[0-9]+' || true)"

  # If no ESIID in filename, try to extract from CSV content (after decryption)
  # SMT CSVs may have ESIID with leading single quote: '10443720004529147
  # Use awk to extract and validate ESIID pattern in one step
  if [[ -z "$esiid_guess" && -f "$effective_path" ]]; then
    esiid_guess="$(awk -F, 'NR>1 {gsub(/^'\''/, "", $1); if ($1 ~ /^10[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]$/) {print $1; exit}}' "$effective_path" || true)"
    log "Extracted ESIID from CSV content: $esiid_guess"
  fi

  esiid="${esiid_guess:-$(printf '%s' "${ESIID_DEFAULT:-}" | tr -d $'\r\n')}"
  meter="${meter_guess:-$METER_DEFAULT}"

  if [[ -z "$esiid" ]]; then
    log "WARN: No ESIID found in filename or CSV content for $file_path; skipping"
    continue
  fi

  size_bytes="$(stat -c '%s' "$effective_path")"
  mtime_epoch="$(stat -c '%Y' "$effective_path")"
  captured_at="$(date -u -d "@$mtime_epoch" +%Y-%m-%dT%H:%M:%SZ)"

  if [[ "$USE_DROPLET_UPLOAD" == "true" ]]; then
    # NEW: POST multipart/form-data to droplet upload server (avoids Vercel payload limit)
    # The droplet upload server saves the file to its inbox and triggers smt-ingest.service
    http_code="$(
      curl -sS -o "$RESP_FILE" -w "%{http_code}" \
        --connect-timeout 30 \
        --max-time 300 \
        -X POST "$SMT_UPLOAD_URL" \
        -F "file=@$effective_path" \
        -F "esiid=$esiid" \
        -F "meter=$meter" \
        -F "accountKey=intelliwatt-smt-ingest" \
        -F "role=smt-ingest" \
        -F "capturedAt=$captured_at" \
        2>/dev/null || printf '000'
    )"

    if [[ "$http_code" == "200" || "$http_code" == "201" ]]; then
      log "Droplet upload success ($http_code): $(jq -c '.message // .' "$RESP_FILE" 2>/dev/null || cat "$RESP_FILE")"
      printf '%s\n' "$sha256" >>"$SEEN_FILE"
    elif [[ "$http_code" == "429" ]]; then
      rate_limit_reset="$(jq -r '.resetAt // empty' "$RESP_FILE" 2>/dev/null || true)"
      log "Droplet upload failed (rate limited 429); stopping this run. resetAt=${rate_limit_reset:-unknown}"
      rate_limited="true"
      break
    else
      log "Droplet upload failed ($http_code): $(cat "$RESP_FILE")"
    fi
  else
    # LEGACY: POST inline JSON to /api/admin/smt/pull (only for small test files)
    # This path is deprecated for production; use SMT_UPLOAD_URL instead.
    json="$(
      SMT_FILE_PATH="$effective_path" \
      SMT_ESIID="$esiid" \
      SMT_METER="$meter" \
      SMT_SOURCE="$SOURCE_TAG" \
      SMT_CAPTURED_AT="$captured_at" \
      SMT_SIZE_BYTES="$size_bytes" \
      python3 - << 'PY'
import base64
import gzip
import json
import os
import sys
from pathlib import Path

path = Path(os.environ["SMT_FILE_PATH"])
esiid = os.environ["SMT_ESIID"]
meter = os.environ["SMT_METER"]
source = os.environ["SMT_SOURCE"]
captured_at = os.environ["SMT_CAPTURED_AT"]
size_bytes = int(os.environ["SMT_SIZE_BYTES"])

raw = path.read_bytes()
gz = gzip.compress(raw)

payload = {
    "mode": "inline",
    "source": source,
    "filename": path.name,
    "mime": "text/csv",
    "encoding": "base64+gzip",
    "sizeBytes": size_bytes,
    "compressedBytes": len(gz),
    "esiid": esiid,
    "meter": meter,
    "captured_at": captured_at,
    "content_b64": base64.b64encode(gz).decode("ascii"),
}

sys.stdout.write(json.dumps(payload, separators=(",", ":")))
PY
    )"

    url="${INTELLIWATT_BASE_URL%/}/api/admin/smt/pull"

    http_code="$(
      printf '%s' "$json" | curl -sS -o "$RESP_FILE" -w "%{http_code}" \
        -X POST "$url" \
        -H "x-admin-token: $ADMIN_TOKEN" \
        -H "content-type: application/json" \
        --data-binary @- 2>/dev/null || printf '000'
    )"

    if [[ "$http_code" == "200" || "$http_code" == "201" ]]; then
      log "Inline POST success ($http_code): $(jq -c '.' "$RESP_FILE" 2>/dev/null || cat "$RESP_FILE")"
      printf '%s\n' "$sha256" >>"$SEEN_FILE"
    else
      log "Inline POST failed ($http_code): $(cat "$RESP_FILE")"
    fi
  fi

  if [[ -n "$MATERIALIZED_TMP_DIR" && -d "$MATERIALIZED_TMP_DIR" ]]; then
    rm -rf "$MATERIALIZED_TMP_DIR"
    MATERIALIZED_TMP_DIR=""
  fi

  if [[ "$rate_limited" == "true" ]]; then
    break
  fi

done

if [[ "$rate_limited" == "true" ]]; then
  log "Run halted early due to upload rate limit. Will retry on next scheduled run after reset=${rate_limit_reset:-unknown}"
fi

log "Ingest run complete"
