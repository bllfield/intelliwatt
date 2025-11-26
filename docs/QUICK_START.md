# IntelliWatt Quick Start

**One-page reference for new chat sessions**

---

## ⚠️ CRITICAL: Windows PowerShell Environment

**DO NOT use bash-style `&&` chaining**
```powershell
# ❌ WRONG
git add . && git commit -m "message"

# ✅ CORRECT
git add .; git commit -m "message"
```

---

## 🧹 Keeper Cleanup Runbook (Chat Only)

- Always let the Cursor chat agent execute each command so we keep a full transcript.
- Capture a DigitalOcean snapshot or `pg_dump` before touching production data.

**Command Prompt sequence (run in repo root):**
1. `npx prisma db execute --file "scripts\sql\bulk_archive_non_keeper_users.sql" --schema prisma\schema.prisma`
2. `npx prisma db execute --file "scripts\sql\delete_non_keeper_users.sql" --schema prisma\schema.prisma`
3. Optional polish:  
   `npx prisma db execute --file "scripts\sql\delete_non_keeper_entries.sql" --schema prisma\schema.prisma`  
   `npx prisma db execute --file "scripts\sql\delete_non_keeper_smt_authorizations.sql" --schema prisma\schema.prisma`
4. Reseed keepers: `node scripts\dev\seed-keeper-users.mjs`
5. Verify with `npx prisma db execute --stdin --schema prisma\schema.prisma` and `SELECT COUNT(*) FROM "User";` (expect `5`).

If verification does not return `5`, stop and investigate before loading any additional fixtures.

---

## 🚀 Production Access

- **URL**: https://intelliwatt.com (Vercel)
- **Database**: DigitalOcean PostgreSQL (production)
- **API**: Prefer **Preview** deployments for testing; treat **Production** as read-only for verified flows
- **No local dev server** needed for data queries

### Environment Strategy
- **Preview**: Use for all testing, development, and experimental changes
- **Production**: Read-only for verified flows and data queries only
- **Safety**: Avoid modifying production data during development

### Database URLs (copy/paste everywhere)
```
DATABASE_URL="postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25061/app-pool?sslmode=require&pgbouncer=true"
DIRECT_URL="postgresql://doadmin:AVNS_lUXcN2ftFFu6XUIc5G0@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/defaultdb?sslmode=require"
```
- Add both lines to local `.env`, `.env.production.local`, Vercel env vars, and the droplet (`sudo nano /etc/environment`; `source /etc/environment`; restart services).
- Prisma schema already uses `url` + `directUrl`; leave them.
- Prisma Studio uses `DATABASE_URL`, so it now hits PgBouncer—close Studio when finished.
- When providing droplet instructions, always include the login and directory steps first, e.g.:
  ```
  ssh root@<droplet-ip>
  sudo -iu deploy
  cd /home/deploy/apps/intelliwatt
  ```
  Never assume the user is already on the right account or path.
- Before telling the user to add or change any value, search the repo. If it already exists, paste it directly instead of asking for it.
- If you need to switch users during a session, spell out the transition (for example, `exit` to leave `deploy` back to root, or `sudo -iu deploy` before running deploy-only commands).

---

## 📊 Current Database State

**3 addresses** (1 per user):

1. `bllfield@yahoo.com` → 9514 Santa Paula Drive, Fort Worth, TX 76116
2. `brian@intellipath-solutions.com` → 8808 Las Vegas Court, Fort Worth, TX 76108
3. `bllfield32@gmail.com` → 1860 East Northside Drive (Unit 2223), Fort Worth, TX 76106

---

## 🔧 Quick Commands (PowerShell)

### Admin Authentication Required
All debug/admin endpoints now require `x-admin-token` header matching `ADMIN_TOKEN` env var.

```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
```

### Check All Addresses

**Preview (Recommended for Testing):**
```powershell
# Replace <your-preview> with your Vercel preview deployment URL
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://<your-preview>.vercel.app/api/debug/list-all-addresses" -Method GET
```

**Production (Read-Only):**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/list-all-addresses" -Method GET
```

### Check Specific User

**Preview:**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://<your-preview>.vercel.app/api/debug/check-address?email=bllfield@yahoo.com" -Method GET
```

**Production:**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/check-address?email=bllfield@yahoo.com" -Method GET
```

### Cleanup Duplicates

⚠️ **Use Preview only - avoid running on Production**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://<your-preview>.vercel.app/api/debug/cleanup" -Method POST
```

### Check Environment Health

**Preview:**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://<your-preview>.vercel.app/api/admin/env-health" -Method GET
```

**Production:**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/admin/env-health" -Method GET
```

---

## 📁 Key Files

- **Prisma Client**: `lib/db.ts`
- **Address Save**: `app/api/address/save/route.ts`
- **Address Normalization**: `lib/normalizeGoogleAddress.ts`
- **Autocomplete UI**: `components/QuickAddressEntry.tsx`
- **Database Schema**: `prisma/schema.prisma`

---

## 🔗 API Endpoints

- `GET /api/debug/list-all-addresses`
- `GET /api/debug/check-address?email=...`
- `POST /api/debug/cleanup`
- `POST /api/address/save`

---

## 📚 Full Documentation

- **[PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)** - Complete operational context
- **[GOOGLE_MAPS_SETUP.md](./GOOGLE_MAPS_SETUP.md)** - Maps integration
- **[ARCHITECTURE_STANDARDS.md](./ARCHITECTURE_STANDARDS.md)** - Core principles
- **[PROJECT_PLAN.md](./PROJECT_PLAN.md)** - Project guardrails

---

**Last Updated**: January 2025

### Verify WattBuy Retail Rates (catalog) — admin proxy

**Note:** WattBuy API requires `utilityID` (camelCase) + `state` (lowercase). We support auto-derivation from address.

1) **Explicit utilityID + state (Oncor):**

```bash
ADMIN_TOKEN="<ADMIN_TOKEN>"
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

2) **Auto-derive from address:**

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-test?address=9514%20Santa%20Paula%20Dr&city=Fort%20Worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

3) **Convenience by-address route:**

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-by-address?address=9514%20Santa%20Paula%20Dr&city=Fort%20Worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

4) **ZIP-only endpoint (auto-derives utilityID):**

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-zip?zip=75201" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

**Notes:**
- `utilityID` must be camelCase (e.g., `44372` for Oncor).
- `state` must be lowercase (e.g., `tx` not `TX`).
- Auto-derivation calls `/v3/electricity/info` to extract utilityID from address.
- See https://www.eia.gov/electricity/data/eia861/ for EIA utility IDs.

3) Inspect DB rows (examples depend on your admin readers; use psql/Prisma Studio as needed).

### Verify WattBuy Electricity catalog — admin proxy (Robust)

The robust electricity endpoint implements 3-strategy fallback for maximum reliability:

1) **With address (recommended):**

```bash
ADMIN_TOKEN="<ADMIN_TOKEN>"
curl -sS "https://intelliwatt.com/api/admin/wattbuy/electricity?address=9514%20santa%20paula%20dr&city=fort%20worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

2) **Using electricity-probe endpoint (dedicated testing):**

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/electricity-probe?address=9514%20santa%20paula%20dr&city=fort%20worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
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

**Note:** `zip` is required. Use `state` as lowercase two-letter code (e.g., "tx"). `address` and `city` should be URL-encoded.

### Verify WattBuy Electricity Info — admin proxy

1) With address (zip is required):

```bash
ADMIN_TOKEN="<ADMIN_TOKEN>"
curl -sS "https://intelliwatt.com/api/admin/wattbuy/electricity/info?address=9514%20santa%20paula%20dr&city=fort%20worth&state=tx&zip=76116&housing_chars=true&utility_list=true" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

2) With just zip (minimal query):

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/electricity/info?zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

Note: `zip` is required. `housing_chars` and `utility_list` can be set to "true" to include those sections in the response. Response includes ESIID, utility info, housing characteristics, and utility list.

### WattBuy Inspector UI

For interactive testing with visual inspection of responses:

1. Navigate to `/admin/wattbuy/inspector` in your browser
2. Paste your `ADMIN_TOKEN` in the auth field
3. Test endpoints with real-time inspection results:
   - **By Utility**: Enter `utilityID` and `state` (lowercase)
   - **By Address**: Enter address fields and test multiple endpoints
4. View inspection metadata:
   - `topType`: Payload structure (array/object)
   - `topKeys`: Top-level keys (if object)
   - `foundListPath`: Where the array was found (`rates`, `plans`, `(root)`, etc.)
   - `count`: Number of items found
   - `sample`: First 3 items
   - `note`: Diagnostic messages

**If `count = 0`**: This indicates upstream content from WattBuy. Contact support with the `x-amzn-requestid` from headers, exact selector used, and the `topType`/`topKeys`/`foundListPath` metadata. See `docs/TESTING_API.md` for detailed troubleshooting.

## ERCOT — Quick Commands (Production)

### Environment Setup
```bash
export PROD_BASE_URL="https://intelliwatt.com"
export ADMIN_TOKEN="<your-admin-token>"
export CRON_SECRET="<your-cron-secret>"
```

### Basic Verification
```bash
# Verify env health
curl -sS "$PROD_BASE_URL/api/admin/env-health" -H "x-admin-token: $ADMIN_TOKEN" | jq

# Confirm we can resolve the latest daily file from the page
curl -sS "$PROD_BASE_URL/api/admin/ercot/debug/url-sanity" -H "x-admin-token: $ADMIN_TOKEN" | jq

# List recent ingests
curl -sS "$PROD_BASE_URL/api/admin/ercot/ingests?limit=10" -H "x-admin-token: $ADMIN_TOKEN" | jq

# Get last ingest record
curl -sS "$PROD_BASE_URL/api/admin/ercot/debug/last" -H "x-admin-token: $ADMIN_TOKEN" | jq
```

### Manual Operations
```bash
# Manual fetch by explicit URL (set ERCOT_TEST_URL first)
npm run ercot:fetch:latest

# Exercise the cron route (uses ERCOT_PAGE_URL resolver)
npm run ercot:resolve:fetch

# Or trigger cron directly:
curl -sS "$PROD_BASE_URL/api/admin/ercot/cron?token=$CRON_SECRET" | jq
# Or with header:
curl -sS "$PROD_BASE_URL/api/admin/ercot/cron" -H "x-cron-secret: $CRON_SECRET" | jq
```

### ESIID Lookup (via WattBuy Electricity Info)
```bash
# Lookup ESIID from address using WattBuy Electricity Info endpoint (/v3/electricity/info)
curl -sS "$PROD_BASE_URL/api/admin/ercot/lookup-esiid?line1=9514%20Santa%20Paula%20Dr&city=Fort%20Worth&state=TX&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

### Admin UI
- Navigate to `/admin/ercot/inspector` for interactive ERCOT testing
- View ingest history, test URL resolution, lookup ESIIDs
- Requires `ADMIN_TOKEN` in browser session

## Admin Inspector UIs

### WattBuy Inspector
- **URL**: `/admin/wattbuy/inspector`
- **Features**: 
  - Test all WattBuy endpoints with real-time metadata
  - View inspection results (topType, count, sample, etc.)
  - Test robust electricity endpoint with fallback indicators
  - Requires `ADMIN_TOKEN` for authentication

### SMT Inspector
- **URL**: `/admin/smt/inspector`
- **Features**:
  - Test SMT ingest, upload, and health endpoints
  - Address-to-ESIID lookup (via WattBuy Electricity Info endpoint `/v3/electricity/info`)
  - Manual ESIID entry option (skip lookup)
  - Trigger SMT pull by ESIID
  - Requires `ADMIN_TOKEN` for authentication

### ERCOT Inspector
- **URL**: `/admin/ercot/inspector`
- **Features**:
  - View ERCOT ingest history
  - Test URL resolution
  - Lookup ESIID from address (via WattBuy Electricity Info endpoint `/v3/electricity/info`)
  - Requires `ADMIN_TOKEN` for authentication


## Using ChatGPT for this Project

1. Open a new chat.
2. Paste the entire contents of `docs/CHAT_BOOTSTRAP.txt`.
3. Ask for ONE step. ChatGPT will provide a single Cursor Agent Block or precise instructions.
4. Apply that step. Confirm done.
5. Ask for the next step.
6. For major pivots, ChatGPT will provide a Cursor block that updates `docs/PROJECT_PLAN.md` (and other plan files as needed).


### Default Model

All development, deployment, and automation chats in this project use **GPT-5 Codex** by default.  
Confirm at the top of each Cursor Agent Block:
```
# Model: GPT-5 Codex
```

---

## Smart Meter Texas Quick Start (Post-2025 JWT Upgrade)

1. **Prerequisites**
   - IntelliWatt must have an SMT Entity Account (CSP/REP) with:
     - Service ID user `INTELLIPATH` and password.
     - Static IP(s) whitelisted with SMT (droplet or VPN endpoint).

2. **Environment Variables (Vercel / API Layer)**
   - `SMT_API_BASE_URL` → `https://services.smartmetertexas.net` (prod) or UAT URL.
   - `SMT_USERNAME` → SMT service ID.
   - `SMT_PASSWORD` → SMT service ID password.
   - `SMT_REQUESTOR_ID` → same as service ID unless SMT specifies otherwise.
   - `SMT_REQUESTOR_AUTH_ID` → IntelliWatt DUNS / SMT authentication ID.

3. **Token Check (whitelisted host)**
   ```bash
   curl -sS -H "Accept: application/json" \
     -H "Content-Type: application/json" \
     "${SMT_API_BASE_URL}/v2/token/" \
     -d '{"username":"<SMT_USERNAME>","password":"<SMT_PASSWORD>"}'
   ```
   - Expect `statusCode: 200` and an `accessToken` field (JWT string).

4. **REST API Usage**
   - Attach `Authorization: Bearer <accessToken>` to all SMT requests.
   - Use the Interface Guide v2 schemas for `/v2/energydata/`, `/v2/premise/`, etc.

5. **SFTP Ingest**
   - Configure `SMT_HOST`, `SMT_USER`, `SMT_KEY`, `SMT_REMOTE_DIR`, `SMT_LOCAL_DIR`.
   - Droplet cron + `/api/admin/smt/pull` continue to manage CSV ingestion.

