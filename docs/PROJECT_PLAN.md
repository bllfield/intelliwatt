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

PC-2025-11-07: ESIID Source Cutover (ERCOT-only; remove WattBuy ESIID)

Rationale

- ESIID resolution must come exclusively from ERCOT daily extracts / Agreement APIs to keep UI/CDM stable and vendor-agnostic. (ESIID is optional in CDM; we continue to persist it on `HouseAddress`.)

Scope

- Feature-flag and deprecate admin routes:

  - `/api/admin/address/resolve-esiid` and `/api/admin/address/resolve-and-save` (WattBuy-backed lookups) are now gated off and scheduled for removal.

- Keep WattBuy for plan pulls only (address/zip and TDSP where available), **never** for ESIID.

- Update docs and flags; add a probe endpoint for WattBuy offers.

Rollback

- Re-enable the two admin routes via feature flag `wattbuyEsiidDisabled=false` if emergency rollback is required.

Guardrails

- CDM-first API consumption and RAW→CDM discipline remain unchanged.



PC-2025-11-01: ESIID Resolver — Switch to ERCOT (Deprecate WattBuy for ESIID)

Rationale

We will source ESIID from ERCOT/SMT flows going forward. WattBuy is no longer used for ESIID lookups.

Scope

Provider flag: RESOLVER_PROVIDER=ercot (default).

Resolver: lib/resolver/addressToEsiid.ts routes to ERCOT resolver implementation.

Admin routes:

POST /api/admin/address/resolve-esiid now calls ERCOT resolver.

POST /api/admin/address/resolve-and-save remains the same contract; it uses the ERCOT resolver internally and persists to HouseAddress.esiid (+ UserProfile.esiid if linked).

RAW→CDM:

Store ERCOT responses in raw_ercot (new RAW collection/bucket if not present).

Transformer tx_ercot_to_meter → HouseAddress.esiid, utilityName, tdspSlug.

Observability: corrId + duration logging (unchanged).

Rollback

Flip RESOLVER_PROVIDER=wattbuy (legacy path remains in code but unused by default).



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

Scope

- **Client (`lib/wattbuy/client.ts`):**
  - Use `x-api-key` header (not Authorization Bearer).
  - Add retry logic (1 retry on 5xx errors with exponential backoff).
  - Capture diagnostic headers: `x-amzn-requestid`, `x-documentation-url`, `x-amz-apigw-id`.
  - Handle JSON parsing errors gracefully.

- **Parameters (`lib/wattbuy/params.ts`):**
  - `retailRatesParams`: Accept `utilityID` (camelCase), optional `state` (lowercase), optional `zip`.
  - `electricityParams`: Accept `address`, `city`, `state` (lowercase), required `zip`.
  - `electricityInfoParams`: Extends `electricityParams` with `housing_chars`, `utility_list`.

- **Auto-derivation (`lib/wattbuy/derive.ts`):**
  - `deriveUtilityFromAddress()`: Calls `/v3/electricity/info` to extract utilityID from address.
  - Prefers deregulated utilities, falls back to TX TDSPs.
  - Uses hard-coded EIA utility IDs as last resort.

- **Endpoints:**
  - `/api/admin/wattbuy/retail-rates-test`: Accepts `utilityID+state` OR `address/city/state/zip` (auto-derives).
  - `/api/admin/wattbuy/retail-rates-zip`: Always derives utilityID from address (requires zip).
  - `/api/admin/wattbuy/retail-rates-by-address`: Convenience endpoint for address-based queries.

- **API Endpoints Used:**
  - `/v3/electricity/retail-rates`: Requires `utilityID` (camelCase, integer as string) + `state` (lowercase).
  - `/v3/electricity`: Catalog endpoint, requires `zip`, optional `address`, `city`, `state` (lowercase).
  - `/v3/electricity/info`: Info endpoint, requires `zip`, optional `address`, `city`, `state` (lowercase), `housing_chars`, `utility_list`.

Rollback

- Revert to previous parameter names (`utility_id` snake_case) if needed.
- Remove auto-derivation if it causes issues.

Guardrails

- All WattBuy calls use centralized `wbGet()` function with clean headers.
- No internal headers forwarded to WattBuy API.
- State always lowercase, utilityID always camelCase per WattBuy test page spec.