# Testing IntelliWatt API Endpoints (Prod & Preview)

## Why do I need to pass tokens if I have `.env.local`?

- `.env.local` is loaded by the **server** when you run locally.

- From your terminal against a deployed URL, you're an external client — admin routes still require `x-admin-token`.

- Prod env vars live in Vercel → Project → Settings → Environment Variables.

## Deployment URLs

- Production: `https://intelliwatt.com`

- Preview example: `https://<project>-<hash>-vercel.app`

## Automated Node smoke test (Cursor / CI)

1. `npm i -g vercel` and `vercel login`

2. Pull prod envs: `vercel env pull .env.vercel --environment=production`

3. Run: `node scripts/admin/api_test_prod.mjs --base https://intelliwatt.com`

   - or: `npm run test:prod -- https://intelliwatt.com`

## Quick sanity endpoints

- Public ping: `GET /api/ping` → `{ ok: true, ... }`

- Text ping: `GET /api/ping.txt` → `OK`

- Env health: `GET /api/admin/env-health` with `x-admin-token: <ADMIN_TOKEN>`

## ERCOT quick verify (admin/cron)

```bash
# URL sanity (admin)
curl -sS "$BASE/api/admin/ercot/debug/url-sanity" -H "x-admin-token: $ADMIN_TOKEN" | jq

# Manual fetch by explicit URL (admin) - set ERCOT_TEST_URL in Vercel or pass ?url=
curl -sS "$BASE/api/admin/ercot/fetch-latest?url=$ERCOT_TEST_URL" -H "x-admin-token: $ADMIN_TOKEN" | jq

# List recent ingests (admin)
curl -sS "$BASE/api/admin/ercot/ingests" -H "x-admin-token: $ADMIN_TOKEN" | jq

# Cron (header)
curl -sS "$BASE/api/admin/ercot/cron" -H "x-cron-secret: $CRON_SECRET" | jq
# Cron (query)
curl -sS "$BASE/api/admin/ercot/cron?token=$CRON_SECRET" | jq
```

**Notes:**
- Set `ERCOT_PAGE_URL` as in `DEPLOY_ERCOT.md`.
- Use `ERCOT_TEST_URL` for a known file to validate ingestion.
- Idempotent: repeated runs skip duplicates by `fileSha256`.

## WattBuy API Testing

### Retail Rates Endpoints

**Note:** WattBuy API requires `utilityID` (camelCase) + `state` (lowercase). We support auto-derivation from address.

#### A) Explicit utilityID + state (Oncor)

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Returns retail rates for Oncor (utilityID 44372) in Texas.

#### B) Derive from address (auto-derives utilityID)

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-test?address=9514%20Santa%20Paula%20Dr&city=Fort%20Worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Auto-derives utilityID from address via `/v3/electricity/info`, then fetches retail rates.

#### C) Convenience by-address route

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-by-address?address=9514%20Santa%20Paula%20Dr&city=Fort%20Worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Same as B, but with simpler path name.

#### D) ZIP-only endpoint (auto-derives utilityID)

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-zip?zip=75201" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Auto-derives utilityID from ZIP code, then fetches retail rates.

**Note:** All endpoints require `state` to be lowercase (e.g., `tx` not `TX`). `utilityID` must be camelCase.

### Electricity Catalog (Robust)

The robust electricity endpoint implements 3-strategy fallback for maximum reliability:

```bash
# With address (recommended)
curl -sS "https://intelliwatt.com/api/admin/wattbuy/electricity?address=9514%20santa%20paula%20dr&city=fort%20worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq

# Using electricity-probe endpoint (dedicated testing)
curl -sS "https://intelliwatt.com/api/admin/wattbuy/electricity-probe?address=9514%20santa%20paula%20dr&city=fort%20worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Fallback Strategy:**
1. Direct call with uppercase state (e.g., `TX`)
2. Retry with lowercase state (e.g., `tx`)
3. Fallback to `wattkey` lookup via `/v3/electricity/info`

**Response includes:**
- `usedWattkey`: Boolean indicating if fallback was used
- `shape`: Payload structure metadata (`topType`, `keys`)
- `headers`: Diagnostic headers from WattBuy
- `data`: Full response payload

### Using the Admin Inspector UI

Navigate to `/admin/wattbuy/inspector` for an interactive testing interface.

**Inspector Response Fields:**
- `topType`: Whether the payload is an `array` or `object`
- `topKeys`: If object, what keys exist at the top level
- `foundListPath`: Which key contains the array (or `"(root)"` if the payload itself is the list)
- `count`: Number of items found (even when WattBuy doesn't return a root array)
- `sample`: First 3 items from the found array
- `note`: Diagnostic message if no array was found

**If `count = 0`:** This indicates upstream content from WattBuy, not a code issue. When contacting WattBuy support, include:
1. **Request ID**: The `x-amzn-requestid` from the response headers
2. **Exact selector used**: `utilityID=44372&state=tx` (if explicit) or the derived utilityID
3. **Metadata**: Include the `topType`, `topKeys`, and `foundListPath` values

### Debugging WattBuy Failures

1. **Inspect diagnostic headers** in the JSON response:
   ```bash
   # Look for these fields in the response:
   .headers.x-amzn-requestid      # AWS request ID for support
   .headers['x-documentation-url'] # API documentation link
   .headers['x-amz-apigw-id']     # API Gateway ID
   ```

2. **Try both selectors** to isolate the issue:
   - ZIP-based: `?zip=75201`
   - Utility+State: `?utilityID=44372&state=tx`

3. **Common Issues:**
   - **403 Forbidden**: Check API key permissions in WattBuy dashboard
   - **500 Internal Server Error**: Check server logs, verify `WATTBUY_API_KEY` is set
   - **Empty results**: Verify ZIP code or utilityID is valid for Texas
   - **Timeout**: Check network connectivity, retry logic should handle transient 5xx errors

## SMT Inline + Webhook Smoke Tests (2025-11-12)

### A) Inline upload (stores RawSmtFile; no droplet pull)

**Where:** Local Windows PowerShell  
**Set:**

```powershell
$BASE_URL    = "https://intelliwatt.com"
$ADMIN_TOKEN = "<PASTE_64_CHAR>"
$csvB64      = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\adhoc.csv"))
$body = @{
  mode       = "inline"
  filename   = "adhoc.csv"
  encoding   = "base64"
  content_b64= $csvB64
  esiid      = "10443720000000001"
  meter      = "M1"
  sizeBytes  = 12345
} | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "$BASE_URL/api/admin/smt/pull" `
  -Headers @{ "x-admin-token" = $ADMIN_TOKEN } `
  -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 6
```

**Expect:** `{ ok: true, mode: "inline", ... }` and raw persisted.

### B) Admin-triggered webhook (droplet pull)

**Where:** Local Windows PowerShell  
**Set:**

```powershell
$BASE_URL    = "https://intelliwatt.com"
$ADMIN_TOKEN = "<PASTE_64_CHAR>"
$body = @{
  esiid = "10443720000000001"
  meter = "M1"
} | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "$BASE_URL/api/admin/smt/pull" `
  -Headers @{ "x-admin-token" = $ADMIN_TOKEN } `
  -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 6
```

**Expect:** `{ ok: true, message: "...", webhookResponse: {...} }`.

### C) Webhook literal body (Windows curl)

**Where:** Windows PowerShell  
**Note:** Use `^` for line continuation; `--data-raw` keeps the literal JSON body.

```powershell
curl.exe -X POST ^
  http://64.225.25.54:8787/trigger/smt-now ^
  -H "x-intelliwatt-secret: $env:INTELLIWATT_WEBHOOK_SECRET" ^
  --data-raw "{\"esiid\":\"10443720000000001\",\"meter\":\"M1\"}"
```

**Expect:** HTTP 200 with `[INFO]` / `[DONE]` lines in response body.

## SMT Customer Authorization Canonical Tests (LOCKED — run once endpoints ship)

> **Where:** Windows PowerShell (Invoke-RestMethod or curl.exe variants), admin-gated routes only.

### 1) Create Agreement (admin proxy)

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$Body = @{
  esiid    = "10443720000000001"
  meter    = "M1"
  language = "en"
  termsAck = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/admin/smt/agreements/new" `
  -Headers @{ "x-admin-token" = $AdminToken } `
  -ContentType "application/json" `
  -Body $Body | ConvertTo-Json -Depth 6
```

**Expect (once implemented):** `201 Created` | `200 OK` with `{ ok:true, agreementId, status }`.

### 2) Create Subscription (15-min data, SFTP delivery)

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$Agreement  = Read-Host "Agreement ID from step 1"
$Body = @{
  agreementId = $Agreement
  delivery    = "SFTP"   # or "CALLBACK"
  format      = "CSV"    # or "JSON"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/admin/smt/subscriptions/new" `
  -Headers @{ "x-admin-token" = $AdminToken } `
  -ContentType "application/json" `
  -Body $Body | ConvertTo-Json -Depth 6
```

**Expect:** `{ ok:true, subscriptionId, status }`; verify SFTP delivery settings echoed back.

### 3) Enrollment Request (historical backfill to SFTP)

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$Agreement  = Read-Host "Agreement ID (res reuse from step 1)"
$Body = @{
  agreementId = $Agreement
  monthsBack  = 12    # residential default; 24 only for commercial ESIDs
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/admin/smt/enrollments/new" `
  -Headers @{ "x-admin-token" = $AdminToken } `
  -ContentType "application/json" `
  -Body $Body | ConvertTo-Json -Depth 6
```

**Expect:** `{ ok:true, enrollmentId, status, requestedRange, effectiveRange }`.

### 4) Agreement/Subscription/Enrollment Status Checks

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$Esiid      = "10443720000000001"

Invoke-RestMethod -Method GET `
  -Uri "$BaseUrl/api/admin/smt/agreements/list?esiid=$Esiid" `
  -Headers @{ "x-admin-token" = $AdminToken } | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method GET `
  -Uri "$BaseUrl/api/admin/smt/subscriptions/list?esiid=$Esiid" `
  -Headers @{ "x-admin-token" = $AdminToken } | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method GET `
  -Uri "$BaseUrl/api/admin/smt/enrollments/list?esiid=$Esiid" `
  -Headers @{ "x-admin-token" = $AdminToken } | ConvertTo-Json -Depth 6
```

**Expect:** `200 OK` with arrays including IDs + status; downstream SFTP drops should appear once active.

## SMT JWT Token Debug (Admin Only, LOCKED)

> **Where:** Windows PowerShell (Invoke-RestMethod), admin-gated route.

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"

Invoke-RestMethod -Method GET `
  -Uri "$BaseUrl/api/admin/smt/token" `
  -Headers @{ "x-admin-token" = $AdminToken } |
  ConvertTo-Json -Depth 6
```

**Expect:** `{ "ok": true, "tokenPreview": "...", "expiresAt": "...", "expiresInSec": 3600, "rawExpiresInSec": 3600, "tokenType": "Bearer", "fromCache": false }`

**Notes:**
- Requires Vercel env vars: `SMT_JWT_CLIENT_ID`, `SMT_JWT_CLIENT_SECRET`, `SMT_JWT_AUDIENCE`, `SMT_JWT_TOKEN_URL`.
- Optional env vars: `SMT_JWT_SCOPE`, `SMT_JWT_CACHE_TTL_SEC`.
- Route is admin-only via `x-admin-token`; use to verify JWT configuration before wiring Agreements/Subscriptions/Enrollment flows.
- Full token preview (including cached/fresh metadata) is available at `/api/admin/smt/jwt/preview` for deeper ops troubleshooting; never expose that route to end users.

## Windows PowerShell — Canonical HTTP Snippets (LOCKED 2025-11-12)

### 1) Admin-triggered SMT pull (POST /api/admin/smt/pull)

**A. PowerShell-native (Invoke-RestMethod)**

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$Body = @{
  esiid = "10443720000000001"
  meter = "M1"
} | ConvertTo-Json -Compress

$Response = Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/admin/smt/pull" `
  -Headers @{ "x-admin-token" = $AdminToken } `
  -ContentType "application/json" `
  -Body $Body

$Response | ConvertTo-Json -Depth 6
```

**B. Explicit curl.exe**

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$Body       = '{"esiid":"10443720000000001","meter":"M1"}'

curl.exe -X POST ^
  "$BaseUrl/api/admin/smt/pull" ^
  -H "x-admin-token: $AdminToken" ^
  -H "content-type: application/json" ^
  --data-binary $Body
```

### 2) Droplet webhook trigger (POST http://<droplet>:8787/trigger/smt-now)

**A. PowerShell-native (Invoke-RestMethod)**

```powershell
$DropletUrl = "http://64.225.25.54:8787/trigger/smt-now"
$Secret     = Read-Host "INTELLIWATT_WEBHOOK_SECRET"
$Body = @{
  esiid = "10443720000000001"
  meter = "M1"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method POST `
  -Uri $DropletUrl `
  -Headers @{ "x-intelliwatt-secret" = $Secret } `
  -ContentType "application/json" `
  -Body $Body | Out-String
```

**B. Explicit curl.exe**

```powershell
$DropletUrl = "http://64.225.25.54:8787/trigger/smt-now"
$Secret     = Read-Host "INTELLIWATT_WEBHOOK_SECRET"
$Body       = '{"esiid":"10443720000000001","meter":"M1"}'

curl.exe -X POST ^
  $DropletUrl ^
  -H "x-intelliwatt-secret: $Secret" ^
  -H "content-type: application/json" ^
  --data-binary $Body
```

### Gotchas (Windows PowerShell)

- Bare `curl` calls the `Invoke-WebRequest` alias; always choose `Invoke-RestMethod` or `curl.exe`.
- PowerShell uses the backtick `` ` `` for line continuation; do **not** copy bash `\` line breaks.
- `ConvertTo-Json -Compress` avoids whitespace issues when posting JSON bodies.
- `curl.exe --data-binary` sends the string exactly as provided; verify quotes inside `$Body`.
- These conventions are LOCKED per plan change `[PC-2025-11-12-B]`; future docs must reference this section.

## SMT Normalize API — Canonical Tests (LOCKED 2025-11-12)

### A) Normalize the latest RawSmtFile

**PowerShell (Invoke-RestMethod)**

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$Body       = @{ latest = $true } | ConvertTo-Json -Compress

Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/admin/smt/normalize" `
  -Headers @{ "x-admin-token" = $AdminToken } `
  -ContentType "application/json" `
  -Body $Body | ConvertTo-Json -Depth 6
```

**Explicit curl.exe**

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$Body       = '{"latest":true}'

curl.exe -X POST ^
  "$BaseUrl/api/admin/smt/normalize" ^
  -H "x-admin-token: $AdminToken" ^
  -H "content-type: application/json" ^
  --data-binary $Body
```

### B) Normalize a specific RawSmtFile by ID

**PowerShell (Invoke-RestMethod)**

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$RawId      = Read-Host "RawSmtFile ID"
$Body       = @{ rawId = $RawId } | ConvertTo-Json -Compress

Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/admin/smt/normalize" `
  -Headers @{ "x-admin-token" = $AdminToken } `
  -ContentType "application/json" `
  -Body $Body | ConvertTo-Json -Depth 6
```

**Explicit curl.exe**

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$RawId      = Read-Host "RawSmtFile ID"
$Body       = ("{""rawId"":""{0}""}" -f $RawId)

curl.exe -X POST ^
  "$BaseUrl/api/admin/smt/normalize" ^
  -H "x-admin-token: $AdminToken" ^
  -H "content-type: application/json" ^
  --data-binary $Body
```

### C) Normalize all files received since a timestamp

**PowerShell (Invoke-RestMethod)**

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$Since      = "2025-11-01T00:00:00Z"
$Body       = @{ since = $Since } | ConvertTo-Json -Compress

Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/admin/smt/normalize" `
  -Headers @{ "x-admin-token" = $AdminToken } `
  -ContentType "application/json" `
  -Body $Body | ConvertTo-Json -Depth 6
```

**Explicit curl.exe**

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
$Body       = '{"since":"2025-11-01T00:00:00Z"}'

curl.exe -X POST ^
  "$BaseUrl/api/admin/smt/normalize" ^
  -H "x-admin-token: $AdminToken" ^
  -H "content-type: application/json" ^
  --data-binary $Body
```

### Gotchas (Normalize)

- Responses should return `{ ok: true, normalized, files[] }`; inspect `files` array for per-file counts.
- Re-running against the same file is idempotent; expect `normalized` to remain stable.
- Errors come back as `{ ok: false, error }` with HTTP 4xx/5xx; check PowerShell `$Error[0]` for details.
- Keep timestamps in ISO 8601 UTC; PowerShell’s `Get-Date -AsUTC -Format o` is a quick helper if you need dynamic values.

## ESIID Lookup — Current Source: WattBuy (LOCKED 2025-11-12)

WattBuy Property Details → ESIID

**Windows PowerShell (Invoke-RestMethod)**

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"
# Example route; update if your repo exposes a helper admin proxy for WattBuy lookups:
# /api/admin/wattbuy/property-details?address=<...>&city=<...>&state=TX&zip=75201
$Address = "2000 Ross Ave"
$City    = "Dallas"
$State   = "TX"
$Zip     = "75201"

Invoke-RestMethod -Method GET `
  -Uri "$BaseUrl/api/admin/wattbuy/property-details?address=$([uri]::EscapeDataString($Address))&city=$City&state=$State&zip=$Zip" `
  -Headers @{ "x-admin-token" = $AdminToken }
```

**Expect:** JSON payload including `esiid` resolved by WattBuy for the property.

> NOTE: ERCOT ESIID indexing is paused. Do not run ERCOT ESIID cron or daily pulls while this lock is active. See `docs/DEPLOY_ERCOT.md` “Pause ERCOT ESIID”.

**Gotchas**

- Ensure `ESIID_SOURCE=wattbuy`, `WATTBUY_ESIID_ENABLED=true`, and `ERCOT_ESIID_DISABLED=true` are set in Vercel env.
- Keep using the Windows IRM / curl.exe conventions locked earlier in this doc.

## Verification Snapshot — SMT + WattBuy ESIID (2025-11-12)

All canonical tests below returned **HTTP 200** in production:

- **Admin SMT Pull:** `POST /api/admin/smt/pull` (IRM + curl.exe variants)
- **Droplet Webhook:** `POST http://64.225.25.54:8787/trigger/smt-now` with `x-intelliwatt-secret`
- **Normalize:** `POST /api/admin/smt/normalize` with `{ latest:true }`, `{ rawId }`, `{ since }`
- **WattBuy ESIID Proxy (Admin):** `GET /api/admin/wattbuy/property-details?...`

Reference:

- Windows rules (IRM/curl.exe, headers, JSON bodies) are **LOCKED** above.
- UI helpers at **/admin/smt/inspector** exercised the same flows and reported 200 OK.

This snapshot marks the current state as **VERIFIED**. If any route changes, update this section immediately.

SMT Inline Ingest & Normalization – Admin Test Scripts (2025-11-15)

All of these commands require a valid ADMIN_TOKEN for the production project.

1) Direct inline test from a small local CSV (PowerShell example)

On a Windows dev machine with PowerShell:

```
$BASE_URL    = "https://intelliwatt.com"
$ADMIN_TOKEN = "<ADMIN_TOKEN>"

$csvPath = "C:\path\to\test-smt.csv"

$csvBytes = [System.IO.File]::ReadAllBytes($csvPath)
$csvB64   = [System.Convert]::ToBase64String($csvBytes)

$bodyObj = @{
    mode        = "inline"
    source      = "local-powershell-test"
    filename    = [System.IO.Path]::GetFileName($csvPath)
    mime        = "text/csv"
    encoding    = "base64"          # small test file -> plain base64
    sizeBytes   = $csvBytes.Length
    esiid       = "10443720000000001"
    meter       = "M1"
    captured_at = (Get-Date).ToUniversalTime().ToString("o")
    content_b64 = $csvB64
}

$bodyJson = $bodyObj | ConvertTo-Json -Depth 6

$response = Invoke-RestMethod -Method POST `
    -Uri "$BASE_URL/api/admin/smt/pull" `
    -Headers @{ "x-admin-token" = $ADMIN_TOKEN } `
    -ContentType "application/json" `
    -Body $bodyJson

$response | ConvertTo-Json -Depth 10
```

Expected response:

- ok: true
- mode: "inline"
- persisted: true
- duplicate: false
- message: "Inline payload stored and verified."

2) Verify raw SMT files

On the droplet or any trusted machine:

```
export ADMIN_TOKEN="<ADMIN_TOKEN>"

curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
  "https://intelliwatt.com/api/admin/debug/smt/raw-files?limit=10" | jq
```

You should see entries for both:

- Direct test uploads (e.g. test-smt.csv, source: "local-powershell-test").
- Droplet-ingested SMT files (e.g. 20251114T202822_IntervalData.csv, source: "adhocusage").

3) Verify normalized intervals

After a droplet ingest run that posts IntervalData CSVs:

```
export ADMIN_TOKEN="<ADMIN_TOKEN>"

curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
  "https://intelliwatt.com/api/admin/analysis/daily-summary?esiid=10443720000000001&meter=M1&dateStart=2025-11-14T00:00:00Z&dateEnd=2025-11-16T00:00:00Z&limit=10" | jq
```

If auto-normalization is working, rows should include one or more daily summaries for the
requested ESIID/meter range, driven by SmtInterval records created during inline ingest.

## SMT Normalize + Debug + Daily Summary (Admin Smoke Tests)

Use these tests anytime you touch SMT ingest or analysis logic.

> Note: Replace `<ADMIN_TOKEN>`, `<ESIID>`, and `<RAW_SMT_FILE_ID>` with real values. Do **not** commit secrets into the repo.

1. **Normalize a Raw SMT CSV**

   ```bash
   export ADMIN_TOKEN="<ADMIN_TOKEN>"

   curl -sS -X POST "https://intelliwatt.com/api/admin/smt/normalize" \
     -H "x-admin-token: $ADMIN_TOKEN" \
     -H "content-type: application/json" \
     --data-binary '{
       "rawId": "<RAW_SMT_FILE_ID>"
     }'
   ```

   Expected:

   - `ok: true`
   - First run: `intervalsInserted > 0`, `duplicatesSkipped` small.
   - Subsequent run on same id: `intervalsInserted: 0`, `duplicatesSkipped` equal to records for that file.

2. **Inspect intervals for an ESIID**

   ```bash
   export ADMIN_TOKEN="<ADMIN_TOKEN>"

   curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
     "https://intelliwatt.com/api/admin/debug/smt/intervals?esiid=<ESIID>&limit=5"
   ```

   You should see:

   - Correct `esiid`.
   - `meter` (currently `"unknown"` in our test).
   - `ts` in UTC.
   - Realistic `kwh` values.

   Optional bounded test:

   ```bash
   curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
     "https://intelliwatt.com/api/admin/debug/smt/intervals?esiid=<ESIID>&dateStart=2025-11-17T00:00:00Z&dateEnd=2025-11-19T00:00:00Z&limit=200"
   ```

3. **Delete a bad slice (clean-up test data)**

   ```bash
    export ADMIN_TOKEN="<ADMIN_TOKEN>"

    curl -sS -X POST "https://intelliwatt.com/api/admin/debug/smt/intervals" \
      -H "x-admin-token: $ADMIN_TOKEN" \
      -H "content-type: application/json" \
      --data-binary '{
        "esiid": "<ESIID>",
        "meter": "unknown",
        "dateStart": "2025-11-15T00:00:00Z",
        "dateEnd":   "2025-11-17T00:00:00Z"
      }'
   ```

   Expected:

   - Response contains `ok: true` and a sensible `deletedCount`.
   - Re-running the `GET` for the same window should show fewer (or zero) rows.

4. **Daily Summary completeness check**

   ```bash
   export ADMIN_TOKEN="<ADMIN_TOKEN>"

   curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
     "https://intelliwatt.com/api/admin/analysis/daily-summary?esiid=<ESIID>&dateStart=2025-11-17T00:00:00Z&dateEnd=2025-11-19T00:00:00Z&limit=10"
   ```

   Expected:

   - `rows` array with per-day entries.
   - Each row has: `date` (local date in America/Chicago), `esiid`, `meter`, `found` (interval count), `expected` (currently 96), `completeness = found / expected`.
   - `meta.range` shows the analyzed local range with `zone: "America/Chicago"`.
   - Partial CSV windows (e.g., file only covers 06:00–06:00 next day) will produce completeness ≈ 0.5 across two days. This is expected until we add more sophisticated DST/boundary handling.

## SMT Billing Reads (Ad-Hoc via /v2/energydata)

**Endpoint**

- `POST /api/admin/smt/billing/fetch`
- Admin-only (requires `x-admin-token` header with the same `ADMIN_TOKEN` used elsewhere).

**Purpose**

- Trigger Smart Meter Texas `/v2/energydata` to retrieve:
  - Monthly Billing Reads (primary target)
  - Optional 15-minute interval and daily register reads
- Returns the raw SMT payload so we can study the shape before wiring persistence.

### curl example (Linux/macOS)

```bash
ADMIN_TOKEN="PASTE_YOUR_64_CHAR_TOKEN"
BASE_URL="https://intelliwatt.com"

curl -sS -X POST "$BASE_URL/api/admin/smt/billing/fetch" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "esiid": "10443720004529147",
    "startDate": "2024-11-01",
    "endDate": "2024-11-30",
    "includeInterval": false,
    "includeDaily": false,
    "includeMonthly": true
  }'
```

### PowerShell (Windows)

```powershell
$BaseUrl    = "https://intelliwatt.com"
$AdminToken = Read-Host "ADMIN_TOKEN"

$Body = @{
  esiid           = "10443720004529147"
  startDate       = "2024-11-01"
  endDate         = "2024-11-30"
  includeInterval = $false
  includeDaily    = $false
  includeMonthly  = $true
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/admin/smt/billing/fetch" `
  -Headers @{ "x-admin-token" = $AdminToken } `
  -ContentType "application/json" `
  -Body $Body | ConvertTo-Json -Depth 6
```

> Tip: Start with short date windows while experimenting. Responses can be large if `includeInterval` is set to true.

---
## SMT Authorization API (v1) — Smoke Tests

### POST /api/smt/authorization

Creates an `SmtAuthorization` record using the schema defined in `docs/SMT_AUTH_MODEL.md`. Until the magic-link session helper is wired in, callers must supply `userId` and `contactEmail` in the request body.

#### PowerShell example

```powershell
$baseUrl = "https://intelliwatt.com"

$body = @{
  userId = "<TEST_USER_ID>"
  contactEmail = "user@example.com"
  houseAddressId = "<HOUSE_ADDRESS_ID>"
  houseId = "<HOUSE_ID>"
  esiid = "10443720000000001"
  serviceAddressLine1 = "123 Main St"
  serviceCity = "Fort Worth"
  serviceState = "TX"
  serviceZip = "76101"
  tdspCode = "ONCOR"
  tdspName = "Oncor"
  customerName = "Test Customer"
  contactPhone = "8175551234"
  consent = $true
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/api/smt/authorization" `
  -ContentType "application/json" `
  -Body $body
```

Expected: HTTP 201 with `{ ok: true, authorizationId: "<uuid>" }`.

### GET /api/admin/smt/authorizations

Lists recent SMT authorizations. Requires `x-admin-token`.

#### PowerShell example

```powershell
$baseUrl = "https://intelliwatt.com"
$adminToken = "<YOUR_64_CHAR_ADMIN_TOKEN>"

Invoke-RestMethod `
  -Method Get `
  -Uri "$baseUrl/api/admin/smt/authorizations?limit=20" `
  -Headers @{ "x-admin-token" = $adminToken }
```

Expected: HTTP 200 with `{ ok: true, count, items: [...] }` or HTTP 401 if the admin token is missing or invalid.