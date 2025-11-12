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
- **WattBuy:** 
  - Uses `/v3/electricity/retail-rates`, `/v3/electricity`, `/v3/electricity/info` endpoints.
  - API client (`lib/wattbuy/client.ts`) uses `x-api-key` header, `utilityID` (camelCase), `state` (lowercase).
  - Auto-derives `utilityID` from address via `lib/wattbuy/derive.ts` when not provided.
  - Includes retry logic (1 retry on 5xx) and diagnostic header capture.
  - RAW → `RawWattbuyRetailRate`, `RawWattbuyElectricity`, `RawWattbuyElectricityInfo`.
  - Transformer `tx_wattbuy_to_meter` → `meter(esiid, utilityName, tdspSlug)`.
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

- ✅ WattBuy admin routes verified: 
  - `/api/admin/wattbuy/retail-rates-test` (utilityID+state OR address auto-derive)
  - `/api/admin/wattbuy/retail-rates-zip` (ZIP-based, auto-derives utilityID)
  - `/api/admin/wattbuy/retail-rates-by-address` (convenience endpoint)
  - `/api/admin/wattbuy/retail-rates` (persists to RawWattbuyRetailRate)
  - `/api/admin/wattbuy/electricity` (persists to RawWattbuyElectricity)
  - `/api/admin/wattbuy/electricity/info` (persists to RawWattbuyElectricityInfo)
  - `/api/admin/wattbuy/ping`

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

PC-2025-11-07: ESIID Source Cutover (WattBuy Electricity Info endpoint)

Rationale

- ESIID resolution now uses WattBuy's `/v3/electricity/info` endpoint, which provides reliable ESIID data. This endpoint is specifically designed for ESIID extraction and utility information.

Scope

- ESIID lookup endpoint `/api/admin/ercot/lookup-esiid` now uses WattBuy Electricity Info endpoint (`/v3/electricity/info`) instead of ERCOT database.

- ERCOT database (`ErcotEsiidIndex`) is preserved but no longer used for ESIID lookups. ERCOT ingestion continues for historical/backup purposes.

- WattBuy Electricity Info endpoint provides ESIID in various field names (esiid, esiId, esi_id, addresses[].esi, utility_info[].esiid).

- All ESIID lookup logic preserved; only the data source changed from ERCOT database to WattBuy API.

- Property bundle and SMT Inspector now use `/v3/electricity/info` for ESIID extraction (while still using `/v3/electricity` for wattkey and property context).

Rollback

- ERCOT database lookup logic remains in codebase but is not wired to database queries. Can be re-enabled if needed.

Guardrails

- CDM-first API consumption and RAW→CDM discipline remain unchanged.
- ESIID is optional in CDM; we continue to persist it on `HouseAddress`.



PC-2025-11-01: ESIID Resolver — Use WattBuy Electricity Info Endpoint

Rationale

We source ESIID from WattBuy's `/v3/electricity/info` endpoint, which is specifically designed for ESIID extraction and utility information. This endpoint provides more reliable ESIID data than the general `/v3/electricity` endpoint.

Scope

ESIID lookup: `/api/admin/ercot/lookup-esiid` uses WattBuy Electricity Info endpoint (`wbGetElectricityInfo`).

Admin routes:

GET /api/admin/ercot/lookup-esiid now calls WattBuy Electricity Info endpoint (`/v3/electricity/info`) and extracts ESIID from response.

ESIID extraction handles multiple field name variations (esiid, esiId, esi_id, addresses[].esi, utility_info[].esiid).

Property bundle and SMT Inspector: Use `/v3/electricity/info` for ESIID extraction, while `/v3/electricity` is still used for wattkey and property context.

RAW→CDM:

WattBuy electricity/info responses are captured via `wbGetElectricityInfo` which uses `wbGet` internally (retry logic, diagnostic headers).

ESIID is extracted and returned to callers; can be persisted to `HouseAddress.esiid` if needed.

Observability: corrId + duration logging (unchanged).

Rollback

ERCOT database lookup logic remains in codebase but is not wired. Can be re-enabled if needed.



PC-2025-11-02: WattBuy 403 Closure (FYI / Support Artifact)

Context

WattBuy confirmed they do not whitelist domains. The 403s were unrelated to origin. We have moved off WattBuy for ESIID; however, to close the support ticket, we can provide a reproducible call log (see snippet below).

Action

Retain a one-time diagnostic: cURL + response body excerpt demonstrating 403, so WattBuy support can validate key/scope if needed for other endpoints later.

PC-2025-11-08: Replace Offers with Retail-Rates + Electricity (Catalog)

Rationale

- We only need the rate database and electricity catalog; `/v3/offers` is deprecated for our use case.

Scope

- Add admin-gated proxies:

  - `GET /api/admin/wattbuy/retail-rates` → persists to `RawWattbuyRetailRate`.

  - `GET /api/admin/wattbuy/electricity` → persists to `RawWattbuyElectricity`.

  - `GET /api/admin/wattbuy/electricity/info` → persists to `RawWattbuyElectricityInfo`.

- Deprecate `/api/offers` with HTTP 410 to prevent accidental calls.

- Do not refactor existing code paths beyond removing offers; keep UI unaffected until it's wired to new sources.

Rollback

- Re-enable `/api/offers` by restoring prior route if needed.

Guardrails

- Token-gated admin endpoints; log corrId and never leak API keys.

PC-2025-01-XX: WattBuy API Client Standardization

Rationale

- Standardize WattBuy API calls to match their test page specification (x-api-key header, camelCase parameters, lowercase state).
- Add retry logic and diagnostic header capture for better troubleshooting.
- Enable auto-derivation of utilityID from address for retail-rates queries.
- Implement robust electricity endpoint with fallback strategies.

Scope

- **Client (`lib/wattbuy/client.ts`):**
  - Use `x-api-key` header (not Authorization Bearer).
  - Add retry logic (1 retry on 5xx errors with exponential backoff).
  - Capture diagnostic headers: `x-amzn-requestid`, `x-documentation-url`, `x-amz-apigw-id`, `content-type`, `content-length`.
  - Handle JSON parsing errors gracefully with raw text preview for debugging.
  - Response type includes `data`, `text`, `headers`, `ok`, `status`.

- **Parameters (`lib/wattbuy/params.ts`):**
  - `retailRatesParams`: Accept `utilityID` (camelCase), optional `state` (lowercase), optional `zip`.
  - `electricityParams`: Accept `address`, `city`, `state` (lowercase), required `zip`.
  - `electricityInfoParams`: Extends `electricityParams` with `housing_chars`, `utility_list`.

- **Auto-derivation (`lib/wattbuy/derive.ts`):**
  - `deriveUtilityFromAddress()`: Calls `/v3/electricity/info` to extract utilityID from address.
  - Returns `utilityID`, `state`, and `utilityList` for multi-utility fallback.
  - Prefers deregulated utilities, falls back to TX TDSPs.
  - Uses hard-coded EIA utility IDs as last resort.

- **Robust Electricity (`lib/wattbuy/electricity.ts`):**
  - `getElectricityRobust()`: Implements 3-strategy fallback:
    1. Direct call with uppercase state
    2. Retry with lowercase state
    3. Fallback to `wattkey` lookup via `/v3/electricity/info`
  - Returns diagnostic info including `usedWattkey` flag.

- **Response Inspection (`lib/wattbuy/inspect.ts`):**
  - `inspectRetailRatesPayload()`: Analyzes raw WattBuy payloads to find list structures.
  - Returns `topType`, `topKeys`, `foundListPath`, `count`, `sample`, `message`.
  - Handles both array and object payloads.

- **Data Normalization (`lib/wattbuy/normalize-plans.ts`):**
  - `toPlans()`: Normalizes raw WattBuy responses into unified `Plan` type.
  - Distinguishes between REP plans and utility tariffs.
  - Maps to `RatePlan` Prisma model via `upsert-plans.ts`.

- **Endpoints:**
  - `/api/admin/wattbuy/retail-rates-test`: Accepts `utilityID+state` OR `address/city/state/zip` (auto-derives). Returns inspection metadata.
  - `/api/admin/wattbuy/retail-rates-zip`: Always derives utilityID from address (requires zip). Includes multi-utility fallback.
  - `/api/admin/wattbuy/retail-rates-by-address`: Convenience endpoint for address-based queries with fallback.
  - `/api/admin/wattbuy/retail-rates`: Main endpoint with database persistence to `RatePlan` model.
  - `/api/admin/wattbuy/electricity`: Robust electricity endpoint with fallback strategies.
  - `/api/admin/wattbuy/electricity-probe`: Dedicated probe endpoint for testing.

- **API Endpoints Used:**
  - `/v3/electricity/retail-rates`: Requires `utilityID` (camelCase, integer as string) + `state` (lowercase). Returns REP plans or utility tariffs.
  - `/v3/electricity`: Catalog endpoint, requires `zip`, optional `address`, `city`, `state` (lowercase).
  - `/v3/electricity/info`: Info endpoint, requires `zip`, optional `address`, `city`, `state` (lowercase), `housing_chars`, `utility_list`.
  - `/v3/offers`: **DEPRECATED** - No longer used in our stack.

Rollback

- Revert to previous parameter names (`utility_id` snake_case) if needed.
- Remove auto-derivation if it causes issues.
- Disable robust electricity fallback if upstream issues resolved.

Guardrails

- All WattBuy calls use centralized `wbGet()` function with clean headers.
- No internal headers forwarded to WattBuy API.
- State always lowercase, utilityID always camelCase per WattBuy test page spec.
- Multi-utility fallback only triggers on 204/empty responses.
- All responses include diagnostic metadata for troubleshooting.

---

PC-2025-11-10: ERCOT Daily Pull System

Rationale

- Source ESIID data exclusively from ERCOT daily extracts for accurate, vendor-agnostic ESIID resolution.
- Enable automated daily ingestion of ERCOT TDSP ESIID Extract files.
- Support manual testing and debugging of ERCOT data ingestion.

Scope

- **Prisma Models:**
  - `ErcotIngest`: Tracks ingestion history with `fileSha256` (unique), `status`, `note`, `fileUrl`, `tdsp`, `rowCount`, `headers`, `error`, `errorDetail`.
  - `ErcotEsiidIndex`: Stores normalized ESIID data (preserved but not used for lookups; ESIID now comes from WattBuy Electricity Info endpoint `/v3/electricity/info`).

- **Library Functions (`lib/ercot/`):**
  - `resolve.ts`: `resolveLatestFromPage()` - Uses JSDOM to parse HTML and extract TDSP_ESIID_Extract file links.
  - `fetch.ts`: `fetchToTmp()` - Downloads files to `/tmp`, computes SHA256 hash, captures headers.
  - `ingest.ts`: `ingestLocalFile()` - Parses CSV/TSV/pipe-delimited files, extracts ESIIDs, batch upserts to `ErcotEsiidIndex`.
  - `types.ts`: `IngestResult` type for ingestion results.

- **API Routes:**
  - `/api/admin/ercot/cron`: Vercel cron endpoint (supports header `x-cron-secret` or query `?token=CRON_SECRET`).
  - `/api/admin/ercot/fetch-latest`: Manual fetch by explicit URL (admin-gated).
  - `/api/admin/ercot/ingests`: List ingestion history (admin-gated).
  - `/api/admin/ercot/debug/last`: Get last ingest record (admin-gated).
  - `/api/admin/ercot/debug/url-sanity`: Test URL resolution (admin-gated).
  - `/api/admin/ercot/lookup-esiid`: Lookup ESIID from address using WattBuy Electricity Info endpoint `/v3/electricity/info` (admin-gated).

- **Admin Scripts:**
  - `scripts/admin/ercot_fetch_latest.mjs`: Manual file fetch via API.
  - `scripts/admin/ercot_resolve_fetch.mjs`: Exercise cron route.
  - `scripts/admin/test_ercot.mjs`: Test all ERCOT endpoints.

- **Vercel Cron:**
  - Schedule: `15 9 * * *`, `30 10 * * 3`, `0 15 * * *` (multiple daily runs).
  - Path: `/api/admin/ercot/cron`.

- **Idempotence:**
  - Files deduplicated by SHA256 hash.
  - Skips re-ingestion of already processed files.
  - Batch upserts for efficient database writes.

Rollback

- Disable cron in `vercel.json` if issues occur.
- Remove admin routes if needed (data remains in database).
- Migration can be rolled back if schema issues.

Guardrails

- RAW→CDM: ERCOT data stored in `ErcotEsiidIndex` with raw JSON for traceability (preserved but not used for ESIID lookups; ESIID now comes from WattBuy Electricity Info endpoint `/v3/electricity/info`).
- Idempotent ingestion via SHA256 deduplication.
- Admin-gated endpoints for security.
- Error logging with full stack traces for debugging.

---

PC-2025-11-10: Email Normalization

Rationale

- Prevent duplicate user accounts due to email case sensitivity.
- Ensure consistent email storage, lookup, and comparison across the system.

Scope

- **Utility (`lib/utils/email.ts`):**
  - `normalizeEmail()`: Converts email to lowercase and trims whitespace.
  - `normalizeEmailSafe()`: Safe version that returns empty string on invalid input.

- **Updated Files:**
  - All email storage: `lib/magic/magic-token.ts`, `app/login/magic/route.ts`, `app/api/send-magic-link/route.ts`.
  - All email lookups: `app/api/address/save/route.ts`, `app/api/user/address/route.ts`, `app/api/user/entries/route.ts`.
  - All email comparisons: `app/api/user/referral-link/route.ts`, `app/api/admin/user/dashboard/route.ts`.
  - All debug endpoints: `app/api/debug/check-address/route.ts`, `app/api/debug/check-address-brian/route.ts`.
  - All external endpoints: `app/api/external/magic-link/route.ts`, `app/api/send-admin-magic-link/route.ts`.
  - Admin routes: `app/admin/magic/route.ts`.

Rollback

- Remove `normalizeEmail()` calls if issues occur (emails remain in database as stored).
- No data migration needed (existing emails remain as-is).

Guardrails

- All new email inputs normalized before storage/lookup/comparison.
- Existing emails in database remain unchanged (no migration).
- Case-insensitive email handling prevents duplicate accounts.

---

PC-2025-11-10: SMT Integration & Admin Tools

Rationale

- Enable SMT data pull via webhook from DigitalOcean droplet.
- Provide admin UI for testing SMT endpoints and triggering pulls.
- Integrate ERCOT ESIID lookup with SMT pull workflow.

Scope

- **SMT API Routes:**
  - `/api/admin/smt/pull`: Trigger SMT data pull via webhook (requires `DROPLET_WEBHOOK_URL`/`SECRET` **or** `INTELLIWATT_WEBHOOK_URL`/`SECRET`).
  - `/api/admin/smt/ingest`: SMT file ingestion endpoint.
  - `/api/admin/smt/upload`: SMT file upload endpoint.
  - `/api/admin/smt/health`: SMT health check endpoint.

- **ESIID Lookup (via WattBuy):**
  - `/api/admin/ercot/lookup-esiid`: GET endpoint to find ESIID from address using WattBuy Electricity Info endpoint (`/v3/electricity/info`).
  - Uses fuzzy matching on `serviceAddress1` and `zip`.
  - Returns best match with similarity score.

- **Admin UI Pages:**
  - `/admin/wattbuy/inspector`: Interactive WattBuy API testing with real-time metadata.
  - `/admin/smt/inspector`: SMT endpoint testing with address-to-ESIID-to-SMT-pull workflow.
  - `/admin/ercot/inspector`: ERCOT ingest history and ESIID lookup.
  - `/admin/retail-rates`: Retail rates exploration and management.
  - `/admin/modules`: System modules overview.

- **Admin Dashboard:**
  - `/admin/page.tsx`: Updated with Admin Tools section linking to all inspector pages.

Rollback

- Remove admin UI pages if needed (API routes remain functional).
- Disable webhook endpoints if security concerns.

Guardrails

- All admin routes require `ADMIN_TOKEN` header.
- Webhook endpoints require the shared secret header `x-intelliwatt-secret` (value from `DROPLET_WEBHOOK_SECRET` or `INTELLIWATT_WEBHOOK_SECRET`).
- ESIID lookup uses fuzzy matching for address resolution.
- SMT pull triggered only after ESIID confirmation.

---

### PC-2025-11-10: Admin Read-Only DB Explorer

**Rationale**

Provide a secure, on-domain, read-only database viewer for internal operations without depending on external tools each time. Must respect ADMIN_TOKEN security and RAW→CDM discipline.

**Scope**

- New admin UI: `/admin/database`
- New admin API routes:
  - `GET /api/admin/db/tables` — whitelisted tables + columns + row counts
  - `POST /api/admin/db/query` — paginated rows, optional ILIKE search on text columns, optional CSV export
- Whitelist tables: `HouseAddress`, `ErcotIngest`, `RatePlan`, `RawSmtFile`, `SmtInterval` (ErcotEsiidIndex removed from whitelist; ESIID lookup now uses WattBuy)
- Token gate: `x-admin-token` header, as documented in ENV_VARS and ADMIN_API

**Security & Guardrails**

- Follows existing admin token model (see ENV_VARS.md and ADMIN_API.md)
- Read-only: no INSERT/UPDATE/DELETE endpoints
- No secrets or PII echoed in logs; CSV export is admin-only
- `force-dynamic` to avoid caching

**Rollback**

- Remove `/app/admin/database` and `/app/api/admin/db/*` files. No schema changes required.

**How to use it (quick):**

Deploy the change (push to main). Navigate to `/admin/database`, paste your `ADMIN_TOKEN`, and browse whitelisted tables with pagination, search, and CSV export.

---

### PC-2025-11-10-B: ERCOT Daily TDSP Zip Auto-Fetch

**Rationale**

Automate ingestion of ERCOT TDSP DAILY zip files (Lubbock, CenterPoint, Oncor, TNMP, AEP Central, AEP North). Keep a daily archive in S3 and record metadata in `ErcotIngest`.

**Scope**

- `GET /api/admin/ercot/cron?token=CRON_SECRET`: scrape `ERCOT_PAGE_URL`, detect latest "Posted" day, download all DAILY zips, upload to S3 (`ercot/YYYY-MM-DD/<filename>`), create `ErcotIngest` rows.
- Idempotent: skip upload if object exists in S3 or SHA256 already ingested.
- Token-gated with `CRON_SECRET` (supports query param or `x-cron-secret` header, or Vercel managed cron).

**Schedule**

- Vercel → Settings → Cron Jobs:
  - Path: `/api/admin/ercot/cron?token=$CRON_SECRET`
  - Schedule: `0 6 * * *` (6:00 AM America/Chicago) — adjust as needed.

**ENV Variables Required (Production)**

- `ERCOT_PAGE_URL` — ERCOT data product page URL (e.g., `https://www.ercot.com/mp/data-products/data-product-details?id=ZP15-612`)
- `CRON_SECRET` — Long random string for cron authentication
- `S3_ENDPOINT` or `DO_SPACES_ENDPOINT` — S3-compatible endpoint (e.g., `https://nyc3.digitaloceanspaces.com` or AWS endpoint)
- `S3_REGION` — Region (e.g., `nyc3` for DO Spaces or `us-east-1` for AWS)
- `S3_BUCKET` — Bucket name
- `S3_ACCESS_KEY_ID` — Access key
- `S3_SECRET_ACCESS_KEY` — Secret key
- `S3_FORCE_PATH_STYLE` — Optional, set to `true` for MinIO-style endpoints
- `S3_ACL` — Optional, defaults to `private`

**How to run it now (smoke test)**

After deploy, run:

```bash
# Replace BASE and secrets
BASE="https://intelliwatt.com"
CRON_SECRET="<your-cron-secret>"

curl -sS "$BASE/api/admin/ercot/cron?token=$CRON_SECRET" | jq
```

You should see: latest `postedAt`, and `results` for each TDSP with `key`, `bytes`, or `skipped:true` if already present.

**Notes & Gotchas**

- **Why scrape?** ERCOT's MIS/Data Product page doesn't expose a stable JSON index publicly, so we parse the HTML safely and grab the newest day's zips. If ERCOT changes markup, we'll tweak selectors (keep cheerio here for that reason).
- **Storage first, parse later:** We only archive here. Your existing ESIID resolvers/parsers can read from S3 using `storageKey` in `ErcotIngest` headers JSON—separate concerns keep this resilient.
- **Timing:** Your page snippet shows "Posted 6:19:52 AM" for all six. A 6:30 AM CT cron run is perfect.
- **Idempotent:** Re-running the job for the same day won't dupe files (checks S3 object existence and SHA256 hash).

**Rollback**

- Remove or disable cron in `vercel.json`.
- Remove `/app/api/admin/ercot/cron/route.ts` and related library files if needed.
- S3 objects remain (no automatic deletion).

## PC-2025-11-11-A — SMT JWT Upgrade (Authoritative Override)

- **Rationale:** SMT decommissioned FTPS and non-JWT API (effective 2025-09-13). We must use SFTP and API with JWT.
- **Scope:**
  - Keep SFTP path (OpenSSH keys, `/adhocusage`) as-is.
  - Add JWT acquisition/caching to all SMT API calls.
  - Standardize webhook headers: `x-intelliwatt-secret`, `x-admin-token`.
  - Inline ingest payload enabled for inspector (`content_b64` supported).
- **Env keys:**
  - **Droplet:** `SMT_SFTP_*`, `GNUPG_HOME`, `PGP_RECIPIENT_FPR`, `BATCH_LIMIT`, `LOG_LEVEL`, `INTELLIWATT_WEBHOOK_SECRET`
  - **Vercel:** `DATABASE_URL`, `ADMIN_TOKEN`, `INTELLIWATT_WEBHOOK_SECRET`, `DROPLET_WEBHOOK_URL`, `DROPLET_WEBHOOK_SECRET`
- **Done Criteria:** SFTP login OK, cycle shows non-zero fetch/decrypt/send, inspector download works, JWT protected API succeeds.

### PC-2025-11-12-B — SMT Pulls Aligned + Inline Persistence + Admin Tools

- Standardized webhook auth to `x-intelliwatt-secret`.
- Persist inline CSV uploads received via `/api/admin/smt/pull` (mode: "inline") into storage + RawFile DB.
- Added Admin → SMT Tools page with:
  - Buttons: Trigger webhook pull, Send inline test CSV.
  - Results table wired to `/api/admin/debug/smt/raw-files`.
- Confirmed: `/api/admin/debug/smt/raw-files?limit=N` continues to expose the latest raw files for QA.

#### PC-2025-11-12-b — SMT Guardrails Before Normalize

- `/api/admin/smt/pull` inline uploads persist to storage + `raw_smt_files` with `sha256` idempotency.
- `SmtInterval` enforces uniqueness on `(esiid, meter, ts)` to prevent duplicate ingest.
- Next.js does not allow custom App Router body-parser sizing; keep inline payloads within default limits (~4 MB) and fall back to the droplet webhook for larger files while keeping function limits at 60s/1 GB.
- `/admin/smt` UI uses a server action proxy; admin secrets never touch the browser.
- `/api/admin/smt/normalize` supports `dryRun=1` for DST + record-count verification before writes.

## PC-2025-11-12 — Adopt ChatGPT House Rules

**Decision:** The project adopts `docs/CHATGPT_HOUSE_RULES.md` as the authoritative guidance for how ChatGPT must answer.  
**Scope:** All future instructions must comply:
- One step per answer.
- Cursor Agent Blocks for any change Cursor can apply.
- Start with exact placement (paths, environment, secrets).
- Keep plan docs up to date with explicit overrides.

**Overrides:** This plan change supersedes any prior guidance that conflicts with the House Rules.

## PC-2025-11-12-C: Standardize Model → GPT-5 Codex

**Decision:** All Cursor-based operations and ChatGPT answers default to **GPT-5 Codex**.  
**Rationale:** Ensures consistent code generation and alignment with IntelliWatt development stack.  
**Scope:**  
- `.cursor/model.config.json` defines the default model.  
- Cursor Agent Blocks and inline GPT editing must specify `# Model: GPT-5 Codex`.  
**Overrides:** Supersedes any prior model directives (GPT-4.1, GPT-4o, etc.).

## PC-2025-11-12-D — Enforce One-Step, Explicit Instruction Protocol

**Decision:** Adopt stricter house rules for ChatGPT responses.

**Scope:**
- Overwrite `docs/CHATGPT_HOUSE_RULES.md` with the one-step, explicit, Cursor-first protocol.
- Overwrite `docs/CHAT_BOOTSTRAP.txt` with the strict bootstrap.

**Effect:** This change overrides all prior instruction styles or multi-step guidance.

**Model:** Default to GPT-5 Codex for all code/instruction blocks.