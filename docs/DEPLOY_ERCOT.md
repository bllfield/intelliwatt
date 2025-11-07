# ERCOT Daily Pull — Deploy & Verify

**Production env variables (Vercel → Settings → Environment Variables):**
- `DATABASE_URL` — Managed Postgres connection string
- `ADMIN_TOKEN` — Admin token for protected routes
- `CRON_SECRET` — Long random string for cron guard
- `ERCOT_PAGE_URL` — https://www.ercot.com/mp/data-products/market/tdsp-esiid-extracts
- `PROD_BASE_URL` — https://intelliwatt.com

**Cron Configuration**
Ensure `vercel.json` includes:
```json
{
  "crons": [
    { "path": "/api/admin/ercot/cron", "schedule": "0 9 * * *" }
  ]
}
```

## Deploy Steps
1. Redeploy Production from the Vercel dashboard.
2. Verify cron under Vercel → Project → Settings → Cron Jobs (`/api/admin/ercot/cron` @ 09:00 UTC).
3. Run the smoke script (PowerShell or bash) to ensure cron, ingests, and optional manual fetch all succeed.

## Smoke Scripts
- Windows PowerShell: `scripts/admin/ercot_smoke.ps1`
- macOS/Linux: `scripts/admin/ercot_smoke.sh`

## Expected Results
- First cron call may ingest a new file; repeats skip duplicates by hash.
- Manual fetch confirms the endpoint is up and logging to `ErcotIngestLog`.

## Troubleshooting
- **401** on cron: `x-cron-secret` missing or route not exporting GET.
- **500**: check ERCOT page reachability and logs.
- **No ingests**: run manual fetch to ensure the resolved URL is valid.

## Env Health Check

After deploying, confirm required env vars are present (no secrets returned):

```bash
curl -sS https://intelliwatt.com/api/admin/env-health \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

Expected:
```json
{
  "ok": true,
  "env": {
    "DATABASE_URL": true,
    "ADMIN_TOKEN": true,
    "CRON_SECRET": true,
    "ERCOT_PAGE_URL": true,
    "PROD_BASE_URL": true,
    "NODE_ENV": "production"
  }
}
```

If any entries are `false`, update Vercel → Project → Settings → Environment Variables (Production) and redeploy.

### Quick Peek — Most Recent Ingest

`GET /api/admin/ercot/debug/last` (requires `x-admin-token`)

Optional query params:
- `status` (e.g., `ok`, `skipped`, `error`)
- `tdsp` (e.g., `oncor`)

Example:
```bash
curl -sS "https://intelliwatt.com/api/admin/ercot/debug/last?status=ok&tdsp=oncor" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

Response:
```json
{ "ok": true, "row": { "id": "...", "status": "ok", "tdsp": "oncor", "createdAt": "..." } }
```
If `row` is `null`, no matching ingests were found.

## Cron Signal Test

Use this to verify Vercel scheduled jobs (and `CRON_SECRET`) are wired correctly.

`GET /api/admin/ercot/debug/echo-cron`

Headers: `x-cron-secret: <CRON_SECRET>`

Examples:
```bash
# Manual check (vercelOk=false when called locally)
curl -sS https://intelliwatt.com/api/admin/ercot/debug/echo-cron \
  -H "x-cron-secret: $CRON_SECRET" | jq .

# For scheduled runs (check logs near 09:00 UTC): expect ok:true, vercelOk:true
```
If `vercelOk` stays false at scheduled times, confirm `vercel.json` cron entries and redeploy.
