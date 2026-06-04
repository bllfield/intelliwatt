#!/usr/bin/env bash
set -euo pipefail

log() { echo "[apply_green_button_upload_nginx] $*"; }

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
  echo "[apply_green_button_upload_nginx] ERROR: Could not find repo root (missing deploy/droplet). Started from: ${start_dir}" >&2
  exit 1
fi

cd "${repo_root}"
log "repo_root=${repo_root}"

NGINX_SRC="deploy/droplet/nginx/uploads.intelliwatt.com"
NGINX_DST="/etc/nginx/sites-available/uploads.intelliwatt.com"
NGINX_LINK="/etc/nginx/sites-enabled/uploads.intelliwatt.com"

if [[ ! -f "${NGINX_SRC}" ]]; then
  echo "[apply_green_button_upload_nginx] ERROR: Missing ${NGINX_SRC}" >&2
  exit 1
fi

if [[ ! -f "/etc/letsencrypt/live/uploads.intelliwatt.com/fullchain.pem" ]]; then
  echo "[apply_green_button_upload_nginx] WARN: TLS cert not found at /etc/letsencrypt/live/uploads.intelliwatt.com/" >&2
  echo "[apply_green_button_upload_nginx] WARN: Install cert first (certbot) or adjust ssl_certificate paths in ${NGINX_SRC}" >&2
fi

log "Installing nginx site → ${NGINX_DST}"
sudo cp "${NGINX_SRC}" "${NGINX_DST}"
sudo ln -sf "${NGINX_DST}" "${NGINX_LINK}"

log "Testing nginx config"
sudo nginx -t

log "Reloading nginx"
sudo systemctl reload nginx

log "Done. Green Button upload proxy: https://uploads.intelliwatt.com → 127.0.0.1:8091 (600s proxy_read_timeout, CORS on errors)"
