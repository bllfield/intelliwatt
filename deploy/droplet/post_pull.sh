#!/usr/bin/env bash
set -euo pipefail

log() { echo "[post_pull] $*"; }

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
  echo "[post_pull] ERROR: Could not find repo root (missing deploy/droplet). Started from: ${start_dir}" >&2
  exit 1
fi

cd "${repo_root}"
log "repo_root=${repo_root}"

# 1) Re-apply EFL pdftotext nginx + systemd config
if [[ -x "deploy/droplet/apply_efl_pdftotext.sh" ]]; then
  log "Running apply_efl_pdftotext.sh"
  sudo bash "deploy/droplet/apply_efl_pdftotext.sh"
else
  echo "[post_pull] ERROR: deploy/droplet/apply_efl_pdftotext.sh missing or not executable" >&2
  exit 1
fi

# 1b) Re-apply EFL fetch proxy systemd config (optional)
if [[ -x "deploy/droplet/apply_efl_fetch_proxy.sh" ]]; then
  log "Running apply_efl_fetch_proxy.sh"
  sudo bash "deploy/droplet/apply_efl_fetch_proxy.sh"
else
  log "Skipping apply_efl_fetch_proxy.sh (not present)"
fi

# 2) Safe service restarts (ONLY if the unit exists on this droplet)
restart_if_exists() {
  local unit="$1"
  if systemctl list-unit-files | awk '{print $1}' | grep -qx "${unit}"; then
    log "Restarting ${unit}"
    sudo systemctl restart "${unit}"
  else
    log "Skipping ${unit} (not installed on this host)"
  fi
}

# Keep this conservative: only the droplet services we already run here.
restart_if_exists "smt-webhook.service"
restart_if_exists "smt-ingest.service"
restart_if_exists "green-button-upload.service"
restart_if_exists "efl-pdftotext.service"
restart_if_exists "efl-fetch-proxy.service"
restart_if_exists "nginx.service"

# 3) Quick health checks (do not fail the script if curl isn't installed)
log "Health checks (best-effort)"
if command -v curl >/dev/null 2>&1; then
  curl -fsS "https://efl-pdftotext.intelliwatt.com/health" || true
else
  log "curl not found; skipping HTTP health checks"
fi

log "Done."


