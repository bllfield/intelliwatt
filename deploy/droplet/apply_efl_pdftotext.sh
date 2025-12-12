#!/usr/bin/env bash
set -euo pipefail

log() { echo "[apply_efl_pdftotext] $*"; }

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
  echo "[apply_efl_pdftotext] ERROR: Could not find repo root (missing deploy/droplet). Started from: ${start_dir}" >&2
  exit 1
fi

cd "${repo_root}"
log "repo_root=${repo_root}"

NGINX_SRC="deploy/droplet/nginx/efl-pdftotext.intelliwatt.com"
SYSTEMD_OVERRIDE_SRC="deploy/droplet/systemd/efl-pdftotext.override.conf"
ENV_EXAMPLE_SRC="deploy/droplet/env/.efl-pdftotext.env.example"

NGINX_DST="/etc/nginx/sites-available/efl-pdftotext.intelliwatt.com"
NGINX_LINK="/etc/nginx/sites-enabled/efl-pdftotext.intelliwatt.com"
SYSTEMD_OVERRIDE_DIR="/etc/systemd/system/efl-pdftotext.service.d"
SYSTEMD_OVERRIDE_DST="${SYSTEMD_OVERRIDE_DIR}/override.conf"

LIVE_ENV_DST="/home/deploy/.efl-pdftotext.env"

if [[ ! -f "${NGINX_SRC}" ]]; then
  echo "[apply_efl_pdftotext] ERROR: Missing ${NGINX_SRC}" >&2
  exit 1
fi

if [[ ! -f "${SYSTEMD_OVERRIDE_SRC}" ]]; then
  echo "[apply_efl_pdftotext] ERROR: Missing ${SYSTEMD_OVERRIDE_SRC}" >&2
  exit 1
fi

log "Installing nginx site → ${NGINX_DST}"
sudo cp "${NGINX_SRC}" "${NGINX_DST}"

log "Enabling nginx site symlink → ${NGINX_LINK}"
sudo ln -sf "${NGINX_DST}" "${NGINX_LINK}"

log "Installing systemd override → ${SYSTEMD_OVERRIDE_DST}"
sudo mkdir -p "${SYSTEMD_OVERRIDE_DIR}"
sudo cp "${SYSTEMD_OVERRIDE_SRC}" "${SYSTEMD_OVERRIDE_DST}"

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

log "Testing nginx config"
sudo nginx -t

log "Reloading systemd + nginx and restarting efl-pdftotext"
sudo systemctl daemon-reload
sudo systemctl reload nginx
sudo systemctl restart efl-pdftotext.service

log "Done."
log "Health check: curl -i https://efl-pdftotext.intelliwatt.com/health"


