#!/usr/bin/env bash
set -euo pipefail

log() { echo "[apply_efl_fetch_proxy] $*"; }

# Find repo root by walking up until we find deploy/droplet
start_dir="$(pwd)"
repo_root=""

while true; do
  if [[ -d "deploy/droplet" ]]; then
    repo_root="$(pwd)"
    break
  fi
  if [[ "$(pwd)" == "/" ]]; then
    break
  fi
  cd ..
done

if [[ -z "${repo_root}" ]]; then
  echo "[apply_efl_fetch_proxy] ERROR: Could not find repo root (missing deploy/droplet). Started from: ${start_dir}" >&2
  exit 1
fi

cd "${repo_root}"
log "repo_root=${repo_root}"

SERVICE_SRC="deploy/efl-fetch-proxy/efl-fetch-proxy.service"
ENV_EXAMPLE_SRC="deploy/droplet/env/.efl-fetch-proxy.env.example"

SERVICE_DST="/etc/systemd/system/efl-fetch-proxy.service"
LIVE_ENV_DST="/home/deploy/.efl-fetch-proxy.env"

if [[ ! -f "${SERVICE_SRC}" ]]; then
  echo "[apply_efl_fetch_proxy] ERROR: Missing ${SERVICE_SRC}" >&2
  exit 1
fi

log "Installing systemd unit → ${SERVICE_DST}"
sudo cp "${SERVICE_SRC}" "${SERVICE_DST}"

# Only create the live env file if it does not exist (never overwrite secrets)
if [[ ! -f "${LIVE_ENV_DST}" ]]; then
  if [[ -f "${ENV_EXAMPLE_SRC}" ]]; then
    log "Creating ${LIVE_ENV_DST} from example (NO secrets overwritten)"
    sudo cp "${ENV_EXAMPLE_SRC}" "${LIVE_ENV_DST}"
    sudo chown deploy:deploy "${LIVE_ENV_DST}"
    sudo chmod 600 "${LIVE_ENV_DST}"
  else
    log "WARN: ${LIVE_ENV_DST} missing and example not found (${ENV_EXAMPLE_SRC}). You must create it manually."
  fi
else
  log "Live env exists (leaving as-is): ${LIVE_ENV_DST}"
fi

log "Reloading systemd and restarting efl-fetch-proxy (if enabled)"
sudo systemctl daemon-reload
if systemctl list-unit-files | awk '{print $1}' | grep -qx "efl-fetch-proxy.service"; then
  sudo systemctl restart efl-fetch-proxy.service || true
fi

log "Done."
log "Local health check: curl -sS http://127.0.0.1:8088/health"

