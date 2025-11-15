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

### PC-2025-11-12-E — SMT Webhook & Droplet Ingest Hardening

- Vercel route `/api/admin/smt/pull` now accepts webhook headers `x-intelliwatt-secret`, `x-smt-secret`, or `x-webhook-secret`.
- Droplet script `deploy/smt/fetch_and_post.sh` falls back to `ESIID_DEFAULT` when filenames omit the ESIID and posts JSON via stdin.
- Documentation updated (`docs/DEPLOY_SMT_INGEST.md`, `docs/ENV_VARS.md`, `docs/OPS_CHECKLIST.md`) with exact env vars, SSH steps, webhook URL, and inline smoke tests (bash + PowerShell + webhook curl script).

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

[PC-2025-11-12-E] ESIID Source Switch → WattBuy Primary (LOCKED)

Decision:

- Effective immediately, ESIID resolution is sourced from **WattBuy**.

- **ERCOT ESIID indexing and daily pulls are paused** until re-enabled.

Locked Rules:

1) Primary ESIID source: **WattBuy** property-details resolver (good data now).

2) ERCOT: disabled for ESIID lookups (cron/jobs/timers off); keep code in place but inactive.

3) Rates still come from WattBuy retail-rates/electricity APIs as already configured.

4) Any prior guidance naming ERCOT as the ESIID authority is suspended while this section is ACTIVE.

Implementation Notes:

- Add the following env flags (see ENV_VARS.md):

  - `ESIID_SOURCE=wattbuy`

  - `WATTBUY_ESIID_ENABLED=true`

  - `ERCOT_ESIID_DISABLED=true`

- Pause any cron/timer that hits `/api/admin/ercot/cron` or ERCOT ESIID indexing (see DEPLOY_ERCOT.md “Pause” steps).

- Admin UIs should reflect that ERCOT ESIID tools are paused.

Status: ACTIVE / Overrides earlier ERCOT-first guidance until explicitly lifted.

[PC-2025-11-12-F] SMT Inspector Navigation (LOCKED)

Requirement:

- The SMT Inspector page **must link to every SMT admin utility** that exists in the app.

- Utilities are maintained as a simple registry (array) in the inspector component so additions are one-line changes.

Initial Set (as of this lock):

- `/admin/smt/raw` — Raw Files & Normalize UI

- `/admin/smt/trigger` — Admin SMT Trigger (Webhook)

Rules:

1) When a new SMT admin utility is added, append it to the inspector registry in `app/admin/smt/inspector/page.tsx`.

2) Do not remove links for active utilities without updating this section.

3) If a utility is temporarily paused, keep the link and annotate its state (Paused) in the UI.

Status: ACTIVE / Required for all future SMT utilities.

[PC-2025-11-12-G] SMT + WattBuy ESIID Hand-off — COMPLETED (2025-11-12)

Scope Verified as DONE:

1) Admin SMT Pull:

   - Route: **/api/admin/smt/pull** (Vercel, App Router)

   - Headers: `x-admin-token`

   - Paths:

     - `{ esiid, meter }` → droplet webhook trigger (200 OK observed)

     - `{ mode:"inline", ... }` → RawSmtFile persist (200 OK observed)

2) Droplet Webhook (SMT fetch/post):

   - URL: **http://64.225.25.54:8787/trigger/smt-now**

   - Header: `x-intelliwatt-secret`

   - Logs: `[INFO] Listing adhocusage ...` / `[DONE] ...` (200 OK observed)

3) Normalize:

   - Route: **/api/admin/smt/normalize**

   - Contract: `{ latest:true } | { rawId } | { since:"ISO" }`

   - Behavior: idempotent upsert; DST handled; links to source raw file

   - Result: 200 OK; filesProcessed/duplicatesSkipped counters correct

4) Admin UIs:

   - **/admin/smt/trigger** — manual POST helper for pull

   - **/admin/smt/raw** — list RawSmtFile + “Normalize now”

   - **/admin/smt/inspector** — hub links (LOCKED nav requirement satisfied)

5) ESIID Source of Truth:

   - **WattBuy** is the active ESIID authority (LOCKED).

   - **ERCOT ESIID indexing is paused** per PC-2025-11-12-E.

6) Testing Conventions (Windows):

   - Locked PowerShell Invoke-RestMethod & curl.exe patterns in **docs/TESTING_API.md**

   - All canonical snippets produce **HTTP 200** with expected shapes.

Status: COMPLETE. Any changes to headers, routes, or source-of-truth must update this milestone and the prior LOCKED sections.

[PC-2025-11-12-A] SMT Inline + Webhook Hand-off (LOCKED)

Context:

- We now support two paths on **/api/admin/smt/pull**:

  (a) `mode: "inline"` → stores base64 CSV into RawSmtFile (no pull executed)

  (b) `{ esiid, meter }` (no `mode`) → Admin-triggered webhook call to droplet to pull files

- Vercel route: **app/api/admin/smt/pull/route.ts**

- Header for admin: `x-admin-token`

- Header for webhook: `x-intelliwatt-secret`

Vercel-side Environment (Server):

- `INTELLIWATT_WEBHOOK_SECRET` = (exact same value as droplet)

- `DROPLET_WEBHOOK_URL` = `http://64.225.25.54:8787/trigger/smt-now`

Droplet-side Components (Verified):

- Webhook server: **/home/deploy/smt_ingest/web/webhook_server.py** (listens on TCP 8787)

- Systemd service (smt-ingest.service) runs **deploy/smt/fetch_and_post.sh**

- Inbox dir: **/home/deploy/smt_inbox** (owned by user `deploy`)

- State file: **/home/deploy/smt_inbox/.posted_sha256**

- SMT SFTP host: `ftp.smartmetertexas.biz`, user: `intellipathsolutionsftp`, key: `/home/deploy/.ssh/intelliwatt_smt_rsa4096`

Locked Headers & Fields:

- Admin trigger request body (JSON): `{ "esiid": "1044…", "meter": "M1" }` (no mode)

- Inline upload request body (JSON): `{ "mode":"inline", "filename":"...", "encoding":"base64", "content_b64":"...", "esiid":"...", "meter":"...", "sizeBytes":N, ... }`

- `x-admin-token` required unless `x-intelliwatt-secret` is provided

Navigation (Locked):

- `/admin/smt/inspector` must link to every SMT admin utility (normalize UI, raw files, future SMT tools). Any new SMT admin page is incomplete until the inspector exposes a direct link.

Outcome (What works now):

- **Admin trigger path** returns `{ ok: true, message: "...", webhookResponse: {} }` on 200

- **Droplet webhook** returns 200 with log lines like:

  `[INFO] Listing adhocusage at YYYYMMDD_HHMMSS` / `[DONE] YYYYMMDD_HHMMSS`

- **Inline** persists to `RawSmtFile` and returns `{ ok: true, mode: "inline", ... }`

Next Steps (strict order):

1. Add a UI button in **app/admin/smt/inspector/page.tsx** to POST `{ esiid, meter }` to `/api/admin/smt/pull` (admin header).

2. Wire **app/api/admin/smt/normalize/route.ts** to read the newly persisted `RawSmtFile` (from inline) and emit `SmtInterval` rows.

3. Add an Admin page to list `RawSmtFile` (sha256, filename, received_at) and allow “Normalize now” per file.

4. Embed the tested PowerShell/curl commands into **docs/TESTING_API.md** (this patch does that).

Status: ACTIVE / DO NOT CHANGE HEADERS OR ROUTES WITHOUT UPDATING THIS SECTION.

[PC-2025-11-12-B] Windows PowerShell HTTP Call Conventions (LOCKED)

Rationale:

- Past confusion occurred because Windows PowerShell aliases `curl` → `Invoke-WebRequest`, which does not accept common curl flags (`-sS`, `-H`, `-d`, `--data-binary`) or bash line continuations (`\`).

- To prevent future mistakes, ALL Windows examples must follow the rules below.

Locked Rules:

1) Do not show bare `curl` in Windows PowerShell. Use **Invoke-RestMethod (IRM)** or explicitly call **curl.exe**.

2) If using IRM:

   - Always set `-ContentType "application/json"` when posting JSON.

   - Build the JSON body via `ConvertTo-Json -Compress` (or pass a literal string if needed).

   - Use PowerShell backtick `` ` `` for line continuation (never `\`).

3) If using curl.exe:

   - Force the real binary by calling **`curl.exe`** (not `curl`).

   - Pass a literal JSON string in `$Body` and send with `--data-binary $Body`.

   - Include `-H "content-type: application/json"`.

4) All docs must include *both* variants for admin routes and droplet webhooks:

   - Admin trigger: `POST {base}/api/admin/smt/pull` with header `x-admin-token: <token>`.

   - Droplet webhook: `POST http://<droplet>:8787/trigger/smt-now` with header `x-intelliwatt-secret: <secret>`.

5) Cross-reference: The canonical snippets live in **docs/TESTING_API.md** (Windows section). Any future testing instructions must reference those.

Status: ACTIVE / REQUIRED for all Windows examples going forward.

[PC-2025-11-12-C] SMT Normalize API Contract (LOCKED)

Purpose:

- Convert persisted RAW SMT CSVs (uploaded inline via `/api/admin/smt/pull` mode:"inline") into 15-minute `SmtInterval` rows.

Route (Admin-gated):

- **POST** `/api/admin/smt/normalize`

- Header: `x-admin-token: <ADMIN_TOKEN>`

Request Body (JSON):

- One of:

  1) `{ "rawId": "<uuid-or-numeric-id>" }` → normalize a single RawSmtFile

  2) `{ "latest": true }` → normalize the most recently received RawSmtFile

  3) `{ "since": "2025-11-01T00:00:00Z" }` → normalize all RawSmtFile rows received at/after this ISO timestamp

Response (JSON):

- Success: `{ "ok": true, "normalized": <count>, "files": [ { "id": "...", "filename": "...", "rows": <n> } ] }`

- Error: `{ "ok": false, "error": "<message>" }` (HTTP 400/500 as appropriate)

Locked Behavior:

- Input CSVs are assumed to be SMT “adhoc usage” files; parsing handles CST/CDT → UTC.

- Idempotent upsert: do not duplicate intervals if the same file is re-normalized.

- Required columns: timestamp (local), usage kWh, ESIID, meter.

- Persist referential link from intervals → source raw file.

- Keep existing JSON keys used by current ingestion/inline paths; do not rename existing fields elsewhere.

- Admin header (`x-admin-token`) required; no public access.

- This contract MUST be implemented in **app/api/admin/smt/normalize/route.ts** (Next.js App Router) and use the existing DB client.

Status: ACTIVE / DO NOT CHANGE without updating this section.

[PC-2025-11-12-H] SMT Customer Authorization & Auto-Pull (LOCKED, NEXT)

Goal:

- Move from admin-only ingest to customer-authorized automatic delivery of real usage data.

Scope (must implement in this phase):

1) Agreements (CSP Data Sharing)

   - REST: New Energy Data Sharing Agreement, List Agreements, Status, Terminate, List ESIIDs per Agreement.

   - Store: agreementId, status, createdAt, language, termsAcceptedAt, esiid(s), meter(s).

   - UX: capture T&Cs + language; confirm ESIID (from WattBuy).

2) Subscriptions (Ongoing Delivery)

   - REST: New Subscription, List Subscriptions, Unsubscribe/Cancel.

   - Deliveries: SFTP (preferred; droplet already pulling) or Callback API (JSON).

   - Store: subscriptionId, deliveryType, format, status.

3) Enrollment (Historical Backfill — optional but recommended)

   - One-time historical backfill, delivered to SFTP.

   - Limit rules:

     - Residential ESIDs: max 12 months of backfill.

     - Commercial/interval ESIDs: up to 24 months (per SMT constraints).

   - Store: enrollmentId, status, requestedRange, effectiveRange, accountClass (res/com).

4) JWT

   - Implement SMT Token Generation and reuse cached tokens for all REST calls.

5) Ops & Admin

   - Nightly cron to refresh Agreement/Subscription/Enrollment status.

   - Admin pages to create/list/terminate agreements, create/list/unsubscribe subscriptions, trigger enrollment.

   - Logs & alerts if delivery is paused or agreement expires.

Constraints:

- ESIID source of truth remains WattBuy (ERCOT ESIID paused).

- Keep existing SFTP/webhook ingest unchanged.

Done Criteria:

- Customer completes agreement; we can create a subscription; SFTP drop appears and is auto-pulled → normalized into SmtInterval.

- Admin UI shows live Agreement/Subscription/Enrollment status per home, including effective backfill window (12 vs 24 months).

References: SMT Interface Guide sections (Agreements, Subscriptions, Enrollment, Token Generation, backfill limits).

Status: NOT STARTED (docs locked to prevent scope creep).

[PC-2025-11-13-A] Intake + SMT Authorization UX (Google → ERCOT Autocomplete) (LOCKED, NEXT)

Purpose:

- Define the customer-facing flow for pulling SMT usage with minimal friction.
- Clarify that we will start with Google Places + WattBuy and later transition to ERCOT-backed autocomplete to reduce cost and own the address/ESIID index.
- Align this UX with PC-2025-11-12-H (SMT Customer Authorization & Auto-Pull) so engineering and design are building the same thing.

Current State (as of 2025-11-13):

- ESIID source of truth: WattBuy (Get All Electricity Details For A Property / retail rates).
- ERCOT ESIID indexing: paused (used only for historical work; not powering current frontend).
- SMT ingestion pipeline: DONE for admin-only test flows (webhook → droplet → SFTP → fetch_and_post.sh → /api/admin/smt/normalize → SmtInterval).
- SMT Agreements/Subscriptions/Enrollments: NOT IMPLEMENTED YET (see PC-2025-11-12-H).

Locked Primary UX (EnergyBot-style, no SMT login, no meter field on happy path):

1) Address Intake (Step 0)

   - Component: Service address text box on the IntelliWatt onboarding flow.
   - Behavior (current):
     - Use Google Places autocomplete as the suggestion source.
     - When user selects an address:
       - Normalize and store the address on the House record.
       - Call WattBuy backend to retrieve ESIID + utility/TDSP for that address.
       - Store ESIID on the House record and display it in the UI (e.g., “ESIID: 1044…”) for transparency.
   - Future behavior (see “Transition to ERCOT Autocomplete” below):
     - Replace Google Places suggestions with an internal ERCOT-backed address/ESIID index, while still using WattBuy for rates and plan shopping.

2) Customer Info + Consent (Step 1)

   - On the next screen, ask for only:
     - First name
     - Last name
     - Email address
     - Phone number (for SMS/notifications)
     - Current supplier (auto-suggest list of REPs; prefill based on WattBuy if possible)
   - Show a single authorization checkbox:
     - Text must clearly state that the customer authorizes IntelliWatt (legal entity / CSP) to access their electricity usage, meter, and premise data from Smart Meter Texas for up to 12 months (residential) under the SMT terms.
   - The large SMT-style authorization copy (like the Blitz Ventures example) is displayed in a modal or inline block on IntelliWatt pages, not as a redirect to SMT.

3) Backend SMT Authorization (Step 2 — tied to PC-2025-11-12-H)

   - On submit (checkbox checked), backend will:
     - Persist a record of:
       - The exact authorization text shown.
       - Timestamp, IP, and user identity (name/email/phone).
       - ESIID and current supplier.
     - Use the SMT JWT helper (PC-2025-11-12-H) to obtain a valid SMT token.
     - Call SMT’s Agreement endpoint(s) to:
       - Create a New Energy Data Sharing Agreement using the ESIID and customer identity data.
       - Request 12 months of access for residential customers (and up to SMT limits for commercial, per PC-2025-11-12-H).
   - No SMT login for the customer. The entire consent occurs on IntelliWatt’s UI, using SMT’s required language and our CSP credentials.

4) Subscriptions + Enrollment (Step 3 — tied to PC-2025-11-12-H)

   - Once the Agreement is active:
     - Create an SMT Subscription for 15-minute interval data with delivery to SFTP (preferred).
     - Optionally create an SMT Enrollment for historical backfill (12 months residential, up to 24/36 months for qualifying commercial accounts, per SMT limits).
   - SMT begins delivering CSVs to the existing SFTP inbox; droplet + fetch_and_post.sh + /api/admin/smt/normalize handle ingestion as they do today (no changes to that pipeline).
   - From the customer’s perspective:
     - They did not go to the SMT site.
     - They did not type a meter number.
     - They did not upload a bill on the happy path.
     - They only saw IntelliWatt UI + a consent modal.

Fallback Paths (must exist, but are secondary):

A) Bill Upload / Photo (Fallback 1)

   - Provide a way for the customer to upload or photograph their bill.
   - Use OCR to extract:
     - Meter number
     - ESIID (if present)
     - REP details and other useful metadata.
   - Use this data to:
     - Verify or populate ESIID and meter info.
     - Support SMT Agreement creation in edge cases where automated SMT/ESIID flows fail.

B) Optional Manual Meter Field (Fallback 2)

   - Provide a small optional input:
     - “If you know it, enter your meter number.”
   - Used only when:
     - OCR fails or bill is not available.
   - This field is not required for the primary flow and should be visually de-emphasized.

Transition Plan: Google → ERCOT Autocomplete (Cost Optimization)

Phase 1 (NOW / CURRENT)

- Continue using Google Places for address autocomplete on customer-facing intake.
- Use WattBuy for:
  - ESIID lookup.
  - Rate/plan shopping.
- Implement SMT JWT helper + Agreements/Subscriptions/Enrollment using this UX, per PC-2025-11-12-H and this section.

Phase 2 (Re-enable ERCOT Index for Autocomplete)

- When ready to replace Google:
  - Re-enable ERCOT ESIID indexing cron to populate an internal table (e.g., EsiidAddressIndex) with:
    - ESIID
    - Full normalized address (street, city, state, ZIP)
    - TDSP / utility
    - Premise metadata as available.
  - Add a backend search endpoint:
    - GET /api/address/search?q=...&zip=...
    - Returns a small list of matching addresses with ESIID and TDSP.
  - Update the frontend autocomplete to call /api/address/search instead of Google Places.
  - Still call WattBuy for rates/plan details once an address/ESIID is chosen.
- Goal:
  - Reduce external Google Places cost.
  - Own a Texas-wide address→ESIID autocomplete built on ERCOT data, while keeping WattBuy as the rate engine.

Phase 3 (Refinement & Flags)

- Add feature flags to toggle between:
  - Google Places (legacy / fallback).
  - ERCOT-backed address autocomplete.
- Ensure all new flows continue to:
  - Use WattBuy as ESIID source of truth for rate analysis.
  - Use SMT (via Agreements/Subscriptions/Enrollment) for actual interval usage data.
- Update admin tools (SMT Inspector) to show, per home:
  - Intake path: Google vs ERCOT autocomplete.
  - Agreement/subscription/enrollment status.
  - Whether usage is coming from SMT auto-pulls or uploads (bill/Green Button/etc.).

Notes:

- This section refines the SMT auth UX implied in earlier discussions:
  - Primary customer consent is captured on IntelliWatt pages via SMT-compliant authorization text and a single checkbox/modal.
  - No default SMT login or SMT-hosted UI flow is required in the primary path.
- This plan must be followed for all future SMT-related UX and API work unless this LOCKED section is explicitly superseded in a later PC entry.

Status:

- Phase 1: IN PROGRESS — SMT JWT + Agreement/Subscription/Enrollment APIs still to be implemented, but intake UX is defined here.
- Phase 2/3: PLANNED — ERCOT autocomplete and flags to be implemented after Phase 1 is stable.

[PC-2025-11-13-C] Chat Run-Completion + Plan-Doc Update Rules (LOCKED)

Rationale:

- Ensure future ChatGPT sessions understand how the user signals that a Cursor step is complete.
- Enforce that any change affecting items tracked in this plan (or related docs) is always mirrored into the plan docs via a dedicated Cursor Agent Block.

Scope:

- Chat run-completion signal:
  - After a Cursor Agent Block finishes, the user will paste Cursor’s response/output back into the chat.
  - That pasted response serves two purposes:
    1. It lets ChatGPT verify the change was applied as expected.
    2. It counts as the user saying “done” for that step, so ChatGPT can safely move to the next step.
- Plan-doc update requirement:
  - Whenever ChatGPT instructs Cursor to add or edit functionality that touches anything referenced in `docs/PROJECT_PLAN.md` (or any plan-related docs), ChatGPT must:
    - Include, as part of that same step or the immediately-following step, a Cursor Agent Block that updates the relevant plan docs to reflect the change.
    - Clearly mark when a new Plan Change entry overrides earlier guidance.
- This Plan Change is the source of truth for these rules and applies to all future chats operating in the IntelliWatt / Intellipath project.

Rollback:

- To disable this behavior, a future Plan Change must explicitly revoke PC-2025-11-13-C.

[PC-2025-11-13-D] Big-File SMT Interval Uploads (Admin + Customer Manual Uploads) (LOCKED)

Rationale:

- Real SMT interval CSVs (12-month, 15-minute data) are often larger than the ~4 MB Next.js App Router upload limit.
- IntelliWatt must be able to accept full-size interval files end-to-end, not just truncated test samples.
- This requirement applies to both admin tools and customer-facing “manual upload” flows (e.g., SMT or Green Button CSVs).

Scope:

- Big-file requirement:
  - SMT interval files MUST be supported at full size for ingestion into `RawSmtFile` and `SmtInterval`.
  - This applies equally to admin and customer manual upload paths.
- Ingestion paths:
  - The canonical big-file ingestion path is via the droplet ingest pipeline (e.g., `fetch_and_post.sh` / `smt-ingest.service`), which is not constrained by App Router body size limits.
  - Provide and maintain admin automation (e.g., `scripts/admin/Upload-SmtCsvToDroplet.ps1`) that copies local CSVs to the droplet inbox and triggers `smt-ingest.service`, ensuring full-size files enter `RawSmtFile`/`SmtInterval` via the standard pipeline.
  - The existing `/admin/smt/raw` → “Load Raw Files” inline upload:
    - Is a small-file/debug convenience only.
    - Remains subject to App Router limits (~4 MB).
    - Is NOT the primary path for production-sized SMT interval CSVs.
- Customer manual uploads:
  - Any future customer-facing manual interval upload feature MUST:
    - Use a backend/storage-based pipeline (droplet, object storage, or equivalent) that can safely accept large files.
    - Avoid directly posting large files into App Router endpoints.
  - Admin and customer tools should share the same core ingestion module/pattern to keep behavior consistent.

Overrides:

- Overrides earlier assumptions that manual SMT interval uploads would only involve tiny test files.
- Establishes big-file support as a core requirement for both admin and customer manual uploads.

Rollback:

- A future Plan Change must explicitly revoke PC-2025-11-13-D to alter this requirement.

[PC-2025-11-13-E] Droplet HTTP Upload Relay + Admin UI Hook (LOCKED)

Rationale:

- Admin and future customer flows need a browser-based way to submit full-size SMT interval files without hitting App Router body limits.
- Reuses the canonical droplet pipeline so the same ingestion path (RawSmtFile → SmtInterval) is exercised for manual uploads.

Scope:

- Droplet HTTP upload server:
  - Add `scripts/droplet/smt-upload-server.ts` (Express + multer) that writes to `/home/deploy/smt_inbox` and triggers `smt-ingest.service` via `sudo systemctl start`.
  - Configure via env (`SMT_UPLOAD_PORT`, `SMT_UPLOAD_MAX_BYTES`, `SMT_INGEST_SERVICE_NAME`).
  - Provide systemd unit instructions in `docs/DEPLOY_SMT_INGEST.md` so ops can run it persistently.
- Admin UI:
  - `/admin/smt/raw` now posts big files to `NEXT_PUBLIC_SMT_UPLOAD_URL` (the droplet upload server).
  - Existing inline upload remains for small/debug files; big-file form clearly routes to the droplet pipeline.
- Documentation:
  - `docs/ENV_VARS.md` lists new env vars (`NEXT_PUBLIC_SMT_UPLOAD_URL`, `SMT_UPLOAD_PORT`, etc.).
  - `docs/DEPLOY_SMT_INGEST.md` explains setup/usage of the upload server and clarifies pipeline responsibilities.

Overrides:

- Reinforces that full-size SMT uploads must traverse the droplet ingest pipeline; App Router inline uploads stay debug-only.
- Establishes the droplet HTTP relay as the canonical web entry point for manual big-file uploads.

Rollback:

- A future Plan Change must explicitly revoke PC-2025-11-13-E to change this behavior.

[PC-2025-11-13-F] SMT Manual Upload Rate Limits (LOCKED)

Rationale:

- Prevent abuse or accidental overload of the SMT manual-upload pipeline while still allowing realistic admin and customer usage for 12-month interval CSVs.

Scope:

- Droplet upload server (`scripts/droplet/smt-upload-server.ts`) now enforces in-memory, role-aware rate limits:
  - Admin uploads: default **50 per 24-hour window** (`SMT_ADMIN_UPLOAD_DAILY_LIMIT` / `SMT_ADMIN_UPLOAD_WINDOW_MS`).
  - Customer uploads: default **5 per ~30-day window** (`SMT_CUSTOMER_UPLOAD_MONTHLY_LIMIT` / `SMT_CUSTOMER_UPLOAD_WINDOW_MS`).
- Upload server continues to persist files into `SMT_UPLOAD_DIR` (default `/home/deploy/smt_inbox`) and trigger `SMT_INGEST_SERVICE_NAME` (default `smt-ingest.service`) so data flows into `RawSmtFile` → `SmtInterval`.
- Admin UI (`/admin/smt/raw`) tags droplet uploads with `role="admin"` and a stable `accountKey`, and surfaces rate-limit (429) errors to operators.

Constraints / Notes:

- Limits are configurable via environment variables without redeploying code.
- Future customer-facing upload flows must send `role="customer"` and a stable `accountKey` (e.g., user/home ID) while reusing the same droplet endpoint and respecting the configured limits.
- The upload server optionally accepts `SMT_UPLOAD_TOKEN`; if set, clients must provide the token in the `x-smt-upload-token` header.

Rollback:

- A future Plan Change must explicitly revoke PC-2025-11-13-F to modify these rate-limit rules.

[PC-2025-11-13-G] Customer Manual SMT Upload (Droplet Pipeline) (LOCKED)

Rationale:

- Customers need a simple way to manually upload their own 12-month SMT/interval CSVs.
- Admin and customer manual uploads must share the same big-file-safe droplet pipeline and rate limits.
- Each upload must be tied to a specific home/account so we can enforce per-customer limits and surface the ingestion in dashboards.

Scope:

- Added customer-facing upload page `app/customer/smt-upload/page.tsx` with explanatory content.
- Added reusable component `components/customer/SmtUploadForm.tsx` that posts directly to the droplet upload server (`NEXT_PUBLIC_SMT_UPLOAD_URL`).
  - Tags uploads with `role=customer` and a user-provided `accountKey` (Home ID reference for now).
  - Shows success, rate-limit (429), and error messaging returned by the droplet server.
- Reuses existing droplet upload service and limits (admin 50/day, customer 5/month by default) configured via env vars.

Future Work:

- Integrate the page into the main customer dashboard navigation.
- Replace the free-text Home ID field with an authenticated `home_id`/`user_id` from the signed-in session.
- Link post-upload flows to the usage analysis pages so customers can view results immediately after ingest.

Overrides:

- Establishes the droplet-upload-based customer manual upload flow as the canonical method for 12-month SMT CSV ingestion.

Rollback:

- A future Plan Change must explicitly revoke PC-2025-11-13-G to alter this requirement.

[PC-2025-11-13-B] SMT Identity & Contact Details (LOCKED)

Purpose:

- Prevent confusion about which legal identifiers, phone numbers, and SMT contact emails to use in future integrations, tickets, or documentation.

Locked Identity (Intellipath / IntelliWatt):

- Legal Entity: Intellipath Solutions LLC
- DBA: IntelliWatt
- DUNS: 134642921
- PUCT Aggregator Registration Number: 80514
- Official Business Phone (Intellipath / IntelliWatt): 817-471-0579
  - NOTE: 817-471-0579 is the business contact number for CSP / SMT / PUCT work.
  - Personal numbers (e.g., 817-471-6562) must NOT be used in formal docs or SMT requests.

Locked SMT Contact Channels:

- Primary SMT Support Email (per current SMT guides):
  - support@smartmetertexas.com
- Alternate SMT Service Desk Email (in use for API / CSP tickets):
  - rt-smartmeterservicedesk@randstadusa.com
- SMT Help Desk Phone:
  - 1-844-217-8595 (from SMT user guides; use for follow-up/escalation as needed).

Constraints:

- Future plan changes, API contracts, and ops runbooks must reference:
  - DUNS 134642921
  - PUCT Aggregator Registration #80514
  - Business phone 817-471-0579
  - SMT support@smartmetertexas.com as primary support email
- Do NOT re-introduce deprecated or bouncing addresses such as smt.operational.support@smartmetertexas.com in new docs.

Status: ACTIVE / REQUIRED for all future SMT-related communications and documentation.

PC-2025-11-14-A: SMT Big-File Upload Hardening (CORS + Non-Blocking Ingest)

Rationale:

- Admin uploads from https://intelliwatt.com/admin/smt/raw to smt-upload.intelliwatt.com were intermittently failing with 504 Gateway Time-out and browser CORS errors. The upload server must respond quickly and consistently with JSON while still triggering the existing smt-ingest.service pipeline on the droplet.

Changes:

- Updated `scripts/droplet/smt-upload-server.ts` (and JS runtime) to:
  - Enforce a single, centralized CORS middleware that allows origin `https://intelliwatt.com` and sets `Vary: Origin`, including for error responses.
  - Add structured logging for request method, URL, origin, content-length, saved file path, and ingest trigger status.
  - Make the `/upload` route fully wrapped in `try/catch` and return a `202` JSON response immediately after saving the CSV to `SMT_UPLOAD_DIR`.
  - Trigger `smt-ingest.service` using `systemctl start` in a fire-and-forget fashion (no blocking on ingest completion).
  - Add a global error handler so unexpected errors return JSON with CORS headers instead of hanging and causing nginx 504s.

Notes / Overrides:

- This Plan Change **overrides** any prior SMT upload guidance that implied waiting on ingest completion before responding to the client. The canonical behavior is now:
  1. Accept large SMT CSV uploads via `smt-upload.intelliwatt.com`.
  2. Save the file into `SMT_UPLOAD_DIR`.
  3. Trigger `smt-ingest.service` asynchronously.
  4. Respond with a `202` JSON payload to the admin UI quickly, to avoid timeouts.
- Nginx remains responsible for TLS termination and max body size (`client_max_body_size 10m`), but the upload server is now the source of truth for CORS behavior and JSON error responses for SMT uploads.

### PC-2025-11-14-B: SMT Upload Server Keep-Alive

**Rationale:**  
During testing, the SMT upload server (`smt-upload-server.js`) was starting, logging that it was listening on port 8081, and then the systemd service immediately deactivated. There were no visible errors, and nginx returned 504 Gateway Time-out for admin uploads to `smt-upload.intelliwatt.com`. We need the upload server process to remain alive reliably for long-running operation.

**Changes:**

- Updated `scripts/droplet/smt-upload-server.js` (and TS source) to:
  - Add a lightweight `setInterval` keep-alive timer that logs a periodic `[smt-upload] keep-alive tick` and ensures the Node event loop always has an active handle.
  - Keep the existing `app.listen(PORT, ...)` behavior while adding clearer startup logging.

**Notes / Overrides:**

- This is a low-risk operational hardening change on top of PC-2025-11-14-A. It does not alter SMT upload semantics (rate limiting, auth, or ingest triggering); it only ensures the upload server process stays running under systemd instead of exiting unexpectedly.

## PC-2025-11-15-A: SMT upload + ingest hardening

- smt-upload.intelliwatt.com is fronted by nginx on the droplet and proxies to the Node SMT upload server on port 8081.
- The upload server:
  - Exposes `/health` and `/upload` with CORS locked to `https://intelliwatt.com`.
  - Accepts SMT CSV uploads (admin UI and customer manual flows) and saves them into `/home/deploy/smt_inbox`.
  - Triggers `smt-ingest.service` via `systemctl start smt-ingest.service` after each accepted upload.
- `smt-ingest.service` runs `deploy/smt/fetch_and_post.sh`, which:
  - Uses a python3 helper to build the inline JSON payload for `/api/admin/smt/pull` (compression override covered in PC-2025-11-15-B).
  - Derives `esiid` / `meter` from filenames, falling back to `ESIID_DEFAULT` / `METER_DEFAULT` when absent.
  - Skips CSVs already posted by tracking SHA-256 hashes in `.posted_sha256`.
- Guardrails / next steps:
  - Keep endpoints, headers, and service names unchanged.
  - Confirm inline payload contract stays aligned with compression behavior.
  - Verify that uploaded files appear in `RawSmtFile` / `SmtInterval` after normalize jobs.

## PC-2025-11-15-B: SMT Inline Upload Compression (base64+gzip Override)

- Droplet inline uploads now gzip large SMT CSV files before base64 encoding to satisfy Vercel’s ~4.5 MB function body limit.
- Endpoint remains `POST https://intelliwatt.com/api/admin/smt/pull` with `mode: "inline"` and `x-admin-token`.
- Payload shape:
  - `encoding: "base64+gzip"` (new default); `sizeBytes` is the uncompressed CSV byte size; optional `compressedBytes` notes the gzipped size.
  - Debug tools can continue sending `"encoding": "base64"` for small files; both encodings are supported.
- Example inline payload:
```jsonc
{
  "mode": "inline",
  "source": "adhocusage",
  "filename": "20251114T202822_IntervalData.csv",
  "mime": "text/csv",
  "encoding": "base64+gzip",         // gzipped CSV bytes, then base64
  "sizeBytes": 5642292,              // original CSV size in bytes
  "compressedBytes": 1876543,        // optional: gzipped byte length
  "esiid": "10443720000000001",
  "meter": "M1",
  "captured_at": "2025-11-14T20:28:22Z",
  "content_b64": "<base64-of-gzipped-csv>"
}
```
- App changes:
  - `/api/admin/smt/pull` auto-detects `"base64"` vs `"base64+gzip"` and gunzips when required before storing bytes.
  - Storage and `RawSmtFile` persistence always use the original CSV bytes; SHA-256 dedupe also uses the raw CSV.
- Guardrails:
  - No changes to domain names, webhook secrets, or systemd units.
  - This overrides earlier guidance that assumed inline uploads were plain base64 only.

## PC-2025-11-15-C: SMT Inline Auto-Normalization

- Inline uploads to `/api/admin/smt/pull` now normalize SMT IntervalData CSVs immediately after the raw file is saved.
- The handler decodes the CSV bytes, parses them via `parseSmtCsvFlexible`, groups into 15-minute intervals with `groupNormalize`, and upserts rows into `SmtInterval` using `skipDuplicates`.
- Normalization is synchronous with the inline ingest; a 200 OK response indicates both `RawSmtFile` and corresponding `SmtInterval` rows exist (deduped by `(esiid, meter, ts)`).
- The process is idempotent: duplicate raw files (same SHA-256) skip reprocessing, and interval inserts rely on the unique index.
- Downstream analysis endpoints (e.g., `/api/admin/analysis/daily-summary`) can rely on `SmtInterval` being populated immediately after droplet inline ingest succeeds.

## PC-2025-11-15-D: SMT Upload & Inline Ingest (Finalized Droplet Flow)

**Scope**

This plan change locks in the current SMT ingestion flow from browser upload through interval normalization and overrides any prior, partial SMT ingest guidance.

**Architecture**

- Frontend:
  - Main app: `https://intelliwatt.com` (Next.js App Router).
  - Users upload SMT CSVs (IntervalData) from the IntelliWatt UI.

- Upload edge:
  - Domain: `https://smt-upload.intelliwatt.com`
  - Backed by nginx on the DigitalOcean droplet:
    - `GET /health` → Node upload server on `127.0.0.1:8081`.
    - `POST /upload` → Node upload server on `127.0.0.1:8081`.
  - CORS is locked to `https://intelliwatt.com` only.

- Droplet upload server:
  - Service: `smt-upload-server.service`
  - Binary: `scripts/droplet/smt-upload-server.js` (listens on port 8081).
  - Behavior:
    - `GET /health` responds with JSON including `uploadDir` and `maxBytes`.
    - `POST /upload` accepts `multipart/form-data` including:
      - `file`: SMT CSV.
      - `role`, `accountKey` meta fields.
    - On success:
      - Saves files into `/home/deploy/smt_inbox` with timestamped names (e.g. `20251114T202822_IntervalData.csv`).
      - Triggers `systemctl start smt-ingest.service`.

- SMT ingest job (droplet):
  - Service: `smt-ingest.service`.
  - Script: `deploy/smt/fetch_and_post.sh`.
  - Workflow:
    1. SFTP pull from Smart Meter Texas:
       - Host/user are configured via env (see ENV_VARS).
       - Remote root currently `/` (includes an `adhocusage` directory used for testing).
       - Files land in `/home/deploy/smt_inbox`.
    2. For each discovered `.csv` file:
       - Computes SHA-256; dedupes using a `.posted_sha256` file so files are not re-posted.
       - Attempts to infer `esiid` and `meter` from the filename; if not present, falls back to `ESIID_DEFAULT` and `METER_DEFAULT`.
       - Computes `captured_at` from file mtime and `sizeBytes` via `stat`.
       - Builds an inline JSON payload via an embedded `python3` helper:
         - Reads raw CSV bytes.
         - Gzips them.
         - Base64-encodes the gzipped bytes.
         - Sets:
           - `"encoding": "base64+gzip"`.
           - `"sizeBytes"` = original CSV size.
           - `"compressedBytes"` = gzipped byte length (for observability).
           - `"content_b64"` = base64(gzip(CSV bytes)).
       - POSTs to:
         - `POST ${INTELLIWATT_BASE_URL}/api/admin/smt/pull`
         - Header: `x-admin-token: ${ADMIN_TOKEN}`.

**Inline API contract**

`POST /api/admin/smt/pull` with `mode = "inline"` now supports both:

- Plain base64 CSV (for tiny test files, e.g. PowerShell):
  - `"encoding": "base64"`
  - `"content_b64"` = base64(CSV bytes)

- Compressed SMT IntervalData CSV (for real SMT files from the droplet):
  - `"encoding": "base64+gzip"`
  - `"content_b64"` = base64(gzip(CSV bytes))
  - `"sizeBytes"` = original CSV size
  - `"compressedBytes"` = gzipped size (optional; used for debugging)

Example droplet payload:

```jsonc
{
  "mode": "inline",
  "source": "adhocusage",
  "filename": "20251114T202822_IntervalData.csv",
  "mime": "text/csv",
  "encoding": "base64+gzip",
  "sizeBytes": 5642292,
  "compressedBytes": 338959,
  "esiid": "10443720000000001",
  "meter": "M1",
  "captured_at": "2025-11-14T20:28:22Z",
  "content_b64": "<base64-of-gzipped-csv>"
}
```

Behavior in `/api/admin/smt/pull`

For mode = "inline":

The handler validates:

esiid, meter, captured_at, sizeBytes, and content_b64.

It decodes the payload based on encoding:

"base64" → content_b64 is base64-decoded directly as CSV bytes.

"base64+gzip" → base64-decoded bytes are gunzipped to recover the CSV.

It persists a RawSmtFile record, including:

filename, source, sizeBytes, sha256, storagePath, contentType, and encoding info.

It calls an inline CSV normalizer:

Parses the CSV (e.g. timestamp,kwh).

Uses a normalization helper to create SmtInterval rows via Prisma
(smtInterval.createMany with skipDuplicates: true).

Normalization is idempotent; if intervals already exist for that raw file, it does nothing.

Errors during normalization are logged but do not block storing the raw file.

A successful 200 response from /api/admin/smt/pull in inline mode is now interpreted as:

The raw SMT file exists in RawSmtFile.

Its intervals have been normalized into SmtInterval (auto-normalization path).

Override

This plan change supersedes all previous SMT ingest plan notes that assumed:

Plain "encoding":"base64" only.

A separate, manual normalization step.

From now on, SMT ingestion from the droplet must use "encoding":"base64+gzip" for large
IntervalData CSVs, and /api/admin/smt/pull is the single point that both stores and normalizes
SMT data for analysis endpoints such as /api/admin/analysis/daily-summary.

PC-2025-11-15-SSH: Droplet Access Standard
------------------------------------------------

Rationale:
- Ensure all future admins, scripts, and ChatGPT instructions use the correct SSH key-based login for the SMT droplet.
- Avoid confusion around password logins, which are not supported for the deploy user.

Details:
- SMT droplet: 64.225.25.54
- SSH user: deploy
- Canonical SSH command (Windows PowerShell):
    ssh -i "$HOME\.ssh\intelliwatt_deploy_ed25519" deploy@64.225.25.54
- Notes:
  - The intelliwatt_deploy_ed25519 public key is stored in /home/deploy/.ssh/authorized_keys on the droplet.
  - Password login for deploy is disabled; only the SSH key should be used.
  - Future ChatGPT bootstrap text MUST reference this command when instructing how to connect to the SMT droplet.
- Overrides:
  - Any prior guidance that suggested logging in as deploy using a password is obsolete and should not be used.

PC-2025-11-15-NORM: SMT IntervalData Normalization Canonicalized
----------------------------------------------------------------

Rationale:
- SMT IntervalData CSVs (ESIID, USAGE_DATE, USAGE_START_TIME, USAGE_END_TIME, USAGE_KWH, etc.) are now the canonical input for SmtInterval.
- Clean up ESIID formatting and ensure kWh and meter values are stored correctly for ERCOT/SMT history pulls.

Details:
- ESIID:
  - Read from the CSV "ESIID" column when present.
  - Strip any leading apostrophes or Excel guard characters (e.g. "'10443720004529147" → "10443720004529147").
  - If CSV ESIID is missing, fall back to the inline payload ESIID (when provided).
- Meter:
  - Primary source is the inline payload (meter value passed in from the SMT SFTP/inline POST or manual uploads).
  - If no meter is provided, SmtInterval.meter falls back to "unknown".
- kWh:
  - Parsed from the CSV "USAGE_KWH" column as a number.
  - Rows with non-numeric kWh are skipped and counted as invalid.
  - Valid kWh values (e.g. 0.106, 0.086) are stored as-is and used in totalKwh calculations.
- Shared helper:
  - Both /api/admin/smt/pull (inline) and /api/admin/smt/normalize now use a shared SMT normalization helper so behavior is consistent.
- DST and skipDuplicates:
  - Existing DST handling and SmtInterval.createMany({ skipDuplicates: true }) behavior are preserved.

Overrides:
- This Plan Change supersedes any earlier informal assumptions about SMT CSV headers or ESIID formatting.
- Any previous normalization code that stored ESIID with a leading apostrophe or forced kWh to 0 for valid rows is considered legacy and should not be reintroduced.

PC-2025-11-15-KWH: SMT Interval kWh Mapping Fixed
-------------------------------------------------

Rationale:
- SMT IntervalData CSVs were being parsed correctly for kWh (USAGE_KWH) in diagnostics, but SmtInterval.kwh was being persisted as 0.
- This prevented downstream analysis (daily-summary, completeness checks) from seeing real usage for SMT history pulls.

Details:
- The shared SMT normalization helper now:
  - Parses kWh from the "USAGE_KWH" column as a number.
  - Validates that kWh is finite; rows with non-numeric kWh are skipped and counted as invalid.
  - Persists the parsed numeric kWh directly into SmtInterval.kwh.
- No changes were made to:
  - Timestamp (ts) handling, including DST logic.
  - ESIID cleaning and meter resolution behavior from PC-2025-11-15-NORM.
  - Idempotent insertion behavior using prisma.smtInterval.createMany({ skipDuplicates: true }).

Overrides:
- This Plan Change supersedes any previous behavior where SmtInterval.kwh may have been defaulted to 0 despite valid USAGE_KWH values in the CSV.
- Any future normalization changes must continue to use the parsed numeric kWh value for persistence.

PC-2025-11-15-SMT-Interval-Repair
---------------------------------

Rationale:
- We discovered early SMT intervals for ESIID 10443720004529147 were inserted with kWh=0 due to an earlier normalization bug.
- After fixing the parser, duplicates remained because createMany(skipDuplicates: true) does not overwrite existing rows.

Change:
- Added POST /api/admin/debug/smt/intervals with a delete-range capability that allows an admin (x-admin-token) to remove intervals for a given esiid/meter/date range.
- This endpoint is for operational repair and debugging only; ingest and normalization flows remain unchanged.

Usage:
- Admin can call POST with (esiid, optional meter, optional dateStart/dateEnd) to wipe bad intervals, then re-run /api/admin/smt/normalize for the associated RawSmtFile to re-insert the corrected data.

Notes:
- This supplements prior SMT debug endpoints (raw-files, intervals GET) and does not alter production ingest behavior or public APIs.