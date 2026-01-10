#!/usr/bin/env bash
set -euo pipefail

log() { echo "[apply_droplet_services] $*"; }

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
  echo "[apply_droplet_services] ERROR: Could not find repo root (missing deploy/droplet). Started from: ${start_dir}" >&2
  exit 1
fi

cd "${repo_root}"
log "repo_root=${repo_root}"

install_unit_if_present() {
  local src="$1"
  local dst="/etc/systemd/system/$(basename "${src}")"
  if [[ -f "${src}" ]]; then
    log "Installing systemd unit → ${dst}"
    sudo cp "${src}" "${dst}"
  else
    log "Skipping missing unit (not in repo): ${src}"
  fi
}

log "Installing droplet service units"
install_unit_if_present "deploy/droplet/smt-upload-server.service"
install_unit_if_present "deploy/droplet/green-button-upload-server.service"
install_unit_if_present "deploy/droplet/efl-pdftotext.service"
install_unit_if_present "deploy/droplet/smt-webhook.service"
install_unit_if_present "deploy/droplet/intelliwatt-ensure-services.service"
install_unit_if_present "deploy/droplet/intelliwatt-ensure-services.timer"

log "Reloading systemd"
sudo systemctl daemon-reload

log "Enabling watchdog timer"
sudo systemctl enable --now intelliwatt-ensure-services.timer || true

# Best-effort: enable the critical long-running daemons if their units are installed.
log "Enabling core services (best-effort)"
sudo systemctl enable --now smt-upload-server.service || true
sudo systemctl enable --now green-button-upload-server.service || true
sudo systemctl enable --now efl-pdftotext.service || true
sudo systemctl enable --now smt-webhook.service || true

log "Done."

