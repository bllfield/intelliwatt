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
- `DROPLET_WEBHOOK_URL` — Droplet webhook URL for SMT data pull (e.g., `http://64.225.25.54:8787/trigger/smt-now`). Alias: `INTELLIWATT_WEBHOOK_URL`
- `DROPLET_WEBHOOK_SECRET` — Shared secret sent in header `x-intelliwatt-secret` for SMT webhook authentication. Alias: `INTELLIWATT_WEBHOOK_SECRET`
- `GREENBUTTON_API_KEY` — (future) Green Button API access
- `GREEN_BUTTON_UPLOAD_SECRET` — Shared HMAC secret between Vercel and the droplet Green Button uploader (required for signed upload tickets).
- `GREEN_BUTTON_UPLOAD_URL` — Server-side URL of the droplet `/upload` endpoint. Optional if using `NEXT_PUBLIC_GREEN_BUTTON_UPLOAD_URL`.
- `NEXT_PUBLIC_GREEN_BUTTON_UPLOAD_URL` — Public URL exposed to the browser for the droplet `/upload` endpoint. Omit in preview/dev if the droplet isn’t reachable.
- `GREEN_BUTTON_UPLOAD_MAX_BYTES` — Optional override for the 10 MB default upload limit (applies to both Vercel fallback route and droplet service).
- `GREEN_BUTTON_UPLOAD_ALLOW_ORIGIN` — Optional CORS allowlist for the droplet uploader (defaults to `https://intelliwatt.com` when unset).

### OpenAI (per-module projects)

- `OPENAI_FACT_CARD_API_KEY`
  - **Purpose**: API key for the dedicated **Fact Card / EFL parser** OpenAI Project.
  - **Precedence**: Used first by the Fact Card client; falls back to `OPENAI_API_KEY` when unset.
  - **Scope**: Server-only; never expose to the browser.
- `OPENAI_BILL_PARSER_API_KEY`
  - **Purpose**: API key for the dedicated **Bill Parser / Current Plan** OpenAI Project.
  - **Precedence**: Used first by the Bill Parser client; falls back to `OPENAI_API_KEY` when unset.
  - **Scope**: Server-only; never expose to the browser.
- `OPENAI_API_KEY`
  - **Purpose**: Shared default OpenAI key for generic tools and as a **fallback** when module-specific keys are not configured.
  - **Note**: When using separate Projects per module, prefer the module keys above. `OPENAI_API_KEY` is optional and only used when it looks like a real key (starts with `sk-`); values such as `"1"` or `"true"` are treated as flags only, never as API keys.
- `OPENAI_IntelliWatt_Fact_Card_Parser`
  - **Purpose**: Feature flag for Fact Card / EFL AI parsing.
  - **Enabled when**: Set to a truthy value such as `"1"`, `"true"`, `"yes"`, `"on"`, or `"enabled"`.
  - **Behavior**: When not truthy, Fact Card AI calls are skipped and deterministic parsing + validator still run, with clear JSON warnings.
- `OPENAI_IntelliWatt_Bill_Parcer`
  - **Purpose**: Feature flag for Bill Parser AI.
  - **Enabled when**: Same truthy semantics as above.
  - **Behavior**: When not truthy, bill parsing falls back to non-AI/regex paths where available.

## EFL pdftotext Helper (Droplet HTTPS Proxy)

- `EFL_PDFTEXT_URL`
  - **Purpose**: HTTPS endpoint Vercel calls when `pdf-parse`/`pdfjs` extraction fails for EFL PDFs.
  - **Production canonical value**: `https://efl-pdftotext.intelliwatt.com/efl/pdftotext`
  - **Requirements**:
    - Must be **HTTPS** (port 443), not `http://` or a direct `:8095` URL.
    - Hostname must be publicly reachable from Vercel (fronted by nginx + TLS on the droplet).
    - nginx on the droplet should proxy this path to the local helper on `http://127.0.0.1:8095/efl/pdftotext`.
- `EFL_PDFTEXT_TOKEN`
  - **Purpose**: Shared secret between Vercel and the droplet `pdftotext` helper.
  - Sent as header `X-EFL-PDFTEXT-TOKEN` from Vercel; the Python helper validates it against its own `EFL_PDFTEXT_TOKEN`.
  - Must match exactly on both Vercel and the droplet.
  - **Droplet env note**: Use a dedicated env file (e.g. `/home/deploy/.efl-pdftotext.env`) loaded via `EnvironmentFile=` in the `efl-pdftotext.service` systemd unit, and set `EFL_PDFTEXT_TOKEN=your-token` (and optional `EFL_PDFTEXT_PORT=8095`) **without quotes**.
  - **Normalization**: If some tools wrap the value in single or double quotes (e.g., `"token"` or `'token'`), the Node helper automatically trims whitespace and strips one pair of wrapping quotes before sending it upstream.

## EFL Fetch Proxy (Droplet) — WAF/403 Fallback

When some EFL hosts block Vercel/AWS IP ranges (common 403/406), the app can optionally route PDF fetching through a separate proxy service (droplet / VPS / vendor) that uses different egress.

- `EFL_FETCH_PROXY_URL`
  - **Purpose**: Full HTTPS URL of the proxy endpoint that returns raw bytes for a target EFL URL.
  - **Recommended value**: `https://<your-proxy-host>/efl/fetch`
  - **Used by**: `lib/efl/fetchEflPdf.ts` (only when direct fetch returns **403/406**).

- `EFL_FETCH_PROXY_TOKEN`
  - **Purpose**: Optional shared bearer token used to authenticate Vercel → proxy.
  - **Sent as**: `Authorization: Bearer <EFL_FETCH_PROXY_TOKEN>`
  - **Server-side**: The proxy should enforce this token when configured.

## Databases
- `DATABASE_URL` — Primary IntelliWatt application database (master normalized dataset; used by `prisma/schema.prisma`). **Web app (Vercel) stays on this pooled URL (PgBouncer).**
- `DIRECT_URL` — Direct Postgres connection for Prisma migrations and backend jobs that should avoid PgBouncer (e.g., SMT ingest/normalize on the droplet). **Do not repoint to the pool.**
- `CURRENT_PLAN_DATABASE_URL` — **Separate PostgreSQL database dedicated to the Current Plan / Current Rate module.** Must not reuse the primary `DATABASE_URL`. Point this to a distinct database instance (e.g., `intelliwatt_current_plan`) created just for manual plan entries and bill uploads.
- `USAGE_DATABASE_URL` — Module DB for raw and processed usage data (SMT intervals, Green Button uploads, manual entries) before normalization into master usage tables.
- `USAGE_DIRECT_URL` — Direct Postgres URL for the **Usage module DB** (used for Prisma migrations / introspection; avoids PgBouncer).
- `HOME_DETAILS_DATABASE_URL` — Module DB for home characteristics and energy-impact factors (square footage, insulation, windows, thermostat habits, HVAC type, etc.).
- `APPLIANCES_DATABASE_URL` — Module DB for appliance inventory, schedules, and per-appliance usage modeling (including future photo/label analysis).
- `UPGRADES_DATABASE_URL` — Module DB for energy-efficiency upgrades, quotes, financing options, and scenario planning.
- `OFFERS_DATABASE_URL` — Module DB for third-party plan offers and rate card data prior to mapping into the master normalized offers dataset.
- `REFERRALS_DATABASE_URL` — Module DB for referrals, HitTheJackWatt entries, referral tracking, and jackpot accounting.

### Database Setup Notes
- Each module DB should live on the same DigitalOcean Postgres cluster as the main `DATABASE_URL`, but use a unique database name (e.g., `intelliwatt_current_plan`, `intelliwatt_usage`, `intelliwatt_home_details`, etc.).
- In **dev**, define these URLs in `.env` (never commit secrets).
- In **prod**, configure each env var in Vercel Project Settings → Environment Variables.
- Prisma schemas:
  - `prisma/schema.prisma` → uses `DATABASE_URL` (master DB).
  - `prisma/current-plan.schema.prisma` → uses `CURRENT_PLAN_DATABASE_URL` (Current Plan module).
  - Future module schemas will follow the same pattern (`*.schema.prisma` pointing at their corresponding `*_DATABASE_URL`).

## SMT Inline Ingest (Vercel ↔ Droplet)
- **Vercel env (required):**
  - `ADMIN_TOKEN`
  - `INTELLIWATT_WEBHOOK_SECRET` (alias `DROPLET_WEBHOOK_SECRET`)
  - `DROPLET_WEBHOOK_URL`
- **Droplet env (`/etc/default/intelliwatt-smt`):**
  - `ADMIN_TOKEN`
  - `INTELLIWATT_BASE_URL`
  - `SMT_HOST`, `SMT_USER`, `SMT_KEY`, `SMT_REMOTE_DIR`
  - `SMT_LOCAL_DIR`
  - Optional: `SOURCE_TAG`, `METER_DEFAULT`, `ESIID_DEFAULT`
- **Accepted webhook headers (Vercel route `/api/admin/smt/pull`):** `x-intelliwatt-secret`, `x-smt-secret`, `x-webhook-secret`

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

## SMT Inline/Webhook Hand-off (2025-11-12)

**Vercel (required)**

- `ADMIN_TOKEN` — Admin routes auth (`x-admin-token`)

- `INTELLIWATT_WEBHOOK_SECRET` — Shared secret for droplet webhook (`x-intelliwatt-secret`)

- `DROPLET_WEBHOOK_URL` — `http://64.225.25.54:8787/trigger/smt-now`

**Droplet (`/etc/default/intelliwatt-smt`)**

- `ADMIN_TOKEN` — Must match Vercel

- `INTELLIWATT_BASE_URL` — e.g., `https://intelliwatt.com`
- `SMT_METERINFO_ENABLED` — Feature flag. When `true`, Vercel queues SMT meterInfo via the droplet after WattBuy returns an ESIID (SMT REST remains droplet-only).

  When enabled in production:

  - Address saves that include a `houseId` and `esiid` will enqueue a `SmtMeterInfo` job and POST a `reason: "smt_meter_info"` webhook to the SMT droplet.
  - The droplet calls SMT `/v2/meterInfo/` using the canonical Service ID (`INTELLIPATH`) and posts the parsed meter attributes back into the app via `/api/admin/smt/meter-info`.
  - The resulting `SmtMeterInfo` rows, including `meterNumber` and status (`pending`/`complete`/`error`), are surfaced on the `/admin/smt` “Live Pull Monitor” card for operational visibility.

- `SMT_HOST=ftp.smartmetertexas.biz`

- `SMT_USER=intellipathsolutionsftp`

- `SMT_KEY=/home/deploy/.ssh/intelliwatt_smt_rsa4096`

- `SMT_REMOTE_DIR=/`

- `SMT_LOCAL_DIR=/home/deploy/smt_inbox`

- Optional defaults used by fetch_and_post.sh:

  - `SOURCE_TAG=adhocusage`

  - `METER_DEFAULT=M1`

  - `ESIID_DEFAULT=10443720000000001`  # fallback if none provided

**Inline Post Requirements**

- Requests must use `Content-Type: application/json`.

- Payload must include `encoding: "base64"` for file content in `content_b64`.

SMT Droplet Environment Variables (2025-11-15)

These variables must be configured on the DigitalOcean droplet for SMT ingest to work.

Core SMT ingest

SMT_HOST  
Smart Meter Texas SFTP host, e.g. ftp.smartmetertexas.biz.

SMT_USER  
SMT SFTP username, e.g. intellipathsolutionsftp.

SMT_KEY  
Path to the private SSH key used for SMT SFTP, e.g. /home/deploy/.ssh/intelliwatt_smt_rsa4096.

SMT_REMOTE_DIR  
Remote directory on SMT SFTP (currently / while adhocusage is in use).

SMT_LOCAL_DIR  
Local inbox for SMT files on the droplet, e.g. /home/deploy/smt_inbox.

IntelliWatt API access

INTELLIWATT_BASE_URL  
Base URL for the main app, e.g. https://intelliwatt.com.

ADMIN_TOKEN  
64+ char admin token. Used as x-admin-token header when calling
/api/admin/smt/pull, /api/admin/debug/smt/*, /api/admin/analysis/*, etc.

SMT ingest behavior

SOURCE_TAG  
Optional label for SMT ingest source (defaults used in script, e.g. adhocusage).

ESIID_DEFAULT  
Default ESIID to use when a filename does not contain a parseable ESIID.

METER_DEFAULT  
Default meter ID when a filename does not contain a parseable meter (e.g. M1).

These env vars are consumed by deploy/smt/fetch_and_post.sh and the Node upload server. Changes
here must be kept in sync with deployment notes in docs/DEPLOY_SMT_INGEST.md.

## SMT Upload Relay (2025-11-13)

**Client (Next.js)**

- `NEXT_PUBLIC_SMT_UPLOAD_URL` — Example: `https://smt-upload.intelliwatt.com/upload`. This URL **must** be HTTPS to avoid browser mixed-content blocking. Used by `/admin/smt/raw` (and future customer flows) for full-size SMT CSV uploads via the droplet pipeline.

**Droplet**

- `SMT_UPLOAD_DIR` — Default `/home/deploy/smt_inbox`; directory where the upload server writes incoming SMT CSVs.
- `SMT_UPLOAD_PORT` — Default `8081`; port for the Node upload server (nginx proxies HTTPS traffic to this port).
- `SMT_UPLOAD_MAX_BYTES` — Default `10485760` (10 MB); maximum upload size enforced by multer. Keep this ≤ nginx `client_max_body_size`.
- `SMT_INGEST_SERVICE_NAME` — Default `smt-ingest.service`; systemd unit triggered after each successful upload.
- `SMT_UPLOAD_TOKEN` — Optional; shared secret that, when set, requires clients to send header `x-smt-upload-token` with this value.
- `SMT_ADMIN_UPLOAD_DAILY_LIMIT` — Default `50`; maximum admin uploads allowed per rate-limit window.
- `SMT_ADMIN_UPLOAD_WINDOW_MS` — Default `86400000` (24 hours); admin upload rate-limit window in milliseconds.
- `SMT_CUSTOMER_UPLOAD_MONTHLY_LIMIT` — Default `5`; maximum customer uploads allowed per window.
- `SMT_CUSTOMER_UPLOAD_MONTHLY_WINDOW_MS` — Default `2592000000` (~30 days); customer upload rate-limit window in milliseconds.

## SMT Agreements / Subscriptions (Live Wiring)

- `SMT_AGREEMENTS_ENABLED` — When set to `true` or `1`, the SMT authorization API attempts to create a live SMT Agreement + Subscription for the customer's ESIID using the droplet proxy. Leave unset/false to capture consent without calling SMT (useful for staging).
- `SMT_PROXY_AGREEMENTS_URL` — HTTPS endpoint on the droplet SMT proxy that handles `{ action: "create_agreement_and_subscription", ... }` and talks to the real SMT JWT APIs. If not provided, the code falls back to `SMT_PROXY_URL`.
- `SMT_PROXY_TOKEN` — Shared bearer token for authenticating the Vercel app to the SMT proxy. This is distinct from the upstream SMT credentials, which remain isolated on the proxy.

## ESIID Source Selection (2025-11-12)

**Vercel / Server Required**

- `ESIID_SOURCE` — `"wattbuy"` (current) or `"ercot"` (paused)

- `WATTBUY_ESIID_ENABLED` — `true` to enable WattBuy ESIID path (current)

- `ERCOT_ESIID_DISABLED` — `true` to explicitly pause ERCOT ESIID indexing

**Notes**

- With `ERCOT_ESIID_DISABLED=true`, ops must not schedule ERCOT ESIID cron jobs.

- If switching back later, set `ESIID_SOURCE=ercot`, clear `ERCOT_ESIID_DISABLED`, and re-enable cron (see `docs/DEPLOY_ERCOT.md`).

## SMT Customer Authorization & Auto-Pull — Env (LOCKED)

### Vercel (Server)

- `SMT_CALLBACK_VERIFY_SECRET` — Optional, if using SMT callback JSON delivery.

- `SMT_JWT_CLIENT_ID` — SMT API client id.

- `SMT_JWT_CLIENT_SECRET` — SMT API client secret.

- `SMT_JWT_AUDIENCE` — As provided by SMT (token audience).

- `SMT_JWT_TOKEN_URL` — SMT token endpoint URL.

- `SMT_JWT_SCOPE` — Optional scope override if SMT issues non-default scopes.

- `SMT_JWT_CACHE_TTL_SEC` — Optional TTL (seconds) to cache SMT JWTs before refresh (default behavior: refresh on expiry minus safety buffer).

- `SMT_CALLBACK_BASE_URL` — Optional base URL to advertise callback endpoint (include scheme + host, no trailing slash).

- `ADMIN_TOKEN` — Existing admin gate (unchanged).

### Droplet

- (Existing) `INTELLIWATT_WEBHOOK_SECRET` — webhook auth.

- (Existing) SFTP keys & paths (no change).

### Notes

- If choosing Callback API delivery, expose `/api/smt/callback` (server) and validate `SMT_CALLBACK_VERIFY_SECRET`.

- SFTP remains preferred; Enrollment backfill always goes to SFTP per SMT.

- Enrollment logic must cap requested backfill to 12 months for residential and 24 months for commercial ESIDs.

## Manual Past canonical artifact persist

- `MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST`
  - **Purpose:** When set to `1`, persist manual monthly/annual Past artifacts with canonical display-window stamp (`manual_canonical_artifact_v1`) at artifact write.
  - **Scope:** Server-only. **Do not** expose as `NEXT_PUBLIC_*`.
  - **Production:** Must be `1` in Vercel Production for canonical manual Past artifacts. Redeploy after add/change.
  - **Detail:** `docs/MANUAL_MONTHLY_GREEN_CLOSEOUT.md`
