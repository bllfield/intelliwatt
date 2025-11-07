# IntelliWatt Project Plan (Authoritative)

## Plan Enforcement
**All GPT/Cursor commands must automatically check this Plan before executing changes.**
- Extend this Plan **before coding** any new component.
- **Legacy systems marked "DO NOT MODIFY" may not be edited** unless this Plan is updated to explicitly allow the change.
- UI must consume **only Canonical Data Model (CDM) endpoints**; never bind UI to vendor schemas.

## Architecture Guardrails (Global)
- **CDM-first:** Vendors map RAW → CDM via transformers. UI only reads CDM-shaped endpoints (`/api/v1/...`).
- **RAW captured:** Save full vendor payloads (JSON/XML) before normalization (lossless).
- **Stable APIs:** Version internal APIs (v1). Breaking changes require a new version.
- **Idempotent ingestion:** Dedupe by `(source_id, timestamp)`; re-runnable backfills only append/update safely.
- **Safe migrations:** deprecate → backfill → cutover → remove in a later migration; never drop live columns abruptly.
- **Feature flags:** Gate new modules; default off in prod until verified.
- **PII:** ESIID, addresses, names treated as PII. Do not log raw values. Hash when needed.
- **Observability:** Correlation id, latency, error class per request; counters for unmapped fields and transformer errors.
- **UI resilience:** Return UI-safe shapes; guard nulls; use skeletons/loading states; toast only actionable errors.

## Address Collection System
- Use **HouseAddress** model for all new address features.
- Endpoint: `app/api/address/save/route.ts` (App Router).
- Normalize via `src/lib/normalizeGoogleAddress.ts`.
- Store **both** normalized fields **and** `rawGoogleJson`.
- Prepare WattBuy payload via `src/lib/toWattBuyPayload.ts`.
- **Env:** `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` required for client autocomplete.

## Component Standards
- **WattBuy:** RAW → `raw_wattbuy`; transformer `tx_wattbuy_to_meter` → `meter(esiid, utilityName, tdspSlug)`.
- **SMT:** SFTP/decrypt → `raw_smt_files/raw_smt_intervals`; transformer `tx_smt_to_usage_interval` (idempotent on `(meter_id, ts)`).
- **Green Button:** RAW XML → `raw_green_button`; transformer → `usage_interval(source='green_button')`.
- **Plan Analyzer:** Inputs CDM only; outputs to `analysis_result` (immutable by config hash).
- **Billing OCR (Vision):** RAW OCR → `bill_extract`; promote to CDM only after `validated_by_user=true`.

## Health & Flags
- Health: `app/api/health/route.ts` returns `{ ok, db, corrId }`.
- Feature flags live in `lib/flags.ts` (`wattbuyEnabled`, `smtEnabled`, `greenButtonEnabled`, `strictPIILogging`).

## Legacy System (DO NOT MODIFY)
- `/api/user/address` writes to `UserProfile` (manual entry only).
- Existing `AddressCollection` component that uses `UserProfile`.
- Plan: deprecate only after **100% HouseAddress** coverage and migration.

---

### How to Request an Exception
Add a short "Plan Change" section here with:
- Rationale
- Scope (files/endpoints)
- Rollback plan
Then perform the change.

## Plan Changes

### PC-2025-01: Raw SMT Files Upload Endpoint (January 2025)

**Rationale:**
Enable direct upload of Smart Meter Texas (SMT) raw files via an admin-gated endpoint to support manual ingestion of SMT data when standard SFTP integration is unavailable or for testing/debugging purposes.

**Scope:**
- Add `raw_smt_files` table to Prisma schema with fields: `id`, `createdAt`, `filename`, `content` (text/blob), `uploaded_by` (admin token reference)
- Create gated admin endpoint `POST /api/admin/smt/upload` that:
  - Requires `ADMIN_TOKEN` header (via existing `guardAdmin` function)
  - Accepts multipart file upload of SMT CSV/XML files
  - Stores raw file in database
  - Returns upload confirmation and file ID for potential rollback
- Optional (future): Add `POST /api/admin/smt/upload/rollback?fileId=xyz` to delete uploaded files

**Rollback Plan:**
- If endpoint causes issues, remove `app/api/admin/smt/upload/route.ts`
- Drop `raw_smt_files` table via Prisma migration if needed
- No UI changes required for this endpoint (admin-only tool)
- Existing SMT transformer logic remains unchanged and unaffected

**Guardrails Preserved:**
- Maintains CDM-first architecture (SMT data still transforms to CDM)
- Follows idempotent ingestion patterns
- Admin-gated for security
- RAW data capture follows existing pattern

### PC-2025-02: SMT RAW File Ingestion (October 2025)

**Rationale:**
Capture Smart Meter Texas files in RAW form before any parsing, maintaining RAW→CDM standards. This ensures data integrity and enables re-processing of SMT files without re-fetching.

**Scope:**
- Add Prisma model `RawSmtFile` to store original SMT files (bytes) plus metadata (`filename`, `size`, `sha256`, `sourcePath`).
- Add admin-gated endpoint `POST /api/admin/smt/raw-upload` (App Router) to accept RAW file uploads from the DO proxy.
- Endpoint will **not** parse or transform; it only persists RAW with idempotency via unique `sha256`.
- Store metadata for traceability and debugging.

**Rollback Plan:**
- If issues occur, disable access by removing the Vercel `ADMIN_TOKEN` or feature-flag route in `middleware.ts`.
- Keep data; do not drop the table. Reprocess is possible later from saved bytes.
- Endpoint can be safely disabled without data loss.

**Guardrails Preserved:**
- Maintains RAW capture before transformation (RAW→CDM pattern)
- Idempotent via SHA256 deduplication
- Admin-gated via existing `guardAdmin` function
- No transformation happens at upload time (preserves RAW integrity)

## Normalization Engine — Current State (2025-11-06)

### What's done

- ✅ SMT SFTP ingest → raw tables proven in prod.

- ✅ Admin verification routes working:

  - `/api/admin/smt/raw-upload` (writes raw_smt_files/rows)

  - `/api/admin/debug/smt/raw-files` (lists)

- ✅ WattBuy admin routes verified: `/api/admin/wattbuy/ping`, `/offers`.

- ✅ Normalizer v1:

  - `lib/analysis/normalizeSmt.ts` converts SMT/GB-ish rows → 15-min UTC START series.

  - Admin test route `/api/admin/analysis/normalize-smt` supports fill/DST/grouping/dry-run.

- ✅ **Fast path** on-demand normalize + persist:

  - `POST /api/internal/smt/ingest-normalize` with `x-shared-secret`.

  - Persists **zero-fill** placeholders by default, but **never overwrites real data** with zeros. Real readings upgrade zero rows.

### What's next (ordered)

1) (Optional) 1-minute Vercel catch-up cron for missed windows.

2) Daily completeness summaries per ESIID/Meter/Day (kWh_real, kWh_filled, %complete).

3) Tie to analysis page: run analysis immediately after persist (use cached nightly WattBuy plans).

4) Backfill runner (date windows) and safeguards (idempotent batches).

### Operational settings

- Vercel env: `SHARED_INGEST_SECRET` (required), `ADMIN_TOKEN` (admin routes), `WATTBUY_API_KEY` (nightly).

- Droplet env: `/home/deploy/smt_ingest/.env` includes `SHARED_INGEST_SECRET=...`.

Project Plan Update — Add This Section
Phase 3 Continued — SMT Normalization + ESIID Resolution Integration

Goal:
Connect SMT interval data (normalized and persisted) with verified ESIIDs pulled via WattBuy until direct SMT Agreement lookups are activated.

✅ Completed in this thread

Confirmed SMT normalization + Vercel automation working end-to-end.

Added /api/admin/analysis/daily-summary and /api/admin/cron/normalize-smt-catch for interval completeness tracking.

Fixed Next.js TypeScript return types for admin routes.

Built and deployed new WattBuy integration flow:

lib/wattbuy/client.ts — REST client for https://apis.wattbuy.com/v3/electricity/info/esi.

app/api/admin/address/resolve-esiid → lookup only.

app/api/admin/address/resolve-and-save → lookup + save ESIID to HouseAddress & UserProfile.

app/api/admin/esiid/resolve-meter → find latest meter in UsageInterval.

CLI scripts: scripts/admin/resolve.ts, scripts/admin/esiid-save.ts.

Added WattBuy 403-diagnostic probe route (/api/admin/wattbuy/probe-esiid) with multi-strategy auth/param fallbacks.

Verified database schema supports ESIID fields in HouseAddress, UserProfile, SmtInterval.

Identified WattBuy 403 root cause → domain whitelist mismatch (Intellipath vs. Intelliwatt).

⚙️ Environment / Config

WATTBUY_API_KEY and ADMIN_TOKEN already in .env.local and Vercel.

BASE_URL switches between:

http://localhost:3000 (local testing)

https://intelliwatt.com (prod API calls)

WattBuy_BASE_URL hard-coded to https://apis.wattbuy.com/v3.

📤 Action Items for Next Steps

WattBuy must whitelist https://intelliwatt.com for API origin approval.
(403s occur because only intellipath-solutions.com is registered.)

Once confirmed, set BASE_URL=https://intelliwatt.com everywhere and rerun:

npm run esiid:resolve-save -- <houseId> "9515 Santa Paula Dr" "Fort Worth" "TX" "76116"


Confirm successful ESIID lookup and persistence in HouseAddress/UserProfile.

After ESIID flow stable, integrate SMT AgreementESIIDs API to replace WattBuy lookup entirely.

💡 Next phase goal:
Make the system fully address-first → auto-resolve ESIID + meter and link to persisted intervals for analysis.

PC-2025-11-01: WattBuy → ESIID Bridge (Finalize)

Rationale
Persist ESIIDs via WattBuy until SMT Agreement APIs replace this flow. Preserve RAW→CDM discipline.

Scope

RAW capture: Persist full WattBuy lookup responses to raw_wattbuy (probe/save flows).

Transformer: tx_wattbuy_to_meter maps → HouseAddress.esiid, utilityName, tdspSlug.

Routes:

POST /api/admin/address/resolve-esiid (lookup only)

POST /api/admin/address/resolve-and-save (lookup + persist ESIID to HouseAddress and UserProfile)

Auth: requireAdmin header (x-admin-token).

Observability: corrId + duration logging.

Rollback
Disable the admin routes; RAW in raw_wattbuy remains intact (no schema drops).
(Aligned with component standards for WattBuy RAW→CDM.)

PC-2025-11-02: Daily Completeness Summary (Admin)

Rationale
Provide day-level QA signal for SMT coverage before plan analysis.

Scope

Route: GET /api/admin/analysis/daily-summary (admin-gated)

Query: esiid?, meter?, dateStart, dateEnd

Response (per ESIID/Meter/Day):
{ esiid, meter, day, totalSlots, realCount, filledCount, pct_complete, kWh_real, kWh_filled, kWh_total }

Auth: requireAdmin

Observability: corrId + duration; counters for missing days.

Cron (after verification)

Add Vercel schedule that reads daily completeness to a cache/report; protect with x-vercel-cron (+ CRON_SECRET if set). See lib/auth/cron.ts.

Rollback
Remove the route/cron; no schema changes required.

PC-2025-11-03: Plan Display Compliance (WattBuy)

Rationale
Satisfy WattBuy/PUCT presentation requirements.

Scope

Extend lib/wattbuy/normalize.ts to extract and store:

supplier_registration_number (PUCT #), supplier_contact_email, supplier_contact_phone, full utility_name (TDSP).

Update UI (components/plan/PlanCard.tsx) to display these fields with fallbacks (“Not provided by supplier”).

Keep existing layouts and offer logic unchanged.

References
See docs/WATTBUY_COMPLIANCE_UPDATE.md for fields and fallbacks.

Rollback
Hide the extra UI fields; keep normalization code in place for future use.

First test sequence (matches our admin tooling)
# 0) Sanity
$env:ADMIN_TOKEN = '<YOUR_ADMIN_TOKEN>'
.\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://intelliwatt.com/api/admin/env-health'

# 1) Probe WattBuy ESIID after whitelist
.\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://intelliwatt.com/api/admin/wattbuy/probe-esiid?zip=76116&line1=9515%20Santa%20Paula%20Dr&city=Fort%20Worth&state=TX'

# 2) Resolve-and-save (persists HouseAddress.esiid + utility)
.\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://intelliwatt.com/api/admin/address/resolve-and-save?email=bllfield@yahoo.com'

# 3) Daily completeness (once route is in)
.\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://intelliwatt.com/api/admin/analysis/daily-summary?dateStart=2025-10-28&dateEnd=2025-11-06&esiid=10443720004895510'


Env and auth patterns for these routes are already documented in PROJECT_CONTEXT.md and AUTOMATION_STATUS.md.

Phase 3.5 — ERCOT ESIID Extract Integration (WattBuy Bypass)

Status: ✅ Implementation complete | 🚀 Pending production redeploy

✅ Completed in this phase

ERCOT Public Data Integration

Added automated pull logic for ERCOT TDSP ESIID Extract (ZP15-612) via public ERCOT Market Data Transparency page.

Implemented nightly cron endpoint:

/api/admin/ercot/cron (requires CRON_SECRET)

Resolves and downloads the latest ERCOT extract file, hashes it, and skips duplicates.

Implemented admin fetch route:

/api/admin/ercot/fetch-latest?url=...&notes=daily

Implemented ingest log endpoint:

/api/admin/ercot/ingests (requires ADMIN_TOKEN)

Lists prior ingests and file hashes.

ERCOT Loader and Matcher

Created ingestion scripts to normalize and upsert data into ErcotEsiidIndex.

Built fuzzy address matcher with USPS normalization and trigram index (pg_trgm).

Verified end-to-end matching using sample address (9514 Santa Paula Drive, Fort Worth, TX 76116).

Daily Summary Engine

Implemented /api/admin/analysis/daily-summary for DST-aware SMT completeness checks.

Added CLI (npm run analysis:daily:csv) to export CSV summaries.

Environment & Infrastructure

Environment variables documented and validated:

ERCOT_PAGE_URL=https://www.ercot.com/mp/data-products/data-product-details?id=ZP15-612

ERCOT_PAGE_FILTER=TDSP (optional)

ADMIN_TOKEN, CRON_SECRET, DATABASE_URL, PROD_BASE_URL

Droplet cleaned of all Vercel CLI and linked metadata (~/.vercel removed).

Droplet confirmed working for Git and local helper scripts (run as deploy user).

Production Vercel build set to Next.js Default Output (not Static Export).

## Operational Conventions

**Deployment Model — Git via Vercel**

- Production deployments occur by pushing to the Production branch (`main`).
- Vercel is connected to the repository; each push to `main` triggers an automatic build and deploy.
- Updates to `vercel.json` (e.g., cron entries) take effect on the next Git deploy.
- The DigitalOcean droplet is only for SMT SFTP/ingest; do not run web-app deploys from the droplet.

**Development Model — Cursor-Only, GPT Blocks**

- All code edits are authored as single, copy-ready GPT blocks in Cursor.
- Each block must specify:
  - Model: GPT-4o
  - Thinking: With Thinking
  - Agent: OFF
  - Files to target: explicit file paths
  - Clear, surgical edits limited to the requested scope.
- Do not chain commands with `&&` in shell instructions.
- Avoid refactors unless explicitly requested; assume working systems stay intact.