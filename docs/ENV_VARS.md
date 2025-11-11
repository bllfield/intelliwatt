# IntelliWatt Environment Variables

## Google & Mapping
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — client key for Places/Maps autocomplete
- `GOOGLE_APPLICATION_CREDENTIALS` — filesystem path to JSON key (only if using backend Google SDKs like Vision/Sheets)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — service account email (backend only)

## Integrations
- `WATTBUY_API_KEY` — server key for WattBuy (used with `x-api-key` header, not Authorization Bearer)
- `SMT_SFTP_HOST`, `SMT_SFTP_USER`, `SMT_SFTP_KEY` — Smart Meter Texas SFTP (for droplet)
- `SMT_FETCH_TRIGGER_URL` — Vercel URL for on-demand SMT fetch trigger (e.g., `https://intelliwatt.com/api/admin/smt/fetch-trigger`)
- `SMT_FETCH_ADMIN_TOKEN` — Token for SMT fetch trigger authorization (can reuse `ADMIN_TOKEN`)
- `DROPLET_WEBHOOK_URL` — Droplet webhook URL for SMT data pull (e.g., `http://64.225.25.54:8787/trigger/smt-now`)
- `DROPLET_WEBHOOK_SECRET` — Shared secret sent in header `x-intelliwatt-secret` for SMT webhook authentication
- `GREENBUTTON_API_KEY` — (future) Green Button API access

## ERCOT Integration

### ERCOT EWS (mutual-TLS) - Preferred Method
- `ERCOT_EWS_BASE` — EWS service base URL (e.g., `https://ews.ercot.com`)
- `ERCOT_EWS_REPORTTYPE` — Report type ID (default: `203` for TDSP ESIID Extract)
- `ERCOT_EWS_PFX` — Base64-encoded PKCS#12 (.pfx) file containing client certificate and private key (preferred)
- `ERCOT_EWS_PFX_PASS` — Password for the PFX file (if required)
- `ERCOT_EWS_CERT` — PEM-encoded client certificate (alternative to PFX, include newlines with `\n`)
- `ERCOT_EWS_KEY` — PEM-encoded private key (alternative to PFX, include newlines with `\n`)
- `ERCOT_EWS_CA` — Optional: PEM-encoded CA certificate chain (if required by ERCOT)

### ERCOT Public API (fallback)
- `ERCOT_SUBSCRIPTION_KEY` — ERCOT Public API subscription key (from API Explorer → Products → Subscribe → Profile → Show Primary key)
- `ERCOT_USERNAME` — ERCOT API Explorer username (email) for ROPC token flow
- `ERCOT_PASSWORD` — ERCOT API Explorer password for ROPC token flow
- `ERCOT_TOKEN_URL` — Optional override for ERCOT B2C token endpoint (defaults to official endpoint)
- `ERCOT_CLIENT_ID` — Optional override (defaults to `fec253ea-0d06-4272-a5e6-b478baeecd70`)
- `ERCOT_SCOPE` — Optional override (defaults to `openid fec253ea-0d06-4272-a5e6-b478baeecd70 offline_access` - space-separated)
- `ERCOT_PRODUCT_ID` — Optional override (defaults to `ZP15-612`)

### ERCOT HTML Scraping (fallback)
- `ERCOT_PAGE_URL` — ERCOT data product page URL (e.g., `https://www.ercot.com/mp/data-products/data-product-details?id=ZP15-612`)
- `ERCOT_PAGE_FILTER` — Optional filter for file links (e.g., `TDSP`)
- `ERCOT_USER_AGENT` — Optional user agent string for ERCOT requests
- `ERCOT_TEST_URL` — Optional explicit file URL for manual testing
- `CRON_SECRET` — Secret token for ERCOT cron authentication (header `x-cron-secret` or query `?token=CRON_SECRET`)

## S3 / DigitalOcean Spaces (ERCOT Storage)
- `S3_ENDPOINT` or `DO_SPACES_ENDPOINT` — S3-compatible endpoint (e.g., `https://nyc3.digitaloceanspaces.com` or AWS endpoint)
- `S3_REGION` — Region (e.g., `nyc3` for DO Spaces or `us-east-1` for AWS)
- `S3_BUCKET` — Bucket/space name (lowercase)
- `S3_ACCESS_KEY_ID` — Access key ID
- `S3_SECRET_ACCESS_KEY` — Secret access key
- `S3_FORCE_PATH_STYLE` — Optional, set to `true` for MinIO-style endpoints (recommended for DO Spaces)
- `S3_ACL` — Optional, defaults to `private`

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
