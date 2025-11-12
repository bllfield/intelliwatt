# SMT Environment Variables

## Shared
- `INTELLIWATT_WEBHOOK_SECRET` (required): 64-char secret used by both Vercel and droplet; header **name**: `x-intelliwatt-secret`.
- `ADMIN_TOKEN` (required): 64-char admin bearer used for admin routes (header **name**: `x-admin-token`).

## Droplet-only (examples)
- `DROPLET_WEBHOOK_URL` (ex: `http://127.0.0.1:8787/trigger/smt-now`)
- `DROPLET_WEBHOOK_SECRET` (optional alias to `INTELLIWATT_WEBHOOK_SECRET` if you want redundancy)
- `SMT_SSH_PUBKEY_FPR` (example): `SHA256:TnCYDpOXwbPvwK6aGHCoXhBRgazJrFw3t8ek3IJ99NI`

## Notes
- **Do NOT** use `x-proxy-secret` anywhere (legacy). Use `x-intelliwatt-secret` exclusively.
- Inline mode for `/api/admin/smt/pull` now persists files to storage and creates a DB row — useful for diagnostics and ad-hoc ingest without touching the droplet.
