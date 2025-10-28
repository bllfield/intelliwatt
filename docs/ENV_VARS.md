# IntelliWatt Environment Variables

## Google & Mapping
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — client key for Places/Maps autocomplete
- `GOOGLE_APPLICATION_CREDENTIALS` — filesystem path to JSON key (only if using backend Google SDKs like Vision/Sheets)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — service account email (backend only)

## Integrations
- `WATTBUY_API_KEY` — server key for WattBuy
- `SMT_SFTP_HOST`, `SMT_SFTP_USER`, `SMT_SFTP_KEY` — Smart Meter Texas SFTP
- `GREENBUTTON_API_KEY` — (future) Green Button API access

## Feature Flags
- `NEXT_PUBLIC_FLAG_WATTBUY` = true | false
- `NEXT_PUBLIC_FLAG_SMT` = true | false
- `NEXT_PUBLIC_FLAG_GREENBUTTON` = true | false
- `FLAG_STRICT_PII_LOGGING` = true | false  # server-only

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
