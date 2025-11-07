# Development & Deploy Workflow (Required)

1. Edit code in Cursor using single, self-contained GPT blocks that list exact files to change.
2. Commit & push to `main` to deploy to Production via Vercel (Git-linked).
3. After deploy, run admin health checks such as `/api/admin/env-health` to confirm env presence.
4. The DigitalOcean droplet is for SMT ingestion only—do not deploy the web app from the droplet.
5. Avoid `&&` in commands; provide one command per line.

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

## ERCOT ESIID Index — Step 1: Database Setup

**Goal:** Create the `ErcotEsiidIndex` table and indexes so we can load ERCOT’s daily “TDSP ESIID Extract” and perform fast address→ESIID lookups (zip + fuzzy line1).

### A) Prisma model

- The Prisma model `ErcotEsiidIndex` is defined in `prisma/schema.prisma`.
- Do **not** rename fields; downstream loaders and queries depend on these names.

### B) Run migration locally (dev)

```bash
# From repo root
npx prisma migrate dev --name add_ercot_esiid_index
npx prisma generate
```

### C) Enable extensions and indexes

```powershell
# Ensure pg_trgm is enabled, then create the trigram index
psql $env:DATABASE_URL -f scripts/db/enable_pg_trgm.sql
psql $env:DATABASE_URL -f scripts/db/create_ercot_indexes.sql
```

### D) Production checklist

- Run the same SQL scripts against the managed database (DigitalOcean) once change control approves.
- Capture the output in the deployment log for auditing.
- Coordinate with the data ingestion job before loading ERCOT extracts.

### ERCOT DB Check (automated)

To verify the ERCOT ESIID index setup (table, pg_trgm, trigram index) against the DB pointed to `DATABASE_URL`:

```bash
# Install dependency once if needed
npm i pg --save

# Run the check
npm run check:ercot
```

## ERCOT Resolver — Step 2: Normalization + Dry-Run Match

This step lets you test fuzzy matching (ZIP + trigram on line1) before loading real ERCOT files.

**A) Install deps (once)**

```bash
npm i pg --save
```

**B) Optional seed for local testing**

```powershell
psql $env:DATABASE_URL -f scripts/db/seed_ercot_mock.sql
```

**C) Run the dry-run matcher**

```bash
npm run ercot:test -- --line1 "9514 Santa Paula Dr" --zip 76116 --city "Fort Worth"

# tweak --min 0.85 / --limit 5 as needed
```

The script prints normalized input plus top candidates sorted by similarity and exits non-zero if prerequisites are missing.

### Using `.env.local` automatically

Both the ERCOT DB checker and matcher now auto-load `.env.local` (and fall back to `.env`). No need to export `DATABASE_URL` manually.

**Run the DB checker using .env.local:**

```bash
npm run check:ercot:local
```

**Run the matcher using .env.local:**

```bash
npm run ercot:test:local -- --line1 "9514 Santa Paula Drive" --zip 76116 --city "Fort Worth"
```

## ERCOT Resolver — Step 3: Load from a Local File (Parse + Upsert)

Use this to ingest a TDSP ESIID Extract you’ve saved locally (pipe/csv/tsv).

**A) Run a load from file**

```bash
# Uses DATABASE_URL from .env.local
npm run ercot:load:file -- --file /absolute/path/to/TDSP_ESIID_Extract.txt --notes "initial load"
```

The loader streams the file, normalizes addresses, upserts rows into `ErcotEsiidIndex`, and records an entry in `ErcotIngestLog` (with file hash, counts, and optional notes).

## ERCOT Resolver — Step 4: Remote Fetch (HTTPS) + Admin Trigger

Pull ERCOT’s public TDSP ESIID extract over HTTPS and ingest it directly.

**A) CLI pull (manual)**

```bash
npm run ercot:fetch:latest -- --url "https://<PUBLIC_FILE_URL>" --notes "daily pull"
```

**B) Admin route (requires `x-admin-token`)**

```bash
curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
  "https://intelliwatt.com/api/admin/ercot/fetch-latest?url=https://<PUBLIC_FILE_URL>&notes=daily"
```

The fetcher caches the file in `/tmp`, skips ingestion if the SHA-256 hash was already processed, and otherwise calls `ingestLocalFile()`.

## ERCOT Resolver — Step 5: Scheduling + Guardrails

**A) Set env vars (Vercel → Settings → Environment Variables)**

- `ERCOT_DAILY_URL` = public URL for the daily TDSP ESIID extract
- `ERCOT_MONTHLY_URL` = public URL for the monthly extract (optional)
- `ERCOT_USER_AGENT` = optional custom UA when making HTTPS requests
- `CRON_SECRET` = optional manual trigger token (for local testing)

**B) Verify the cron route locally (token path)**

```bash
# Terminal 1
npm run dev

# Terminal 2 (same repo)
CRON_SECRET="mysecret" npm run ercot:cron:curl
```

**C) Deploy + Cron**

Vercel will call `/api/admin/ercot/cron` based on `vercel.json` schedules (`15 3 * * *` daily, `30 4 * * 3` weekly). The route enforces either the `x-vercel-cron` header or `?token=CRON_SECRET`, checks file hashes against `ErcotIngestLog`, and records header snapshots for schema drift monitoring.

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

## Production Deploy Runbook (Vercel)

**Prereqs**
- Vercel project is linked to this repo.
- Environment variables set in Vercel → Settings → Environment Variables (Production):
  - `ADMIN_TOKEN` (required)
  - `ERCOT_DAILY_URL` (recommended)
  - `ERCOT_MONTHLY_URL` (optional)
  - `CRON_SECRET` (optional for manual cron tests)

**Deploy to Production**
```bash
# Commit & push as usual
git add -A && git commit -m "Ship ERCOT cron/fetch" && git push

# Optional: trigger Vercel production deploy from CLI
npm run deploy:prod
```

**Smoke test production**
```bash
# Ensure ADMIN_TOKEN (and CRON_SECRET if testing the cron route) are set locally
ADMIN_TOKEN="..." CRON_SECRET="..." npm run smoke:prod
```
This pings the admin fetch endpoint and, if `CRON_SECRET` is provided, the cron route to verify prod is responding.

## Analysis — Daily Completeness Summary (Admin)

**Endpoint**
`GET /api/admin/analysis/daily-summary`

**Headers**
- `x-admin-token: <ADMIN_TOKEN>`

**Query**
- `esiid` (optional)
- `meter` (optional)
- `dateStart` (ISO; default = last 7 full days in America/Chicago)
- `dateEnd`   (ISO; default = tomorrow 00:00 local)

Returns per-day `{ found, expected, completeness }`, where `expected` is DST-aware (92/96/100 slots).

**Examples**
```bash
# default last-7-days
./scripts/admin/Invoke-Intelliwatt.ps1 -Uri "https://intelliwatt.com/api/admin/analysis/daily-summary"

# filtered by ESIID and date window
./scripts/admin/Invoke-Intelliwatt.ps1 -Uri "https://intelliwatt.com/api/admin/analysis/daily-summary?esiid=1044...AAA&dateStart=2025-10-28T00:00:00-05:00&dateEnd=2025-11-06T00:00:00-06:00"

# narrow by meter too
./scripts/admin/Invoke-Intelliwatt.ps1 -Uri "https://intelliwatt.com/api/admin/analysis/daily-summary?esiid=1044...AAA&meter=M1"
```

### Admin CLI — Export Daily Completeness to CSV

```bash
# Prod (reads ADMIN_TOKEN/PROD_BASE_URL from env if not passed)
ADMIN_TOKEN="<PROD_ADMIN_TOKEN>" PROD_BASE_URL="https://intelliwatt.com" \
npm run analysis:daily:csv -- --esiid "1044..." --dateStart "2025-10-28T00:00:00-05:00" --dateEnd "2025-11-06T00:00:00-06:00" --out "./daily_summary.csv"

# Local dev server
ADMIN_TOKEN="<ADMIN_TOKEN>" \
npm run analysis:daily:csv -- --base "http://localhost:3000" --esiid "1044..." --out "./daily_summary_local.csv"
```

### Estimate a Bill for a Plan

```bash
# Example: monthly usage spread evenly across each month
curl -sS -H "x-admin-token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "https://intelliwatt.com/api/plan/estimate" \
  -d '{
        "planId": 1,
        "usage": {
          "granularity": "monthly",
          "points": [
            {"month":"2025-01","kwh":1500},
            {"month":"2025-02","kwh":1200}
          ]
        }
      }'
```

**Notes**
- Phase 1 supports flat per‑kWh energy + delivery, simple base fees, minimum-usage fee/credit, and bill credit tiers.
- TOU windows and seasonal riders are defined via `kind:"tou"` components, ready once EFL parsing is added.
- Next phases: parse/ingest EFLs for precise MUF/MUC & credits, add “Top Picks” + compliance banner, and expose a public `/api/plans/recommend` endpoint.

## One-Click Test — ERCOT Fetch (Production)

`npm run test:ercot:fetch` now auto-loads `.env.local` (falling back to `.env`). If `ERCOT_TEST_URL` is absent, it uses `ERCOT_DAILY_URL`.

**PowerShell (Windows)**
```powershell
# Ensure .env.local contains ADMIN_TOKEN and ERCOT_TEST_URL or ERCOT_DAILY_URL
$env:CRON_SECRET = "<PROD_CRON_SECRET>"  # optional
npm run test:ercot:fetch
```

**bash (macOS/Linux)**
```bash
CRON_SECRET="<PROD_CRON_SECRET>" npm run test:ercot:fetch
```
If you want to override values, export `ADMIN_TOKEN`, `ERCOT_TEST_URL`, or `PROD_BASE_URL` before running.

## ERCOT — Where to get the public file URL

The daily and monthly **TDSP ESIID Extract** (EMIL **ZP15-612**) are on ERCOT’s Market Data Transparency site. Grab the HTTPS download URL and place it in `.env.local`:

```env
ERCOT_TEST_URL=https://mdt.ercot.com/public/tdsp/TDSP_ESIID_Extract_2025-11-07.txt
```

Use `npm run ercot:url:sanity` to confirm your env vars and see the exact curl that `npm run test:ercot:fetch` will execute.

## ERCOT — Auto-resolve Latest Daily File (Hands-free)

You no longer need to paste daily URLs. Set a single page URL:

```env
ERCOT_PAGE_URL=https://mdt.ercot.com/anonymous/download?docLookupId=<...>
# Optional: narrow candidate links if page lists multiple products
ERCOT_PAGE_FILTER=TDSP
```

- `npm run ercot:resolve-fetch` — resolves the latest link from `ERCOT_PAGE_URL` and calls `/api/admin/ercot/fetch-latest`.
- `npm run ercot:cron:curl` — exercises the cron route; now resolves automatically if `ERCOT_DAILY_URL` is empty.

