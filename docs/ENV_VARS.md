# IntelliWatt Environment Variables

## Google & Mapping
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — client key for Places/Maps autocomplete
- `GOOGLE_APPLICATION_CREDENTIALS` — filesystem path to JSON key (only if using backend Google SDKs like Vision/Sheets)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — service account email (backend only)

## Integrations
- `WATTBUY_API_KEY` — server key for WattBuy
- `SMT_SFTP_HOST`, `SMT_SFTP_USER`, `SMT_SFTP_KEY` — Smart Meter Texas SFTP (for droplet)
- `SMT_FETCH_TRIGGER_URL` — Vercel URL for on-demand SMT fetch trigger (e.g., `https://intelliwatt.com/api/admin/smt/fetch-trigger`)
- `SMT_FETCH_ADMIN_TOKEN` — Token for SMT fetch trigger authorization (can reuse `ADMIN_TOKEN`)
- `SMT_INTERVAL_TABLE` — Optional override if your SMT interval table/view name differs from `SmtInterval`
- `DROPLET_WEBHOOK_URL` — Droplet webhook URL for on-demand fetch (e.g., `http://64.225.25.54:8787/trigger/smt-now`)
- `DROPLET_WEBHOOK_SECRET` — Shared secret sent in header `x-intelliwatt-secret`
- `GREENBUTTON_API_KEY` — (future) Green Button API access

## Feature Flags
- `NEXT_PUBLIC_FLAG_WATTBUY` = true | false
- `NEXT_PUBLIC_FLAG_SMT` = true | false
- `NEXT_PUBLIC_FLAG_GREENBUTTON` = true | false
- `FLAG_STRICT_PII_LOGGING` = true | false  # server-only
- `WATTBUY_ESIID_DISABLED` — default "true". When "true", WattBuy-backed ESIID admin routes are gated off; plan pulls remain address/zip based.

## Security
- `ADMIN_TOKEN` — **Admin route protection.** Required header `x-admin-token` must match this value on admin/debug endpoints.

## Session Management
- `SESSION_MAX_AGE_HOURS` — Server | Recommended | Reject server writes if session is older than this (default 12).
- `NEXT_PUBLIC_IDLE_WARN_MIN` — Client | Optional | Minutes of inactivity before showing warning (default **30**).
- `NEXT_PUBLIC_IDLE_GRACE_SEC` — Client | Optional | Seconds to wait after warning before redirect (default **60**).

### Notes
- **Public flags** must start with `NEXT_PUBLIC_` (exposed to the browser).
- **Server-only** vars must **not** use `NEXT_PUBLIC_`.
- Rotate keys immediately if credentials appear from unknown projects; restrict Google browser key by referrer.

---

## ADMIN_TOKEN — Security Details (October 2025)

**Purpose:** Protect sensitive endpoints such as:
- `GET/POST /api/debug/*`
- `GET /api/migrate`
- `GET /api/admin/*` (e.g., env health)

**Behavior by environment**
- **Production:** `ADMIN_TOKEN` **must be set** in Vercel. Requests **must** include header `x-admin-token: <ADMIN_TOKEN>`. If missing, server returns **401**; if var not configured, returns **503**.
- **Preview/Dev:** If `ADMIN_TOKEN` is set, it is required (same as Production). If it is **not set**, routes allow access to prevent lockout during development.

**Client usage policy**
- Never expose `ADMIN_TOKEN` in client/browser code.
- Use it only from trusted scripts or servers (e.g., PowerShell, server-to-server).

**Example (PowerShell)**
```powershell
$headers = @{ "x-admin-token" = "<ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://<your-preview>.vercel.app/api/debug/list-all-addresses" -Method GET
```

**Generate a strong token (PowerShell)**
```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object {Get-Random -Max 256}))
```

**Rotation**
- Create a new random value in Vercel → save → redeploy → start using the new header immediately.

**Related keys**
- `ADMIN_SEED_TOKEN` (if present) is for one-time bootstrap/seed flows and is **not** used for route protection.

### ERCOT fetch settings
- `ERCOT_DAILY_URL` — Public HTTPS URL for the daily TDSP ESIID extract.
- `ERCOT_MONTHLY_URL` — Public HTTPS URL for the monthly extract (optional).
- `ERCOT_USER_AGENT` — Optional custom User-Agent string when fetching ERCOT files.
- `CRON_SECRET` — Optional token that allows `/api/admin/ercot/cron?token=...` for manual/QA runs in addition to Vercel cron.
- `ERCOT_PAGE_URL` — Public ERCOT product page (e.g., EMIL ZP15-612 listing). When set, the system resolves the latest `mirDownload?doclookupId=...` link automatically if `ERCOT_DAILY_URL` is omitted.
- `ERCOT_PAGE_FILTER` — Optional substring to prefer in link context (e.g., `TDSP`, `ESIID`).