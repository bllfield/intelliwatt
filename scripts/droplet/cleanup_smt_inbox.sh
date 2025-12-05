#!/usr/bin/env bash
set -e
# Removes stale SMT temp directories and old files to keep droplet disk usage low.
find /home/deploy/smt_inbox -type d -name 'pgp_tmp.*' -mtime +2 -exec rm -rf {} \; || true
find /home/deploy/smt_inbox -type f -mtime +30 -exec rm -f {} \; || true
