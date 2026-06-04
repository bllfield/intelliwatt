#!/usr/bin/env bash
set -euo pipefail

log() { echo "[apply_green_button_upload_nginx] $*"; }
warn() { echo "[apply_green_button_upload_nginx] WARN: $*" >&2; }

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
  warn "TLS cert not found at /etc/letsencrypt/live/uploads.intelliwatt.com/"
  warn "Install cert first (certbot) or adjust ssl_certificate paths in ${NGINX_SRC}"
fi

disable_duplicate_uploads_vhosts() {
  local path
  local -a matches=()
  while IFS= read -r path; do
    [[ -n "${path}" ]] && matches+=("${path}")
  done < <(
    grep -RIl 'server_name[[:space:]]*uploads\.intelliwatt\.com' \
      /etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/conf.d 2>/dev/null || true
  )

  for path in "${matches[@]}"; do
    if [[ "${path}" == "${NGINX_DST}" || "${path}" == "${NGINX_LINK}" ]]; then
      continue
    fi
    local resolved=""
    if [[ -e "${path}" ]]; then
      resolved="$(readlink -f "${path}" 2>/dev/null || realpath "${path}" 2>/dev/null || true)"
    fi
    if [[ "${resolved}" == "${NGINX_DST}" ]]; then
      continue
    fi
    warn "Disabling duplicate uploads vhost: ${path}"
    if [[ -L "${path}" ]] || [[ "${path}" == /etc/nginx/sites-enabled/* ]]; then
      sudo rm -f "${path}"
    elif [[ -f "${path}" ]]; then
      sudo mv "${path}" "${path}.disabled-$(date +%Y%m%d%H%M%S)"
    fi
  done
}

log "Removing duplicate nginx vhosts for uploads.intelliwatt.com (if any)"
disable_duplicate_uploads_vhosts

log "Installing nginx site → ${NGINX_DST}"
sudo cp "${NGINX_SRC}" "${NGINX_DST}"
sudo ln -sf "${NGINX_DST}" "${NGINX_LINK}"

log "Testing nginx config"
nginx_test_log="$(mktemp)"
if ! sudo nginx -t 2>&1 | tee "${nginx_test_log}"; then
  rm -f "${nginx_test_log}"
  exit 1
fi

if grep -q 'conflicting server name "uploads.intelliwatt.com"' "${nginx_test_log}"; then
  warn "nginx still has duplicate uploads.intelliwatt.com — run: sudo grep -RIl uploads.intelliwatt.com /etc/nginx"
  rm -f "${nginx_test_log}"
  exit 1
fi
rm -f "${nginx_test_log}"

log "Reloading nginx"
sudo systemctl reload nginx

if sudo nginx -T 2>/dev/null | grep -q 'proxy_read_timeout 600s'; then
  log "Verified proxy_read_timeout 600s in active nginx config"
else
  warn "Could not confirm proxy_read_timeout 600s — check: sudo nginx -T | grep proxy_read_timeout"
fi

log "Done. https://uploads.intelliwatt.com → 127.0.0.1:8091"
