#!/usr/bin/env bash
set -euo pipefail
source /home/deploy/.intelliwatt.env
exec /usr/bin/env python3 /home/deploy/webhook_server.py
