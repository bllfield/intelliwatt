#!/usr/bin/env bash
set -euo pipefail
source /home/deploy/.intelliwatt.env
exec /usr/bin/env python3 /home/deploy/smt_ingest/web/webhook_server.py
