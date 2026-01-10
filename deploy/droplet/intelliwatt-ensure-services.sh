#!/usr/bin/env bash
set -euo pipefail

log() { echo "[intelliwatt-ensure-services] $*"; }

is_installed_unit() {
  local unit="$1"
  # See note in post_pull.sh: use sudo to avoid false negatives when non-root systemctl
  # cannot connect to the system bus on some hosts.
  if [[ -f "/etc/systemd/system/${unit}" || -f "/lib/systemd/system/${unit}" || -f "/usr/lib/systemd/system/${unit}" ]]; then
    return 0
  fi
  sudo systemctl list-unit-files --no-pager 2>/dev/null | awk '{print $1}' | grep -qx "${unit}"
}

ensure_enabled_active() {
  local unit="$1"
  if ! is_installed_unit "${unit}"; then
    return 0
  fi

  local enabled="unknown"
  enabled="$(systemctl is-enabled "${unit}" 2>/dev/null || true)"
  local active="unknown"
  active="$(systemctl is-active "${unit}" 2>/dev/null || true)"

  # Enable if disabled, then start if inactive.
  if [[ "${enabled}" != "enabled" ]]; then
    log "Enabling ${unit} (was: ${enabled})"
    sudo systemctl enable "${unit}" >/dev/null 2>&1 || true
  fi
  if [[ "${active}" != "active" ]]; then
    log "Starting ${unit} (was: ${active})"
    sudo systemctl start "${unit}" >/dev/null 2>&1 || true
  fi
}

# Core droplet daemons (some droplets may not have all of these installed).
ensure_enabled_active "nginx.service"
ensure_enabled_active "efl-pdftotext.service"

# SMT big-file path server
ensure_enabled_active "smt-upload-server.service"

# Green Button big-file path server (legacy name + repo name)
ensure_enabled_active "green-button-upload.service"
ensure_enabled_active "green-button-upload-server.service"

# SMT webhook server (pull trigger endpoint)
ensure_enabled_active "smt-webhook.service"

# SMT ingest timer/service (if installed on this host)
ensure_enabled_active "smt-ingest.timer"
ensure_enabled_active "smt-ingest.service"

log "Done."

