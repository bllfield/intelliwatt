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

## 🚀 Production Access

- **URL**: https://intelliwatt.com (Vercel)
- **Database**: DigitalOcean PostgreSQL (production)
- **API**: Prefer **Preview** deployments for testing; treat **Production** as read-only for verified flows
- **No local dev server** needed for data queries

### Environment Strategy
- **Preview**: Use for all testing, development, and experimental changes
- **Production**: Read-only for verified flows and data queries only
- **Safety**: Avoid modifying production data during development

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

### Verify WattBuy Electricity catalog — admin proxy

1) With address (zip is required):

```bash
ADMIN_TOKEN="<ADMIN_TOKEN>"
curl -sS "https://intelliwatt.com/api/admin/wattbuy/electricity?address=9514%20santa%20paula%20dr&city=fort%20worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

2) With utility_eid (optional, EID of Utility):

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/electricity?state=tx&zip=76116&utility_eid=6452" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

**Note:** `state` must be lowercase (e.g., `tx` not `TX`).

3) With wattkey (optional, WattBuy home identifier):

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/electricity?wattkey=<wattkey>&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

Note: `zip` is required. Use `state` as lowercase two-letter code (e.g., "tx"). `address` and `city` should be URL-encoded.

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

**If `count = 0`**: This indicates upstream content from WattBuy. Contact support with the `x-amzn-requestid` from headers, exact selector used, and the `topType`/`topKeys`/`foundListPath` metadata. See `docs/WATTBUY_TESTING_RUNBOOK.md` for details.

