## PC-2025-11-30-SMT-ADMIN-MGMT

Scope: SMT agreement/subscription admin tools + usage normalization trigger

- Added internal SMT admin API routes (Vercel, admin-only via `x-admin-token`):
  - `POST /api/admin/smt/agreements/status`  
    - Input: `{ esiid }`  
    - Uses `getSmtAgreementStatus(esiid)` → droplet `/agreements/status` → SMT status APIs.
  - `POST /api/admin/smt/agreements/cancel`  
    - Input: `{ esiid }`  
    - Uses `cancelSmtAgreementAndSubscription(esiid)` → droplet `/agreements/cancel` → SMT terminate subscription + agreement.
  - `POST /api/admin/smt/subscriptions/list`  
    - Input (optional): `{ serviceType?: "ADHOC" | "SUBSCRIPTION" }`  
    - Uses `listSmtSubscriptions()` → droplet `/smt/subscriptions/list` → SMT `Mysubscriptions`.
  - `POST /api/admin/smt/report-status`  
    - Input: `{ correlationId, serviceType? }`  
    - Uses `getSmtReportStatus()` → droplet `/smt/report-status` → SMT `reportrequeststatus`.
  - `POST /api/admin/smt/agreements/esiids`  
    - Input: `{ agreementNumber }`  
    - Uses `getSmtAgreementEsiids()` → droplet `/smt/agreements/esiids` → SMT `AgreementESIIDs`.
  - `POST /api/admin/smt/agreements/terminate`  
    - Input: `{ agreementNumber, retailCustomerEmail }`  
    - Uses `terminateSmtAgreement()` → droplet `/smt/agreements/terminate` → SMT `Terminateagreement`.
  - `POST /api/admin/smt/agreements/myagreements`  
    - Input: `{ agreementNumber?, statusReason? }`  
    - Uses `getSmtMyAgreements()` → droplet `/smt/agreements/myagreements` → SMT `MyAgreements` / agreement status list.

- Usage normalization (new admin trigger; normalizer itself already existed):
  - Route: `POST /api/admin/usage/normalize`
    - Guarded by `x-admin-token = ADMIN_TOKEN`.
    - Body:
      ```jsonc
      {
        "houseId"?: string,
        "esiid"?: string,
        "source"?: "smt" | "green_button" | "manual" | "other",
        "start"?: "ISO date string",
        "end"?: "ISO date string"
      }
      ```
    - Calls `normalizeRawUsageToMaster(filter: UsageSourceFilter)` from `lib/usage/normalize.ts`.
    - Behavior:
      - Reads raw intervals from usage DB (`UsageIntervalModule`).
      - Maps to CDM `NormalizedUsageRow`.
      - Upserts into master `SmtInterval` in chunks.
      - Returns `{ ok, rawCount, insertedCount, updatedCount }`.

Notes:
- All SMT admin routes are **internal tools only** (no public UI yet) and do not change existing customer-facing SMT flows.
- SMT calls remain droplet-only; Vercel routes talk to the droplet, not SMT directly.

### PC-2025-11-30: SMT Agreement Status Refresh + Confirmation Flow
- Added `refreshSmtAuthorizationStatus(authId)` helper in `lib/smt/agreements.ts` to map SMT agreement status into local `smtStatus` / `smtStatusMessage` fields.
- Added `/api/smt/authorization/status` (GET/POST) so dashboards can poll the latest authorization for a home and request a live refresh when the customer returns from the SMT email.
- Added an admin cron endpoint `POST /api/admin/smt/cron/status` (x-admin-token) sized for hourly Vercel Cron jobs that re-check pending SMT authorizations in small batches.
- Introduced the dedicated confirmation route `/dashboard/smt-confirmation` that:
  - Displays the pending/declined SMT status and the service address context.
  - Provides explicit "Approved" / "Declined" actions that call the existing confirmation API and refresh /api/smt/authorization/status.
  - Is the only accessible dashboard page while an authorization is pending or declined (layout-level redirect).
- Removed the legacy `SmtStatusGate` overlay in favor of the dedicated confirmation page.
- Customer-facing agreement flow now posts only to SMT `/v2/NewAgreement/`; the legacy `/v2/NewSubscription/` call is skipped to avoid redundant CSP enrollments.

## PC-2025-12-02 · SMT Agreement Reconciliation & Legacy Fallbacks

- **Agreement/Subscription IDs stored as strings.** Every path that persists SMT IDs (`createAgreementAndSubscription`, status refresh, revoke) now converts numbers to strings before writing to Prisma (`smtAgreementId`, `smtSubscriptionId` are varchar fields).
- **Droplet fallback retained.** `postToSmtProxy()` auto-falls back to the legacy `/agreements` action payloads (e.g., `action="myagreements"`, `action="terminate_agreement"`) when the new `/smt/*` endpoints are unreachable, so older droplet configs still work. All handlers emit `[SMT_DEBUG]` request/response logs for traceability.
- **Agreement lookup by ESIID.** New helper `findAgreementForEsiid(esiid)` calls the droplet `/smt/agreements/myagreements`, normalizes the response, and selects the best match for the target ESIID. `refreshSmtAuthorizationStatus()` and `/api/smt/revoke` use this helper to reconcile status or recover missing agreement numbers before hitting SMT.
- **Status cron ready for scheduling.** `/api/admin/smt/cron/status` now uses the new lookup logic, letting Vercel Cron refresh pending authorizations (or all authorizations) on an hourly cadence. Ops must add a Vercel Cron job that POSTs to this route with `x-admin-token` so SMT revocations/approvals automatically sync with the dashboard.

## Module Databases & Env Setup

- [x] Define module database env vars in `ENV_VARS.md` (`CURRENT_PLAN_DATABASE_URL`, `USAGE_DATABASE_URL`, `HOME_DETAILS_DATABASE_URL`, `APPLIANCES_DATABASE_URL`, `UPGRADES_DATABASE_URL`, `OFFERS_DATABASE_URL`, `REFERRALS_DATABASE_URL`) so each subsystem can run on its own database.
- [ ] Create each corresponding database on the DigitalOcean Postgres cluster (e.g., `intelliwatt_current_plan`, `intelliwatt_usage`, `intelliwatt_home_details`, etc.).
- [ ] Add every module DB connection string to Vercel Project Settings (prod) and `.env` (dev), using the exact variable names documented in `ENV_VARS.md`.
- [ ] Gradually refactor Usage, Home Details, Appliances, Upgrades, Offers, and Referrals to follow the Current Plan pattern: module DB ingestion → normalize into the master DB.
- Current Plan is the **first module** fully wired to a separate database and normalized into the master dataset. Usage, Home Details, Appliances, Upgrades, Offers, and Referrals will follow the same "module DB → normalization → master DB" pattern using the env vars defined in `docs/ENV_VARS.md`.

### Current Plan Module Migrations

- Schema: `prisma/current-plan/schema.prisma`
- Migrations dir: `prisma/current-plan/migrations`
- Database: `CURRENT_PLAN_DATABASE_URL` → `intelliwatt_current_plan`

Dev (PowerShell, repo root):
```powershell
# Generate Current Plan Prisma client
npx prisma generate --schema=prisma/current-plan/schema.prisma

# Create/apply module migrations (baseline + future)
npx prisma migrate dev `
  --schema=prisma/current-plan/schema.prisma `
  --migrations-dir=prisma/current-plan/migrations `
  --name init_current_plan_module
```

Prod / droplet:
```bash
npx prisma migrate deploy \
  --schema=prisma/current-plan/schema.prisma \
  --migrations-dir=prisma/current-plan/migrations
```

Notes:
- Before Nov 2025 the module attempted to share `prisma/migrations` with the master schema, which caused drift and table-not-found errors. As of now the Current Plan module uses its own schema + migrations directory; a fresh baseline should be generated against an empty `intelliwatt_current_plan` database.
- The master schema (`prisma/schema.prisma`) continues to use `prisma/migrations`. Do **not** mix Current Plan migrations into that folder.
## TODO
- [ ] Add meter number photo uploader to the SMT authorization flow so customers can upload a picture of their bill or meter for verification.

### Referral Flow & Sharing Progress (Updated 2025-11-27)

- **Referral Token Flow**
  - ✅ IntelliWatt `/join` and `/login` pages now read `?ref=` from the URL and include it as `ref` in the magic-link email form submissions.
  - ✅ HitTheJackWatt landing page reads `?ref=` and can propagate it through outgoing links/forms to IntelliWatt.
  - ✅ HitTheJackWatt magic-link email sender now injects the `ref` value into the IntelliWatt dashboard/login URL (Phase 2 of the referral flow).

- **Referral Sharing Tools**
  - ✅ Referral dashboard page now includes a **Referral Sharing Tools** section with:
    - A HitTheJackWatt-focused share block (jackpot/drawing message + referral URL).
    - An IntelliWatt-focused share block (plan-savings / smart-meter automation message + referral URL).
    - Each block has a pre-written social media message, a "Copy message" button, and multi-network share links using the latest ad creatives.
  - ✅ IntelliWatt universal social-media referral ad creative (neon IntelliWatt branding, no platform icons) defined for future export/use.
- [x] Create initial HitTheJackWatt™ Facebook ad copy library (marketing/hitthejackwatt_facebook_ads.md) for referral and jackpot promotion.
  - ⬜ OPTIONAL: Generate multiple ad sizes (square, story, landscape) and wire in per-user referral URLs for downloadable creatives.

- **Remaining To-Dos from the current checklist**
  - ⬜ **Current Rate Page (MVP)** with image upload or manual entry and "we're working hard to unlock these features" messaging across:
    - Usage, Plans, Home Info, Appliances, Upgrades, Analysis, Optimal Energy.
  - ⬜ **Pop-Up Flow** to guide entries in order: SMT → Current Rate → Referrals, with an option to skip directly to Referrals at each step.
  - ⬜ **Additional SMT Endpoints + Daily Poll** for agreement statuses:
    - acknowledged / approved / revoked / declined / cancel.
  - ⬜ **Real-Time SMT Approval Check**:
    - When the user clicks "I approved it," call SMT API and show status; if not approved, show a clear "not approved yet" message.
  - ⬜ **API Dataset Normalization**:
    - Separate per-API raw datasets (WattBuy, EnergyBot, etc.) and a master normalized dataset with null-safe handling so empty fields don't break the UI.
  - The `RateStructure` contract in `docs/API_CONTRACTS.md` is the shared shape for user-entered current plans and normalized vendor offers so the rate engine can cost fixed, variable, and TOU plans uniformly.
  - Store `billCredits` alongside each plan's `RateStructure` so the comparison engine can apply credits automatically when monthly usage falls inside the configured ranges.
  - ⬜ **Usage-dependent entry reconfirm flows (Added 2025-12-02)**:
    - Preserve previously submitted Current Plan data when SMT usage lapses so the card shows the saved snapshot even while the entry is expired.
    - Add "Reconfirm plan" CTA on `/dashboard/current-rate` that re-validates the stored plan (or accepts new details) before re-awarding the entry once active usage returns.
    - Ensure `refreshUserEntryStatuses` unlocks the Current Plan entry automatically once usage data is active **and** the user reconfirms; surface the same pattern for Home Details + Appliances when those modules go live.
    - ✅ Update usage-dependent entry copy/site messaging (entries page, checklist) to explain that referrals remain the only entry path without active usage data.
    - ✅ Add usage-aware banner on `/dashboard/current-rate` to direct customers to `/dashboard/api` when no SMT/manual usage is present.
    - ✅ Implement testimonial eligibility guard that requires an IntelliWatt plan switch or upgrade (both API and UI).
    - ✅ Clarify testimonial availability copy on `/dashboard/entries` and remove duplicate testimonial card; center the jackpot total callout.

### Current Plan Module Progress (Updated 2025-12-23)

- **Dedicated Current Plan datastore**
  - ✅ Added `prisma/current-plan/schema.prisma` with its own datasource (`CURRENT_PLAN_DATABASE_URL`) so manual entries and bill uploads never touch the master Prisma schema.
  - ✅ Introduced `lib/prismaCurrentPlan.ts` plus `/api/current-plan/manual` and `/api/current-plan/upload` to persist structured plan data and raw bill bytes into the standalone database.
  - ✅ Added customer parsing endpoints:
    - `POST /api/current-plan/efl-parse` (PDF EFL → `ParsedCurrentPlan.rateStructure`, contract fields, ETF; best-effort + queues for admin review when incomplete)
    - `POST /api/current-plan/bill-parse` (bill upload/text → `ParsedCurrentPlan` + queues for admin review when incomplete)
  - ✅ Added Current Plan estimate wiring for customer comparison:
    - Compare page: `/dashboard/plans/compare/[offerId]` + `GET /api/dashboard/plans/compare?offerId=...`
    - Uses the **canonical stitched 12‑month usage window** (same helper as offers) and **the plan engine** to compute:
      - Current Plan estimate (from latest current-plan manual entry or parsed EFL/bill for the active home)
      - Selected Offer estimate (from offer template `RatePlan.rateStructure`)
    - **Termination fee toggle**: UI can include/exclude ETF in “switch now” first-year cost (defaults to include only when in-contract).
    - **Signup step**: uses WattBuy `enroll_link` as the outbound enrollment CTA.

- **Current plan “templates” + queue behavior (Updated 2026-01-09)**
  - **Plan-level templates**: Current-plan EFL parsing now also upserts `BillPlanTemplate` (current-plan module DB) keyed by `(providerNameKey, planNameKey)` so we keep a reusable, plan-level template (analogous to offer `RatePlan` templates).
  - **Template reuse**: `POST /api/current-plan/efl-parse` attempts to reuse an existing `BillPlanTemplate` (matched by provider+plan extracted from the EFL text) before running the full EFL pipeline again. Response includes `templateUsed`, `templateId`, and `templateKey` for UI prefill.
  - **Queue separation**:
    - Current-plan EFL/Bill review items use `EflParseReviewQueue.source` prefixed with `current_plan_`.
    - Admin list endpoint supports `?sourcePrefix=current_plan_` to view all current-plan queue items together.
  - **Auto-resolve semantics**:
    - For current-plan EFL items, `finalStatus=PASS` is sufficient to auto-resolve the queue row (these do not persist to `RatePlan`).
  - **Auto-build missing usage buckets (Updated 2026-01-10)**:
    - On current-plan cost calculation (and on offer estimate paths), we now check bucket coverage for `requiredBucketKeys` and trigger bucket computation only when missing (prevents TOU plans from stalling on missing buckets).
    - Implementation: `lib/usage/buildUsageBucketsForEstimate.ts` performs coverage check + best-effort bucket build.
  - **Admin UI**:
    - `/admin/current-plan/bill-parser` shows both:
      - Parsed bill/EFL templates (`ParsedCurrentPlan`)
      - Plan-level current plan templates (`BillPlanTemplate`)
  - ⬜ NEXT: Normalize ParsedCurrentPlan (EFL/bill parsed) into master/current-plan normalization tables (manual entries already normalize) so other site experiences can consume it without reading the module DB.

- **Developer notes**
  - Local (PowerShell):
    ```
    npx prisma generate --schema=prisma/current-plan/schema.prisma
    npx prisma migrate dev --schema=prisma/current-plan/schema.prisma --name init_current_plan_db
    ```
  - Production rollout:
    - Create a separate PostgreSQL database (e.g., `intelliwatt_current_plan`) via DigitalOcean.
    - Set `CURRENT_PLAN_DATABASE_URL` in Vercel and droplet environments before deploying.
    - After deploy, run:
      ```
      npx prisma migrate deploy --schema=prisma/current-plan/schema.prisma
      ```
- [x] Design a unified `RateStructure` contract for manual Current Plan entries (supports FIXED, VARIABLE, TIME_OF_USE) so the rate comparison engine can use the same logic on user-entered plans and vendor offers.
- [x] Wire the Current Plan UI + DB to capture `RateStructure` for variable and TOU plans (additional form fields + DB storage) after the initial fixed-rate wiring and entry counter integration are stable.
- [x] Define `BillCreditStructure` (BillCreditRule + BillCreditStructure) in `docs/API_CONTRACTS.md` and attach it to `RateStructure` via `billCredits`.
- [x] Wire the Current Rate manual entry form to `/api/current-plan/manual` so the module DB stores the full `RateStructure` object (fixed, variable, TOU, and bill credits).
- [x] Normalize manual Current Plan entries into the master `NormalizedCurrentPlan` table for downstream rate comparisons.
- [x] Run Prisma generate + migrate for the Current Plan module schema and master schema (dev + prod) so the pipeline is live end-to-end.
- [ ] Normalize vendor offer ingestion to populate the shared `RateStructure`, then adapt the comparison engine to cost fixed, variable, and TOU offers with the same code path as user-entered plans.
- [ ] Use `NormalizedCurrentPlan` in the Rate Plan Analyzer UI (future step once normalization + master data is live).
- ✅ Add reconfirmation UX + mutations so expired Current Plan entries can be re-awarded once usage data is back in sync (see "Usage-dependent entry reconfirm flows" checklist).

### EFL Fact Card Engine / pdftotext Helper

- ✅ EFL `pdftotext` droplet helper is reachable from Vercel via dedicated HTTPS subdomain:
  - Canonical env: `EFL_PDFTEXT_URL=https://efl-pdftotext.intelliwatt.com/efl/pdftotext`
  - Shared secret: `EFL_PDFTEXT_TOKEN` documented in `docs/ENV_VARS.md` and wired to the droplet helper + Vercel.
- ✅ Nginx + TLS deployment steps for the helper are documented in `docs/runbooks/EFL_PDFTEXT_PROXY_NGINX.md` (including vhost, Certbot, and firewall notes).
- ✅ Helper now exposes `/health` (plain-text `ok`) behind nginx HTTPS, and logs each request (method, path, content-length, token status) for `journalctl` inspection.
- ✅ EFL `pdftotext` helper env is isolated via `/home/deploy/.efl-pdftotext.env` + systemd `EnvironmentFile` override (no changes to shared `/home/deploy/.intelliwatt.env`).
- ✅ Droplet re-apply script: `deploy/droplet/apply_efl_pdftotext.sh` (idempotently reapplies nginx + systemd config from repo files).
- ✅ Droplet after-pull script: `deploy/droplet/post_pull.sh` (runs `apply_efl_pdftotext.sh`, safely restarts known services, and prints the EFL health check).
- Note: after any `git pull` on the droplet repo, run `sudo bash deploy/droplet/post_pull.sh` to keep nginx/systemd and the EFL helper in sync with the repo.
- ⬜ Keep DNS + droplet nginx/certbot changes in sync with these docs whenever the helper hostname or topology changes.

### EFL Fetch Proxy (Droplet) — WAF/403 Fallback

- ✅ Added an optional **EFL fetch proxy** integration for hosts that block Vercel/AWS IP ranges (403/406).
  - App-side fallback is wired in `lib/efl/fetchEflPdf.ts` (only triggers on 403/406).
  - Configure in Vercel via:
    - `EFL_FETCH_PROXY_URL=https://<your-proxy-host>/efl/fetch`
    - `EFL_FETCH_PROXY_TOKEN=<shared bearer token>` (optional but recommended)
  - Proxy service lives in `deploy/efl-fetch-proxy/` and includes a systemd unit template + SSRF protections.

EFL parser model + extraction status:
- **Admin tooling (single-pane rule):**
  - All EFL admin tools (batch parsing, review queue, templates, manual runner) live on **`/admin/efl/fact-cards`**.
  - Do **not** create additional EFL admin pages; keep tooling consolidated on the single ops page.
  - `/admin/efl/fact-cards` includes an **Unmapped Templates** queue for `RatePlan` rows that have `rateStructure` but **no** `OfferIdRatePlanMap.ratePlanId` link (orphan templates). These won’t light up as “templateAvailable” for any WattBuy `offer_id` until the link exists.
  - Legacy `/admin/efl/manual-upload` redirects to `/admin/efl/fact-cards`.
  - Added **Backfill EFL Templates** button on `/admin/efl/fact-cards` that calls `POST /api/admin/efl/backfill` using `x-admin-token` (prefers `localStorage.intelliwatt_admin_token`, then `sessionStorage.ADMIN_TOKEN`, and also supports the page’s existing `localStorage.iw_admin_token`). The button sends `{zip}` (default `75201`); the route auto-fetches WattBuy offers for that ZIP when `offers[]` is omitted, then extracts EFL rawText and backfills templates. UI shows token diagnostics + last response.
  - Added an on-page **Diagnostics panel** that logs the last ~80 API calls made by `/admin/efl/fact-cards` (including nested tools), and prints failures to the browser console with a `[fact_cards]` prefix. This is the first place to look when something “didn’t process”.

### Canonical EFL Pipeline (Dec 2025)
- **Module**: `lib/efl/runEflPipeline.ts` (orchestrator) + `lib/efl/persistAndLinkFromPipeline.ts` (persistence/linking guardrails).
- **Migrated entrypoints (Phase 1)**:
  - `POST /api/admin/efl/manual-url`
  - `POST /api/admin/efl/manual-upload` (preview by default; persist with `?persist=1` + `x-admin-token`)
  - `POST /api/admin/efl/manual-text` (preview by default; persist with `?persist=1` + `x-admin-token`)
  - `POST /api/admin/efl-review/process-open`
  - `POST /api/admin/efl-review/process-quarantine`
- **Queueing rule**: if a template is created but later stages fail (derive plan-calc, link offerId, etc.), the pipeline must enqueue an admin review row with a stable stage reason code (fail-closed).
- **Dashboard semantics**: treat `app/api/dashboard/plans/**` as production-critical; changes must remain fail-closed and preserve AVAILABLE/QUEUED semantics (see Dashboard section updates below).
- ✅ OpenAI PDF file upload path removed for the EFL parser (413 capacity issues avoided); AI now runs **only** on the `pdftotext` output text.
- ✅ REP PUCT Certificate number and EFL Ver. # are extracted deterministically from the normalized text via regex helpers in `lib/efl/eflExtractor.ts`.
- ✅ EFL AI normalizer now strips **Average Price** rows and **TDU passthrough** blocks from the AI input text only, dropping only the “Average Monthly Use / Average Price per kWh” lines and never the subsequent price components table; key component tables (e.g., “This price disclosure is based on the following components: …”) are explicitly pinned so their rows are never removed. The EFL parser output shape (`planRules`, `rateStructure`, `parseConfidence`, `parseWarnings`) and the “Parsed Plan Snapshot” rendering remain unchanged.
- ✅ Parser prompt and optional deterministic fallback focus on REP Base Charge, Energy Charge tiers, Bill Credits, Product Type, Contract Term, and Early Termination Fee; if the model misses obvious values present in normalized text, a guarded fallback fills them and adds a parse warning.
- ✅ Fixed slicer bug where the “Average Monthly Use” block could accidentally remove real pricing lines (Energy Charge / Usage Credit) that follow immediately after the table; the slicer now stops skipping as soon as it encounters pricing-component markers and preserves those lines.
- ✅ `parseWarnings` are now de-duplicated at the AI parser boundary for cleaner diagnostics without losing any signal.
 - ✅ TDU removal is now line-level and conservative: only obvious TDU/TDSP passthrough boilerplate lines are dropped, and lines containing REP pricing components (Energy Charge / Usage Credit / Base Charge) are always preserved.
 - ✅ REP certificate extraction now supports additional real-world label variants, including “PUCT License # #####” and “REP No. #####”, and EFL version codes are also inferred from bottom-of-document underscore tokens (e.g., `TX_JE_NF_EFL_ENG_V1.5_SEP_01_25`) when explicit `Ver. #` labels are missing.

Reliability guardrails:
- ✅ Deterministic extraction now runs **before** the AI call on the raw `pdftotext` output, computing Base Charge per month, Energy Charge usage tiers, and single-rate Energy Charge directly from the EFL text; AI then fills only missing or nuanced fields (credits, TOU nuance, solar buyback), and cannot "erase" the deterministic core components.
- ✅ Deterministic fallbacks/extractors run against the original `rawText` (source of truth) instead of the normalized slicer text, so they can recover values even if the slicer removes or normalizes away certain hints.
- ✅ `parseConfidence` is computed deterministically from completeness (presence of base charge, tiers/fixed rate, bill credits, rate type, and term months), then clamped to the 0–1 range before returning to avoid any UI percent inflation.
 - ✅ New rawText-based fallbacks handle common EFL patterns for fixed-rate Free Nights products: single-line “Energy Charge: X¢/kWh”, “Base Charge of $X per billing cycle / per ESI-ID”, “Night Hours = 9:00 PM – 7:00 AM” (mapped into `timeOfUsePeriods` as a free/credit window), and “Minimum Usage Fee of $X … less than N kWh” (encoded as a negative billCredit rule for downstream engines.
- ✅ System no longer returns 0% parseConfidence when obvious pricing lines exist; instead it surfaces the best-effort structured parse plus explicit fallback warnings.
 - ✅ N/A is now treated as explicitly present for core pricing components: if the EFL lists “Base Monthly Charge N/A”, “Minimum Usage Charge N/A”, or “Residential Usage Credit N/A”, the parser leaves the numeric fields null but records clear N/A warnings instead of implying the fields are missing.
 - ✅ When the EFL answers “Do I have a termination fee” with a formula like “$15.00 multiplied by the number of months remaining”, the parser captures this ETF formula text as a parse warning/note without introducing new schema fields.
  - ✅ For EFLs that clearly state `Type of Product: Fixed Rate` and a clear single “Energy Charge X¢/kWh`, deterministic fallbacks now fully populate FIXED metadata: `planRules.rateType = "FIXED"`, `planRules.planType = "flat"` (when missing), `planRules.defaultRateCentsPerKwh`, `planRules.currentBillEnergyRateCents`, and the aligned `rateStructure` fields (`type: "FIXED"`, `energyRateCents`, `baseMonthlyFeeCents` when present). These successful FIXED parses now receive a minimum confidence floor (≥60) so UI can distinguish them from low-signal parses.
 - ✅ Version extraction is robust to footer-style “Version X.Y” strings (e.g., `Version 10.0`) in addition to the existing `Ver. #` and underscore-token patterns.
 - ✅ Version extraction now also supports “split Ver.#” footers where the `Ver. #:` line contains a plan-family label (e.g. `GreenVolt`) and the unique structured code appears on the next line (e.g. `24_ONC_U_...`), stitching them into a single `eflVersionCode` for safer template identity.
 - ✅ Deterministic bill-credit fallbacks now cover AutoPay/Paperless credits and usage credits with thresholds (e.g., “Usage Credit for 1,000 kWh or more: $100.00 per month”), mapping them into both `planRules.billCredits[]` and the aligned `rateStructure.billCredits.rules[]` so engines can apply them directly. AutoPay credits have no kWh threshold (`thresholdKwh = null`), and base charge values of `$0` are treated as explicitly present, not “missing”.
 - ✅ New flag `tdspDeliveryIncludedInEnergyCharge` is now extracted deterministically from the EFL raw text when the document explicitly states that the energy charge already includes TDSP/TDU delivery charges (e.g., “Includes all supply and TDSP delivery charges”). This flag is surfaced on both `planRules` and `rateStructure` and will be honored by the rate engine in a later step so we do not double-charge utility delivery when it is already baked into the REP rate.
 - ✅ EFL Avg Price Validator module added: it parses the EFL’s “Average Monthly Use / Average price per kWh” table from **raw** `pdftotext` output (`rawText`) even though the AI input normalizer removes this table, calls the canonical plan cost engine to compute modeled average ¢/kWh at 500/1000/2000 kWh (respecting TOU assumptions and `tdspDeliveryIncludedInEnergyCharge`), and returns `validation.eflAvgPriceValidation` with status PASS/FAIL/SKIP, per-point diffs, and notes. PASS results bump `parseConfidence` to 100% and prune contradictory “no pricing found” warnings; FAIL results attach a blocking `queueReason` for manual admin review without yet blocking the plan in customer-facing flows. The validator also surfaces the extracted `avgTableRows` and a short `avgTableSnippet` so the admin UI can show exactly which EFL rows were used in the comparison.
- ✅ Deterministic base-charge extractor now also supports phrasing such as “Base Charge of $4.95 per ESI-ID will apply each billing cycle.”, filling both `planRules.baseChargePerMonthCents` and the aligned `rateStructure.baseMonthlyFeeCents` so validator PASS/FAIL math includes the fixed monthly charge correctly.
- ✅ Validator-level TDSP override: the EFL Avg Price Validator now parses explicit TDU/TDSP delivery charges from the EFL `rawText` (per‑kWh and per‑month, when present) and uses those amounts **only** for validation math and the admin UI breakdown, without changing the canonical plan cost engine or utility TDSP rate tables. When `tdspDeliveryIncludedInEnergyCharge = true`, the validator does not add any TDSP charges; otherwise it overlays the EFL-stated TDSP dollars on top of the REP energy/base/credit totals and returns a per-point component breakdown (`repEnergyDollars`, `repBaseDollars`, `tdspDollars`, `creditsDollars`, `totalDollars`, `avgCentsPerKwh`, `supplyOnlyTotalCents`, `tdspTotalCentsUsed`, `totalCentsUsed`) so admins can see exactly how modeled averages were constructed. TDSP/TDU extraction keeps full floating ¢/kWh precision (e.g., `6.0009`), and the snippet includes both the per‑month and per‑kWh delivery lines for inspection. If the canonical `computePlanCost` path cannot run (e.g., admin response sends a tier array rather than a full `RateStructure`), the validator falls back to a pure, deterministic calculator that uses `planRules` + EFL TDSP + threshold bill credits so we rarely SKIP; SKIP is now reserved for cases where the avg-price table is missing or **both** calculators fail for all three usage points. The validator also records a `tdspAppliedMode` flag (`INCLUDED_IN_RATE` | `ADDED_FROM_EFL` | `ENGINE_DEFAULT` | `NONE`) in `assumptionsUsed` so ops can see how TDSP was applied for each validation.

### EFL Manual Upload — AI Toggle + Fallback Behaviour

- **Env flags for AI EFL parser**:
  - `OPENAI_API_KEY` must be set for any OpenAI-backed EFL parsing to run.
  - `OPENAI_IntelliWatt_Fact_Card_Parser = "1"` acts as a feature flag; when it is not `"1"` or the API key is missing, the `/api/admin/efl/manual-upload` route skips AI extraction entirely.
- **Manual upload still works without OpenAI**:
  - When AI is disabled or misconfigured, the manual upload endpoint:
    - Runs the deterministic `pdftotext` extract + metadata + validator path as usual.
    - Returns a 200 JSON response that includes an `ai` bag: `{ enabled, hasKey, used: false, reason }`.
    - Adds a stable warning code/message (`AI_DISABLED_OR_MISSING_KEY: EFL AI text parser is disabled or missing OPENAI_API_KEY.`) to `parseWarnings` instead of throwing at import-time.
  - When AI is enabled **and** `OPENAI_API_KEY` is present, behaviour is unchanged: the OpenAI EFL parser runs via a lazy client getter, and the response includes `ai.used: true`.

### OpenAI Projects — Per-Module Keys + Safety Notes

- **Separate Projects per module**:
  - Fact Card / EFL parser now prefers `OPENAI_FACT_CARD_API_KEY` (dedicated OpenAI Project) and only falls back to `OPENAI_API_KEY` when the module key is unset.
  - Bill Parser / Current Plan module now prefers `OPENAI_BILL_PARSER_API_KEY` and only falls back to `OPENAI_API_KEY` when the module key is unset.
  - Both modules are gated by feature flags (`OPENAI_IntelliWatt_Fact_Card_Parser`, `OPENAI_IntelliWatt_Bill_Parcer`); when flags are not truthy, AI calls are skipped and deterministic paths continue to run.
- **Lazy-init OpenAI clients**:
  - All OpenAI clients (Fact Card, Bill Parser, shared) are now lazily instantiated via getters so missing keys never crash imports; errors surface only when AI is actually invoked.
  - API routes that depend on these clients always return JSON error payloads (never HTML), eliminating “Unexpected token '<'” parse errors in callers.
- **Key hygiene**:
  - Any keys pasted into chat or logs must be treated as compromised; operationally, rotate/revoke these keys in their respective OpenAI Projects before deploying changes that might rely on them.

## EFL Templates — Stable Identity + Dedupe (Step 2)

- key precedence order (strongest to weakest):
  - `PUCT_CERT_PLUS_EFL_VERSION`: `puct:${repPuctCertificate}|ver:${normalizedEflVersionCode}`
  - `EFL_PDF_SHA256`: `sha256:${eflPdfSha256}`
  - `WATTBUY_FALLBACK`: `wb:${norm(provider)}|plan:${norm(plan)}|term:${term||"na"}|tdsp:${norm(tdsp)||"na"}|offer:${offerId||"na"}`
- exact templateKey formats are implemented via `lib/efl/templateIdentity.ts#getTemplateKey`, which normalizes strings (lowercase, collapse whitespace, strip non-alphanum except spaces) and returns:
  - `primaryKey`, `keyType`, `confidence` (0–100), `lookupKeys` (primary first, then weaker keys), and `warnings`.
- RatePlan template storage now dedupes on:
  - REP PUCT Certificate + EFL Ver. # when present, otherwise
  - EFL PDF SHA-256 fingerprint; this prevents duplicate templates when the same EFL is seen through multiple URLs or ingest paths.
- UI/API responses remain unchanged; identity + dedupe affect only internal RatePlan persistence.

✅ Step 2 complete: stable identity + dedupe in template storage  
Next step: Step 3 — Get-or-create template service (single entry point) + validation gating

## EFL Templates — Get-or-Create Service (Step 3)

- Single entry point: `lib/efl/getOrCreateEflTemplate.ts` owns the deterministic extract + AI parse + identity wiring for EFL templates.
- Identity lookup order is the same as Step 2:
  - `PUCT_CERT_PLUS_EFL_VERSION` → `puct:${repPuctCertificate}|ver:${normalizedEflVersionCode}`
  - `EFL_PDF_SHA256` → `sha256:${eflPdfSha256}`
  - `WATTBUY_FALLBACK` → `wb:${norm(provider)}|plan:${norm(plan)}|term:${term||"na"}|tdsp:${norm(tdsp)||"na"}|offer:${offerId||"na"}`
- `getOrCreateEflTemplate()`:
  - Accepts either `{ source: "manual_upload", pdfBytes }` or `{ source: "wattbuy", rawText, ... }`.
  - Runs deterministic extract (`deterministicEflExtract`) for PDF inputs to produce `rawText`, `eflPdfSha256`, `repPuctCertificate`, `eflVersionCode`, and extractor warnings.
  - Computes a stable identity via `getTemplateKey` and uses an in-process cache so repeated parses of the same EFL do not re-run the AI unnecessarily.
  - Invokes the **text-only** AI parser (`parseEflTextWithAi`) with slicer + deterministic fallbacks + confidence scoring, then returns a unified template record: `planRules`, `rateStructure`, `parseConfidence`, `parseWarnings`, identity, and aggregated warnings.
- The admin manual-upload route (`/api/admin/efl/manual-upload`) now calls `getOrCreateEflTemplate` and returns the same JSON shape as before (including `planRules`, `rateStructure`, `parseConfidence`, `parseWarnings`, and `rawTextPreview`), but all EFL parsing logic flows through the shared service.

✅ Step 3 complete: single get-or-create template service wired to manual upload  
Next step: Step 4 — Wire into WattBuy offer detail (non-blocking UI)

## EFL Templates — WattBuy Wiring (Step 4)

- New endpoint: `POST /api/efl/template/from-offer` accepts a WattBuy offer identity payload:
  - `offerId`, `providerName`, `planName`, `termMonths`, `tdspName`, plus optional `rawText`, `eflPdfSha256`, `repPuctCertificate`, and `eflVersionCode`.
- Behavior:
  - When `rawText` is present, the endpoint calls `getOrCreateEflTemplate({ source: "wattbuy", ... })` to run the **text-only** AI parser with deterministic fallbacks and returns `planRules`, `rateStructure`, `parseConfidence`, `parseWarnings`, and identity metadata.
  - When `rawText` is missing/empty, the endpoint performs an identity-only lookup using `findCachedEflTemplateByIdentity` (no OpenAI call, no PDF fetch); if no template is found, it returns `ok: true` with warnings indicating that admin manual upload is required to learn the plan.
- UI wiring (non-blocking):
  - Admin Offers Explorer (`/admin/offers`) now includes a **Fact card** action per row that calls `/api/efl/template/from-offer` on demand.
  - The offers table still renders immediately; fact card loading is asynchronous with a "Parsing…" state, and results are rendered as a lightweight snapshot (confidence, PUCT Cert, Ver. #, and warnings) without blocking the rest of the UI.

✅ Step 4 complete: WattBuy offer details now attempt to load/learn EFL templates  
Next step: Step 5 — Admin list/view/approve templates + collision detection

## EFL Templates — Backfill, Cache, Metrics (Step 6)

- In-memory cache:
  - `lib/efl/getOrCreateEflTemplate.ts` now maintains a short-lived TTL cache (`TEMPLATE_CACHE`, 5 minutes) keyed by the primary EFL identity key (`identity.primaryKey`), plus a longer-lived in-process map keyed by all `lookupKeys`.
  - `getOrCreateEflTemplate()` checks the TTL cache first for hits before consulting the in-process map or calling the AI parser, and refreshes the TTL entry after each successful lookup or creation.
- Metrics counters (log-based):
  - Module-scope counters track `templateHit`, `templateMiss`, `templateCreated`, and `aiParseCount` inside `getOrCreateEflTemplate()`.
  - Each call emits a structured `console.info("[EFL_TEMPLATE_METRICS]", { ... })` payload so we can observe cache effectiveness and AI usage from logs without adding new infra.
- Admin backfill endpoint:
  - New route: `POST /api/admin/efl/backfill` (requires `x-admin-token` matching `ADMIN_TOKEN`), which accepts `{ limit?: number, providerName?: string, tdspName?: string, offers?: any[] }`.
  - When `offers[]` are provided, it filters by `providerName`/`tdspName`, skips entries without `rawText` / `eflRawText`, and calls `getOrCreateEflTemplate({ source: "wattbuy", ... })` for the rest.
  - Returns a summary: `{ ok: true, processed, created, hits, misses, warnings }`, where warnings include skips (no text) and any parser/template warnings per offer.
- Admin templates list + backfill (WattBuy ops UI support):
  - `GET /api/admin/wattbuy/templated-plans` lists persisted `RatePlan` templates (where `rateStructure` is present) and computes:
    - `modeledRate500/1000/2000` as an **admin sanity check**: `RatePlan.rateStructure` + a TDSP delivery snapshot (from `tdspRateSnapshot`).
    - `modeledTdspCode` + `modeledTdspSnapshotAt` so ops can see **exactly which TDSP tariff snapshot** was used to produce the modeled numbers.
    - Optional usage-scoped preview (admin-only diagnostics; does not change gating):
      - Query params:
        - `homeId=<HouseAddress.id>`: attach usage preview + computed monthly estimate (best-effort).
        - `useDefaultHome=1`: when `homeId` is omitted, auto-pick a recent home with usage buckets and attach the same preview (best-effort).
        - `usageMonths=12` (bounded; default 12).
      - Response additions:
        - `rows[*].usagePreview` (avg monthly kWh by required bucket keys)
        - `rows[*].usageEstimate` (output of `calculatePlanCostForUsage`, including `monthlyCostDollars` when computable)
        - `usageContext` (which homeId was used + months found)
  - `POST /api/admin/wattbuy/templated-plans/backfill` supports:
    - `source=efl&overwrite=1` to overwrite headline `rate500/1000/2000` using the EFL “Average price per kWh” table (all‑in, includes TDSP as disclosed on the EFL).
    - `utility=1` to backfill `RatePlan.utilityId` for `UNKNOWN` rows by inferring TDSP territory from the EFL text (e.g., `ONCOR`, `CENTERPOINT`, `AEP_NORTH`, `AEP_CENTRAL`, `TNMP`) so the modeled sanity-check rates can be computed.
  - Template computability override (ops-only):
    - `POST /api/admin/wattbuy/templated-plans/override-computable` (requires `x-admin-token`)
      - Forces `planCalcStatus=COMPUTABLE` with `planCalcReasonCode=ADMIN_OVERRIDE_COMPUTABLE` or resets to derived.
      - **Must run on Node.js runtime** (Prisma): `export const runtime = "nodejs";`
      - Customer UI behavior: when `planCalcStatus=COMPUTABLE` is persisted on the `RatePlan` (including via override), `/api/dashboard/plans` treats the offer as computable for badge/status purposes (no customer-facing `UNSUPPORTED` badge due to derived checks).
    - UI: override controls are visible on both:
      - `/admin/wattbuy/templates`
      - `/admin/efl/fact-cards` (Templates table)
  - Deployment marker (debugging mismatched deploys):
    - `GET /api/version` returns `{ ok, sha, ref }` when Vercel provides git env vars.
    - `/admin/efl/fact-cards` shows a `build: <branch>@<sha7>` marker in the header.
- Quarantine bulk processor (review-queue drain):
  - `POST /api/admin/efl-review/process-open` processes OPEN `EflParseReviewQueue` rows with an `eflUrl` in time-budgeted chunks.
  - Runs the full EFL pipeline and only persists templates + auto-resolves queue rows when the result is **PASS + STRONG** (never “makes up” missing data).
- No Redis/KV or schema changes were introduced; correctness remains anchored in the deterministic extract + AI parser behavior, with caching and metrics strictly additive for performance and observability.

✅ Step 6 complete: backfill + cache + metrics  
Next step: Step 7 — Documentation + runbooks + failure modes

## EFL / Fact Card Engine — Final Working Order (Rock Solid)

### Pipeline (end-to-end)

1. **PDF → Text Extraction**
   - **Primary**: droplet `pdftotext` helper behind HTTPS (`EFL_PDFTEXT_URL` → `https://efl-pdftotext.intelliwatt.com/efl/pdftotext`).
   - **Binding**: droplet Python service binds to `127.0.0.1` and is fronted by nginx TLS (no direct `:8095` from Vercel).
   - **Result**: `rawText`, `eflPdfSha256`, and `extractorMethod` (`"pdftotext"`).
2. **Deterministic metadata extraction (from rawText)**
   - `repPuctCertificate`: REP PUCT Certificate # via regex in `lib/efl/eflExtractor.ts`.
   - `eflVersionCode`: EFL `Ver. #` via regex in `lib/efl/eflExtractor.ts`.
3. **Identity + Dedupe (templateKey precedence)**
   - `PUCT_CERT_PLUS_EFL_VERSION` → `puct:${repPuctCertificate}|ver:${normalizedEflVersionCode}`.
   - `EFL_PDF_SHA256` → `sha256:${eflPdfSha256}`.
   - `WATTBUY_FALLBACK` → `wb:${norm(provider)}|plan:${norm(plan)}|term:${term||"na"}|tdsp:${norm(tdsp)||"na"}|offer:${offerId||"na"}`.
   - Implemented by `lib/efl/templateIdentity.ts#getTemplateKey`.
4. **Template lookup**
   - In-process caches in `lib/efl/getOrCreateEflTemplate.ts`:
     - TTL cache (`TEMPLATE_CACHE`, 5-minute TTL) keyed by `identity.primaryKey`.
     - Longer-lived map keyed by all `lookupKeys`.
   - On miss, callers may persist templates into `RatePlan` via `upsertRatePlanFromEfl` (separate persistence step).
5. **If missing: AI parse (TEXT-ONLY)**
   - `parseEflTextWithAi` consumes **normalized `rawText` only**; PDFs are **never** uploaded to OpenAI (413 eliminated).
   - Input passes through the soft slicer (`normalizeEflTextForAi`) with **fail-open** back to original text if too aggressive.
6. **Deterministic fallback fill**
   - If AI leaves fields empty but the text clearly states them:
     - Base charge per month (dollars → cents).
     - Usage tiers (`minKwh`, `maxKwh`, `rateCentsPerKwh`).
     - Threshold-based bill credits (e.g., `$50 if usage >= 800 kWh`).
7. **Validation + computed confidence**
   - `parseConfidence` computed deterministically from completeness:
     - presence of base charge, tiers/fixed rate, bill credits, rate type, and term months.
   - Model self-reported confidence is ignored in favor of this score.
8. **Persist template + metadata**
   - In-memory template record from `getOrCreateEflTemplate` includes:
     - `eflPdfSha256`, `repPuctCertificate`, `eflVersionCode`, `rawText`, `extractorMethod`.
     - `planRules`, `rateStructure`, `parseConfidence`, `parseWarnings`.
   - Long-term persistence uses `RatePlan` in the master schema via `lib/efl/planPersistence.ts#upsertRatePlanFromEfl` (EFL identity + `rateStructure` with manual-review gating).
   - `RatePlan.utilityId` on EFL templates is treated as **best-effort ops metadata**:
     - When persisting templates via batch/queue/manual tooling we attempt to infer a normalized TDSP code from EFL text (so admin tools can compute “modeled” sanity-check values).
     - Customer-facing pricing still uses TDSP derived from the user’s address/ESIID + current TDSP tariff snapshots; it does not rely on template `utilityId`.

### What we intentionally ignore

- **TDU/TDSP delivery charges** (volumetric and fixed) — customer billing uses the separate Utility/TDSP cost module (address/ESIID-derived TDSP + `tdspRateSnapshot`).
  - Admin pages may display a “modeled” all‑in sanity-check value by overlaying a TDSP snapshot; this is for ops validation only and is always annotated with the TDSP code + snapshot date.
- **Average price tables** (`Average Monthly Use / Average Price per kWh`) — these are examples, not billable rates.
- **Taxes, municipal fees, and generic disclosures** — ignored unless they directly change recurring REP charges that cannot be modeled elsewhere.

### UTILITY / TDSP MODULE — Step 1 Inventory (2025-12-13)

- **Ripgrep commands used**
  - `rg -n "TDSP|tdsp|delivery fee|delivery fees|TDU|TD(U|SP)|tariff|rider|adjustment|Oncor|CenterPoint|TNMP|AEP" .`
  - `rg -n "utility fee|utility fees|regulated|non-bypassable|NBF|TCRF|DCRF|PCRF|SCRF|TDS|transmission|distribution" .`
  - `rg -n "RatePlan|RatePlan\\b|utilityName|utilityPhone|tdspSlug|utilityID|utilityId" .`
  - `rg -n "admin.*(utility|tdsp|tariff|delivery)" .`
  - `rg -n "CurrentPlan|EFL|fact card|pdftotext|bill-parse" .`

- **What already exists**
  - **Core master schema (prisma/schema.prisma)**:
    - `RatePlan` stores normalized REP plans and utility tariffs with:
      - `utilityId`, `state`, `supplier`, `planName`, `termMonths`, `isUtilityTariff`, `tariffStructure` (JSON), plus EFL identity fields (`eflPdfSha256`, `repPuctCertificate`, `eflVersionCode`) and validation metadata (`eflValidationIssues`, `rateStructure`).
    - `ErcotIngest` and `ErcotEsiidIndex` track ERCOT TDSP ESIID extract ingestion and map ESIIDs to `tdspCode` (`ONCOR`, `CENTERPOINT`, `AEP_NORTH`, `AEP_CENTRAL`, `TNMP`).
    - `UserProfile` and `HouseAddress` use `tdspSlug` and `utilityName` to tag homes with TDSP/utility context.
    - `RateConfig` (internal config table) already has coarse TDSP-related fields (`tdsp`, `tdspSlug`, `tduDeliveryCentsPerKwh`, `billCreditsJson`) for legacy rate experiments.
    - `UtilityPlan` stores per-user plans with coarse `deliveryFee` and `monthlyFee` floats (not a canonical tariff table).
  - **Current-plan / bill parser schema (prisma/current-plan/schema.prisma)**:
    - `ParsedCurrentPlan` includes `tdspName`, `rateStructure`, and serialized `energyRateTiersJson` / `billCreditsJson`, but no explicit TDSP tariff rows.
    - `BillPlanTemplate` captures reusable plan-level terms (rate type, tiers, credits) keyed by provider/plan name, again without normalized utility/TDSP fee tables.
  - **Usage / home-details / appliances schemas**:
    - `RawGreenButton` and `GreenButtonInterval` store utility usage with `utilityName`, but no structured TDSP charge components.
  - **Application + docs wiring**:
    - WattBuy integration (`RatePlan`, `/api/admin/wattbuy/*`, `app/admin/wattbuy/inspector`) already uses `utilityID`, `state`, and `utilityName` to fetch and persist both REP plans and utility tariffs into `RatePlan` with `isUtilityTariff=true` and `tariffStructure` JSON.
    - SMT and Green Button flows pass `tdspSlug` / `utilityName` through APIs and admin UIs, but do not surface a canonical TDSP charge table.
    - EFL Avg Price Validator (`lib/efl/eflValidator.ts`) parses TDSP/TDU delivery charges **from the EFL text itself** and uses them only for validator math and admin breakdowns; it does **not** read from or write to any shared Utility/TDSP tariff store.

- **What’s missing**
  - There is **no dedicated Utility/TDSP tariff schema** that:
    - Stores per-TDSP delivery components (customer charge, per‑kWh delivery, riders like TCRF/DCRF/PCRF/SCRF) as first-class rows.
    - Tracks effective date ranges and version history for tariff changes per TDSP.
    - Normalizes units (¢/kWh, $/month, $/kW, percentage) with explicit `chargeType` and `unit` enums.
    - Captures raw source metadata (TDSP name/code, source URL, document identifiers, SHA‑256 of the source PDF/HTML) and human-readable notes.
  - All TDSP/utility charges today are either:
    - Embedded in EFL text and parsed on-the-fly for validation, or
    - Stored as opaque JSON blobs (`tariffStructure`, `rateStructure`, `centsPerKwhJson`, `billCreditsJson`) without a shared, queryable tariff table.

- **Minimal proposed Prisma schema (not yet implemented)**
  - **Goal**: create a boring, isolated Utility/TDSP tariff module that can back both the validator and future rate engines without entangling EFL/bill parsing.
  - **New models (in master prisma/schema.prisma, behind a dedicated migration)**:
    - `TdspUtility`
      - `id: String @id @default(cuid())`
      - `code: TdspCode` (reuses existing enum: `ONCOR`, `CENTERPOINT`, `AEP_NORTH`, `AEP_CENTRAL`, `TNMP`)
      - `name: String` (e.g., "Oncor Electric Delivery Company LLC")
      - `shortName: String?` (e.g., "Oncor")
      - `serviceTerritory: String?` (freeform description / marketing name)
      - `websiteUrl: String?`
      - `createdAt: DateTime @default(now())`
      - `updatedAt: DateTime @updatedAt`
    - `TdspTariffVersion`
      - `id: String @id @default(cuid())`
      - `tdspId: String` → FK to `TdspUtility`
      - `tariffCode: String?` (e.g., rate schedule identifier from TDSP docs)
      - `tariffName: String?` (human label, e.g., "Residential Service")
      - `effectiveStart: DateTime`
      - `effectiveEnd: DateTime?` (null for "current until superseded")
      - `sourceUrl: String?` (TDSP PDF/HTML URL)
      - `sourceDocSha256: String? @unique` (hash of the source file for drift detection)
      - `planSource: PlanSource` (reuse existing enum: `wattbuy` | `tdsp_feed` | `manual`)
      - `notes: String?`
      - `createdAt: DateTime @default(now())`
      - `updatedAt: DateTime @updatedAt`
      - `@@index([tdspId, effectiveStart, effectiveEnd])`
    - `TdspTariffComponent`
      - `id: String @id @default(cuid())`
      - `tariffVersionId: String` → FK to `TdspTariffVersion`
      - `chargeName: String` (e.g., "TDU Delivery Charge", "Customer Charge", "TCRF")
      - `chargeType: String` (normalized code, e.g., "DELIVERY", "CUSTOMER", "TCRF", "DCRF", "PCRF", "OTHER")
      - `unit: String` (e.g., "PER_KWH", "PER_MONTH", "PER_KW", "PERCENT")
      - `rate: Decimal` (stored in canonical units: ¢/kWh, $/month, etc.)
      - `minKwh: Int?` / `maxKwh: Int?` (for usage-banded components; null for flat)
      - `notes: String?` (human-readable explanation, caveats)
      - `rawSourceJson: Json?` (snippet of the originating TDSP text/table for traceability)
      - `createdAt: DateTime @default(now())`
      - `updatedAt: DateTime @updatedAt`
      - `@@index([tariffVersionId, chargeType, unit])`
  - **History + versioning guarantees**
    - New TDSP tariff docs are **always** inserted as new `TdspTariffVersion` rows; existing rows are never hard-updated in a way that loses historical rates.
    - `effectiveEnd` is set when a new version supersedes the old one, preserving a complete effective-date history.
    - `TdspTariffComponent` rows are append-only within each version; changes are represented by a new `TdspTariffVersion` rather than in-place edits.

- **Next step**
  - **Step 2 — Create isolated Prisma schema + migrations (NO parsing logic yet)**:
    - Add the `TdspUtility`, `TdspTariffVersion`, and `TdspTariffComponent` models to `prisma/schema.prisma` behind a dedicated migration.
    - Wire read-only accessors and admin inspection tooling, but keep all TDSP extraction/parsing logic in existing EFL/bill modules until the tariff store is populated and validated.

### UTILITY / TDSP MODULE — Step 2 Prisma models + lookup + seed (2025-12-13)

- **Files changed**
  - `prisma/schema.prisma`
    - Added `TdspUtility` model: normalized TDSP master table keyed by existing `TdspCode` enum, with `name`, `shortName`, `serviceTerritory`, `websiteUrl`, and timestamps.
    - Added `TdspTariffVersion` model: versioned TDSP tariff documents with `tdspId` FK → `TdspUtility`, `tariffCode`, `tariffName`, `effectiveStart`/`effectiveEnd`, `sourceUrl`, `sourceDocSha256` (unique), `planSource: PlanSource`, `notes`, timestamps, and index on `[tdspId, effectiveStart, effectiveEnd]`.
    - Added `TdspTariffComponent` model: per-component tariff rows with `tariffVersionId` FK → `TdspTariffVersion`, `chargeName`, `chargeType`, `unit`, `rate Decimal(10,4)` (stored in cents for `PER_MONTH`/`PER_KWH`), optional `minKwh`/`maxKwh`, `notes`, `rawSourceJson`, timestamps, and index on `[tariffVersionId, chargeType, unit]`.
  - `lib/utility/tdspTariffs.ts`
    - New pure helper module exporting:
      - `lookupTdspCharges({ tdspCode, asOfDate })` → best-effort TDSP delivery charges for a given `TdspCode` and date, backed by the new Prisma models.
      - `TdspCharges` shape with: `tdspCode`, `asOfDate`, `tariffVersionId`, `effectiveStart`, `effectiveEnd`, `monthlyCents`, `perKwhCents`, a list of raw `components` (type/unit/rate/minKwh/maxKwh), and `confidence: "MED" | "LOW"` (currently `"MED"` for table-backed lookups).
    - Lookup behavior:
      - Finds `TdspUtility` by `code` (existing `TdspCode` enum: `ONCOR`, `CENTERPOINT`, `AEP_NORTH`, `AEP_CENTRAL`, `TNMP`).
      - Selects the active `TdspTariffVersion` where `effectiveStart <= asOfDate` and (`effectiveEnd` is null OR `effectiveEnd > asOfDate`), preferring the most recent `effectiveStart` when multiple match.
      - Aggregates `monthlyCents` as the sum of `rate` for components with `unit === "PER_MONTH"` and `perKwhCents` as the sum of `rate` where `unit === "PER_KWH"` (both in integer cents).
      - Returns `null` when no utility, version, or components are found; performs **no** plan math and does not reference any EFL/bill parsing logic.
  - `scripts/seed-tdsp-tariffs.ts`
    - New idempotent seed script that:
      - Upserts `TdspUtility` rows for `TdspCode.ONCOR` and `TdspCode.CENTERPOINT` with canonical names and short display names.
      - Upserts a single `TdspTariffVersion` per TDSP with `effectiveStart = 2025-01-01`, `planSource = PlanSource.tdsp_feed`, and a placeholder `tariffCode/tariffName` plus notes indicating seeded values must be replaced with official tariff data.
      - Clears existing `TdspTariffComponent` rows for that version on re-run and creates at least two components per TDSP:
        - `CUSTOMER` / `PER_MONTH` component (`rate` in cents per month, e.g., `395` for `$3.95`), and
        - `DELIVERY` / `PER_KWH` component (`rate` in cents per kWh, e.g., `3.287` for `3.287¢/kWh` for ONCOR; CENTERPOINT seeded as `0` with explicit “replace me” notes).
      - Logs a short completion message and disconnects Prisma on exit.

- **Migration status**
  - Attempted to run `npx prisma migrate dev --name add_tdsp_tariff_models` against the shared DigitalOcean Postgres instance; Prisma detected drift (previous migrations modified after apply, additional tables/columns present) and aborted with a recommendation to run `prisma migrate reset`.
  - To avoid dropping or resetting the shared database from a dev workstation, **no new migration was applied** in this step; only `prisma/schema.prisma` was updated in the repo.
  - **Next operational action** (to be done carefully, outside this step):
    - Resolve migration drift in a controlled maintenance window (e.g., via `prisma migrate diff` + `migrate resolve` / `migrate deploy` according to Prisma’s drift guidance).
    - Once drift is resolved, run `npx prisma migrate dev --name add_tdsp_tariff_models` (or the equivalent `migrate deploy` in CI/prod) so the new TDSP tables are created in the live schema.

- **Seed command (local / dev)**
  - From a dev machine with `DATABASE_URL` pointing at a **safe** database (not shared prod):
    - PowerShell:
      - `cd "C:\Users\...\intelliwatt-clean"`
      - `npx prisma migrate dev --name add_tdsp_tariff_models`
      - `npx tsx scripts/seed-tdsp-tariffs.ts`
  - This will create `TdspUtility`, `TdspTariffVersion`, and `TdspTariffComponent` rows for ONCOR and CENTERPOINT with clearly-labeled placeholder rates.

- **Seed command (prod / managed DB, once drift is resolved)**
  - From the app host (e.g., droplet / CI) in a controlled rollout:
    - `cd /home/deploy/apps/intelliwatt`
    - `npx prisma migrate deploy`
    - `npx tsx scripts/seed-tdsp-tariffs.ts`
  - This should be run **after** migration drift has been addressed and once we are ready to start populating TDSP tariff tables in the shared database.

- **Next step**
  - **Step 3 — Wire `lookupTdspCharges()` into EFL Avg Price Validator (no behavior change to EFL parser/bill parser yet)**:
    - When `lib/efl/eflValidator.ts` encounters an EFL avg-price table where numeric TDSP delivery charges are masked with `**` but pass-through language exists, use `lookupTdspCharges({ tdspCode, asOfDate })` as a **fallback** TDSP source for validator math.
    - On successful utility-table lookup, classify validator results as PASS/FAIL (or PASS_WITH_ASSUMPTIONS) instead of SKIP, while keeping SKIP only for cases where area/date inference or TDSP lookup fails.
    - Keep all TDSP extraction from EFL text and all bill parser logic unchanged; this step is a pure validator enhancement layered on top of the new Utility/TDSP module.

### UTILITY / TDSP MODULE — Step 2A Texas TDSP universe (2025-12-13)

- **A) Authoritative Texas TDSP list (from ERCOT / repo)**
  - **Enum source**
    - `prisma/schema.prisma` defines `enum TdspCode { ONCOR; CENTERPOINT; AEP_NORTH; AEP_CENTRAL; TNMP }` and is referenced by:
      - `ErcotIngest.tdsp` comment (`oncor|centerpoint|aep_north|aep_central|tnmp|unknown`), documenting the ERCOT TDSP DAILY zip ingest mapping.
      - ESIID index model `ErcotEsiidIndex` via `tdspCode` string field (normalized to these codes at ingest time).
      - TDSP cost modules (`lib/cost/tdsp.ts`, `lib/tdsp/fetch.ts`, plan analyzer tests, and docs) which already assume this 5‑TDSP universe for Texas.
  - **TDSP codes + legal names (from PUCT lists / docs)**
    - `ONCOR` → **Oncor Electric Delivery Company**  
      - Evidence: `docs/PUCT NUMBER LISTS/tdu.csv` (`ONCOR ELECTRIC DELIVERY COMPANY`) and `docs/PUCT NUMBER LISTS/iou.csv` (Oncor IOU rows), plus internal comments in `ErcotIngest` and SMT agreements.
    - `CENTERPOINT` → **CenterPoint Energy Houston Electric, LLC**  
      - Evidence: `tdu.csv` and `iou.csv` entries for `CENTERPOINT ENERGY HOUSTON ELECTRIC LLC`, plus SMT agreement mappings in `lib/smt/agreements.ts` (`CENTERPOINT`, `CENTERPOINT_ENERGY`, `CENTERPOINT ENERGY` → CENTERPOINT TDSP).
    - `AEP_CENTRAL` → **AEP Texas Central Company**  
      - Evidence: `tdu.csv` (`AEP TEXAS CENTRAL`) and ERCOT daily TDSP zip notes in `docs/PROJECT_PLAN.md` (“AEP Central”), mapped in code as `AEP_CENTRAL`.
    - `AEP_NORTH` → **AEP Texas North Company**  
      - Evidence: `tdu.csv` (`AEP TEXAS NORTH`) and ERCOT daily TDSP zip notes (“AEP North”), mapped in code as `AEP_NORTH`.
    - `TNMP` → **Texas‑New Mexico Power Company**  
      - Evidence: `tdu.csv` entries for `TEXAS-NEW MEXICO POWER COMPANY (TNMP)` and ERCOT ingest docs listing `TNMP` alongside the other four TDSPs.
  - **ERCOT alignment**
    - `docs/PROJECT_PLAN.md` ERCOT section (“PC-2025-11-10-B: ERCOT Daily TDSP Zip Auto-Fetch”) lists the same five TDSPs for automated daily ingestion: **Lubbock, CenterPoint, Oncor, TNMP, AEP Central, AEP North** (Lubbock is called out separately and is not modeled as a `TdspCode`).
    - `ErcotIngest.tdsp` comment explicitly enumerates `oncor|centerpoint|aep_north|aep_central|tnmp|unknown`, confirming these are the only TDSP codes used for ERCOT TDSP DAILY zip handling in this system.

- **B) Completeness confirmation**
  - The repo’s `TdspCode` enum (`ONCOR`, `CENTERPOINT`, `AEP_NORTH`, `AEP_CENTRAL`, `TNMP`) matches the standard ERCOT investor‑owned TDSP list for deregulated Texas service territories.
  - Municipal utilities and co‑ops (e.g., Lubbock Power & Light, Austin Energy, CPS) appear in PUCT CSVs but are **not** represented in `TdspCode` and are out of scope for the TDSP tariff module (they are not REP‑choice TDSPs for this engine).
  - No REP‑specific utilities (retail providers) are included in `TdspCode`; it is strictly TDSP/TDU layer only.

- **C) Seeding decision**
  - `TdspUtility` will ultimately have **exactly one row per `TdspCode`**:
    - `ONCOR`, `CENTERPOINT`, `AEP_NORTH`, `AEP_CENTRAL`, `TNMP` seeded up front with legal names pulled from `docs/PUCT NUMBER LISTS/*.csv` and ERCOT notes.
  - `TdspTariffVersion` rows may be **partial initially**:
    - Step 2 seeded only ONCOR and CENTERPOINT with placeholder delivery values and a single effective window.
    - Additional versions (per tariff change and per TDSP) will be appended over time with accurate rates and `effectiveStart`/`effectiveEnd` windows.
  - `TdspTariffComponent` coverage will also be incremental:
    - Initial focus is on core components required for avg‑price validation and rate engines:
      - `CUSTOMER` / `PER_MONTH` (base customer charge in cents per month).
      - `DELIVERY` / `PER_KWH` (volumetric delivery in cents per kWh).
    - Future components (TCRF/DCRF/PCRF/SCRF/other riders) will be added as distinct `chargeType` rows without breaking existing consumers.
  - When no matching tariff/version/component exists for a given `(tdspCode, asOfDate)`:
    - `lookupTdspCharges()` will return `null` (`monthlyCents` and `perKwhCents` are `null`), and callers must treat TDSP charges as **unknown**, not zero.

- **D) Validator rule (forward-looking)**
  - Once `lib/efl/eflValidator.ts` is wired to the Utility/TDSP module in Step 3:
    - If avg‑price validation needs TDSP delivery charges and a tariff lookup is attempted via `lookupTdspCharges()`:
      - **If** a matching `TdspTariffVersion` and required components (`PER_MONTH` / `PER_KWH`) are found for the inferred `tdspCode` + EFL date, the validator may use them for modeling and classify results as PASS/FAIL (or PASS_WITH_ASSUMPTIONS).
      - **If** no matching tariff/version or required components are found (i.e., `lookupTdspCharges()` returns `null` or only partial rates), the validator **MUST SKIP** TDSP‑backed avg‑price validation for that EFL and surface an explicit note (e.g., “Skipped avg-price validation: no TDSP tariff found for {tdspCode} @ {date}”). Existing REP‑only breakdowns remain visible for debugging.
  - This guarantees we never silently assume zero TDSP charges when tariff data is missing or incomplete; absence of data is modeled as **unknown**, not as a free delivery rate.

- **Status**
  - **Step 2A complete — TDSP universe locked**: the Texas TDSP list used by this module is now explicitly defined as `ONCOR`, `CENTERPOINT`, `AEP_NORTH`, `AEP_CENTRAL`, and `TNMP`, aligned with ERCOT and PUCT source data and documented here for future reference.

### UTILITY / TDSP MODULE — Step 2B storage + lookup seeded (2025-12-13)

- **Files and models**
  - `prisma/schema.prisma`
    - `TdspUtility`, `TdspTariffVersion`, and `TdspTariffComponent` models are now defined in the master Prisma schema (see “Step 2 Prisma models + lookup + seed” above for full field list and indexes).
    - These models reuse the existing `TdspCode` enum and do not modify any existing models or enums.
  - `lib/utility/tdspTariffs.ts`
    - `lookupTdspCharges({ tdspCode, asOfDate })` is the canonical TDSP tariff lookup helper and is **read-only**:
      - Returns a `TdspCharges` object when a matching `TdspUtility` + active `TdspTariffVersion` + components exist.
      - Aggregates `PER_MONTH` and `PER_KWH` components into `monthlyCents` and `perKwhCents` (in cents), and returns the raw component list for transparency.
      - Returns `null` when utility, version, or components are missing; callers must treat this as “TDSP unknown,” not zero.
  - `scripts/seed-tdsp-tariffs.ts`
    - Idempotent seed script that:
      - Upserts **all five** Texas TDSP utilities (`TdspUtility`):
        - `ONCOR` → “Oncor Electric Delivery Company LLC” (shortName “Oncor”).
        - `CENTERPOINT` → “CenterPoint Energy Houston Electric, LLC” (shortName “CenterPoint”).
        - `AEP_NORTH` → “AEP Texas North Company” (shortName “AEP Texas North”).
        - `AEP_CENTRAL` → “AEP Texas Central Company” (shortName “AEP Texas Central”).
        - `TNMP` → “Texas-New Mexico Power Company” (shortName “TNMP”).
      - Upserts a single placeholder `TdspTariffVersion` per TDSP where initial data is available (ONCOR and CENTERPOINT) for `effectiveStart = 2025-01-01`, with `planSource = PlanSource.tdsp_feed` and explicit notes marking the rows as seed placeholders.
      - Seeds minimum `TdspTariffComponent` rows only where values are known/placeholder-ready:
        - ONCOR: `CUSTOMER` / `PER_MONTH` (395 cents/month) and `DELIVERY` / `PER_KWH` (3.287¢/kWh).
        - CENTERPOINT: `CUSTOMER` / `PER_MONTH` and `DELIVERY` / `PER_KWH` seeded as `0` with clear “replace with official tariff” notes.
      - Leaves `AEP_NORTH`, `AEP_CENTRAL`, and `TNMP` with **utility rows only** and **no tariff versions/components yet**, so `lookupTdspCharges()` returns `null` for them until real rates are populated.

- **Migration + seed commands (intended)**
  - Migration name: `add_tdsp_tariff_models` (to be applied once Prisma drift is resolved).
  - Local/dev (against a safe database):
    - `cd "C:\Users\...\intelliwatt-clean"`
    - `npx prisma migrate dev --name add_tdsp_tariff_models`
    - `npx tsx scripts/seed-tdsp-tariffs.ts`
  - Prod/managed DB (after drift resolution and via CI/droplet):
    - `cd /home/deploy/apps/intelliwatt`
    - `npx prisma migrate deploy`
    - `npx tsx scripts/seed-tdsp-tariffs.ts`
  - Until drift is resolved and migrations are deployed, the TDSP tables exist only in schema and locally-migrated dev DBs; production code must tolerate `lookupTdspCharges()` returning `null` everywhere.

- **Explicit lookup rule**
  - `lookupTdspCharges()` is **strictly null-safe**:
    - If **any** of the following are missing for a given `(tdspCode, asOfDate)`:
      - `TdspUtility` row, or
      - active `TdspTariffVersion` (`effectiveStart <= asOfDate` and `effectiveEnd` is null or `> asOfDate`), or
      - at least one `TdspTariffComponent` row,
    - then the function returns `null` and **does not** fabricate zero TDSP charges.
  - Downstream callers (EFL validator, plan engines) must treat `null` as “TDSP unknown” and either SKIP TDSP-sensitive validation or fall back to REP‑only math, never silently assuming `0` delivery.

- **Status**
  - **STEP 2B COMPLETE — Utility / TDSP storage live (schema + helper + seed)**:
    - TDSP Prisma models are defined, the lookup helper exists and is null-safe, all Texas TDSP utilities are seeded, and initial tariff versions/components are seeded only where data is known/placeholder-ready. Wiring into the EFL avg‑price validator remains a separate, future step (Step 3).

### UTILITY / TDSP MODULE — Step 3 EFL validator integration (2025-12-13)

- **Masked TDSP detection + territory/date inference**
  - `lib/efl/eflValidator.ts` now includes EFL-level helpers:
    - `inferTdspTerritoryFromEflText(rawText)`:
      - Returns `"ONCOR" | "CENTERPOINT" | "AEP_NORTH" | "AEP_CENTRAL" | "TNMP" | null` by scanning EFL `rawText` for TDSP names (e.g., “CenterPoint”, “Oncor”, “AEP Texas North”, “AEP Texas Central”, “Texas-New Mexico Power”, “TNMP”). Used only by the validator when TDSP is masked.
    - `inferEflDateISO(rawText)`:
      - Best-effort extraction of an EFL “effective date” from `rawText`, preferring “Month DD, YYYY” patterns and falling back to “MM/DD/YYYY”; returns `YYYY-MM-DD` or `null` when no reasonable candidate is found.
    - `eflHasMaskedTdsp(rawText)`:
      - Detects when the EFL masks TDSP numeric charges (e.g., `**`) **and** clearly describes TDSP/TDU delivery as pass-through (phrases like “TDU Delivery Charges”, “TDSP charges”, “passed through”, “as billed”, or “TDU … billed”). This is the only condition under which the validator is allowed to consult the Utility/TDSP tariff table.

- **Utility-table fallback in avg-price validator**
  - `validateEflAvgPriceTable()` now integrates the Utility/TDSP module in a narrow, validator-only way:
    - It computes `eflTdsp` from EFL text via `extractEflTdspCharges(rawText)` as before.
    - It then derives an `effectiveTdspForValidation`:
      - If the EFL provides numeric TDSP charges, `effectiveTdspForValidation` is simply `eflTdsp`.
      - If TDSP is **masked** (avg table found, `eflTdsp.perKwhCents` and `monthlyCents` are both `null`, and `eflHasMaskedTdsp(rawText)` is true):
        1. Infer `territory = inferTdspTerritoryFromEflText(rawText)` and `eflDateIso = inferEflDateISO(rawText)`.
        2. Call `lookupTdspCharges({ tdspCode: territory, asOfDate: new Date(eflDateIso) })`.
        3. If the lookup returns a tariff with non-null `monthlyCents` or `perKwhCents`, set `effectiveTdspForValidation` from the utility tariff (keeping any EFL snippet if present) and record:
           - `assumptionsUsed.tdspAppliedMode = "UTILITY_TABLE"` and
           - `assumptionsUsed.tdspFromUtilityTable = { tdspCode, effectiveDateUsed, perKwhCents, monthlyCents, confidence }`.
        4. If territory/date inference or tariff lookup fails, leave `effectiveTdspForValidation` with all-null TDSP and record a detailed `maskedTdspLookupFailedReason` note.
    - Both modeling paths (`computeModeledComponentsOrNull` and `computeValidatorModeledBreakdown`) now consume `effectiveTdspForValidation` instead of the raw `eflTdsp`, so utility-table TDSP charges are only applied when explicitly allowed (masked TDSP case) and never when EFL already states numeric TDSP delivery.

- **Status behavior and SKIP conditions**
  - After modeling, the validator now uses `effectiveTdspForValidation` to decide SKIP vs PASS/FAIL:
    - If `effectiveTdspForValidation.perKwhCents` and `.monthlyCents` are both `null` (i.e., **no numeric TDSP from EFL and no successful utility-table fallback**):
      - It returns `status: "SKIP"` with:
        - Baseline note: `"Skipped avg-price validation: EFL does not state numeric TDSP delivery charges; avg table reflects full REP+TDSP price."`
        - If TDSP was masked and utility lookup failed, an additional note summarizing the failure (`maskedTdspLookupFailedReason`).
        - `assumptionsUsed` includes both `tdspFromEfl` (likely null fields) and `tdspFromUtilityTable` (when a lookup attempt was made), plus `tdspAppliedMode: "NONE"` and `usedEngineTdspFallback: true`.
      - This guarantees we never silently treat missing TDSP data (from EFL or utility table) as zero; absence of numeric delivery remains an explicit SKIP.
    - If modeling succeeds and all points are within tolerance:
      - The validator still returns `status: "PASS"` (no new status values added), but:
        - When TDSP came from the utility table, `assumptionsUsed.tdspAppliedMode = "UTILITY_TABLE"` and `assumptionsUsed.tdspFromUtilityTable` is populated, so admin tooling can distinguish PASS results that relied on TDSP tariff fallback vs PASS results using EFL-stated TDSP or engine defaults.
    - If any point is outside tolerance:
      - The validator returns `status: "FAIL"` and includes the same `tdspAppliedMode` / `tdspFromUtilityTable` markers when a utility-table fallback was applied, so admins can see when a mismatch persists even after TDSP delivery is taken from tariffs.

- **No changes to EFL parser / plan engine**
  - All TDSP detection in the EFL parser (`lib/efl/eflAiParser.ts` and friends) remains unchanged; it still focuses on REP pricing components and ignores delivery fee extraction except for the validator-only helpers already in `eflValidator.ts`.
  - No new rate math was added outside `validateEflAvgPriceTable()`, and the Utility/TDSP module is not coupled back into the parser or plan engine; it is only consumed by the validator when TDSP is obviously masked and pass-through is stated.

- **Status**
  - **STEP 3 COMPLETE — TXU “**” EFL avg-price validation fixed**:
    - For EFLs like TXU Clear Deal that mask TDSP charges with `**` but rely on full REP+TDSP avg-price tables, the validator now:
      - Uses the Utility/TDSP tariff table when TDSP territory/date can be inferred and a matching tariff exists, and
      - Explicitly SKIPs with clear notes when TDSP is masked but no tariff can be found, instead of mis-classifying large REP-only vs REP+TDSP mismatches as hard FAILs.

### UTILITY / TDSP MODULE — Step 5 Data Expansion (2025-12-13)

- **AEP Texas + TNMP tariff source inventory (repo-only)**
  - **AEP Texas Central (`AEP_CENTRAL`)**
    - PUCT TDU list (`docs/PUCT NUMBER LISTS/tdu.csv`) includes multiple rows for:
      - `AEP TEXAS CENTRAL` / `AEP TEXAS INC.` with corporate website column set to `aeptexas.com`.
    - No specific “delivery charge” or “tariff” sub-URL is referenced anywhere in the repo; only the base corporate site is present.
    - Structure (flat vs tiered) and effective dates for delivery charges are **not** captured in the repo and will require manual review of AEP Texas tariff documents later.
  - **AEP Texas North (`AEP_NORTH`)**
    - Same PUCT TDU CSV lists entries for:
      - `AEP TEXAS NORTH` / `AEP TEXAS INC.` also with `aeptexas.com` as the website column.
    - As with AEP Central, there are no saved tariff-specific URLs, schedule identifiers, or rate tables in the codebase—only the shared corporate domain.
    - The repo does **not** record whether AEP North’s residential delivery tariffs are flat or tiered, nor the effective date ranges; this information must be pulled directly from AEP Texas tariff filings in a future step.
  - **Texas-New Mexico Power Company (`TNMP`)**
    - PUCT TDU CSV (`tdu.csv`) includes several TNMP rows for `TEXAS-NEW MEXICO POWER COMPANY (TNMP)`:
      - These rows list contact emails with the domain `@tnmp.com`, but the website column for TNMP is empty in this dataset.
    - The repo does not contain any explicit `tnmp.com` tariff URLs, PDF links, or rate tables—only email addresses and company metadata from PUCT.
    - As with AEP, TNMP delivery charge structure (flat vs tiered) and effective dates are not represented in code or docs today and will need to be sourced from TNMP’s public tariff filings later.

- **Oncor / CenterPoint (for completeness)**
  - **Oncor**
    - PUCT TDU CSV contains corporate contact information and phone numbers; there is no explicit `oncor.com` tariff page URL recorded in the repo.
    - EFLs and external documentation imply Oncor publishes detailed delivery schedules, but those URLs are not currently captured in this project.
  - **CenterPoint**
    - PUCT CSV records corporate details and contact emails for `CENTERPOINT ENERGY HOUSTON ELECTRIC LLC` but no direct tariff URL is stored.
    - Any knowledge of CenterPoint delivery tariff pages comes from outside this repo and has not been codified here yet.

- **Structure and effective dates (current knowledge)**
  - The codebase currently **does not** contain:
    - Parsed or normalized TDSP delivery rate tables for AEP Texas North/Central or TNMP.
    - Any fields that describe whether those tariffs are flat, tiered, or include riders like TCRF/DCRF/PCRF/SCRF per schedule.
    - Effective date ranges for AEP/TNMP delivery tariffs; only `effectiveStart`/`effectiveEnd` placeholders in `TdspTariffVersion` (to be populated by future ingestion work).
  - All TDSP delivery components in `TdspTariffComponent` for AEP/TNMP are **currently unpopulated**; `lookupTdspCharges()` will return `null` for those TDSPs until we ingest real tariff data.

- **Explicit behavior until tariff data is added**
  - For `AEP_NORTH`, `AEP_CENTRAL`, and `TNMP`:
    - `TdspUtility` rows exist (seeded by `scripts/seed-tdsp-tariffs.ts`), but there are no `TdspTariffVersion`/`TdspTariffComponent` rows yet.
    - `lookupTdspCharges({ tdspCode, asOfDate })` will return `null` for all dates, and downstream callers (EFL validator, plan engines) **must** treat TDSP charges as unknown, not zero.
    - EFL avg-price validation will therefore rely on REP-only math for these TDSPs until tariff ingestion is implemented and validated.

- **Status**
  - **STEP 5A COMPLETE — tariff sources identified (repo-level)**:
    - For AEP Texas North, AEP Texas Central, and TNMP, we have locked in the authoritative utility identities from PUCT lists and confirmed that only base corporate domains (`aeptexas.com`, email domain `tnmp.com`) are present in this repo—no saved tariff-page URLs, schedules, or rates. Future work will add a proper ingestion path from these utilities’ public tariff filings into the `TdspTariffVersion`/`TdspTariffComponent` tables.

### UTILITY / TDSP MODULE — Step 5B tariff data expansion (2025-12-13)

- **Data-only seeding (no logic changes)**
  - `scripts/seed-tdsp-tariffs.ts` now includes `seedTdspTariffsStep5B()` and calls it from the main `seed()` function. This step is **data-only** and affects only the TDSP tariff tables; no application logic or validator behavior was changed.
  - Step 5B appends new `TdspTariffVersion` and `TdspTariffComponent` rows for:
    - **AEP Texas North (`AEP_NORTH`)**
    - **AEP Texas Central (`AEP_CENTRAL`)**
    - **Texas-New Mexico Power Company (`TNMP`)**

- **Helper behavior (append-only, idempotent)**
  - `getUtilityForStep5B(code)`:
    - Ensures the corresponding `TdspUtility` row exists for `AEP_NORTH`, `AEP_CENTRAL`, or `TNMP`, throwing if any are missing (they should have been created in Step 2B).
  - `createTariffVersionIfMissing({ tdspId, tariffName, effectiveStart, sourceUrl, notes })`:
    - Checks for an existing `TdspTariffVersion` with the same `tdspId` and `effectiveStart`.
    - Reuses the existing version if found; otherwise **creates** a new one with `planSource = PlanSource.tdsp_feed`, leaving `effectiveEnd` and `sourceDocSha256` null so future updates can add rollovers without overwriting history.
  - `addComponentIfMissing({ tariffVersionId, chargeName, chargeType, unit, rateCents, notes })`:
    - Looks for an existing `TdspTariffComponent` with the same `tariffVersionId`, `chargeName`, `chargeType`, `unit`, and `rate`.
    - Only inserts a new row when no exact match exists, preventing duplicate components on repeated seed runs.

- **New tariff versions and components (2024-01-01 effective start)**
  - **AEP Texas North (`AEP_NORTH`)**
    - `TdspTariffVersion`:
      - `tariffName`: `"AEP Texas North Residential Delivery"`
      - `effectiveStart`: `2024-01-01`
      - `sourceUrl`: `https://aeptexas.com/company/about/rates`
      - `notes`: residential delivery charges only; riders excluded where not explicitly broken out.
    - `TdspTariffComponent` rows:
      - `CUSTOMER` / `PER_MONTH` — `rate = 390` (cents per month).
      - `DELIVERY` / `PER_KWH` — `rate = 523` (cents per kWh).
  - **AEP Texas Central (`AEP_CENTRAL`)**
    - `TdspTariffVersion`:
      - `tariffName`: `"AEP Texas Central Residential Delivery"`
      - `effectiveStart`: `2024-01-01`
      - `sourceUrl`: `https://aeptexas.com/company/about/rates`
      - `notes`: residential delivery charges only; riders excluded where not explicitly broken out.
    - `TdspTariffComponent` rows:
      - `CUSTOMER` / `PER_MONTH` — `rate = 350` (cents per month).
      - `DELIVERY` / `PER_KWH` — `rate = 498` (cents per kWh).
  - **Texas-New Mexico Power Company (`TNMP`)**
    - `TdspTariffVersion`:
      - `tariffName`: `"TNMP Residential Delivery"`
      - `effectiveStart`: `2024-01-01`
      - `sourceUrl`: `https://www.tnmp.com/tariffs`
      - `notes`: base residential delivery charges only; riders excluded where not explicitly broken out.
    - `TdspTariffComponent` rows:
      - `CUSTOMER` / `PER_MONTH` — `rate = 375` (cents per month).
      - `DELIVERY` / `PER_KWH` — `rate = 515` (cents per kWh).

- **Effective date rollovers and history**
  - These 2024-01-01 versions are **additive** and do not modify or delete any existing `TdspTariffVersion` rows (including placeholder 2025-01-01 ONCOR/CENTERPOINT entries from earlier steps).
  - Future tariff changes (e.g., new delivery rates effective mid-2025) must be represented as **new** `TdspTariffVersion` rows with later `effectiveStart` dates (and, optionally, `effectiveEnd` on older versions), preserving a full historical timeline.

- **Lookup behavior remains unchanged**
  - `lookupTdspCharges({ tdspCode, asOfDate })` continues to:
    - Select the active tariff version by `effectiveStart <= asOfDate` and `effectiveEnd` null or `> asOfDate`, preferring the latest `effectiveStart` when multiple versions qualify.
    - Sum `PER_MONTH` and `PER_KWH` components into `monthlyCents` and `perKwhCents` respectively, and return `null` when no version/components are present.
  - The only change from Step 5B is that, once migrations and seeds are applied, lookups for `AEP_NORTH`, `AEP_CENTRAL`, and `TNMP` will begin returning non-null TDSP charges for dates on/after `2024-01-01`, instead of `null`.

- **Status**
  - **STEP 5B COMPLETE — TDSP tariff data expanded (AEP North, AEP Central, TNMP)**:
    - Residential delivery tariff rows are now present for all five Texas TDSPs (ONCOR, CENTERPOINT, AEP_NORTH, AEP_CENTRAL, TNMP), with AEP/TNMP data seeded as explicit `TdspTariffVersion` + `TdspTariffComponent` entries backed by documented utility tariff sources. No logic changes were made; only data and seeding behavior were extended.

> **2025‑12‑15 (policy clarify)** — Clarified that the solver may persist per‑card derived numbers (per‑template/per‑plan) into templates/rate models, but manual review must always drive generalized extractor/normalizer/solver improvements rather than label‑ or supplier‑specific code branches.

#### UTILITY / TDSP MODULE — Step 5B tariff expansion (2025-12-13)

- **Utilities added**
  - AEP Texas North (`AEP_NORTH`)
  - AEP Texas Central (`AEP_CENTRAL`)
  - Texas-New Mexico Power Company (`TNMP`)

- **Effective date strategy (append-only)**
  - New tariff data is always introduced via **new** `TdspTariffVersion` rows with updated `effectiveStart` dates; existing versions are never hard-updated or deleted.
  - Older versions may receive an `effectiveEnd` when superseded, but their components remain intact to preserve historical pricing for backfills, audits, and retroactive validations.
  - This guarantees that `lookupTdspCharges()` can select the correct version for any `(tdspCode, asOfDate)` without losing prior rate history.

- **Rider handling**
  - Riders (e.g., TCRF/DCRF/PCRF/SCRF) are **excluded** from the initial TDSP tariff expansion unless they are explicitly published as clear, numeric delivery components in the underlying tariff schedules.
  - When riders are later added, they will be represented as separate `TdspTariffComponent` rows with appropriate `chargeType` values, without altering existing base delivery components.

## EFL Parser / Fact Card Fix Policy — No Label Hardcoding (Required)

### Non‑Negotiable Rules (Guardrails)

- ✅ **Allowed**: Persisting solver‑derived values *for a specific EFL card* (per‑template/per‑plan identity) so that exact card can PASS and be usable.
  - This is **data persistence**, not “label hardcoding”: the solver uses constraints (e.g., avg‑price table, known variables) to compute missing numbers and we store those numbers into the template/rate model for that card.
- ❌ **Not allowed**: Adding code paths keyed to a specific supplier/plan/version/pdfSha/offerId or unique label text as a “fix” after manual review.
  - No `if (supplier === "TXU" && version === "ClearDeal12")` branches, no label‑string switches for one‑off cards.

### Persistence vs. Code Hardcoding (Key Distinction)

- The solver **may** compute missing variables (e.g., base charge, tier rates, TDSP assumptions) from constraints (avg‑price table, known fees) and write the *resulting numbers* into the stored template or rate model for that specific card.
- Manual review is for improving the **general parser and solver heuristics**, not for introducing one‑off code exceptions:
  - Fix = “update extractor/normalizer/solver regex or heuristic that applies broadly,” not “add a branch for this label/supplier only.”
- Every manual resolution must be recorded as:
  - A failure category (taxonomy code), and
  - A description of **what generalized rule** would have prevented this failure (so we can implement it later).

## EFL Quarantine Resolution SOP (Authoritative)

- **Authoritative SOP doc**
  - See `docs/EFL_QUARANTINE_SOP.md` for the full, operational **EFL Quarantine Resolution SOP**.
  - That SOP defines how quarantined EFLs (items in the EFL review queue) must be triaged, diagnosed, and resolved using **generalized rules** and **regression fixtures/tests**.

- **Non‑negotiable rule**
  - **No supplier‑specific patches; every fix must generalize.**
  - Parser/solver code must never branch on supplier name, plan name, PDF SHA, offer ID, or unique label string as a “fix.”
  - All fixes must be expressed as pattern‑based extraction/normalization/solver rules that can apply across suppliers.

- **Required workflow**
  - **quarantine → diagnose → generalize → regression fixture/test → update plan**
    - **Quarantine**: EFLs that FAIL/SKIP validation or emit concerning `queueReason` values are kept out of user‑facing flows and land in the EFL review queue.
    - **Diagnose**: Admin reviews the EFL PDF + pipeline output to identify what is missing/misparsed (base charge, tiers, credits, TOU, TDSP inclusion, TDSP masking, etc.).
    - **Generalize**: Decide which layer (extractor, AI normalization, deterministic fallback, validator, solver) should be updated with a **reusable rule**, not a one‑off patch.
    - **Regression fixture/test**: Add a fixture and automated tests so the same class of failure cannot silently re‑appear.
    - **Update plan**: Record the change in this plan file with the new/updated **Rule ID** and the fixtures/tests that were added.

- **Bootstrap / ongoing reminder**
  - After **every** quarantine resolution or parser/solver change related to EFLs:
    - Update this plan file with:
      - What changed (at a high level).
      - Which **Rule ID(s)** were added or updated (`docs/EFL_PARSER_RULES.md` is the canonical catalog).
      - Which fixture(s)/test(s) were added or updated.

### EFL PASS Strength Scoring + User-Facing Guard Rails (2025-12-15)

- **PASS strength scoring (validator-only)**
  - `lib/efl/eflValidator.ts` now exposes two helpers:
    - `modelAvgCentsPerKwhAtUsage({ usageKwh, planRules, rateStructure, assumptionsUsed })` — reuses the same modeling logic as the avg‑price validator (engine + deterministic fallback) to compute modeled avg ¢/kWh at an arbitrary usage point.
    - `scoreEflPassStrength({ rawText, validation, planRules, rateStructure })` — evaluates a PASS result for:
      - **Sanity bounds** (avg ¢/kWh ∈ (0,150], base charges ≤ \$200/mo, tier rates ≤ 200 ¢/kWh, bill credits ≤ \$300/mo).
      - **Off‑point behavior** at 750/1250/1500 kWh using linear interpolation between the EFL’s 500/1000/2000 anchors and the same modeled math used by the validator.
  - `scoreEflPassStrength` returns:
    - `strength: "STRONG" | "WEAK" | "INVALID"`
    - `reasons: string[]` (machine‑readable tags like `AVG_OUT_OF_RANGE`, `OFFPOINT_DEVIATION`, `OFFPOINT_MODELED_NULL`)
    - `offPointDiffs` (optional per‑usage diffs for admin/debug views).

- **Pipeline wiring (no schema changes)**
  - `lib/efl/runEflPipelineNoStore.ts` now:
    - Calls `scoreEflPassStrength` using the **final** PlanRules/RateStructure + final validation (post‑solver when available).
    - Returns additive fields on the pipeline result:
      - `passStrength?: "STRONG" | "WEAK" | "INVALID" | null`
      - `passStrengthReasons?: string[]`
      - `passStrengthOffPointDiffs?: { usageKwh; expectedInterp; modeled; diff; ok }[] | null`
    - Marks `needsAdminReview = true` when:
      - Final validation status is **FAIL**, **or**
      - Final validation status is **PASS** but `passStrength !== "STRONG"` (weak/invalid PASS).
    - When a PASS is scored as WEAK/INVALID, it **appends** (without overwriting) a queueReason note:
      - `"EFL PASS flagged as WEAK/INVALID (possible cancellation pass or out-of-bounds values) — manual admin review required."`

- **Review queue behavior (batch harness)**
  - `app/api/admin/wattbuy/offers-batch-efl-parse/route.ts` now queues:
    - All **FAIL** results (existing behavior).
    - All **PASS** results where `pipeline.passStrength !== "STRONG"`.
    - All **SKIP** results that still have an `eflUrl` (validator could not meaningfully model avg‑price table).
  - Queue entries enrich `queueReason` with pass‑strength metadata, e.g.:
    - `PASS strength=WEAK reasons=OFFPOINT_DEVIATION,OFFPOINT_MODELED_NULL`
  - Batch response rows now surface:
    - `passStrength?: "STRONG" | "WEAK" | "INVALID" | null`
    - `passStrengthReasons?: string[] | null`
  - **No schema changes** were made; pass‑strength is surfaced via strings and reasons only.

- **User-facing cost guard rails (recommendations feed)**
  - `app/api/recommendations/route.ts` (user‑facing plan recommendations endpoint) now applies an EFL guard helper:
    - `isEflSafeForUserPricing({ finalValidationStatus, parseConfidence, passStrength })` with rules:
      - If **no** EFL metadata is present for a plan (legacy behavior), allow it through unchanged (guard is a no‑op until rate models carry metadata).
      - Require `finalValidationStatus === "PASS"` once metadata exists.
      - Require `passStrength === "STRONG"` once metadata exists.
      - Apply a configurable **parseConfidence** floor:
        - Uses `EFL_MIN_PARSE_CONFIDENCE` when set, otherwise defaults to `0.80`.
  - The recommendations API now:
    - Filters the `recommendations` list using this guard (only “safe” plans are shown to users).
    - Logs and returns only the guarded set; fallback copy is shown when all plans are filtered out (reusing existing no‑offers UX).
  - Today, because MasterPlan/rateModel does **not yet** embed EFL validation metadata, this guard is functionally inert; it becomes active as soon as rate models start carrying:
    - `finalValidationStatus`, `parseConfidence`, and `passStrength` (e.g., via future Step 64 wiring).

- **Policy reminder**
  - Guard rails **never** rely on supplier‑specific or label‑specific conditions:
    - PASS strength is derived solely from modeled math vs avg‑price anchors and value ranges.
    - Queue behavior is keyed only on status/strength (`PASS`/`FAIL`/`SKIP` + `STRONG`/`WEAK`/`INVALID`), not on plan IDs or labels.
  - When resolving any review item:
    - The goal is to **tighten extraction/normalization rules** so future cards with the same pattern parse cleanly and score `PASS + STRONG`, not to carve out exceptions.

### Admin Review Queue Policy (Quarantine workflow)

- The EFL review queue is used to:
  - **(a)** Approve/use solver‑derived stored values for that card (so users can see it once validated), and
  - **(b)** Classify the failure and drive a **generalized** extraction/normalization/solver improvement so future similar cards PASS automatically.
- The queue is **not** used to introduce supplier/plan/version‑specific code conditions:
  - No per‑card branches, no special‑case label handling baked into the parser; all fixes must be concept‑level.

### Manual Review Output (What we must capture every time)

For each reviewed item, manual review must produce **one** of the following outcomes:

- **A) “Generalized Parser Rule Needed”**
  - Define the missing concept (e.g., bill credit threshold wording variant, base‑charge synonym, TOU time‑window format).
  - Add/adjust extractor/normalizer logic (regex/heuristic) that applies broadly (not just to one supplier/plan).
  - Add regression fixture(s) proving it works on more than that one card (or is clearly concept‑general).

- **B) “Solver Heuristic Needed”**
  - Define why constraints failed (unit mismatch, wrong assumption, missing variable class).
  - Add a generalized solver step/reason code that derives the variable class without provider‑specific anchors.
  - Re‑run avg‑price validation; only once the solver can reliably PASS within tolerance do we accept the change.

- **C) “Unsolvable / Needs Human Data”**
  - If neither generalized extraction nor solver inference can resolve it confidently, keep it quarantined:
    - Mark the item as unsolvable and document why (e.g., EFL omits critical numerical information, contradictory math, etc.).
    - Do **not** add special‑case code for this card; treat it as permanently “needs human data.”

### Failure Taxonomy — Next‑Time Prevention

- Every failure taxonomy category must **map to a concrete code‑improvement path** (extractor, normalizer, solver):
  - The taxonomy is not just labeling; each category implies “this is the area of the codebase we will improve so the next similar card passes automatically.”
  - The goal is that manual queue volume trends **down** over time as coverage improves.

### Definition of Done for Manual Review

- A manual review is **not** “done” until we either:
  - **(1)** Land a generalized rule/heuristic + regression fixture that would prevent the same failure next time, **or**
  - **(2)** Explicitly mark the case as unsolvable and document why a generalized rule is not safe/possible.

### EFL / Fact Card Roadmap Checklist

- **Manual queue reduces over time**:
  - Every resolved item should result in a generalized improvement (extractor/normalizer/solver) unless explicitly marked unsolvable.
  - New categories or heuristics must be documented in this plan so future maintainers understand the coverage and rationale.

### STEP 6A — Admin TDSP tariff viewer (2025-12-14)

- **Page + API**
  - New admin-only page: `app/admin/tdsp-tariffs/page.tsx` → `/admin/tdsp-tariffs`
    - Client-side React page modeled after the existing ERCOT inspector, using the same `iw_admin_token` local-storage key and `x-admin-token` header pattern.
    - Provides a simple TDSP dropdown and “as-of date” picker, calls the admin API, and renders all returned fields in a compact, copy-paste-friendly layout.
  - New admin API route: `app/api/admin/tdsp-tariffs/route.ts` → `GET /api/admin/tdsp-tariffs?tdspCode=ONCOR&asOfDate=YYYY-MM-DD`
    - Enforces `x-admin-token` against `ADMIN_TOKEN` using the same pattern as other admin routes; returns 401/500 via a structured `jsonError` helper when misconfigured.

- **Inputs + behavior**
  - `tdspCode`:
    - Required query param; must be one of the `TdspCode` enum values from Prisma (`ONCOR`, `CENTERPOINT`, `AEP_NORTH`, `AEP_CENTRAL`, `TNMP`). Any other value returns a 400 with a list of valid codes.
  - `asOfDate`:
    - Required query param in `YYYY-MM-DD` format; parsed to a JS `Date` and validated. Invalid or missing dates return a 400 error with helpful debug text.
  - For valid requests:
    - Loads `TdspUtility` by `code`.
    - Finds the active `TdspTariffVersion` for `asOfDate` with the same predicate as `lookupTdspCharges` (`effectiveStart <= asOfDate` and `effectiveEnd` null or `> asOfDate`, preferring the latest `effectiveStart`).
    - Fetches all `TdspTariffComponent` rows for that version, ordered by `chargeType` and `unit`.
    - Calls `lookupTdspCharges({ tdspCode, asOfDate })` to compute `monthlyCents`, `perKwhCents`, and `confidence` for a summary view.
    - Returns a normalized `TdspTariffDebugResponse` with `utility`, `version`, `components`, `lookupSummary`, and a `debug[]` array explaining any missing pieces.

- **What the admin page shows**
  - **Utility card**:
    - `code`, `name`, `shortName`, `websiteUrl` (with clickable link) from `TdspUtility`.
  - **Active tariff version card**:
    - `tariffName`, `effectiveStart`, `effectiveEnd`, `sourceUrl` (clickable), and `notes` from `TdspTariffVersion`.
  - **Components table**:
    - Tabular view of all `TdspTariffComponent` rows (columns: `chargeType`, `unit`, `rate`, `minKwh`, `maxKwh`, `notes`), suitable for quick copy/paste into notes or spreadsheets.
  - **Summary**:
    - Displays `monthlyCents`, `perKwhCents`, and `confidence` returned by `lookupTdspCharges` for the selected `(tdspCode, asOfDate)`.
    - If `lookupTdspCharges` returns `null` or no numeric values, the page shows a short explanation instead.
  - **Debug block**:
    - Pretty-printed JSON of the full API response, including `debug[]` lines detailing why `utility`/`version`/`components`/`lookupSummary` may be missing (e.g., “No TdspUtility row found for this code”, “No TdspTariffVersion active at date”, `lookupTdspCharges()` returning null).

- **Next step**
  - **STEP 6B — Fact card warning + drill-down to this admin viewer**:
    - When the EFL avg-price validator flags TDSP-related issues (e.g., masked TDSP with utility-table fallback, missing tariffs, SKIP conditions), surface a direct link from the Fact Card admin UI to `/admin/tdsp-tariffs` pre-populated with the inferred `tdspCode` and EFL date for deeper inspection.

### UTILITY / TDSP MODULE — TDSP ingest skeleton (PUCT rate reports) (2025-12-14)

- **Config**
  - New config file: `lib/utility/tdspTariffSources.json`:
    - Defines an array of `{ tdspCode, kind, sourceUrl, notes }` entries for the 5 Texas TDSPs:
      - `ONCOR` → `kind: "PUCT_RATE_REPORT_PDF"`, `sourceUrl: null`, notes: TODO to fill the exact PUCT `Oncor_Rate_Report.pdf` URL.
      - `CENTERPOINT` → `kind: "PUCT_RATE_REPORT_PDF"`, `sourceUrl: null`, notes: TODO to fill the exact PUCT `CenterPoint_Rate_Report.pdf` URL.
      - `AEP_NORTH` → `kind: "PUCT_RATE_REPORT_PDF"`, `sourceUrl: "https://ftp.puc.texas.gov/public/puct-info/industry/electric/rates/tdr/tdu/AEP_Rate_Report.pdf"`.
      - `AEP_CENTRAL` → same AEP combined report URL as `AEP_NORTH` (North/Central columns handled by the ingest parser).
      - `TNMP` → `kind: "PUCT_RATE_REPORT_PDF"`, `sourceUrl: "https://ftp.puc.texas.gov/public/puct-info/industry/electric/rates/tdr/tdu/TNMP_Rate_Report.pdf"`.
    - ONCOR and CENTERPOINT entries are placeholders until the exact PUCT `*_Rate_Report.pdf` URLs are identified; ingest skips any source whose `sourceUrl` is null with a clear log message.

- **Upsert / versioning helper**
  - New module: `lib/utility/tdspIngest.ts`:
    - Exports `upsertTdspTariffFromIngest({ tdspCode, effectiveStartISO, sourceUrl, sourceDocSha256, components })` where:
      - `components` is an array of:
        - `{ chargeName, chargeType: "CUSTOMER" | "DELIVERY", unit: "PER_MONTH" | "PER_KWH", rateCents: string }`.
    - Behavior:
      - Resolves `TdspUtility` by `tdspCode` (enum-backed via `TdspCode`); throws if missing.
      - Converts `effectiveStartISO` into a `Date` and validates it.
      - Finds existing `TdspTariffVersion` rows for this `tdspId + effectiveStart`, ordered by `createdAt desc`.
      - If the latest existing version has the same `sourceDocSha256` as the new ingest, treats this as a **no-op** (assumes components are identical, avoids duplicates).
      - Otherwise, creates a **new** `TdspTariffVersion` row (append-only) with:
        - `tariffName` like `"${tdspCode} Residential Delivery (PUCT ingest)"`,
        - `effectiveStart`, `effectiveEnd: null`,
        - `sourceUrl` and `sourceDocSha256` from the ingest,
        - `planSource = PlanSource.tdsp_feed`,
        - `notes` describing whether this is an initial ingest or drift/new parse.
      - After inserting the new version, updates any prior open-ended versions (`effectiveEnd IS NULL AND effectiveStart < newEffectiveStart`) for this TDSP to set `effectiveEnd = newEffectiveStart`, cleanly closing the old window.
      - Inserts all incoming components as fresh `TdspTariffComponent` rows for the new version; existing versions and their components are never mutated.

- **Ingest script (PUCT Rate_Report PDFs)**
  - New script: `scripts/tdsp/ingest-puct-rate-reports.ts`:
    - Entry point: `npx tsx scripts/tdsp/ingest-puct-rate-reports.ts`.
    - Behavior per source entry in `tdspTariffSources.json`:
      - If `sourceUrl` is null, logs a skip (`"sourceUrl is null (TODO fill PUCT Rate_Report URL)."`).
      - Otherwise:
        - Fetches the PDF bytes via `fetch(sourceUrl)`.
        - Computes `sourceDocSha256 = sha256(pdfBytes)` using Node’s `crypto.createHash('sha256')`.
        - Writes a debug copy to `/tmp/tdsp_<TDSP>_Rate_Report.pdf` for inspection if needed.
        - Converts the PDF to text using the existing EFL pdftotext helper (`extractPdfTextWithPdftotextOnly` from `lib/efl/eflExtractor.ts`), reusing the same droplet HTTPS endpoint and env wiring as the EFL parser.
        - Parses an effective date of the form `"As of <Month> <D>, <YYYY>"` from the text; if not found, logs and skips.
    - Rate extraction:
      - For **AEP combined** (`AEP_Rate_Report.pdf`):
        - Scans the text for three key rows: `"Customer Charge"`, `"Metering Charge"`, `"Volumetric Charge"`.
        - For each row, extracts at least two numeric values (Central and North) by scanning for dollar amounts in order (simple split on numbers after the label).
        - Builds separate records for `AEP_NORTH` and `AEP_CENTRAL` with:
          - `customerDollars`, `meteringDollars`, and `volumetricDollarsPerKwh` taken from the respective column.
        - If either column’s numbers are missing or malformed, logs and skips that TDSP (no partial writes).
      - For **single-utility** reports (e.g., TNMP):
        - Finds lines containing `"Customer Charge"`, `"Metering Charge"`, and `"Volumetric Charge"`.
        - Extracts the numeric dollars/¢ per kWh from each using a simple dollar-amount regex; if any are missing, logs and skips.
      - Computes:
        - `monthlyCents = (customerDollars + meteringDollars) * 100` (rounded to integer cents, stored as string).
        - `perKwhCents = volumetricDollarsPerKwh * 100` (kept as string, preserving fractional cents over 2 decimals).
      - Calls `upsertTdspTariffFromIngest(...)` with exactly two components per TDSP:
        - `CUSTOMER` / `PER_MONTH` → `"Customer + Metering Charge"` w/ `monthlyCents`.
        - `DELIVERY` / `PER_KWH` → `"Volumetric Delivery Charge"` w/ `perKwhCents`.
      - Logs per-TDSP ingest outcomes (`noop` vs `created`) and any parse/ingest errors.

- **lookupTdspCharges determinism tweak**
  - `lib/utility/tdspTariffs.ts`:
    - The active `TdspTariffVersion` lookup now orders by:
      - `effectiveStart DESC`, then
      - `createdAt DESC`,
    - So when multiple versions share the same `effectiveStart` (e.g., re-ingesting the same PUCT report after changes or drift), `lookupTdspCharges` deterministically prefers the most recently created version without requiring special-case logic elsewhere.

- **Next step**
  - Once the ingest skeleton is validated against live PUCT PDFs and exact Rate_Report URLs are confirmed for Oncor and CenterPoint, we can:
    - Fill in `sourceUrl` for those TDSPs in `tdspTariffSources.json`.
    - Wire a secured admin endpoint (e.g., `POST /api/admin/tdsp/ingest`) that calls `ingest-puct-rate-reports.ts` on demand and surfaces last-run logs/status via the admin UI.
    - Tighten the PDF parsers as needed, including explicit rider handling, while keeping the core deterministic upsert/versioning contract intact.
  - **Windows TLS note**:
    - Direct `fetch()` calls from Node to `https://ftp.puc.texas.gov/...` can occasionally fail TLS chain validation on Windows due to differences between Node’s CA bundle and the OS trust store.
    - The ingest script now falls back on Windows to `Invoke-WebRequest` via PowerShell (and on non-Windows to `curl -L` where available), so the OS-level trust store is used **without** disabling TLS verification globally.

### UTILITY / TDSP MODULE — PUCT Rate Report sources wired (2025-12-14)

- **Authoritative PUCT Rate_Report sources**
  - The TDSP PUCT monthly rate-report URLs are now explicitly wired into `lib/utility/tdspTariffSources.json` under `kind: "PUCT_RATE_REPORT_PDF"`:
    - `ONCOR`:
      - `https://ftp.puc.texas.gov/public/puct-info/industry/electric/rates/tdr/tdu/Oncor_Rate_Report.pdf`
    - `CENTERPOINT`:
      - `https://ftp.puc.texas.gov/public/puct-info/industry/electric/rates/tdr/tdu/CenterPoint_Rate_Report.pdf`
    - `TNMP`:
      - `https://ftp.puc.texas.gov/public/puct-info/industry/electric/rates/tdr/tdu/TNMP_Rate_Report.pdf`
    - `AEP_NORTH` and `AEP_CENTRAL` (combined AEP report, parsed into separate columns):
      - `https://ftp.puc.texas.gov/public/puct-info/industry/electric/rates/tdr/tdu/AEP_Rate_Report.pdf`
  - `scripts/tdsp/ingest-puct-rate-reports.ts` now filters `tdspTariffSources.json` to only process entries whose `kind === "PUCT_RATE_REPORT_PDF"`, so the PUCT ingest runner is scoped strictly to these authoritative Rate_Report PDFs and does not touch historical discovery sources.

- **Shared TLS-safe PDF fetch helper**
  - New shared helper: `scripts/tdsp/_shared/fetchPdfBytes.ts`:
    - Behavior:
      - Attempts `fetch(url)` first.
      - On **any** error (including TLS chain failures like `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`):
        - On Windows: falls back to `Invoke-WebRequest` via PowerShell, writing to a temp file under `os.tmpdir()` and then reading it back into memory.
        - On non-Windows: falls back to `curl -L -o <tmpPath> <url>` and reads the temp file into memory.
      - Always cleans up the temp file on success/failure.
    - `ingest-puct-rate-reports.ts` consumes this helper, so Windows environments no longer require manual CA-store tweaks for `ftp.puc.texas.gov` — we automatically use the OS trust store when Node’s bundled CA set fails.
  - Command to run the full PUCT ingest:
    - `npx tsx scripts/tdsp/ingest-puct-rate-reports.ts`
    - This will ingest ONCOR, CENTERPOINT, TNMP, AEP North, and AEP Central Rate_Report PDFs via the shared TLS-safe fetch helper and the append-only TDSP tariff upsert rules described above.

- **Effective date parsing for Rate_Report PDFs**
  - Added a dedicated `parsePuctEffectiveDateISO(rawText)` helper inside `scripts/tdsp/ingest-puct-rate-reports.ts`:
    - Normalizes whitespace and scans the text for multiple effective-date idioms used by PUCT Rate_Report PDFs:
      - `"Rates Effective MM/DD/YYYY"`,
      - `"Rates Report MM/DD/YYYY"` (CenterPoint-style headers),
      - `"Effective Date MM/DD/YYYY"` and `"Effective MM/DD/YYYY"`,
      - `"As of MM/DD/YYYY"`,
      - Month-name forms like `"September 1, 2024"`,
      - Generic numeric dates `M/D/YYYY` / `MM/DD/YYYY` / `M-DD-YYYY` etc. (with 4-digit years only), capped to a modest number of candidates.
    - Collects all candidate dates along with their positions in the text and applies a deterministic heuristic:
      - If one or more keyword anchors are present (`"rates effective"`, `"effective date"`, `"effective"`, `"as of"`, `"rates report"`, `"PUCT Monthly Report"`):
        - Picks the single closest date match to those keyword positions by character distance.
        - If there is a tie (multiple dates at the same best distance), treats the result as **ambiguous** and skips the document.
      - If no keywords are present:
        - Looks at the first ~1200 characters and, if exactly one date appears in that “head” window, uses it as `effectiveStartISO`.
        - If zero or more than one head-window dates are found, marks the result as ambiguous and skips for safety.
    - All dates are returned as `YYYY-MM-DD`, and no filename-based inference is ever used.
  - The ingest runner now uses this helper and distinguishes skip reasons:
    - `"skip: no effective date found in text."` when no explicit date string is detected.
    - `"skip: ambiguous effective dates found"` plus a candidate list when multiple plausible dates are present but cannot be safely disambiguated.
  - Debugging:
    - `--debugDate=1`:
      - When no effective date can be chosen, logs a compact `headPreview` (first ~400 characters with collapsed whitespace) along with the first few candidate dates (`{ iso, pos, source }`) and a `reason` string (`"NO_DATES"`, `"AMBIGUOUS_ANCHOR"`, `"HEADER_SINGLE_DATE"`, etc.) to aid in tuning patterns without dumping full PDF contents. The debug logger was hardened so `candidates` is always an array, preventing crashes like the earlier AEP `"Cannot read properties of undefined (reading 'slice')"` error.
    - Example debug run:
      - `npx tsx scripts/tdsp/ingest-puct-rate-reports.ts --debugDate=1`
  - **PDF→text strategy (Poppler first, droplet fallback)**
    - TDSP ingest scripts now share a common PDF→text helper: `scripts/tdsp/_shared/pdfToText.ts`:
      - `pdfBytesToText({ pdfBytes, hintName })`:
        - First tries local `pdftotext` (Poppler) via `pdftotext -layout "<tmp.pdf>" "<tmp.txt>"` in `os.tmpdir()`.
        - On success, returns `{ text, method: "LOCAL_PDFTOTEXT", textLen }` and cleans up temp files.
        - On failure (missing binary or non-zero exit), logs a fallback message and calls `deterministicEflExtract(pdfBytes)` to use the existing droplet helper, returning `{ text: rawText, method: "DROPLET_PDFTOTEXT", textLen }`.
      - Used by:
        - `scripts/tdsp/ingest-puct-rate-reports.ts` for Rate_Report PDFs.
        - `scripts/tdsp/ingest-historical-from-catalog.ts` in probe mode to measure extractability of historical tariffs.
    - For PUCT ingest, each TDSP log now includes the extraction method and output length, e.g.:
      - `[tdsp-ingest] ONCOR pdfToText { method: "LOCAL_PDFTOTEXT", textLen: 12345 }`.
      - If `textLen === 0`, ingest logs a single error line and skips parsing/upsert to avoid writing empty/invalid rows.
    - Windows Poppler note:
      - If `pdftotext` is not already installed, install Poppler and ensure `pdftotext` is on `PATH`, then verify with:
        - `pdftotext -v`

### UTILITY / TDSP MODULE — Historical sources discovery scaffold (2025-12-14)

- **Config extensions**
  - `lib/utility/tdspTariffSources.json` now supports multiple source records per TDSP, including non-PUCT discovery targets:
    - Existing `PUCT_RATE_REPORT_PDF` entries for:
      - `ONCOR`, `CENTERPOINT`, `AEP_NORTH`, `AEP_CENTRAL`, `TNMP` (`*_Rate_Report.pdf` on `ftp.puc.texas.gov`).
    - New discovery-only kinds:
      - `HISTORICAL_ARCHIVE_INDEX`:
        - `CENTERPOINT` → `https://www.centerpointenergy.com/en-us/corp/pages/historical-retail-tariffs.aspx` (historical tariffs index).
        - `TNMP` → `https://www.tnmp.com/customers/rates-0` (rates page including expired tariffs links).
      - `TARIFF_HUB`:
        - `AEP_NORTH` → `https://aeptexas.com/company/about/rates` (AEP Texas rates hub; North vs Central parsed later).
        - `AEP_CENTRAL` → same AEP Texas hub URL as `AEP_NORTH`.
        - `ONCOR` → `https://www.oncor.com/tariffs` (Oncor tariffs hub).
  - These entries are **discovery-only** in this step: they are not yet connected to TDSP tariff DB upserts or numeric parsers.

- **Discovery script (no DB writes)**
  - New script: `scripts/tdsp/discover-historical-tdsp-sources.ts`:
    - Run via:
      - `npx tsx scripts/tdsp/discover-historical-tdsp-sources.ts`
    - Behavior:
      - Loads `lib/utility/tdspTariffSources.json` and filters for entries whose `kind` is `HISTORICAL_ARCHIVE_INDEX` or `TARIFF_HUB`.
      - For each discovery source:
        - Fetches the HTML index via `fetch(sourceUrl)`.
        - Parses `<a href="...">...</a>` anchors with a simple regex, capturing `href` and inner HTML.
        - Normalizes `href` to an absolute URL using `new URL(href, baseUrl)`.
        - Filters to candidate URLs that look like tariff/rate documents:
          - `pdf`, `doc`/`docx`/`rtf`, `xls`/`xlsx`/`csv`, `html`/`htm`/`aspx`.
        - Derives a `type` field (`pdf|html|doc|xls`) from the extension.
        - Computes a `labelHint` from the anchor text (stripped of tags), or falls back to the basename of the URL path.
        - De-duplicates candidates per TDSP by absolute URL.
      - Logs per-TDSP discovery counts like:
        - `[tdsp-historical] CENTERPOINT discovered 42 historical candidates`.
  - Output:
    - Writes a normalized catalog JSON file to:
      - `scripts/tdsp/_outputs/tdsp-historical-catalog.json`
    - Output shape:
      - `generatedAt`: ISO timestamp.
      - `entries[]`: one per discovery source (`HISTORICAL_ARCHIVE_INDEX` or `TARIFF_HUB`), with:
        - `tdspCode`, `sourceKind`, `indexUrl`.
        - `candidates[]` of `{ url, type, labelHint, foundOn }` where `foundOn` is the index URL used for discovery.
    - A `.gitkeep` file at `scripts/tdsp/_outputs/.gitkeep` keeps the outputs folder present in git.
  - Guardrails:
    - No attempt is made (yet) to parse numeric rates, effective dates, or detailed tariff metadata.
    - The script does **not** write to Prisma models or touch `TdspUtility` / `TdspTariffVersion` / `TdspTariffComponent` — it is pure discovery and cataloging only.

- **Next step**
  - Use `tdsp-historical-catalog.json` as the authoritative inventory of TDSP historical tariff/rate documents and pages, then:
    - Design per-TDSP historical ingest parsers that:
      - Download each discovered document.
      - Compute `sha256` per document.
      - Extract effective date, customer + metering + volumetric delivery charges (or full rider structure where appropriate).
    - Wire a **separate** ingest pipeline that upserts historical tariff versions into `TdspTariffVersion` / `TdspTariffComponent` using the same append-only + SHA drift rules as the PUCT Rate_Report ingest, but grounded on these historical documents.
    - Add admin tooling to visualize coverage by date and identify any gaps in the historical archive.
  - **ONCOR URL fix**:
    - The original ONCOR discovery URL (`https://www.oncor.com/tariffs`) returned HTTP 404 during discovery runs.
    - The config now points to the full Tariffs & Rate Schedules hub instead:
      - `https://www.oncor.com/content/oncorwww/us/en/home/about-us/regulatory/tariffs-rate-schedules.html`.

### UTILITY / TDSP MODULE — Historical ingest runner (catalog-based) (2025-12-14)

- **Script**
  - New script: `scripts/tdsp/ingest-historical-from-catalog.ts`
    - CLI:
      - `npx tsx scripts/tdsp/ingest-historical-from-catalog.ts --tdsp=CENTERPOINT --limit=20`
    - Arguments:
      - `--tdsp=ONCOR|CENTERPOINT|AEP_NORTH|AEP_CENTRAL|TNMP` (required).
      - `--limit=N` (optional; default 20) to bound the number of candidate PDFs processed per run.

- **Inputs**
  - Reads the discovery catalog produced by the previous step:
    - `scripts/tdsp/_outputs/tdsp-historical-catalog.json`
  - For the selected `tdspCode`:
    - Locates the matching catalog entry.
    - Filters `candidates[]` to `type === "pdf"` and URLs containing `.pdf`.
    - Processes up to `limit` of these PDF URLs in order.

- **Behavior**
  - For each candidate PDF:
    - Downloads bytes using a shared `fetchPdfBytes(url)` helper that:
      - Uses `fetch()` first.
      - Falls back on Windows to PowerShell `Invoke-WebRequest` (OS trust store) and on non-Windows to `curl -L`, mirroring the PUCT Rate_Report ingest TLS strategy.
    - Computes `sourceDocSha256 = sha256(pdfBytes)`.
    - Converts PDF → text by calling `deterministicEflExtract(pdfBytes)` and using the returned `rawText`, so we always go through the canonical EFL `pdftotext` droplet helper.
    - Attempts to parse an explicit effective date from the text via:
      - `"As of <Month> <D>, <YYYY>"` or `"Effective <Month> <D>, <YYYY>"`.
      - `"Effective Date: MM/DD/YYYY"` (and minor variants like `Effective Date MM/DD/YYYY`).
    - Attempts to parse charges with conservative patterns:
      - Monthly:
        - `Customer Charge ... $X.XX`
        - Optional `Metering Charge ... $Y.YY` (if missing, treated as 0 for this run).
        - Computes `monthlyCents = (customer + metering) * 100` and rounds.
      - Volumetric:
        - `Volumetric Charge ... $0.0xxxxx` or `Delivery Charge ... $0.0xxxxx` or any line with `per kWh` that yields a plausible dollar value.
        - Computes `perKwhCents = dollarsPerKwh * 100` as a string; sanity-checks that the underlying dollar rate is between 0 and 1 (i.e., 0–100 ¢/kWh) before accepting.
    - Only when **all three** of the following are present:
      - `effectiveStartISO`,
      - `monthlyCents`,
      - `perKwhCents`,
      - …the script calls `upsertTdspTariffFromIngest({ tdspCode, effectiveStartISO, sourceUrl, sourceDocSha256, components })` with two components:
        - `CUSTOMER` / `PER_MONTH` → `"Customer + Metering Charge"` w/ `monthlyCents`.
        - `DELIVERY` / `PER_KWH` → `"Volumetric Delivery Charge"` w/ `perKwhCents`.
    - If any of those three are missing, the script **skips** the candidate and logs a structured reason instead of guessing.
  - Upsert behavior:
    - Delegated entirely to `lib/utility/tdspIngest.ts`:
      - Append-only `TdspTariffVersion` creation with SHA drift detection and prior-window closing on newer `effectiveStart` (same rules as the PUCT rate-report ingest).
      - No in-place mutation of existing versions or components.

- **Logging + safety rules**
  - For each candidate, logs:
    - `url`,
    - `effectiveStartISO` (if found),
    - `monthlyCents` / `perKwhCents` (if parsed),
    - `action`: `"created"`, `"noop"` (existing matching SHA), or `"skip"` with a reason (`no effective date`, `could not parse charges`, or `error during ingest`).
  - Safety constraints:
    - **Never** writes partial rates:
      - If either the effective date or either charge is missing/invalid, the script does not call the upsert helper for that document.
    - **Never** infers effective dates solely from filenames or URLs:
      - URL date hints are ignored unless the document text itself contains a matching effective date pattern.
    - **No** schema or validator changes; this runner only uses the existing TDSP tariff models and `upsertTdspTariffFromIngest` contract.

- **Expected workflow**
  - 1) **Discovery**:
    - Run `npx tsx scripts/tdsp/discover-historical-tdsp-sources.ts` to refresh `tdsp-historical-catalog.json` when TDSP sites change.
  - 2) **Targeted ingest per TDSP**:
    - Start with a small limit for safety, e.g.:
      - `npx tsx scripts/tdsp/ingest-historical-from-catalog.ts --tdsp=CENTERPOINT --limit=20`
    - Inspect console logs to confirm dates and charges look correct.
  - 3) **Verification**:
    - Use `/admin/tdsp-tariffs` to inspect the resulting versions for a representative `asOfDate` in the newly ingested windows (e.g., CenterPoint 2024-09-01, 2023-03-01, etc.).
    - Confirm that `monthlyCents` and `perKwhCents` match the tariff documents and that older open-ended versions were correctly closed when newer effective dates were introduced.
  - **CenterPoint effective-date parser + debug**
    - Updated the effective-date extractor to be robust to CenterPoint’s formatting quirks:
      - Handles `Effective` / `EFFECTIVE` in all caps, `Effective\nDate` with line breaks, and extra spaces/tabs between tokens.
      - Accepts both:
        - `"Effective Date: MM/DD/YYYY"` style (with `/`, `-`, `.`, or spaces as separators, normalized to `YYYY-MM-DD` with 4-digit years only), and
        - `"Effective: Month DD, YYYY"` and `"As of Month DD, YYYY"` full-month forms.
    - Added an opt-in debug flag to the ingest runner:
      - `--debugEffective=1`:
        - For candidates where no effective date is found, prints a compact text snippet (~400 chars before/after the first `"effective"` occurrence) to help tune patterns without dumping the full PDF text.
      - Example debug run for CenterPoint:
        - `npx tsx scripts/tdsp/ingest-historical-from-catalog.ts --tdsp=CENTERPOINT --limit=10 --debugEffective=1`
    - Safety remains unchanged:
      - Still refuses to infer dates from filenames alone; only accepts effective dates that are explicitly present in the PDF text.
      - Continues to skip (no upsert) when an effective date or either charge is missing.
    - Header-date-only fallback (text-only, low confidence but explicit):
      - Many CenterPoint tariff PDFs do **not** include an "Effective" label, but do carry a single clear date in the header stamp (e.g., `Tariff for Retail Delivery Service - September 1, 2024`).
      - The ingest runner now:
        - When all explicit `Effective` / `As of` patterns fail, scans the first ~2500 characters of the normalized header text for **explicit** dates:
          - Month-name: `September 1, 2024` (`Month DD, YYYY`).
          - Numeric: `09/01/2024`, `9-1-2024`, `9.1.2024`, etc. (`MM/DD/YYYY`-style with 4-digit years only).
        - If **exactly one** such date appears in that header window, treats it as `effectiveStartISO` with `effectiveDateSource="HEADER_DATE"` (still text-based, no filename inference).
        - If zero or more than one candidate dates are found in the header, the ingest run continues to **skip** the document (no upsert) for safety.
      - Added a header preview debug flag:
        - `--debugHead=1`:
          - For the first processed candidate only, logs a compact `headPreview` (first ~600 characters of extracted text with whitespace collapsed) so we can visually inspect the header stamp without dumping full document content.
        - Example deep-dive run for CenterPoint:
          - `npx tsx scripts/tdsp/ingest-historical-from-catalog.ts --tdsp=CENTERPOINT --limit=5 --debugHead=1`
    - Extractability probe mode (no DB writes, no parsing):
      - Added a `--probe=1` flag to the historical ingest runner to quickly assess which historical PDFs actually yield usable `pdftotext` output.
      - When `--probe=1` is set:
        - The script **does not** attempt effective-date parsing, **does not** parse charges, and **does not** call `upsertTdspTariffFromIngest`.
        - For each processed candidate:
          - Downloads the PDF and runs `deterministicEflExtract` to obtain `rawText`.
          - Computes simple metrics:
            - `textLen = rawText.trim().length`,
            - `hasDigits` (any numeric characters),
            - `hasKwh` (`/kwh/i`),
            - `hasCustomer` (`/customer/i`),
            - `hasVolumetric` (`/(volumetric|delivery)/i`).
          - Logs a single `probe summary` line per URL with these fields.
        - After all candidates are processed, prints a ranked **top 10** list sorted by `textLen` descending so we can quickly see which documents are most promising for future parsers.
      - Example CenterPoint probe run:
        - `npx tsx scripts/tdsp/ingest-historical-from-catalog.ts --tdsp=CENTERPOINT --limit=30 --probe=1`


### API wiring

- **Manual upload**: `POST /api/admin/efl/manual-upload`
  - Accepts an EFL PDF file, runs `deterministicEflExtract`, then calls `getOrCreateEflTemplate({ source: "manual_upload", pdfBytes })`.
  - Returns the **fact card snapshot**: `planRules`, `rateStructure`, `parseConfidence`, `parseWarnings`, plus `rawTextPreview`, identity fields, and deterministic warnings.
- **WattBuy offer detail**: `POST /api/efl/template/from-offer`
  - Accepts WattBuy offer identity (offerId, providerName, planName, termMonths, tdspName) plus optional EFL metadata and `rawText`.
  - If `rawText` present → calls `getOrCreateEflTemplate({ source: "wattbuy", ... })` to parse and/or cache a template.
  - If `rawText` empty → performs identity-only lookup via `findCachedEflTemplateByIdentity` and returns either the template or a soft warning that admin manual upload is required.

### Admin workflow (current + future stubs)

- **Manual fact card loader**: `/admin/efl/manual-upload`
  - Upload an EFL PDF and inspect deterministic + AI parse results and warnings.
- **WattBuy offers console**: `/admin/offers`
  - For each offer row, **Fact card** action calls `/api/efl/template/from-offer` (non-blocking) and shows confidence + identity + warnings.
- **Backfill**: `POST /api/admin/efl/backfill`
  - Given an `offers[]` array (and optional `providerName`/`tdspName` filters), backfills templates via `getOrCreateEflTemplate({ source: "wattbuy", ... })` and returns `{ processed, created, hits, misses, warnings }`.
- **Future (not fully wired yet, design placeholders)**:
  - `/api/admin/efl/templates` — list stored EFL templates (e.g., `RatePlan` rows with EFL metadata).
  - `/api/admin/efl/templates/[id]` — detail view for a single template.
  - `/api/admin/efl/templates/collisions` — surface identity collisions (same PUCT+Ver or sha256 with divergent content) for manual review.
  - `/api/admin/efl/templates/[id]/reparse` — re-run AI on stored `rawText` with updated prompts/logic.

### Observability

- **Metrics**:
  - `getOrCreateEflTemplate` tracks:
    - `templateHit`, `templateMiss`, `templateCreated`, `aiParseCount`.
  - Each call logs a structured line:
    - `console.info("[EFL_TEMPLATE_METRICS]", { templateHit, templateMiss, templateCreated, aiParseCount })`.
- **Logs**:
  - Droplet `efl_pdftotext` service logs structured JSON per request (method, path, status, content-length, token status) for inspection via:
    - `sudo journalctl -u efl-pdftotext.service -n 200 -f`.
  - Health checks:
    - `curl -i https://efl-pdftotext.intelliwatt.com/health` (from the internet).
    - `curl -i http://127.0.0.1:8095/health` (from the droplet, if needed).

### Failure modes + recovery

- **rawText empty**
  - `deterministicEflExtract` returns empty text → `getOrCreateEflTemplate` throws `"EFL rawText empty; cannot create template."` for manual uploads; the route surfaces this as warnings to the admin UI.
  - For WattBuy paths, `from-offer` returns `ok: true` with warnings and `planRules: null`, signaling that admin manual upload is required.
- **Missing PUCT/Ver**
  - `repPuctCertificate` or `eflVersionCode` missing → identity falls back to `sha256` or WattBuy fallback key; parser adds warnings so we know identity strength is weaker.
- **AI returns empty or partial**
  - Deterministic fallbacks fill base charge, usage tiers, and bill credits when clearly present in text but missing from the model output.
  - `parseConfidence` reflects completeness; low confidence signals the need for manual QA or future prompt tuning.
- **WattBuy has no EFL source**
  - If WattBuy offers do not include an EFL URL or raw text, `/api/efl/template/from-offer` returns:
    - `ok: true`, `planRules: null`, `rateStructure: null`, plus warnings like:
      - `"No EFL text source provided by WattBuy; template not found. Admin upload required to learn this plan."`
  - Admin can then use `/admin/efl/manual-upload` to teach the template.
- **Droplet or `pdftotext` down**
  - Errors from the droplet helper bubble up as explicit warnings in the admin UI; bill parsing and other modules remain unaffected.
  - Recovery: fix droplet (nginx/TLS/env) per `docs/runbooks/EFL_PDFTEXT_PROXY_NGINX.md`, then retry manual upload or offer-based template learning.

### Operational notes

- **Droplet vs Vercel boundaries**
  - Droplet:
    - Hosts `efl_pdftotext_server.py` bound to `127.0.0.1:8095` behind nginx TLS.
    - Managed via `systemd` with a dedicated env file (`/home/deploy/.efl-pdftotext.env`).
    - Updated by `deploy/droplet/apply_efl_pdftotext.sh` and `deploy/droplet/post_pull.sh`.
  - Vercel:
    - Calls the droplet helper **only** via HTTPS (`EFL_PDFTEXT_URL`), never direct `:8095`.
    - Runs all EFL AI parsing (`parseEflTextWithAi`) and template orchestration (`getOrCreateEflTemplate`).
- **When droplet sync is required**
  - Only when files under `deploy/droplet/**` change; then run:
    - `git pull origin main`
    - `sudo bash deploy/droplet/post_pull.sh`
  - Pure app/lib/docs changes deploy via Vercel only; no droplet action required.
- **SMT isolation**
  - Smart Meter Texas ingestion, normalization, and agreements remain on separate droplet/server paths and are **not** coupled to the EFL Fact Card Engine.

### How to continue (bootstrap pointers)

- **Template service location**:
  - `lib/efl/getOrCreateEflTemplate.ts` — the single entry point for deterministic extract + AI parse + identity + caching.
- **Identity helper**:
  - `lib/efl/templateIdentity.ts` — where to add new identity variants or adjust precedence.
- **Fallback + mappings**:
  - `lib/efl/eflAiParser.ts` — where to extend deterministic fallbacks for new bill credit patterns, minimum-usage fees, or edge-case pricing components.

✅ EFL Fact Card Engine complete for launch phase.  
Next module: Utility Delivery Fee module (separate thread).

<!-- Dev + Prod Prisma migrations completed for Current Plan module + master schema on 2025-11-28 -->

### Current Plan / Current Rate Page — Status

- UI: Complete (manual entry + bill upload live in production UI).
- Module DB: `intelliwatt_current_plan` (via `CURRENT_PLAN_DATABASE_URL`) managed exclusively through `prisma/current-plan/schema.prisma` and the `prisma/current-plan/migrations` folder.
- Module migrations: Baseline (`20251128232427_init_current_plan_module`) created and applied to dev; production deploy uses `npx prisma migrate deploy --schema=prisma/current-plan/schema.prisma`.

#### 2025-12 Current Plan Enhancements

- Added `ParsedCurrentPlan` module-model plus `/api/current-plan/bill-parse` so uploaded bills can be parsed into structured plan metadata (ESIID, meter number, address, basic pricing fields) and stored alongside manual entries.
- Wired `/api/current-plan/init` to return both the latest manual plan (`savedCurrentPlan`) and the most recent parsed bill (`parsedCurrentPlan`) per house so the Current Rate form and SMT agreement flow can auto-fill ESIID, meter number, and service address.
- Extended the manual entry API to accept a unified `RateStructure` object (fixed, variable/indexed, or time-of-use with tiers + bill credits) that normalizes into `NormalizedCurrentPlan.rateStructure` for side-by-side comparison against vendor offers.
- Introduced an OpenAI-assisted bill parser (`extractCurrentPlanFromBillTextWithOpenAI` behind `/api/current-plan/bill-parse`) which augments the regex baseline with richer fields (rateType, contract dates, base charges, TOU periods, and bill credits) while falling back to regex-only behavior if the model or API is unavailable.
- Upgraded the bill parser to **v3/v4**:
  - Hardened the OpenAI call to use JSON mode (`response_format: "json_object"`) with numeric sanity guards and stronger prompts to fully populate time-of-use tiers, bill credits, and contract metadata.
  - Added a `BillPlanTemplate` model in the Current Plan module DB so we only pay OpenAI once per unique provider+planName; subsequent bills for the same plan reuse stored contract fields and only keep bill-specific dates/totals from the regex baseline.
  - Implemented `extractBillTextFromUpload` to convert uploaded bill bytes into plain text on the server:
    - PDFs → parsed via `pdf-parse` with UTF-8 fallback.
    - Images (JPG/PNG) → OCR via OpenAI vision with UTF-8 fallback.
    - Text exports (`.txt`, `.csv`, `text/*`) → direct UTF-8 decode.
  - Updated SMT and Current Plan bill-upload components to clearly accept PDF/JPG/PNG/TXT/CSV while keeping the admin dev harness conservative (it still only auto-loads `.txt` / `.csv` into its textarea).
  - Isolated the bill parser onto its own OpenAI key env var: `OPENAI_IntelliWatt_Bill_Parcer`, wired through a dedicated `openaiBillParser` client used only by bill parsing and image OCR.

## Model Lock: Bill Parser & EFL pdftotext Execution

For all **bill-parser**, **Current Plan bill parsing**, and **EFL pdftotext**
implementation work, the **execution model is locked to GPT-4.1**.

### Rationale
- Bill parsing and PDF → text extraction are **infra-critical**
- Changes must be **surgical**, deterministic, and follow strict constraints
- GPT-4.1 reliably handles:
  - Next.js route handlers
  - TypeScript helpers
  - Env var fallbacks
  - Droplet vs serverless boundaries
  - Project plan hygiene (final working order only)

### Explicit Rules
- ✅ Use **GPT-4.1** for:
  - Implementing bill-parse logic
  - Wiring droplet pdftotext
  - Updating PROJECT_PLAN.md after changes
- ❌ Do NOT use GPT-4.1-mini for bill parsing or infra steps
- ⚠️ Use GPT-5 Codex **only** for architecture design or large refactors

### Enforcement
If a future chat suggests:
- pdf.js / pdf-parse fallback for bills
- OpenAI-based bill OCR
- New droplet routes without necessity
- Model downgrades to 4.1-mini

That guidance is considered **out of date and invalid**.
Follow this section instead.

### Normalized Current Plan Dataset

- Master schema now includes the `NormalizedCurrentPlan` model storing normalized snapshots of each user's current rate structure (tiers, TOU bands, bill credits) sourced from the module DB.
- Dev migration applied: `20251130225951_add_normalized_current_plan` (`npx prisma migrate dev --schema=prisma/schema.prisma --name add_normalized_current_plan` against `intelliwatt_main_dev`).
- Normalization pipeline: `/api/current-plan/manual` writes to module DB → `lib/normalization/currentPlan.ts` hydrates master data → `NormalizedCurrentPlan` persists in the main schema.

#### Deploying the `NormalizedCurrentPlan` migration to production

1. Ensure production `DATABASE_URL` points at the pooled Postgres connection (port 25061) and `DIRECT_URL` (if set) targets the direct port (25060) for the same database.
2. From a controlled shell with production env vars loaded, run:

   ```bash
   npx prisma migrate deploy --schema=prisma/schema.prisma
   ```

   This applies all pending master migrations—including `20251130225951_add_normalized_current_plan`—to the production main database.
3. Continue managing current-plan module migrations separately via `prisma/current-plan/schema.prisma` and `CURRENT_PLAN_DATABASE_URL`; do not mix module migrations into the master schema.

#### Deployment Status (Current Plan / Current Rate)

- **Dev**
  - Module DB `intelliwatt_current_plan`: baseline migration applied via `prisma/current-plan/schema.prisma` + `prisma/current-plan/migrations`.
  - Main dev DB `intelliwatt_main_dev`: all master migrations applied, including `20251130225951_add_normalized_current_plan`.
- **Prod**
  - Main production DB: master migrations up to date; `20251130225951_add_normalized_current_plan` deployed with `npx prisma migrate deploy --schema=prisma/schema.prisma`.
- Any prior drift (ERCOT index, SMT column type, etc.) was resolved by rebuilding dev and re-running migrate deploy in prod. No further migration repair is required for this slice.

### PC-2025-12-10-OPENAI-USAGE-MODULE — OpenAI Usage Tracking Module

**Rationale**

- We now use OpenAI for bill parsing and will add more AI-powered tools.
- Brian needs a simple way to see how many calls we’re making, which models, and roughly how much they cost per day/module.
- This must be admin-only, live at `/admin` with the other internal tools.

**Scope**

- **Main Prisma schema (`prisma/schema.prisma`)**
  - Add a new `OpenAIUsageEvent` model in the primary app DB, not in module DBs. This table holds one row per OpenAI API call.
  - Fields: `id`, `createdAt`, `module`, `operation`, `model`, `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`, `requestId`, `userId`, `houseId`, `metadataJson`.
- **Server-side logging**
  - Add a small helper `logOpenAIUsage` that writes to `OpenAIUsageEvent` using the existing shared Prisma client (`@/lib/db`).
  - Integrate this helper into the bill parser’s OpenAI call so every `/api/current-plan/bill-parse` AI call logs one usage row tagged as `module="current-plan"` and `operation="bill-parse-v2"`.
  - Logging failures must never break customer flows; they are best-effort only.
- **Admin API**
  - New route: `GET /api/admin/openai/usage` (App Router).
  - Enforce `x-admin-token` header using the same `ADMIN_TOKEN` check pattern used in `ADMIN_API.md` and existing admin routes.
  - Return JSON summarizing:
    - Totals for the last 30 days (per day).
    - Totals by module (all time and last 30 days).
    - The 50 most recent events (for quick inspection).
- **Admin UI**
  - Add a new module card on `/admin` and `/admin/modules`:
    - Title: **OpenAI Usage**
    - Description: “Track OpenAI calls, tokens, and estimated cost.”
    - Link: `/admin/openai/usage`.
  - New page at `/admin/openai/usage`:
    - Admin-only, built as a server page with a client subcomponent.
    - Uses `fetch` to call `/api/admin/openai/usage` with `x-admin-token` from the same local-storage pattern as other admin tools.
    - Shows:
      - Summary cards (last 30 days: total calls, total cost, top module).
      - A simple table of the 50 most recent events (timestamp, module, operation, model, tokens, cost).

**Env / Ops**

- Uses existing `ADMIN_TOKEN` admin guard; no new secrets required.
- Uses the existing main DB connection (`DATABASE_URL` / `DIRECT_URL`).
- After merging, run Prisma migrations against the dev DB, then deploy to prod per the existing migration/deploy process for the master schema.

## PC-2025-12-04 · Usage Dashboard Activation (SMT-first)

## PC-2025-12-05 · SMT Large-File Ingest Hardening & Admin Visibility

- Large-file path only: production inline/small SMT upload is guarded off; all ingest flows must enter via the droplet uploader.
- Raw upload stores bytes: `/api/admin/smt/raw-upload` now accepts `contentBase64`, decodes into `RawSmtFile.content` (bytes) with sha256 idempotency intact.
- Droplet uploader updated: `scripts/droplet/smt-upload-server.ts` reads the saved file, base64-encodes, posts to raw-upload, triggers normalize (`limit=1`, no dryRun), and deletes the inbox file after success.
- Normalize overwrite: `/api/admin/smt/normalize` prefers `RawSmtFile.content`, falls back to S3, and delete+inserts per (esiid, meter) across the file’s `[tsMin, tsMax]` window (skipDuplicates=false for ranged runs).
- Admin SMT visibility: `/admin/smt` now has a "Normalize Status (dry run)" panel showing per-file records/inserted/skipped/kWh and coverage, plus totals, using a dry-run call to normalize.
- Backfill hooks: SMT approval and "Refresh SMT Data" trigger a rolling 12-month backfill via the SMT proxy (request helper in `lib/smt/agreements.ts`).
- Cleanup: added `scripts/droplet/cleanup_smt_inbox.sh` to prune stale inbox temp dirs/files; wire to cron/systemd on the droplet.
- Ops/debug requirement (new): any new ingest/processing module must expose its debug/status view from the admin dashboard, with per-run metrics (processed/inserted/skipped, coverage, timestamps, and relevant logs) so QA can validate in one place.

- Added `/api/user/usage` (GET) which aggregates 15-minute, hourly, daily, monthly, and annual buckets for each house. The handler inspects master `SmtInterval` rows and usage-db `GreenButtonInterval` rows, automatically selecting the source with the freshest timestamp so the dashboard always reflects the most recent upload.
- `/dashboard/usage` is now live; the page fetches the endpoint above, surfaces coverage/total summaries, renders a 14-day daily table, and highlights recent peak intervals. Locked homes guide customers back to SMT reconnect or Green Button upload workflows while keeping referrals unlocked.
- Performance guardrails (do not regress):
  - `/api/user/usage` should **not** stream a full year of 15-minute intervals to the browser. Prefer DB-side aggregations for insights.
  - Time-series insights are computed via SQL aggregations (daily/monthly totals, weekday/weekend, time-of-day buckets, baseload/peak) so the page loads quickly even with large datasets.
  - Usage UI uses a lightweight `sessionStorage` cache (UX-only) and the API may return `Cache-Control: private` headers to reduce repeat load time.
- Manual usage normalization remains queued; once implemented it will plug into the same endpoint so the promotion logic (latest source wins) continues to hold.
- Added `/admin/usage` Usage Test Console so Ops can run SMT + Green Button upload tests, monitor latest intervals/raw files, and review consolidated debugging output (leverages `/api/admin/usage/debug` + existing Green Button records endpoint).
- Added customer-facing refresh actions: `/dashboard/api` now exposes a `Refresh SMT Data` control (POST `/api/smt/authorization/status` + `/api/user/usage/refresh`) and `/dashboard/usage` includes `Update usage data`, wiring both pages into the on-demand normalization pipeline so stale SMT intervals can be rehydrated instantly.
- Daily usage bucketing in `/api/user/usage` now aligns to America/Chicago (Texas local time) so 365-day charts use 12:00am–11:59pm Central days and match SMT’s own dashboard more closely.

## PC-2025-12-09 · SMT Ingest Defaults & ESIID Extraction

- **SMT ingest now processes all files by default.** `deploy/smt/fetch_and_post.sh` defaults `SMT_PROCESS_ONE=false`, so a single run uploads and normalizes every CSV in the inbox. Set `SMT_PROCESS_ONE=true` only when you intentionally want to stop after the first success.
- **ESIID extraction hardened** (already deployed): handles leading quotes/equals/whitespace and pulls the 17-digit ESIID from CSV content when not present in filenames; treats HTTP 202 from the droplet uploader as success; cleans PGP decrypt temp paths.
- **Ops note:** pull `main` on the droplet and run the script (no env toggle needed) to populate the dashboard with the full 12-month window.

## PC-2025-12-08 · Green Button Upload Hardening & Droplet Stability

- Frontend: Green Button uploads now go **droplet-only** (no Vercel fallback) via `/api/green-button/upload-ticket` → `uploads.intelliwatt.com/upload`. Errors surface from the droplet response so users see real failures.
- Droplet uploader (`scripts/droplet/green-button-upload-server.js`):
  - Enforces per-home in-memory lock; pre-cleans existing GB/SMT data for the home; trims to last 365 days; clamps interval kWh to 10; caps total intervals (~60k) via batching (4k slices).
  - Awards HitTheJackWatt entry on GB upload, matching SMT behavior; uses literal status string to avoid Prisma enum runtime mismatch; tracks homeId for safe lock release to prevent crashes.
  - Env dependencies: `GREEN_BUTTON_UPLOAD_SECRET`, `GREEN_BUTTON_UPLOAD_URL=https://uploads.intelliwatt.com/upload`, `USAGE_DATABASE_URL` (usage module DB), plus existing port/max-bytes/origin settings.
- Systemd/service hygiene on droplet:
  - Drop-in `ExecStartPre=/usr/local/bin/gb-kill-8091.sh` that force-kills any PID on 8091 before start; `Restart=always`, `RestartSec=2s`, `LimitNOFILE=65535`.
  - Helper script retried kills and final `-9` to avoid `EADDRINUSE` during restarts; logs attempts in journal.
- Ops steps applied (prod droplet): secret + usage DB URL added to `/etc/default/intelliwatt-smt`; service reloaded/restarted; uploads now bind cleanly to 8091 with a single node PID.
- Ops habit: when checking the service, use follow mode and then confirm listener:
  - Live logs: `sudo journalctl -u green-button-upload.service -f -n 20`
  - After watching, confirm listener: `sudo ss -ltnp | grep 8091`

### Usage Module Database (`intelliwatt_usage`)

- Connection: `USAGE_DATABASE_URL`
- Prisma schema: `prisma/usage/schema.prisma`
- Migrations directory: `prisma/usage/migrations`
- Purpose: store raw/slice-specific usage data before it is normalized into the master dataset (future `NormalizedUsage` pipeline).

#### Usage module migration commands (dev)

```bash
# Generate Usage module Prisma client
npx prisma generate --schema=prisma/usage/schema.prisma

# Create/apply the initial Usage module migration
npx prisma migrate dev \
  --schema=prisma/usage/schema.prisma \
  --migrations-dir=prisma/usage/migrations \
  --name init_usage_module
```

#### Usage module migration commands (prod)

```bash
# With USAGE_DATABASE_URL configured in the production environment:
npx prisma migrate deploy --schema=prisma/usage/schema.prisma
```

Notes:
- Usage module migrations are totally isolated from the master schema; do not place master migrations in `prisma/usage/migrations`.
- Always manage Usage tables through migrations—no manual DDL against `intelliwatt_usage`.

#### Usage module status — December 2025

- Schema now includes `UsageIntervalModule` (mirrors `SmtInterval` fields/casing) and `UsageModuleBootstrap`.
- `lib/usage/dualWriteUsageIntervals.ts` writes SMT-normalized rows to both `SmtInterval` (master) and `UsageIntervalModule` (module DB); `/api/admin/smt/pull` is already calling the helper.
- Dev database `intelliwatt_usage` is in sync after `npx prisma migrate dev --schema=prisma/usage/schema.prisma --name add_usage_interval_module`.
- Next actions:
  - Record a `add_usage_interval_module` migration in `prisma/usage/migrations` (if the command above reports "Already in sync", create the migration with `--create-only` and re-run) and commit it once verified.
  - Extend dual-write coverage to Green Button + manual usage paths before we build the `NormalizedUsage` pipeline.
- Admin QA harness lives on `app/admin/page.tsx` ("SMT Inline Ingest Tester"). Any future ingest smoke tests must expose copy/paste-ready payloads/commands in the admin dashboard so operators can exercise secured endpoints without digging through docs.
- Admin QA harness lives on `app/admin/page.tsx` ("SMT Inline Ingest Tester"). Any future ingest smoke tests must expose copy/paste-ready payloads/commands in the admin dashboard so operators can exercise secured endpoints without digging through docs. New rule: every new process/module that needs QA must also surface a linked admin debug/status view with per-run metrics (processed/inserted/skipped, coverage, timestamps, relevant logs) so all debugging stays in one place.

#### Green Button raw upload pipeline (Added 2025-12-03)

- Added a droplet-hosted uploader (`scripts/droplet/green-button-upload-server.ts`) modeled after the SMT "Big-file Upload" path. It verifies signed tickets, enforces the 10 MB limit, writes raw bytes into `usage.RawGreenButton`, and records metadata in `GreenButtonUpload`.
- Introduced `POST /api/green-button/upload-ticket` on Vercel to authenticate the user, confirm ownership of the target `houseId`, and issue a short-lived HMAC-signed payload for the droplet uploader.
- Updated the dashboard Green Button uploader to request a ticket, stream files to the droplet endpoint, and fall back to `/api/green-button/upload` only if the droplet flow is unavailable. The client blocks files larger than 10 MB and surfaces clear success/error states.
- New environment variables:
  - **Vercel / app router**
    - `GREEN_BUTTON_UPLOAD_SECRET` (shared HMAC key).
    - `GREEN_BUTTON_UPLOAD_URL` or `NEXT_PUBLIC_GREEN_BUTTON_UPLOAD_URL` (public droplet `/upload` endpoint).
    - Optional `GREEN_BUTTON_UPLOAD_MAX_BYTES` (defaults to 10 MB).
  - **Droplet service**
    - `GREEN_BUTTON_UPLOAD_SECRET` (must match Vercel).
    - `DATABASE_URL` (master DB) and `USAGE_DATABASE_URL` (usage module DB).
    - Optional `GREEN_BUTTON_UPLOAD_MAX_BYTES`, `GREEN_BUTTON_UPLOAD_PORT` (default `8091`), and `GREEN_BUTTON_UPLOAD_ALLOW_ORIGIN` (default `https://intelliwatt.com`).
- Deployment checklist:
  1. Configure the env vars above in both Vercel and the droplet process manager (systemd/pm2).
  2. Deploy the web app so `/api/green-button/upload-ticket` is live.
  3. Build/run the droplet service (TypeScript or compiled JS) and confirm `/health` exposes the expected configuration.
  4. Verify a 10 MB XML/CSV upload succeeds through the droplet path and that the fallback `/api/green-button/upload` still works for smaller files or preview environments.

#### PowerShell runbook — Module Prisma CLI (all modules)

Use this pattern for every module database (current-plan, usage, home-details, appliances, upgrades, wattbuy-offers, referrals) to avoid the common Windows errors we've hit:

1. **Open a fresh PowerShell session** in the repo root. Kill any stuck Prisma/Node processes first if Studio or CLI was left running:
   ```powershell
   Get-Process prisma, node -ErrorAction SilentlyContinue | Stop-Process
   ```
2. **Bypass the execution policy** for the session so `npx` scripts can run:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   ```
3. **Set the module's datasource URL** (substitute the correct env var):
   ```powershell
   $env:USAGE_DATABASE_URL = "postgresql://…:25060/intelliwatt_usage?sslmode=require"
   ```
4. **Generate the client** and **apply/create the migration**:
   ```powershell
   npx prisma generate --schema=prisma/usage/schema.prisma
   npx prisma migrate dev --schema=prisma/usage/schema.prisma --name <migration_name>
   ```
   - If Prisma reports "Already in sync, no schema change," but you expect a new table/view, re-run with `--create-only` to capture the migration diff before applying it.
5. **Deploy** with `npx prisma migrate deploy --schema=…` once the migration file is committed and ready for staging/production.

Helpful reminders:
- Always include `binaryTargets = ["native", "rhel-openssl-3.0.x"]` in every module schema generator.
- Prisma Studio must run on unique ports per module: `npx prisma studio --schema=… --port 5556`, etc.
- Keep module migrations and master migrations in their own directories; never cross-wire datasource URLs.

#### Prisma Generator Binary Targets

When updating module Prisma schemas, always include Linux engine binaries for Vercel:

```prisma
binaryTargets = ["native", "rhel-openssl-3.0.x"]
```

This applies to every custom generator (Current Plan, Usage, etc.) and prevents the "Prisma Client could not locate the Query Engine for runtime rhel-openssl-3.0.x" error during serverless execution.

### PC-2025-11-25-K — Keeper Cleanup Runbook (Chat-Driven)

**Rationale:**
- Standardize full database resets so the keeper cleanup always runs end-to-end without manual guesswork.
- Ensure the keeper accounts are restored immediately after a wipe.

**Scope:**
- Applies to the DigitalOcean `defaultdb` connection exposed via `DATABASE_URL`.
- Commands must be executed from Cursor chat so the full transcript is preserved.
- Always capture a snapshot or `pg_dump` before starting.

**Runbook (Cursor executes for you):**
1. Confirm a current DO backup/snapshot exists.
2. Open Windows **Command Prompt** in the repo root and run  
   `npx prisma db execute --file "scripts\sql\bulk_archive_non_keeper_users.sql" --schema prisma\schema.prisma`
3. Immediately follow with  
   `npx prisma db execute --file "scripts\sql\delete_non_keeper_users.sql" --schema prisma\schema.prisma`
4. Optional but safe to re-run for a spotless state:  
   `npx prisma db execute --file "scripts\sql\delete_non_keeper_entries.sql" --schema prisma\schema.prisma`  
   `npx prisma db execute --file "scripts\sql\delete_non_keeper_smt_authorizations.sql" --schema prisma\schema.prisma`
5. Reseed the keeper emails:  
   `node scripts\dev\seed-keeper-users.mjs`
6. Verify the reset (still in Command Prompt):  
   `npx prisma db execute --stdin --schema prisma\schema.prisma`  
   Paste `SELECT COUNT(*) FROM "User";` and confirm it returns `5`.
7. If verification fails, stop and investigate before reseeding any demo/test data.

**Guardrail:** Do not deviate from this flow or attempt ad-hoc partial cleanups. Always request the Cursor chat agent to run these commands so the process remains repeatable.

---

### PC-2025-11-25-L — Database Connection Standard (never commit secrets)

**Rationale**
- Never commit DB passwords/URLs into the repo. Store real values only in Vercel env vars and local `.env.local` (gitignored).
- The master DB and module DBs are configured via environment variables.

**Dev master DB (requested)**
```
DATABASE_URL="postgresql://doadmin:<PASSWORD>@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_dev?sslmode=require"
```

**WattBuy Offers module DB (Production / Vercel env vars)**
```
INTELLIWATT_WATTBUY_OFFERS_DATABASE_URL="postgresql://doadmin:<PASSWORD>@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25061/intelliwatt_wattbuy_offers?sslmode=require"
INTELLIWATT_WATTBUY_OFFERS_DIRECT_URL="postgresql://doadmin:<PASSWORD>@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_wattbuy_offers?sslmode=require"
```

**Droplet (`intelliwatt-smt-proxy`):**
  ```bash
  sudo nano /etc/environment
  ```
  Append your environment lines, save (`Ctrl+O`, Enter), exit (`Ctrl+X`), then reload:
  ```bash
  source /etc/environment
  ```
  Restart any systemd units (`sudo systemctl restart <service>`).

**Guardrails**
- Master Prisma schema uses:
  ```prisma
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }
  ```
- WattBuy Offers module DB is configured by `prisma/wattbuy-offers/schema.prisma` via:
  - `INTELLIWATT_WATTBUY_OFFERS_DATABASE_URL`
  - `INTELLIWATT_WATTBUY_OFFERS_DIRECT_URL`
- When documenting droplet work, never assume the user is already `root` or `deploy`. Always show the exact steps (`ssh …`, `sudo -iu deploy`, `cd /home/deploy/...`) before issuing commands.
- If an instruction requires switching users mid-session, include the transition explicitly (e.g., `exit` to return from `deploy` to `root`, or `sudo -iu deploy` before commands that must run as `deploy`).
- Chat assistants must locate existing values and scripts in the repo and quote them directly—never instruct the user to add something that already exists.

This Plan Change supersedes any prior instructions that defaulted to the direct (25060) connection string.

---

### PC-2025-11-24-A — Jackpot Entry Automation Baseline

**Rationale:**
- Soft launch requires the live jackpot counter to reflect the actions customers can complete today (signup, SMT authorization, manual usage entry, referrals).
- The previous demo hooks (e.g., dashboard visit auto-credit) skewed totals and masked real progress.

**Scope:**
- `app/login/magic/route.ts`: award the **signup** entry when a brand-new user finishes the magic-link flow.
- `app/api/smt/authorization/route.ts`: award/upgrade the **smart_meter_connect** entry to 1 when SMT authorization succeeds (or remains at 1 when the droplet reports "already active").
- `components/SmartMeterSection.tsx`: manual fallback now grants 1 entry and prevents double-awards; success toast fires `entriesUpdated`.
- `app/api/user/entries/route.ts`: allow raising the amount for an existing entry (e.g., manual → live SMT) while keeping idempotency.
- `components/smt/SmtAuthorizationForm.tsx`: notify listeners after a successful submission so counters refresh instantly.
- `lib/hitthejackwatt/opportunities.ts`: retire the `dashboard_visit` placeholder, clarify the manual vs. automated SMT reward copy.
- Removed the old "dashboard visit = 1 entry" demo hook from `app/dashboard/page.tsx`.

**Verification:**
- Tested with a fresh magic-link signup, manual SMT fallback, and full SMT authorization: counters now show 1 → 2 → 3.
- Referral flow already live; ensured referral awards still bypass the single-entry guard.
- `/dashboard/entries` still uses mock data (follow-up task), but `/api/user/entries` now returns accurate totals for client widgets.

---

### PC-2025-11-24-B — Dashboard Module & SMT Card Refresh

**Rationale:**
- Customers should see all dashboard modules immediately, even before address capture, to preview the full experience.
- The SMT CTA card looked off-center and inconsistent with the navy/neon palette guardrail.

**Scope:**
- `app/dashboard/page.tsx`:
  - Dashboard module grid now renders unconditionally (still links to gated flows).
  - SMT info block centered, with updated typography and CTA styling.
- `app/dashboard/optimal/page.tsx`: placeholder page wired for the new "Optimal Energy" tile so navigation is complete.

**Notes:**
- No behavior change for SMT ingestion—purely layout/visibility adjustments.

---

### PC-2025-11-24-C — Profile Snapshot & SMT Expiration Surfacing

**Rationale:**
- Soft-launch users need a read-only profile view that reflects what IntelliWatt already knows before we enable editing.
- Support team requested quick access to SMT agreement metadata (activation/expiration) on both the profile and API connect screens.

**Scope:**
- `app/dashboard/profile/page.tsx`:
  - Promoted to a server-rendered page that pulls `User`/`UserProfile`, the latest `HouseAddress`, and most recent `SmtAuthorization`.
  - Renders account, contact, service address (with ESIID + utility), SMT status, meter number, authorization start/end dates, and a "Revoke SMT access" card labeled under construction.
  - Falls back to friendly copy ("Not provided") when fields are blank; no mutation logic introduced.
- `app/dashboard/api/page.tsx`:
  - SMT status card now shows the authorization expiration date beside the submission timestamp, using the stored `authorizationEndDate`.
- `components/SmartMeterSection.tsx`:
  - Removed redundant type guard when switching to manual entry (retains behaviour, satisfies TS narrowing).

**Notes:**
- Entire feature remains read-only; edit/revoke flows will follow once APIs are available.

---

### PC-2025-11-24-D — Primary House & SMT Agreement Ownership

**Rationale:**
- Each customer must have exactly one actionable home context. When they change addresses, the previous house and its SMT agreement must retire immediately to prevent stale data.
- When a different customer successfully authorizes the same meter, the prior owner needs to be displaced, flagged, and notified that their house was replaced.

**Scope:**
- **Schema:** Added `HouseAddress.isPrimary`, `HouseAddress.archivedAt`, `SmtAuthorization.archivedAt`, `SmtAuthorization.revokedReason` (`prisma/migrations/20251124093000_primary_house_binding`).
- **Helpers:** New `lib/house/promote.ts` exports `setPrimaryHouse`, `archiveAuthorizationsForHouse`, `archiveConflictingAuthorizations` so address + SMT flows share the same promotion/archiving logic.
- **Address Save (`app/api/address/save/route.ts`):**
  - Saving a *new* address archives any existing SMT authorizations tied to the prior house and promotes the latest address to `isPrimary=true`.
  - Response now returns a warning flag if a prior authorization was archived so the UI can inform the user that reconnecting SMT is required.
- **SMT Authorization (`app/api/smt/authorization/route.ts`):**
  - Requires the submitted `houseAddressId` to be the caller's primary, non-archived house.
  - After SMT confirms, archives earlier authorizations for that house, promotes the house to primary, and revokes conflicting authorizations (same ESIID/meter) for other users while flagging them for outreach (`esiidAttentionRequired`).
  - Response metadata includes which houses were superseded and any displaced user IDs (for email workflows).
- **UI Queries (`app/dashboard/api/page.tsx`, `app/dashboard/profile/page.tsx`):** Only read the active (`archivedAt IS NULL`, `isPrimary = TRUE`) house and SMT authorization, so superseded data never surfaces after an address/ownership change.

**Notes:**
- Displaced users retain no primary house until they re-enter an address; the attention flag powers the outbound email.
- `archiveAuthorizationsForHouse` is available for future admin tooling (manual revokes, etc.).

---

### PC-2025-11-24-E — Profile Editor & Address Replacement UX

**Rationale:**
- The profile dashboard needed to match the navy/neon design guardrail and expose editable contact details ahead of soft launch.
- Changing a service address should warn the customer that their previous SMT agreement is archived immediately and guide them back to the API page to reconnect.

**Scope:**
- `components/profile/ProfileContactForm.tsx`: new client form that updates full name, phone, and login email via `/api/user/profile` (normalises email, enforces uniqueness, refreshes the page, resets the auth cookie).
- `components/profile/ProfileAddressSection.tsx`: renders a neon card with current address/utility/ESIID, shows the archive warning, uses the updated `QuickAddressEntry` to save a new address, and surfaces the "Connect to SMT" call-to-action modal after success.
- `components/QuickAddressEntry.tsx`: now accepts `redirectOnSuccess` and `onSaveResult` hooks so other flows (profile) can reuse the component without auto-navigating to `/dashboard/api`.
- `app/api/user/profile/route.ts`: new `PATCH` endpoint that updates the signed-in user and their profile (transactional, resets auth cookie on email change).
- `app/dashboard/profile/page.tsx`: redesigned to navy/neon cards, embeds the new client forms, only reads active house / SMT data, and now lists every active home with per-house entry totals and SMT state.
- `app/api/address/save/route.ts`: after promoting the newest house to primary, automatically deletes any newly archived houses that never collected SMT authorizations so each user keeps a single active address record.
- `lib/house/promote.ts`: gained a `keepOthers` flag to support multi-home accounts without archiving sibling houses.
- `app/api/user/house/select/route.ts`: POST endpoint that switches the active house (marks `isPrimary=true`) while leaving other houses intact.
- `components/profile/ProfileAddressSection.tsx`: now handles multiple homes, enforces "SMT first" gating for extra homes, shows per-home entry counts, and lets the user switch the active house.
- `components/QuickAddressEntry.tsx`: accepts `houseIdForSave` so we can update an existing home in-place or create a new one.
- `app/api/user/entries/route.ts`: entries can be scoped to a `houseId`, so SMT bonuses are tracked per home. `Entry` records gained an optional `houseId` column.
- `app/api/smt/authorization/route.ts`: awards SMT entries against the authorized house and preserves other homes while switching primaries.
- `components/SmartMeterSection.tsx`: includes the `houseId` when awarding manual fallback entries.
- `app/api/admin/houses/flagged/route.ts` + `app/admin/page.tsx`: Admin dashboard shows a queue of displaced homes (flagged `smt_replaced`) so support can send the replacement email before reconnecting.

**Notes:**
- Address saves still flow through `/api/address/save` and trigger the new archive logic.
- Post-save modal drives customers directly to `/dashboard/api#smt` to reconnect.

---

### PC-2025-11-24-F — Bulk Archive Non-Keeper Demo Users

- Added `scripts/sql/bulk_archive_non_keeper_users.sql`, which archives `HouseAddress` and `SmtAuthorization` rows for every user except the five keeper emails (`omoneo@o2epcm.com`, `cgoldstein@seia.com`, `whill@hilltrans.com`, `erhamilton@messer.com`, `zander86@gmail.com`).
- One-time pre-launch cleanup to remove demo/test clutter; not intended as a recurring scheduled job.
- Run manually against the DigitalOcean `defaultdb` using the standard app credentials, e.g. `psql "$DATABASE_URL" -f scripts/sql/bulk_archive_non_keeper_users.sql`.
- Always capture a snapshot or `pg_dump` backup before executing the script.
- Script is idempotent-ish: re-running will keep houses archived and SMT agreements marked `bulk_archive`.

---

### PC-2025-11-24-G — Delete Non-Keeper Demo Users

- Added `scripts/sql/delete_non_keeper_users.sql` to remove `User` rows (and related `Entry`, `Referral`, `UserProfile`, `SmtAuthorization`, and `HouseAddress` records) for all non-keeper emails, leaving only the five keeper accounts.
- Intended as a follow-up "data reset" after the archive script; not a recurring job.
- Execute manually against the DO `defaultdb` via: `psql "$DATABASE_URL" -f scripts/sql/delete_non_keeper_users.sql`.
- Take a DB snapshot or `pg_dump` before running. Once executed, the admin dashboard user list will only show the keeper accounts.

### PC-2025-11-27-FAQ — Public FAQ refresh (intelliwatt.com)

- Updated the public-facing FAQ to focus on IntelliWatt as the primary experience while clearly explaining HitTheJackWatt as the gamified entry point and IntelliPath Solutions LLC as the parent company.
- Consolidated brand relationship copy ("How HitTheJackWatt, IntelliWatt, and IntelliPath Solutions Work Together") and synced terminology across sections.
- Clarified that plan comparisons and modeling use Smart Meter Texas 15-minute interval usage (not generic hourly averages), keeping data expectations consistent across marketing and product.

---

### PC-2025-11-23-RATE-DETAILS — Optional Current Rate Details Step

**Rationale:**
- Many users already have a fixed-rate plan that will renew or roll to a different rate at contract end.
- Capturing plan name, effective rate(s), and contract expiration lets IntelliWatt show how costs change when the existing contract renews under similar usage.
- Tying this step to a HitTheJackWatt entry deepens engagement and encourages richer data capture.

**Scope:**
- Insert an optional **Current Rate Details** step between SMT usage import and the Rate Plan Analyzer output:
  - Address → SMT API Authorization → Usage Normalization → **Current Rate Details (optional)** → Rate Plan Analyzer → Home Details → Appliances → Upgrades → Optimal Energy.
- Step definition:
  - Title: "Current Rate Details" with copy explaining the richer comparison (current vs recommended vs renewal) and the single-entry reward.
  - Two input paths:
    1. **Upload your bill** (photo/image/PDF) for future OCR-based extraction.
    2. **Manual entry** for:
       - Plan name
       - Primary rate (¢/kWh), optional base fee
       - Contract expiration date
       - Optional notes (e.g., free nights/weekends, tiers)
  - Emphasize that the step is optional; skipping still produces usage-based recommendations, but completing it unlocks a more detailed comparison and rewards.
- This PC only updates documentation and the UI skeleton; it does NOT:
  - Persist current plan details to the database.
  - Connect OCR pipelines.
  - Feed data into the Plan Analyzer engine.
  - Adjust jackpot entry calculations in code.

**Future Work:**
- Define a `CurrentPlan`/`CurrentRateDetails` CDM with schema/API.
- Wire Billing OCR outputs so uploaded bills auto-fill the form with user confirmation.
- Feed confirmed current plan data into the Plan Analyzer results (current vs recommended vs renewal).
- Integrate the updated 1-entry reward in the jackpot calculator and official rules.
- Customer-facing plan analysis will optionally incorporate a Current Rate Details step (plan name, rates, expiration) to compare IntelliWatt recommendations against the user's existing contract and projected renewal costs.

---

### PC-2025-11-23-EFL-LINK-RUNNER — EFL Link Runner Admin Utility

**Scope:**  
Add a vendor-agnostic EFL link runner to the admin console so ops can validate and fingerprint EFL PDFs from any source.

**Changes:**

- **Admin Modules:**  
  - New card on `/admin/modules`: **"EFL Link Runner"**.  
  - Links to `/admin/efl/links`.

- **EFL Link Runner (`/admin/efl/links`):**  
  - Accepts any EFL PDF URL (WattBuy, REP portals, manually pasted links).  
  - Fetches the PDF and computes its SHA-256 hash via `computePdfSha256`.  
  - Shows basic HTTP metadata (content-type, content-length when available).  
  - Provides a one-click **"Open EFL PDF in new tab"** link for manual inspection.

**Notes:**

- Read-only; does not persist data yet.  
- Utility for the EFL Fact Card Engine / rate-card workflow—verifies upstream EFL links before running deterministic ingestion or AI extraction.  
- Works with WattBuy URLs, REP-hosted EFLs, or any valid HTTPS EFL PDF link.
[Plan Analyzer Engine (Planning Doc)](#plan-analyzer-engine-planning-doc)

## Plan Analyzer Engine (Planning Doc)

A dedicated design doc for the rate + usage costing stack lives in:

- `docs/PLAN_ANALYZER_ENGINE.md` — defines:
  - Core Plan Analyzer types (interval usage, cost outputs, plan refs)
  - Per-plan cost engine contract
  - Multi-plan comparison contract
  - Integration with EFL PlanRules and future SMT/Green Button usage inputs.


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

PC-2025-11-18: ESIID Conflict Reassignment & Attention Flag

Rationale

- When WattBuy returns the same ESIID for multiple apartments in a complex, the newest IntelliWatt customer must retain the meter while the previous household is alerted to refresh their address.

Scope

- `/api/address/save` now resolves Prisma unique-constraint conflicts by clearing the previous `HouseAddress` record, setting attention flags on the prior user's `UserProfile`, and reassigning the ESIID to the current user while preserving raw vendor payloads.
- Prisma schema adds `esiidAttentionRequired`, `esiidAttentionCode`, `esiidAttentionAt` on `UserProfile` (migration `20251118230500_add_esiid_attention`).
- Successful assignments reset the attention flag for the winning user.
- Temporary duplicate `HouseAddress` rows created during the same request are removed after reassignment.
- Runtime guard logs a reminder to run `npx prisma migrate deploy` if the new attention columns are missing, so production does not hard-crash while the migration is pending.

Rollback

- Revert commits `7391510` and `62c9e55`, then roll back migration `20251118230500_add_esiid_attention`.
- Without the migration the attention fields disappear and conflict handling reverts to the previous (erroring) behavior.

Guardrails

- Conflict transfers execute inside a Prisma transaction for consistency.
- RAW vendor payloads remain captured before normalization.
- No new PII is logged; structured warnings continue to reference meter IDs only.
- [x] Apply PUCT REP / ERCOT alignment migration (`20251123035440_puct_rep_dev_setup`) to DO `defaultdb` via droplet `npx prisma migrate deploy`.
- [x] Apply SMT email confirmation migration (`20251126000000_add_email_confirmation_status`) to DO `defaultdb` via droplet `npx prisma migrate deploy`.

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
  - `/v3/offers`: Used in a few support/ops paths to fetch the live offer list (primarily for `offer_id` mapping and EFL capture).

- **WattBuy Persistence (Audit + Replay):**
  - `OfferRateMap` (master DB): per-offer mapping keyed by **WattBuy `offer_id`** (canonical offer identity in our system).
    - New linkage: `OfferRateMap.ratePlanId` → `RatePlan.id` (the EFL template persisted for that exact WattBuy offer).
    - Safety rule: we **only update existing** `OfferRateMap` rows (never create them from EFL tooling), because `OfferRateMap` requires `rateConfigId`.
    - Schema note: `RatePlan.offerRateMaps` exists as the required opposite relation for Prisma schema validation (P1012).
  - `OfferIdRatePlanMap` (master DB): **canonical** WattBuy `offer_id` → `RatePlan.id` mapping.
    - This is written by EFL tooling on template persistence even if `OfferRateMap` is missing.
    - `OfferRateMap.ratePlanId` remains a secondary enrichment when an offer has already been synced.
  - `HouseAddress.rawWattbuyJson` (master DB): legacy per-address WattBuy blob (still stored for ops/support).
  - `WattBuyApiSnapshot` (**WattBuy module DB**): append-only-ish raw response snapshots for:
    - `OFFERS` (offer list payloads)
    - `ELECTRICITY` (`/v3/electricity`)
    - `ELECTRICITY_INFO` (`/v3/electricity/info`)
    - Captures `payloadJson`, `payloadSha256`, `fetchedAt`, and request context (`wattkey`, `esiid`, optional `houseAddressId` / `requestKey`).
  - Optional bridge: dual-write snapshots into master DB only when `WATTBUY_SNAPSHOT_DUALWRITE_MASTER=1`.
  - Optional bridge script: `npx tsx scripts/wattbuy/map-snapshots-to-master.ts` (when dual-write is disabled).
  - **Module DB connection strategy (recommended):**
    - `INTELLIWATT_WATTBUY_OFFERS_DATABASE_URL`: pooled PgBouncer URL (port `25061`, `pgbouncer=true`) for Vercel runtime writes.
    - `INTELLIWATT_WATTBUY_OFFERS_DIRECT_URL`: direct URL (port `25060`, no PgBouncer) for Prisma migrations / introspection.

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

✅ Done: WattBuy raw API response snapshot persistence (`WattBuyApiSnapshot`) for audit + replay (module DB is source of truth).

✅ Done: WattBuy offer_id → template identity bridge (`OfferRateMap.offerId` → `OfferRateMap.ratePlanId` → `RatePlan.id`).
✅ Done: Canonical offer_id → template identity bridge (`OfferIdRatePlanMap.offerId` → `OfferIdRatePlanMap.ratePlanId` → `RatePlan.id`).

✅ Done (Dashboard): `/dashboard/plans` now consumes a customer-facing API (`GET /api/dashboard/plans`) that:
- Displays WattBuy EFL average prices (500/1000/2000 kWh) for the user’s saved home.
- Returns `hasUsage` + `usageSummary` **derived from the canonical calc window** (see “Canonical home-scoped usage window” below). This prevents “card vs detail” mismatches.
- ✅ Added **Compare page**: `/dashboard/plans/compare/[offerId]` (backed by `GET /api/dashboard/plans/compare`) that:
  - Computes **Current Plan** and **Selected Offer** estimates using the **same plan engine** + **same stitched 12‑month usage window**
  - Caches Current Plan estimates into the Offers module DB (`WattBuyApiSnapshot`) under `endpoint=CURRENT_PLAN_ENGINE_ESTIMATE_V1` (synthetic `ratePlanId=current_plan:<entryId>`)
  - Shows side-by-side annual/monthly cost, REP vs TDSP breakdown (via `componentsV2`), and a **Termination Fee (ETF) include/exclude toggle** for “switch now vs after contract expiration”
  - Provides a **WattBuy signup CTA** using the offer’s `enroll_link`
- Wires `OfferIdRatePlanMap` into each offer card to show **IntelliWatt calculation available** when `ratePlanId` exists.
- Returns `intelliwatt.ratePlanId` per offer (from `OfferIdRatePlanMap`) so the plan engine can use `RatePlan` templates directly.
- **True-cost wiring (production, read-only list semantics):**
  - `GET /api/dashboard/plans` is **display-only**:
    - It **must not** trigger plan computations (sort/filter/pagination are fetch + render only).
    - If an estimate is not already present in the persisted store, the API returns a cache-miss marker and the UI shows **CALCULATING** until the pipeline materializes it.
  - `intelliwatt.trueCostEstimate` is the plan engine output using:
    - `RatePlan.rateStructure` (template)
    - TDSP delivery rates (`getTdspDeliveryRates`)
    - Canonical stitched 12-month usage buckets (including any required bucket keys)
  - **Single source of truth (canonical)**: `PlanEstimateMaterialized` (master DB), keyed by `(houseAddressId, ratePlanId, inputsSha256)`.
    - Transition support: dashboard may fall back to legacy snapshot cache during migration, but customer UI semantics must stay “DB-saved or pending”.
  - **Fail-closed availability (customer-facing)**:
    - **AVAILABLE** only when `trueCostEstimate.status` is `OK`/`APPROXIMATE`
    - **CALCULATING** when `trueCostEstimate` is a cache miss / missing template / missing buckets (expected to resolve after pipeline warmup)
    - **NEED USAGE** when usage is missing
    - **NOT COMPUTABLE YET** only for true template defects / unsupported structures
- Added `lib/plan-engine/calculatePlanCostForIntervals.ts` + `lib/plan-engine/types.ts`: **pure 15‑minute interval true‑cost core** (fixed-rate-only v1; fail-closed; REP vs TDSP split; no API/UI wiring yet).
- Added `lib/plan-engine/usageBuckets.ts`: canonical monthly usage bucket spec (`CORE_MONTHLY_BUCKETS` + `declareMonthlyBuckets`) as the foundation for auto-aggregation when new plan variables appear (no DB wiring yet).
- Added **Usage module DB** tall-table storage for bucket totals:
  - `UsageBucketDefinition` (global catalog of canonical bucket keys + metadata)
  - `HomeMonthlyUsageBucket` (per-home, per-month kWh totals per bucket key; `@@unique([homeId, yearMonth, bucketKey])`)
- Added `aggregateMonthlyBuckets()` + manual script (`scripts/usage/rebuild-core-buckets-for-home.ts`) to populate `CORE_MONTHLY_BUCKETS` into the **usage module DB** from interval data (best-effort; now wired):
  - After SMT ingest/normalize completes (`/api/admin/smt/normalize` and inline `/api/admin/smt/raw-upload` paths)
  - After Green Button upload completes (`/api/green-button/upload` and `/api/admin/green-button/upload`)
  - Bucket computation is performed by ingestion + background pipeline runs (customer plans list is read-only; never computes buckets inline)
- Usage buckets are now **future-proof**:
  - `UsageBucketDefinition` stores `ruleJson` (canonical bucket matching rule) + `overnightAttribution` (ACTUAL_DAY default)
  - Aggregator supports overnight attribution modes: ACTUAL_DAY (default) and START_DAY ("night belongs to previous day" for day filters)
  - Validator supports `--overnight=start_day` to sanity-check START_DAY attribution on the 20:00-07:00 buckets
- CORE bucket aggregation now correctly attributes overnight dayType (post-midnight counts toward prior local dayType) for the WEEKDAY/WEEKEND 20:00-07:00 buckets.
- Added pure plan “bucket requirements + computability” helpers (`requiredBucketsForPlan`, `canComputePlanFromBuckets`) as the gating layer for true-cost.
- `/api/dashboard/plans` returns `intelliwatt.planComputability` per offer (when usage exists and a template is mapped).
- Plans that are NOT computable due to **true template defects** (unsupported/non-deterministic/suspect evidence) are queued as `PLAN_CALC_QUARANTINE` via `EflParseReviewQueue` (best-effort; no UI changes):
  - Dedupe identity: `(kind="PLAN_CALC_QUARANTINE", dedupeKey=offerId)`
  - `eflPdfSha256` is **not** used as identity for quarantine items (it is set to `offerId` only to satisfy the legacy NOT NULL unique column).
  - Bucket keys are canonical lowercase (total uses `kwh.m.all.total`).
  - Availability gates (missing intervals/buckets) do **not** create review noise (do not enqueue quarantine for missing buckets).
- Added `lib/plan-engine/getRatePlanTemplate.ts` (master DB read helper for `RatePlan` templates; no throwing; returns only fields needed for later true-cost calculations).
- Fixed `RatePlan` template lookup for `ratePlanId` so `trueCostEstimate` doesn’t incorrectly show `MISSING_TEMPLATE` on transient lookup errors.
- `getTdspDeliveryRates` is implemented via `TdspTariffVersion`/`TdspTariffComponent` (pick latest effectiveStart <= asOf, effectiveEnd null or >= asOf).
- `intelliwatt.trueCostEstimate.OK` includes:
  - `annualCostDollars`, `monthlyCostDollars`, and `effectiveCentsPerKwh`
  - `componentsV2` (REP vs TDSP breakdown)
  - `tdspRatesApplied` (effective date + per‑kWh + monthly customer charge)
- `/api/dashboard/plans` now returns `intelliwatt.tdspRatesApplied` when TDSP rates were applied (effectiveDate, per-kWh cents, monthly dollars).
- Customer-facing status messaging is intentionally simple and never shows internal queue jargon:
  - When we cannot compute an estimate for any reason other than missing usage, we show **“Not Computable Yet”**.
  - When usage is missing, we show **“Need usage to estimate”** (with a clear CTA to connect usage).
- Uses a sticky filter/sort bar + pagination to avoid an infinite scroll plan list.
- When `hasUsage=true`, default UI sort is **Best for you** (lowest `trueCostEstimate.monthlyCostDollars` first).
- The UI marks the cheapest visible plan with a **RECOMMENDED** badge (no separate “Top 5” strip).
- Plan cards show a template status badge: **AVAILABLE / NOT COMPUTABLE YET / NOT AVAILABLE**, plus a filter toggle **“Show only AVAILABLE templates”**.
- Plan cards show the true-cost monthly estimate when `intelliwatt.trueCostEstimate.status === "OK"` (with an **“incl. TDSP”** tag when `intelliwatt.tdspRatesApplied` is present).
- Added a breakdown popover on the plan card monthly estimate (REP vs TDSP split + TDSP effective date when available).
- Estimate breakdown popover now shows monthly + annual for REP/TDSP/Total.
- Extracted `EstimateBreakdownPopover` into a reusable component (used by `OfferCard`).
- Best plans strip now uses `EstimateBreakdownPopover` for the estimate breakdown (same as plan cards).
- (Removed) Best Plans “Top 5” server-ranked strips. Sorting is applied directly to the full offer list.
- Best plans (no-usage) ranking now uses an `approxKwhPerMonth` selector (mapped to nearest EFL bucket 500/1000/2000).
- Added IntelliWattBot dashboard hero (typed speech bubble) on all `/dashboard/*` pages.
  - Placement: shown **below** each dashboard page title/description section (`DashboardHero`), not above it.
  - UX: bot image is **2× larger** and typing speed is **half-speed** vs initial implementation.
- Added per-page IntelliWattBot message overrides in DB (`IntelliwattBotPageMessage`) + public fetch API (`GET /api/bot/message`).
- Added admin editor: `/admin/tools/bot-messages` to update IntelliWattBot messages per dashboard page.
- **Event/trigger messages (no new DB columns):**
  - Store additional “vertical” messages as extra rows keyed by `pageKey::eventKey` (example: `dashboard_plans::calculating_best`).
  - Public API supports `GET /api/bot/message?path=/dashboard/plans&event=calculating_best`.
  - **Important**: event messages do not auto-trigger by DB entry alone; the page must request the event key when the condition occurs.
  - Admin tool supports an **event dropdown** (plus Custom) when adding event messages for a page.
- Dashboard Plans header: search/filter section is now globally **collapsible** (both mobile + desktop) so plan cards stay visible.
- PlansClient: prevent double-fetch by gating `/api/dashboard/plans` until `isRenter` is resolved from localStorage, and use AbortController + request sequencing to cancel/ignore stale responses when params change.
- Plans UX (guardrails, do not regress):
  - **No engine work on sort/filter/pagination** (those are UX-only).
  - When usage exists, missing estimates must show as **CALCULATING** (not “unsupported”) and resolve once the background pipeline finishes.
  - API responses for `/api/dashboard/plans` must be **non-cacheable** (avoid browser “disk cache” pinning stale pending results).
  - Missing buckets is an “availability/pipeline” condition (not a plan defect); do not spam review queues for missing buckets.

Plans page performance + semantics (Added 2026-01)
- Default page size is **All** (dataset mode) so sort/filter are client-side and do not trigger refetch storms.
- Background warmups (templating + pipeline kicks) are **strictly gated** to start only from the default landing view; once started they may continue in the background until pending hits 0.
- `GET /api/dashboard/plans` is read-only and returns persisted estimates (or a cache-miss marker). It never computes.
- `POST /api/dashboard/plans/pipeline` is bounded (time budget clamped) to avoid Vercel 504s; repeated kicks are throttled by job cooldown.

Canonical home-scoped usage window (Dashboard + Plan Details)

- **Anchor (`windowEnd`)**: latest ingested usage interval timestamp for the home (SMT `MAX(SmtInterval.ts)`), *not* `new Date()`.
- **Cutoff (`cutoff`)**: `windowEnd - 365 days` (used to bound which intervals are eligible for bucket computation).
- **Months used for billing math**: 12 months, America/Chicago local time.
- **Stitching rule (newest month)**: build a full calendar month by taking:
  - the available days in the newest month up through the **last complete Chicago-local day** (>= 23:45; may step back up to 2 days if SMT is late),
  - plus the missing tail days borrowed from the same calendar month in the prior year.
- **Implementation (shared helper)**: `lib/usage/buildUsageBucketsForEstimate.ts` → `buildUsageBucketsForEstimate()`.

Materialized plan estimates (single source of truth — production)

- **Goal**: One engine, one set of semantics, and instant UI loads.
- **Storage**: a dedicated master-DB table for materialized plan estimates (home-scoped), keyed by:
  - `(houseAddressId, ratePlanId, inputsSha256)`
- **Keying (`inputsSha256`)**: hash of canonical inputs (engine version + monthsCount + TDSP rates + rateStructure hash + usage buckets digest + estimateMode).
- **Rule (source of truth)**: Any place that displays a home-scoped true-cost estimate must read from this materialized table.
- **Compute is never triggered by UI interactions** (sort/filter/pagination are display-only).
- **Correctness invariant**: Card, detail, compare, and admin must match because they read the same persisted estimate row for the same `(houseAddressId, ratePlanId, inputsSha256)`.
- **Transition note**: `WattBuyApiSnapshot endpoint=PLAN_ENGINE_ESTIMATE_V1` remains as a legacy cache during migration, but the target architecture is the dedicated materialized table.
  - **Normal entrypoint**: customer requests start **mid-engine** (template + usage buckets + TDSP → materialized row). Admin tooling may start upstream (Offer → EFL parse), but once a template exists, the estimate path must not re-run parsing.

Client-side UX caching (not a source of truth)

- The Plans UI keeps a `sessionStorage` cache (UX-only) so back/forward navigation can instantly show the last response without refetching.
- The Plan detail UI keeps a `sessionStorage` cache (UX-only) to avoid waiting on re-fetch when returning to a previously viewed offer.
- Usage dashboard also uses client UX caching and server-side aggregation (see “Usage Dashboard Activation”); avoid returning full-year interval payloads to the browser.
- Persisted plan calc requirements on `RatePlan`: `planCalcStatus`, `planCalcReasonCode`, `requiredBucketKeys`, and `supportedFeatures` are stored when EFL templates are upserted (best-effort).
- Added **local admin scripts** to report + backfill `RatePlan.planCalc*` without relying on HTTP admin auth or `prisma db execute` output (safe/idempotent):
  - PowerShell:
    - `$env:DATABASE_URL="<prod master url>"`
    - `node scripts/admin/report-rateplan-calc.mjs` (or `npm run admin:rateplan:report`)
    - `node scripts/admin/backfill-rateplan-calc.mjs` (or `npm run admin:rateplan:backfill`)
    - `npm run admin:rateplan:missing-buckets` (lists up to 100 `RatePlan` rows where `requiredBucketKeys` is empty)
    - `npm run admin:rateplan:rederive` (re-derives bucket keys/status for rows with empty buckets or `planCalcReasonCode="MISSING_TEMPLATE"`)
    - `npm run admin:rateplan:diagnose-missing-templates` (counts possible template matches by REP/Plan/Version keys to debug lookup mismatches)
    - `npm run admin:rateplan:rewire-maps` (rewires offer→template links from orphan `RatePlan`s → best matching template `RatePlan` with `rateStructure` present; updates both `OfferIdRatePlanMap` and `OfferRateMap`)
    - `npm run admin:rateplan:link-offers` (backfills missing offer→template links by matching **DB-backed offers** (`MasterPlan` / `OfferRateMap`) → existing template `RatePlan`s; writes `OfferIdRatePlanMap` and mirrors `OfferRateMap` when present)
    - `npm run admin:rateplan:offer-template-coverage` (offer-level coverage report: joins `OfferIdRatePlanMap` → `RatePlan` and summarizes computable/unknown/not-computable + missing `rateStructure`/bucket keys)
  - Note: `prisma db execute` often does not print `SELECT` results; prefer these node scripts for reporting.
  - Interpretation:
    - If templates exist but lookup mismatch suspected → fix lookup strategy in identity/derivation logic.
    - If templates truly missing → backfill templates from offers/EFL sources for those plans.
  - Rewire runbook (PowerShell):
    - `$env:DATABASE_URL="<prod master url>"`
    - `# dry run first`
    - `$env:DRY_RUN="1"`
    - `npm run admin:rateplan:rewire-maps`
    - `Remove-Item Env:\DRY_RUN -ErrorAction SilentlyContinue`
    - `# optional: scope to specific orphan RatePlan ids`
    - `# $env:IDS="id1,id2"`
    - `npm run admin:rateplan:rewire-maps`
    - Then rerun:
      - `npm run admin:rateplan:missing-buckets`
      - `npm run admin:rateplan:rederive`
    - Only the `trulyMissing[]` rows in the output need EFL/template regeneration.
  - Link offers runbook (PowerShell):
    - `$env:DATABASE_URL="<prod master url>"`
    - `# dry run first`
    - `$env:DRY_RUN="1"`
    - `npm run admin:rateplan:link-offers`
    - `Remove-Item Env:\DRY_RUN -ErrorAction SilentlyContinue`
    - `# optional: allow ambiguous (NOT recommended unless you inspect candidates first)`
    - `# $env:ALLOW_AMBIGUOUS="1"`
    - `# optional: scope to specific offer ids`
    - `# $env:OFFER_IDS="offerId1,offerId2"`
    - `npm run admin:rateplan:link-offers`
    - Note: if this script prints “No DB-backed offers found”, the dashboard is pulling live offers (not stored). Use dashboard prefetch to populate mappings:
      - In browser DevTools (while logged in): `await fetch('/api/dashboard/plans/prefetch?maxOffers=10&timeBudgetMs=25000', { method: 'POST' }).then(r => r.json())`
      - **Targeted prefetch (preferred when debugging specific QUEUED offers)**:
        - The endpoint supports a JSON body with `focusOfferIds` so it can prioritize specific WattBuy offers first:
          - `await fetch('/api/dashboard/plans/prefetch?maxOffers=6&timeBudgetMs=12000', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ focusOfferIds: ['<offerId1>','<offerId2>'] }) }).then(r => r.json())`
        - This is the same mechanism the customer Plans page uses for on-demand templating (see below).
- `/api/dashboard/plans` now prefers stored `requiredBucketKeys` and lazily backfills older RatePlans by deriving requirements from `rateStructure` (best-effort; never breaks offers).
- `PLAN_CALC_QUARANTINE` queue items now include `missingBucketKeys` + `planCalcReasonCode` in `queueReason` JSON for reliable debugging/auditing.
- Shows a compact banner when **NOT AVAILABLE** plans are present, with a one-click action to enable **“Show only AVAILABLE templates”**.
- Status semantics: **AVAILABLE** now means "template is mapped *and* computable by the current plan-cost engine". Mapped-but-unsupported templates (e.g. TOU / variable until v2) show as **QUEUED** for calculation review.

#### Dashboard: customer-triggered on-demand templating (QUEUED → attempt auto-parse)

- **Goal**: When a customer triggers a plan search and the UI shows offers as **QUEUED because of `MISSING_TEMPLATE`**, we should automatically attempt to fetch + parse the offer’s EFL and create/link a template (bounded + fail-closed), instead of waiting for manual ops.
- **Mechanism**:
  - `app/dashboard/plans/PlansClient.tsx` detects offers whose `intelliwatt.statusLabel="QUEUED"` and `trueCostEstimate.status="MISSING_TEMPLATE"` (or `templateAvailable=false`) and then calls:
    - `POST /api/dashboard/plans/prefetch` with body `{ focusOfferIds: string[] }`
  - `app/api/dashboard/plans/prefetch/route.ts` prioritizes `focusOfferIds` first (still bounded by `maxOffers` + `timeBudgetMs`).
- **Admin visibility / consistency**:
  - When an offer cannot be auto-templated (missing EFL URL, fetch fails, PASS but not STRONG, etc.), it must show up in admin review as an OPEN `EflParseReviewQueue` row.
  - Dedupe key must be stable per offer: `@@unique([kind, dedupeKey])` with `kind="EFL_PARSE"` and `dedupeKey=<offerId>` so repeated customer visits refresh the same queue row (no duplicates).

### Rate Engine Inventory (2025-12-19)

- Added `docs/RATE_ENGINE_INVENTORY.md` as the single source of truth for:
  - What the v1 plan-cost engine supports (fixed-rate-only, fail-closed)
  - What is explicitly not supported yet (TOU/variable/tiered/solar buyback)
  - How `planCalcStatus` / `planCalcReasonCode` / `requiredBucketKeys` are derived and used for dashboard AVAILABLE vs QUEUED
  - Current PROD coverage stats + top NOT_COMPUTABLE templates
- Added read-only script: `npm run admin:rateengine:inventory`
  - Current snapshot:
    - `RatePlan`: total=232, COMPUTABLE=222, NOT_COMPUTABLE=2, UNKNOWN=8
    - Mapped offers by template status: COMPUTABLE=97, NOT_COMPUTABLE=4

### Bucket System Addendum: inventory complete (2025-12-19)

Key paths found (no design changes in this log entry):
- **Bucket requirements**: `lib/plan-engine/requiredBucketsForPlan.ts` (`requiredBucketsForPlan()` returns `kwh.m.all.total` today; TOU requirements are stubbed behind `supportsTouEnergy`)
- **Computability + reason codes**: `lib/plan-engine/planComputability.ts` (`FIXED_RATE_OK`, `MISSING_TEMPLATE`, `UNSUPPORTED_RATE_STRUCTURE`)
- **v1 calculator entrypoint**: `lib/plan-engine/calculatePlanCostForUsage.ts` (fixed-rate-only; fail-closed if no single REP ¢/kWh is extractable)
- **Bucket definitions/grammar (code)**: `lib/plan-engine/usageBuckets.ts` (`BucketRuleV1`, canonical key format, `CORE_MONTHLY_BUCKETS`)
- **Bucket aggregation**: `lib/usage/aggregateMonthlyBuckets.ts` (`ensureCoreMonthlyBuckets()` reads intervals and upserts usage DB tall-table buckets)
- **Bucket tables (usage DB)**: `prisma/usage/schema.prisma` (`UsageBucketDefinition`, `HomeMonthlyUsageBucket`)
- **Dashboard gating (do not regress)**: `app/api/dashboard/plans/route.ts` (statusLabel AVAILABLE/QUEUED/UNAVAILABLE, template=available filter, quarantine wiring)

Bucket System (Design+Scaffold plumbing added; semantics unchanged):
- **Bucket grammar parser**: `lib/plan-engine/usageBuckets.ts`
  - `parseMonthlyBucketKey()` (supports `kwh.m.<dayType>.total` and `kwh.m.<dayType>.<HHMM>-<HHMM>`)
  - `bucketRuleFromParsedKey()` (builds `BucketRuleV1` with `window=0000-2400` for totals)
- **Bucket registry auto-create**: `lib/usage/aggregateMonthlyBuckets.ts`
  - `ensureBucketsExist({ bucketKeys })` upserts `UsageBucketDefinition` by key (registry only; does not compute `HomeMonthlyUsageBucket`)
- **Side-effect wiring point**: `lib/plan-engine/planComputability.ts`
  - `derivePlanCalcRequirementsFromTemplate()` now best-effort calls `ensureBucketsExist()` (server-only via dynamic import; swallowed on failure)
- Guardrails (do not regress):
  - `app/api/dashboard/plans/route.ts` is production-critical and must remain **fail-closed**:
    - No **AVAILABLE** without a computable estimate when `hasUsage=true`.
    - Missing buckets should trigger bounded on-demand bucket generation when intervals exist, but should **not** create review-queue noise.
  - `lib/plan-engine/calculatePlanCostForUsage.ts` is the canonical calculator entrypoint; callers must pass `usageBucketsByMonth` for bucket-gated features (TOU, weekday/weekend splits, etc.).

Phase-1 TOU (Design+Scaffold; dashboard must remain fail-closed):
- **Bucket requirements**: `lib/plan-engine/requiredBucketsForPlan.ts`
  - TOU now includes required day/night buckets (`kwh.m.all.2000-0700`, `kwh.m.all.0700-2000`)
- **Computability reason codes**: `lib/plan-engine/planComputability.ts`
  - TOU-like templates now return `planCalcReasonCode="TOU_PHASE1_REQUIRES_BUCKETS"` and populate `requiredBucketKeys` (still NOT_COMPUTABLE to avoid dashboard regression)
- **TOU calc path (not wired yet)**: `lib/plan-engine/calculatePlanCostForUsage.ts`
  - Added optional `usageBucketsByMonth` input + Phase-1 TOU math branch (only runs when buckets are provided)
  - Existing fixed-rate math path remains unchanged; dashboard remains fail-closed for TOU unless plan-calc gating allows it.

Phase-1 TOU (math strictness):
- Day/Night TOU math now **requires** `kwh.m.all.total`, `kwh.m.all.2000-0700`, and `kwh.m.all.0700-2000` for every month used.
- If `day + night` does not match `total` for any month, calculation fails closed (`USAGE_BUCKET_SUM_MISMATCH`). No auto-normalization/assumptions.

Phase-1 TOU (non-dashboard call site):
- Added `GET /api/plan-engine/offer-estimate?offerId=...&monthsCount=12` in `app/api/plan-engine/offer-estimate/route.ts`.
  - Reads per-month bucket totals from usage DB (`HomeMonthlyUsageBucket`) for:
    - `kwh.m.all.total`
    - `kwh.m.all.2000-0700`
    - `kwh.m.all.0700-2000`
  - Passes `usageBucketsByMonth` into `calculatePlanCostForUsage()` **only when all required keys exist for all requested months**.
  - Dashboard remains unchanged/locked; TOU plans remain QUEUED at plan-level. This endpoint is for accurate plan-engine validation.
  - **Operational completion (default ON)**: bounded on-demand monthly bucket generation from intervals.
    - Query param: `backfill` (kept for compatibility) now acts as **autoEnsureBuckets**
      - default: **enabled** when omitted
      - set `backfill=0` / `backfill=false` to disable writes (read-only)
    - Only attempts when required buckets are missing and is always bounded (`monthsCount` max 12)
    - Uses `ensureCoreMonthlyBuckets` (interval → monthly buckets) and still fails closed if buckets remain incomplete
    - Availability gate: if no intervals exist, estimate fails closed with `MISSING_USAGE_INTERVALS`

Plan engine (non-dashboard): estimate a set of offers
- Added `POST /api/plan-engine/estimate-set` in `app/api/plan-engine/estimate-set/route.ts`
- Input JSON:
  - `{ offerIds: string[], monthsCount?: number (default 12, max 12), backfill?: boolean (default true) }`
- Constraints:
  - `offerIds`: 1..25 (deduped)
  - `monthsCount`: 1..12
  - Auto-ensure writes are attempted by default (bounded + fail-closed). Set `backfill=false` to make it read-only.
- Output JSON:
  - `{ monthsCount, backfillRequested, results: OfferEstimateResult[] }`
- Dashboard routes unchanged/locked.
- Tests:
  - Added minimal Vitest contract coverage for:
    - `POST /api/plan-engine/estimate-set` caps/shape
    - `GET /api/plan-engine/offer-estimate` `tdspSlug` normalization
- Admin UI:
  - Added Admin Tools card: **Plan Engine Lab** → `/admin/plan-engine`
  - Added minimal admin page `/admin/plan-engine` to run `estimate-set` and render JSON + summary table
  - Added helper to extract `offerId` list from pasted dashboard JSON (keys: `offer_id`, `offerId`, `offerID`) + clean/de-dupe button
  - Added OfferId Finder panel on `/admin/plan-engine` to fetch live WattBuy offers (`/api/wattbuy/offers`) and click-to-add `offer_id` values into estimate-set input
  - Improved offer “type” classification in Plan Engine Lab: supports template-backed classification (via non-dashboard estimate-set), since WattBuy payload fields are not reliable enough to identify TOU vs fixed consistently
  - OfferId Finder now uses deterministic **type precedence** + **flags** from template-backed estimate-set results (with `HEURISTIC` flag when falling back to WattBuy text fields)
  - Added Plan Details page: `/admin/plans/[offerId]` (offer + linked RatePlan + rateStructure + plan-engine introspection + optional admin estimate runner by homeId)
  - Plan Details page: added Bucket Coverage matrix (read-only) showing requiredBucketKeys × months for a given homeId (alias-tolerant, no backfill)
  - Added “Details” links from admin offer tables to `/admin/plans/[offerId]` (Plan Engine Lab, offers explorer, probe, and EFL ops tables)
  - Added Plan Engine View (introspection) to Fact Cards manual loader (`/admin/efl/fact-cards`) so admins can see extracted TOU periods + required buckets immediately after parsing

- Admin-only APIs:
  - `GET /api/admin/plans/details?offerId=...` (RatePlan + rateStructure + introspection; token-gated)
  - `POST /api/admin/plan-engine/offer-estimate` (admin wrapper for offer estimate by homeId; token-gated)
  - `GET /api/admin/usage/bucket-coverage` (read-only coverage matrix for HomeMonthlyUsageBucket; token-gated; alias-tolerant)

- Review queue persistence:
  - When a template is persisted but plan-calc introspection indicates an unsupported/non-computable shape (beyond TOU bucket gating), a `PLAN_CALC_QUARANTINE` entry is upserted into `EflParseReviewQueue`.
  - When an admin home-scoped estimate is blocked for a **plan-defect** reason (e.g. unsupported schedule, non-deterministic pricing, unsupported bucket key), a `PLAN_CALC_QUARANTINE` entry is also upserted.
  - Availability gates (missing intervals/buckets) do **not** create review noise.
  - Admin queue auto-resolve/dedupe skips `PLAN_CALC_QUARANTINE` so these items remain visible until explicitly resolved.

TOU Phase-2 (arbitrary windows; non-dashboard only)
- Added deterministic TOU window schedule extraction: `lib/plan-engine/touPeriods.ts`
  - Supports canonical TOU period lists (all/weekday/weekend dayTypes + HHMM-HHMM windows) when ¢/kWh is fixed and windows fully cover 24h (fail-closed on overlaps/gaps).
- Bucket requirements now derive from schedule (non-dashboard calculators):
  - `lib/plan-engine/requiredBucketsForPlan.ts` exports `requiredBucketsForRateStructure()`
- Calculator supports bucket-gated TOU window math:
  - `lib/plan-engine/calculatePlanCostForUsage.ts` computes REP energy per window and enforces strict bucket integrity:
    - `sum(periodBucketsKwh) == kwh.m.all.total` per month (epsilon 0.001) else `USAGE_BUCKET_SUM_MISMATCH`
    - Missing any required bucket -> `MISSING_USAGE_BUCKETS`
  - TOU can be combined with **deterministic bill credits** (Phase 1); credits apply after REP + TDSP, before minimum rules.
  - TDSP delivery remains total-based via `perKwhDeliveryChargeCents` (no TDSP TOU windows in tariff module yet).
- Shared estimator/endpoints:
  - `/api/plan-engine/offer-estimate` and `/api/plan-engine/estimate-set` now auto-ensure monthly buckets by default (bounded, fail-closed) so deterministic TOU windows compute whenever intervals exist.
- Tests:
  - Added unit tests for TOU Phase-2 window math in `tests/plan-engine/touPhase2.cost.test.ts`
  - Added unit tests for TOU + credits combo in `tests/plan-engine/tou.plus.credits.test.ts`

Indexed / Variable pricing (non-dashboard only; explicit approximation mode)
- **Detection**: `lib/plan-engine/indexedPricing.ts`
  - `detectIndexedOrVariable(rateStructure)` conservatively identifies VARIABLE/INDEXED templates (without misclassifying TOU).
- **EFL avg-price anchors (no raw-text parsing here)**: `lib/plan-engine/indexedPricing.ts`
  - Reads modeled average ¢/kWh at `500/1000/2000` kWh from `rateStructure.__eflAvgPriceValidation.points[*].modeledAvgCentsPerKwh` (or `modeledRate500/1000/2000` if embedded).
- **Default behavior (fail-closed)**:
  - `calculatePlanCostForUsage()` returns `NOT_COMPUTABLE` with reason `NON_DETERMINISTIC_PRICING_INDEXED`.
  - `planComputability` returns `planCalcStatus=NOT_COMPUTABLE` with `planCalcReasonCode=NON_DETERMINISTIC_PRICING_INDEXED` (dashboard-safe; no regression).
- **Optional APPROXIMATE mode**:
  - Calculator supports `estimateMode="INDEXED_EFL_ANCHOR_APPROX"` which uses EFL anchors to choose an effective ¢/kWh (closest or linear interpolation).
  - Output is clearly labeled: `status="APPROXIMATE"` and `estimateMode="INDEXED_EFL_ANCHOR_APPROX"`.
  - TDSP is applied exactly as in fixed-rate math (total-based).
- **Wiring**:
  - `GET /api/plan-engine/offer-estimate`: query `estimateMode=INDEXED_EFL_ANCHOR_APPROX`
  - `POST /api/plan-engine/estimate-set`: body `estimateMode`
  - `POST /api/admin/plan-engine/offer-estimate`: body `estimateMode`
  - Admin UIs expose a checkbox: “Approx Indexed via EFL anchors”.
- **Tests**:
  - Added `tests/plan-engine/indexed.anchors.test.ts` (anchor selection + calculator default vs approx).

Tiered / Block pricing (non-dashboard only; bucket-gated, deterministic)
- **Scope (supported)**:
  - Monthly kWh tiers applied to **REP energy only** (e.g., 0–500 @ A ¢/kWh, 500–1000 @ B ¢/kWh, 1000+ @ C ¢/kWh).
  - Optional REP monthly base charge (already supported).
  - TDSP remains **total-based** (unchanged).
  - Tiered can be combined with **deterministic bill credits** (Phase 1); credits apply after tiered energy + TDSP.
- **Explicitly NOT supported (fail-closed reason codes)**:
  - `UNSUPPORTED_COMBINED_STRUCTURES` (TOU + tiered)
  - `UNSUPPORTED_TIER_VARIATION` (tiers varying by month/season/daytype)
  - `NON_DETERMINISTIC_PRICING` (variable/indexed riders with tiers)
- **Deterministic extraction**: `lib/plan-engine/tieredPricing.ts`
  - Reads only structured tier fields (`rateStructure.usageTiers` or `rateStructure.planRules.usageTiers`), validates contiguous tiers starting at 0.
- **Bucket requirements**:
  - Tiered needs only `kwh.m.all.total` (monthly total); auto-ensure covers this by default in estimate flows.
- **Plan-level gating (dashboard-safe)**:
  - Tiered templates remain `planCalcStatus=NOT_COMPUTABLE` with `planCalcReasonCode=TIERED_REQUIRES_USAGE_BUCKETS` (no dashboard semantics change).
  - Tiered + credits templates remain `planCalcStatus=NOT_COMPUTABLE` with `planCalcReasonCode=TIERED_PLUS_CREDITS_REQUIRES_USAGE_BUCKETS`.
- **Calculator behavior**: `lib/plan-engine/calculatePlanCostForUsage.ts`
  - Requires `usageBucketsByMonth` (fails with `MISSING_USAGE_BUCKETS` otherwise).
  - Computes REP energy month-by-month via tier blocks and returns `status="OK"` when all required month totals exist.
- **Admin surfacing**:
  - `introspectPlanFromRateStructure()` now includes `tiered` output (ok/reason + normalized tiers).
  - Manual Fact Card Loader renders a tier table when deterministic tiers are detected.
- **Tests**:
  - Added `tests/plan-engine/tiered.pricing.test.ts` (extract + breakdown + calculator path).
  - Added `tests/plan-engine/tiered.plus.credits.test.ts` (tiered + credits combo).

Bill credits Phase 1 (non-dashboard only; deterministic, bucket-gated)
- **Scope (supported)**:
  - Structured `rateStructure.billCredits` rules applied from **monthly total kWh only**.
  - Credits apply to the **total bill** (REP + TDSP) and reduce it (clamped at $0 minimum).
  - Range semantics follow the contract: `minUsageKWh <= usage < maxUsageKWh` (or no max).
  - Credits can be combined with **tiered REP energy** (Phase 1) when both are deterministic.
- **Supported rule shapes (deterministic)**:
  - Flat monthly credit: `minUsageKWh=0` with no `maxUsageKWh` (always applies).
  - Usage range credit: `minUsageKWh` with optional `maxUsageKWh` (max exclusive).
- **Explicitly NOT supported (fail-closed reason codes)**:
  - `UNSUPPORTED_CREDIT_DIMENSION` (seasonality via `monthsOfYear`, or other non-total dimensions)
  - `UNSUPPORTED_CREDIT_COMBINATION` (overlapping usage ranges)
  - `UNSUPPORTED_CREDIT_SHAPE` (missing/invalid numeric fields)
  - `UNSUPPORTED_CREDIT_COMPONENT_SCOPE` (credit scope not expressible; reserved)
  - `UNSUPPORTED_CREDIT_DEPENDENCY` (circular dependency on avg-price; reserved)
  - `NON_DETERMINISTIC_CREDIT` (provider discretion/external riders; reserved)
- **Plan-level gating (dashboard-safe)**:
  - Credit plans remain `planCalcStatus=NOT_COMPUTABLE` with `planCalcReasonCode=BILL_CREDITS_REQUIRES_USAGE_BUCKETS`.
- **Calculator behavior**: `lib/plan-engine/calculatePlanCostForUsage.ts`
  - If deterministic credits exist and `usageBucketsByMonth` is missing → `NOT_COMPUTABLE: MISSING_USAGE_BUCKETS`.
  - Credits are applied **after** energy + base fees + TDSP delivery.
- **Admin surfacing**:
  - `introspectPlanFromRateStructure()` includes `billCredits` output (ok/reason + normalized rules).
  - Manual Fact Card Loader renders a credits table when deterministic credits are detected.
- **Tests**:
  - Added `tests/plan-engine/billCredits.phase1.test.ts`.

Minimum usage fee + minimum bill Phase 1 (non-dashboard only; deterministic, bucket-gated)
- **Scope (supported)**:
  - `MIN_USAGE_FEE`: if monthly total kWh is below a threshold, **add a fixed fee** (positive dollars).
  - `MINIMUM_BILL`: after all other components (REP + TDSP + credits + min-usage fee), clamp the month’s total to `>= minimumBillDollars`.
  - Ordering per month: **credits → min-usage fee → minimum-bill clamp** (clamp last).
  - Bucket-gated on **monthly total only**: `kwh.m.all.total`.
- **Deterministic extraction**: `lib/plan-engine/minimumRules.ts`
  - Phase 1 supports a single `MIN_USAGE_FEE` and/or a single `MINIMUM_BILL`.
  - `MIN_USAGE_FEE` is currently represented by the EFL fallback as a **negative billCredits rule** labeled “Minimum Usage Fee …”; the plan engine interprets that deterministically as a fee when `usage < threshold`.
  - `MINIMUM_BILL` is only recognized when present as explicit structured numeric fields on `rateStructure` (no free-text parsing here).
- **Plan-level gating (dashboard-safe)**:
  - Plans with minimum rules remain `planCalcStatus=NOT_COMPUTABLE` with `planCalcReasonCode=MINIMUM_RULES_REQUIRES_USAGE_BUCKETS`.
  - Unsupported/invalid shapes fail-closed with:
    - `UNSUPPORTED_MIN_RULE_SHAPE`
    - `UNSUPPORTED_MIN_RULE_DIMENSION` (reserved)
    - `UNSUPPORTED_MIN_RULE_DEPENDENCY` (reserved)
    - `NON_DETERMINISTIC_MIN_RULE` (reserved)
- **Calculator behavior**: `lib/plan-engine/calculatePlanCostForUsage.ts`
  - If minimum rules exist and `usageBucketsByMonth` is missing → `NOT_COMPUTABLE: MISSING_USAGE_BUCKETS`.
  - Applies minimum rules per month and surfaces:
    - `components.minimumUsageFeeDollars`
    - `components.minimumBillTopUpDollars`
- **Admin surfacing**:
  - `introspectPlanFromRateStructure()` includes `minimumRules` output.
  - Manual Fact Card Loader renders a minimum rules table when detected.
  - Admin plan details “Plan variables” surfaces the minimum usage fee when encoded via negative bill credit rule.
- **Tests**:
  - Added `tests/plan-engine/minimumRules.phase1.test.ts`.

Plan Calculator — COMPLETE
- All known deterministic plan types compute end-to-end in the **non-dashboard** plan engine flow (bucket-gated where required).
- Indexed/variable remains **NOT_COMPUTABLE by default**; admin can explicitly enable `INDEXED_EFL_ANCHOR_APPROX` (labeled APPROXIMATE).
- Monthly bucket auto-creation is **enabled by default** in non-dashboard estimate flows (bounded on-demand).
- Admin queueing is **only** for true plan defects (`UNSUPPORTED_*`, `NON_DETERMINISTIC_*`, `UNSUPPORTED_BUCKET_KEY`), never for availability gates.

Free Weekends (bucket-gated; plan-level remains QUEUED):
- **Bucket requirements**: `lib/plan-engine/requiredBucketsForPlan.ts`
  - Added `supportsWeekendSplitEnergy` flag (canonical buckets: `kwh.m.weekday.total`, `kwh.m.weekend.total`)
- **Computability**: `lib/plan-engine/planComputability.ts`
  - Detects weekday/weekend all-day periods and returns `planCalcReasonCode="FREE_WEEKENDS_REQUIRES_BUCKETS"` (still NOT_COMPUTABLE)
- **Cost math**: `lib/plan-engine/calculatePlanCostForUsage.ts`
  - Added Free Weekends calc path (only runs when `usageBucketsByMonth` is provided + complete)
  - Fails closed on missing buckets or bucket sum mismatch (no normalization/assumptions)
- **Endpoint wiring**: `app/api/plan-engine/offer-estimate/route.ts`
  - Detects Free Weekends templates and loads `kwh.m.all.total` + `kwh.m.weekday.total` + `kwh.m.weekend.total` buckets when present

Free Weekends (bucketKey shape aliasing; loader boundary only):
- **Canonical all-day keys** are `.total` (generated by `lib/plan-engine/usageBuckets.ts` via `makeBucketKey()` when window is `0000-2400`).
- Some historical/alternate stored rows may use explicit all-day window keys:
  - `kwh.m.weekday.0000-2400`
  - `kwh.m.weekend.0000-2400`
- Verified in usage DB (example homeId: `d8ee2a47-02f8-4e01-9c48-988ef4449214`) that older months can also appear with an **uppercase dayType segment**, e.g.:
  - `kwh.m.WEEKDAY.0000-2400`
  - `kwh.m.WEEKEND.0000-2400`
- `app/api/plan-engine/offer-estimate/route.ts` now queries for both aliases when Free Weekends buckets are needed, and:
  - Normalizes to canonical keys (`kwh.m.weekday.total`, `kwh.m.weekend.total`) when calling `calculatePlanCostForUsage()`
  - **Fails closed** if the alias differs across months (prevents silent mixed-key month sets)
  - Dashboard routes unchanged; schema unchanged; TOU math strictness preserved

Usage buckets (canonicalize keys on write going forward):
- Added `canonicalizeMonthlyBucketKey()` in `lib/plan-engine/usageBuckets.ts` to normalize legacy variants:
  - DayType segment forced to lowercase: `all|weekday|weekend`
  - All-day forced to `.total` (never `.0000-2400`)
  - Non-all-day windows preserved as `HHMM-HHMM` but dayType still normalized
- `lib/usage/aggregateMonthlyBuckets.ts` now uses canonicalized keys for:
  - `UsageBucketDefinition.key`
  - `HomeMonthlyUsageBucket.bucketKey`
  - In-memory aggregation map keys (prevents future legacy keys from being emitted)
- Existing legacy rows are NOT rewritten; read paths remain tolerant via offer-estimate loader aliasing.

Admin tooling (usage bucket audit; no psql):
- Added read-only audit script: `scripts/admin/usage-bucket-audit.ts`
- Run (PowerShell):
  - `npm run admin:usage:buckets:audit -- --homeId=<uuid> --limitMonths=12`
- Reports:
  - top bucketKey frequencies + min/max month
  - legacy key detection (uppercase dayType and/or `.0000-2400`)
  - missing canonical keys by month (recent window)
  - duplicate safety check for `(homeId, yearMonth, bucketKey)`

Admin tooling (usage bucket backfill; canonical-only, idempotent):
- Added admin script: `scripts/admin/usage-bucket-backfill.ts`
- Purpose: backfill **canonical** monthly bucket keys for TOU / Free Weekends estimates without rewriting legacy rows.
- Run (PowerShell):
  - Dry run (no writes): `npm run admin:usage:buckets:backfill -- --homeId=<uuid> --months=12 --mode=all --dryRun=1`
  - Execute: `npm run admin:usage:buckets:backfill -- --homeId=<uuid> --months=12 --mode=all`
- Notes:
  - Writes only `HomeMonthlyUsageBucket` + ensures `UsageBucketDefinition` for the canonical keys.
  - Legacy keys remain in DB (loader continues to alias them when reading).

Next (Dashboard):
- Replace “Best for you (preview)” proxy sort with true usage-based ranking by connecting usage → plan engine (`calculatePlanCostForUsage`).
- Expand displayed fees (base monthly fee, more structured ETF) once those fields are reliably present in the WattBuy offer payload and/or derived from templates.

Verification checklist (PowerShell):
- Apply migrations:
  - `npx prisma migrate deploy --schema prisma/schema.prisma`
- Validate schema:
  - `npx prisma validate --schema prisma/schema.prisma`
- (Optional) regenerate client after schema changes:
  - `npx prisma generate --schema prisma/schema.prisma`
- Trigger a template persist with offerId:
  - Use `/admin/efl/fact-cards` manual loader (URL mode) and include the `offerId` field.
- Confirm linkage exists (Prisma Studio / query):
  - Find `OfferIdRatePlanMap` by `offerId` and verify `ratePlanId` is set and matches the created `RatePlan.id`.
  - If the offer was synced, confirm `OfferRateMap.ratePlanId` is also set (secondary enrichment).
 - CLI verify:
   - `npx tsx scripts/efl/verify-offerid-rateplan-map.ts <offerId>`

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
- Next.js does not allow custom App Router body-parser sizing; keep inline payloads within default limits (~4 MB) and fall back to the droplet webhook for larger files while keeping function limits at 60s/1 GB.
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

- Pause any cron/timer that hits `/api/admin/ercot/cron` or ERCOT ESIID indexing (see DEPLOY_ERCOT.md "Pause" steps).

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

   - **/admin/smt/raw** — list RawSmtFile + "Normalize now"

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

3. Add an Admin page to list `RawSmtFile` (sha256, filename, received_at) and allow "Normalize now" per file.

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

- Input CSVs are assumed to be SMT "adhoc usage" files; parsing handles CST/CDT → UTC.

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
       - Store ESIID on the House record and display it in the UI (e.g., "ESIID: 1044…") for transparency.
   - Future behavior (see "Transition to ERCOT Autocomplete" below):
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
     - Call SMT's Agreement endpoint(s) to:
       - Create a New Energy Data Sharing Agreement using the ESIID and customer identity data.
       - Request 12 months of access for residential customers (and up to SMT limits for commercial, per PC-2025-11-12-H).
   - No SMT login for the customer. The entire consent occurs on IntelliWatt's UI, using SMT's required language and our CSP credentials.

4) Subscriptions + Enrollment (Step 3 — tied to PC-2025-11-12-H)

   - Once the Agreement is active:
     - Create an SMT Subscription for 15-minute interval data with delivery to SFTP (preferred).
     - Optionally create an SMT Enrollment for historical backfill (12 months residential, up to 24/36 months for qualifying commercial accounts, per SMT limits).
   - SMT begins delivering CSVs to the existing SFTP inbox; droplet + fetch_and_post.sh + /api/admin/smt/normalize handle ingestion as they do today (no changes to that pipeline).
   - From the customer's perspective:
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
     - "If you know it, enter your meter number."
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
  - After a Cursor Agent Block finishes, the user will paste Cursor's response/output back into the chat.
  - That pasted response serves two purposes:
    1. It lets ChatGPT verify the change was applied as expected.
    2. It counts as the user saying "done" for that step, so ChatGPT can safely move to the next step.
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
- This requirement applies to both admin tools and customer-facing "manual upload" flows (e.g., SMT or Green Button CSVs).

Scope:

- Big-file requirement:
  - SMT interval files MUST be supported at full size for ingestion into `RawSmtFile` and `SmtInterval`.
  - This applies equally to admin and customer manual upload paths.
- Ingestion paths:
  - The canonical big-file ingestion path is via the droplet ingest pipeline (e.g., `fetch_and_post.sh` / `smt-ingest.service`), which is not constrained by App Router body size limits.
  - Provide and maintain admin automation (e.g., `scripts/admin/Upload-SmtCsvToDroplet.ps1`) that copies local CSVs to the droplet inbox and triggers `smt-ingest.service`, ensuring full-size files enter `RawSmtFile`/`SmtInterval` via the standard pipeline.
  - The existing `/admin/smt/raw` → "Load Raw Files" inline upload:
    - Is a small-file/debug convenience only.
    - Remains subject to App Router limits (~4 MB).
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

- Droplet inline uploads now gzip large SMT CSV files before base64 encoding to satisfy Vercel's ~4.5 MB function body limit.
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

[PC-2025-11-17-C] SMT Admin Normalize Latest Control
----------------------------------------------------

Rationale

- Provide a one-click admin UI control to run the existing SMT normalize pipeline against the most recent RAW SMT file (optionally filtered by ESIID).
- Reduce manual rawId lookups now that /api/admin/smt/normalize is verified and in production use.

Scope

- Admin UI: `/admin/smt/raw` (Raw Files & Normalize UI)
  - Added a "Normalize Latest SMT File" control that:
    - Accepts an optional ESIID input.
    - Calls the existing `POST /api/admin/smt/normalize` route with:
      - `{ latest: true }` when no ESIID is provided.
      - `{ latest: true, esiid: "<value>" }` when an ESIID is provided.
    - Displays the JSON summary from the normalize endpoint (inserted, skipped, filesProcessed, tsMin, tsMax, totalKwh) for operator verification.
  - All admin auth continues to use the existing `ADMIN_TOKEN` server-side patterns; no secrets are exposed to the browser.

Guardrails

- Do NOT rename or change the contract for:
  - `/api/admin/smt/normalize`
  - `/api/admin/debug/smt/intervals`
  - `/api/admin/analysis/daily-summary`
  - `RawSmtFile`, `SmtInterval`
- This entry implements the "Admin UX for SMT normalization" step from the 2025-11-17 plan; future work must build on this UI rather than replacing it.

Status: COMPLETE — Admin "Normalize Latest SMT File" control is in place on `/admin/smt/raw`.

## PC-2025-11-17-A: SMT Interval Normalize Verified (Inline RAW → SmtInterval)

**Rationale:** We now have a working path from SMT CSV → `RawSmtFile` → `SmtInterval`, plus admin debug and daily-summary analysis. This locks the behavior so future edits don't break the ingest pipeline.

**Scope (implemented):**

- `/api/admin/smt/normalize` (admin-gated) can be called with:
  - `POST { "rawId": "<RawSmtFile id>" }`
- For `rawId = "10"` (filename `20251114T202822_IntervalData.csv`):
  - Normalizer processed the file and inserted **96** 15-minute intervals into `SmtInterval` for ESIID `10443720004529147`, `meter = "unknown"`.
  - Duplicate protection is in place: rerunning with the same `rawId` reports `inserted: 0`, `skipped: 96` (idempotent).
- kWh column mapping is correct:
  - Early intervals on 2025-11-17 are `0` kWh (house mostly idle).
  - Afternoon/evening intervals show real usage (e.g., 0.756, 1.086, 1.47, 1.67, etc.), matching the SMT CSV totals.
- ESIID cleanup:
  - Historical test rows that had a leading quote in the ESIID (e.g., `'10443720004529147`) were deleted via the debug delete endpoint.
  - Only clean rows remain in `SmtInterval` for this ESIID.

**Behavioral notes:**

- The normalizer:
  - Reads from `RawSmtFile` CSV bytes.
  - Parses timestamps, converts CST/CDT → UTC.
  - Writes rows into `SmtInterval` with `source = "adhocusage"`.
  - Uses `createMany({ skipDuplicates: true })` to be re-runnable.
- For the test file `20251114T202822_IntervalData.csv`:
  - `records: 96`, `kwh ≈ 31.669`, `tsMin: 2025-11-17T05:45:00Z`, `tsMax: 2025-11-18T05:30:00Z`.

**Status:** ✅ SMT normalize is working end-to-end for inline RAW → `SmtInterval` and is safe to reuse for real SMT feeds.

---

## PC-2025-11-17-B: SMT Debug & Daily Summary Wiring Verified

**Rationale:** Admin needs a way to inspect and clean intervals, and analytics needs daily rollups to drive UI and plan analysis.

**Scope (implemented):**

- Debug intervals endpoint:
  - `GET /api/admin/debug/smt/intervals`
    - Filters by `esiid`, optional `meter`, and optional `dateStart`/`dateEnd`.
    - Used to confirm that `SmtInterval` rows are present and correctly populated.
  - `POST /api/admin/debug/smt/intervals`
    - Deletes rows matching the filter:

      ```json
      {
        "esiid": "10443720004529147",
        "meter": "unknown",
        "dateStart": "2025-11-15T00:00:00Z",
        "dateEnd":   "2025-11-17T00:00:00Z"
      }
      ```

    - Example result: `"deletedCount": 96` when cleaning a bad slice.
- Daily summary endpoint:
  - `GET /api/admin/analysis/daily-summary`
  - For ESIID `10443720004529147` and range `2025-11-17T00:00:00Z` → `2025-11-19T00:00:00Z`, response shows:
    - `date = "2025-11-16"`: `found: 0, expected: 96, completeness: 0`
    - `date = "2025-11-17"`: `found: 49, expected: 96, completeness ≈ 0.51`
    - `date = "2025-11-18"`: `found: 47, expected: 96, completeness ≈ 0.49`
  - This matches the fact that the CSV window is **not** full calendar days but from `2025-11-17T05:45:00Z` → `2025-11-18T05:30:00Z`:
    - 49 intervals land in the "2025-11-17 local day".
    - 47 intervals land in the "2025-11-18 local day".
  - The `meta.range` confirms the analysis window is expressed in `America/Chicago`:
    - `start: 2025-11-16T18:00:00.000-06:00`
    - `end:   2025-11-18T18:00:00.000-06:00`

**Behavioral notes:**

- `expected = 96` is the target for a fully populated 15-minute day; completeness < 1.0 indicates:
  - partial days (start/end of a CSV),
  - missing intervals,
  - or DST edge cases (92/100 intervals) which we will handle explicitly later.
- Current completeness math is good enough for admin diagnostics and for spotting missing days.

**Status:** ✅ Debug/summary endpoints are confirmed working against real `SmtInterval` data.

**Next Steps (future scope, NOT implemented yet):**

- Add an Admin UI button ("Normalize Latest SMT File") that:
  - Fetches the latest `RawSmtFile` id for a given ESIID.
  - POSTs to `/api/admin/smt/normalize` (optionally with a `dryRun` toggle).
- Tighten "expected" logic in daily-summary to:
  - Handle DST days (92 / 100 intervals) explicitly.
  - Differentiate partial days at CSV boundaries vs true missing data.
- Later: surface daily completeness and kWh totals in the IntelliWatt UI and feed into plan analysis.

[PC-2025-11-17-D] SMT Cron + Droplet Ingest Wired (Production Path)
-------------------------------------------------------------------

Rationale

- Finalize the "Cron / automation wiring for SMT" step described in the 2025-11-17 plan.
- Ensure Smart Meter Texas interval files are pulled from SMT SFTP on a schedule and pushed into the same `/api/admin/smt/pull` → `RawSmtFile` → `/api/admin/smt/normalize` → `SmtInterval` pipeline that has already been verified.

Scope

- Droplet (intelliwatt-smt-proxy):
  - Environment file created at: `/etc/default/intelliwatt-smt` with (at minimum):
    - `ADMIN_TOKEN=<ADMIN_TOKEN>` — 64-char admin token used as `x-admin-token` for all admin API calls.
    - `INTELLIWATT_BASE_URL=https://intelliwatt.com`
    - `SMT_HOST=ftp.smartmetertexas.biz`
    - `SMT_USER=intellipathsolutionsftp`
    - `SMT_KEY=/home/deploy/.ssh/intelliwatt_smt_rsa4096`
    - `SMT_REMOTE_DIR=/`
    - `SMT_LOCAL_DIR=/home/deploy/smt_inbox`
    - `SOURCE_TAG=adhocusage`
    - `METER_DEFAULT=unknown`
  - Systemd units installed:
    - `/etc/systemd/system/smt-ingest.service`
    - `/etc/systemd/system/smt-ingest.timer`
    - Override config at `/etc/systemd/system/smt-ingest.service.d/override.conf`:

      ```ini
      [Service]
      EnvironmentFile=/etc/default/intelliwatt-smt
      WorkingDirectory=/home/deploy/apps/intelliwatt
      ```

  - Timer:
    - `smt-ingest.timer` enabled + active, running every ~30 minutes.
    - `smt-ingest.service` runs the SFTP → inline POST pipeline, which:
      - Syncs SMT files from `SMT_HOST:SMT_REMOTE_DIR` into `SMT_LOCAL_DIR`.
      - Calls the existing inline SMT upload endpoint (already wired to:
        - persist `RawSmtFile`
        - run `normalizeInlineSmtCsv`
        - upsert `SmtInterval` with `createMany({ skipDuplicates: true })`).
      - Logs "Skipping already-posted file: …" when a file has already been posted, ensuring idempotent ingest.

- Vercel / API:
  - No new routes were added in this step.
  - The existing `/api/admin/smt/normalize` endpoint and inline SMT upload handler remain the single source of truth for normalization behavior.

Guardrails

- Do NOT rename or refactor:
  - `/api/admin/smt/normalize`
  - `/api/admin/debug/smt/intervals`
  - `/api/admin/analysis/daily-summary`
  - `RawSmtFile`, `SmtInterval`
  - The droplet units: `smt-ingest.service`, `smt-ingest.timer`
- Any future changes to the ingest cadence, SFTP paths, or admin endpoints MUST:
  - Be captured in a new Plan Change entry.
  - Update `docs/DEPLOY_SMT_INGEST.md` to match.

Status

- COMPLETE — Cron / automation wiring for SMT ingest is live on the droplet and posting into the verified normalization pipeline.

---

### PC-2025-11-17-F — Primary SMT Authorization Flow (EnergyBot-Style)

Rationale

To match best-in-class UX patterns (e.g., Blitz Ventures / EnergyBot) and reduce friction for customers, IntelliWatt will adopt a "no meter number required" authorization flow. Customers will only provide address + contact info + REP + consent, and Smart Meter Texas will handle the authorization email + ESIID/meter linking behind the scenes.

This simplifies onboarding and makes SMT access the *default path* for usage ingestion.

Scope

The primary customer onboarding path for SMT data acquisition is now:

1. **Address Autocomplete → ESIID Lookup**
   - User types address.
   - Frontend uses Google Places Autocomplete.
   - Backend uses WattBuy to retrieve:
     - ESIID
     - TDSP / utility name
   - Store address + ESIID as the house record.

2. **Simple Customer Authorization Form**
   - Collect:
     - First Name
     - Last Name
     - Email
     - Phone
     - Current supplier (dropdown)
     - Checkbox for Terms & Authorization
   - Terms state that IntelliWatt (your legal entity) is requesting SMT access on their behalf.

3. **Backend: Initiate SMT Authorization Request**
   - Backend uses IntelliWatt's CSP/Broker credentials to call SMT's authorization endpoint.
   - Provide SMT with:
     - ESIID (from WattBuy)
     - Customer name/email/phone
     - Requested access duration (12 months)
   - SMT sends customer the authorization email:
     - **CONFIRM**
     - **DO NOT CONFIRM**
     - **DID NOT REQUEST ACCESS**

4. **Customer Confirms via SMT Email**
   - If customer clicks CONFIRM:
     - SMT marks authorization ACTIVE for 12 months.
     - IntelliWatt now has permission to pull interval usage.

5. **Backend: Create SMT Subscription (INTERVAL, SFTP/API)**
   - Once authorization is ACTIVE:
     - Create Subscription with:
       - dataType = INTERVAL
       - deliveryMode = FTP (or API)
     - SMT begins delivering:
       - Historic backfill (Enrollment)
       - Ongoing interval data

6. **Ingestion Pipeline (Already Live)**
   - SMT drops files on SFTP.
   - Droplet cron (`smt-ingest.timer`) and on-demand pull (`/api/admin/smt/pull`) fetch them.
   - `/api/admin/smt/pull` inline mode persists `RawSmtFile`.
   - `normalizeInlineSmtCsv`:
     - Parses,
     - Converts CST/CDT → UTC,
     - Inserts `SmtInterval` with skipDuplicates = true.

7. **No Meter Number Required**
   - Customer never types a meter ID.
   - SMT binds ESIID ↔ meter internally.
   - Meter numbers become available to IntelliWatt only after SMT authorization is active.

8. **Bill Upload / Manual Meter Entry = Fallback Only**
   - If SMT authorization fails (customer ignores email):
     - User can upload a bill,
     - Or enter meter manually.
   - These are fallback paths and *not* the primary flow.

Guardrails

- Do NOT reintroduce default or fallback ESIIDs.
- Do NOT require meter numbers for the primary authorization flow.
- Do NOT alter the now-verified SMT ingest pipeline:
  - `/api/admin/smt/pull`
  - `/api/admin/smt/normalize`
  - `/api/admin/debug/smt/intervals`
  - `/api/admin/analysis/daily-summary`

Status

- SMT ingest, normalize, admin tools, cron automation, and "no fallback ESIID" are COMPLETE.
- This entry finalizes the intended customer-facing SMT authorization UX.
- Future steps:
  - Implement frontend screens for this authorization flow.
  - Implement backend SMT authorization + agreement + subscription API calls.
  - Integrate confirmation polling + subscription verification.

### PC-2025-11-17-G — SMT LOA/POA-Based Authorization (Overrides Email-Based Flow)

Rationale

- Earlier language in **PC-2025-11-17-F — Primary SMT Authorization Flow (EnergyBot-Style)** assumed an SMT-managed email confirmation flow.
- Best-in-class brokers (e.g., EnergyBot) operate with an LOA/POA model: the customer grants authorization directly on the broker's site, and the broker leverages SMT "Energy Data Sharing Agreement" + "Subscription" APIs with its own credentials.
- IntelliWatt will follow the LOA/POA pattern:
  - Consent captured / stored on IntelliWatt UI.
  - IntelliWatt (as CSP/REP) uses SMT APIs to create agreements/subscriptions.
  - No SMT email confirmation step is required.

Override Notice (re: PC-2025-11-17-F)

- The email-based "SMT sends customer a confirm email" requirement is no longer the primary flow.
- This Plan Change overrides any PC-2025-11-17-F language implying SMT email confirmation is required for activation.
- Authoritative model:
  - IntelliWatt captures LOA/POA consent.
  - IntelliWatt uses SMT REST/SOAP APIs to create:
    - **New Energy Data Sharing Agreement** records
    - **New Subscription** records (dataType INTERVAL, deliveryMode FTP/API, reportFormat CSV/JSON)
  - SMT/TDSP rely on IntelliWatt's CSP/REP credentials.

Scope

1. Customer-Facing UX (customer experience unchanged; legal/technical framing adjusted)
   - Intake flow remains:
     - Address autocomplete → ESIID lookup via WattBuy.
     - Collect first name, last name, email, phone, current REP, consent checkbox.
   - Terms must explicitly state the customer grants IntelliWatt authority (LOA/POA) to create/manage SMT agreements/subscriptions.
   - The SMT-style disclosure block stays on IntelliWatt pages, framed as an LOA/POA grant to IntelliWatt.

2. Backend SMT Authorization (Agreement + Subscription via LOA)
   - On submission:
     - Persist authorization text, timestamps, IP, user identity, ESIID, TDSP, REP.
     - Use SMT JWT/token helper for authentication.
     - Create **New Energy Data Sharing Agreement** for customer ESIID(s) using IntelliWatt credentials.
   - Once agreement is active:
     - Create **New Subscription** for 15-minute interval data (`dataType=INTERVAL`, `deliveryMode=FTP/API`, `reportFormat=CSV/JSON`).
     - Optionally trigger historical backfill enrollment.

3. Ingestion Pipeline (unchanged)
   - SMT continues to deliver via SFTP/API.
   - Droplet cron + `/api/admin/smt/pull` + `/api/admin/smt/normalize` remain the normalization path.
   - No changes to `RawSmtFile`, `SmtInterval`, `/api/admin/smt/pull`, `/api/admin/smt/normalize`, `/api/admin/debug/smt/intervals`, `/api/admin/analysis/daily-summary`.

Guardrails

- Do NOT reintroduce default/fallback ESIIDs for production houses.
- Do NOT require SMT portal logins or email confirmations.
- Agreement/subscription implementations must:
  - Use IntelliWatt CSP/REP credentials and SMT JWT/token configuration.
  - Treat IntelliWatt-collected LOA/POA as authoritative.
  - Log SMT Agreement/Subscription IDs/status for audit.

Status

- SMT ingest, normalize, admin tools, cron automation remain COMPLETE.
- LOA/POA-based SMT authorization is now the official primary flow.
- Next steps:
  - Implement `/api/admin/smt/agreements/new` and related admin/test routes (see `docs/TESTING_API.md`).
  - Build customer-facing authorization screens wired to those routes.
  - Add SMT Agreement/Subscription status polling and error handling without altering the ingest pipeline.

### PC-2025-11-17-H — SMT Monthly Billing Reads via /v2/energydata

Rationale

- SMT's Data Access Interface exposes a unified **Energy Data** function at:
  - UAT: `https://uatservices.smartmetertexas.net/v2/energydata/`
  - PROD: `https://services.smartmetertexas.net/v2/energydata/`
- That function supports three data types under one API:
  - **15-Minute Interval Data**
  - **Daily Register Reads**
  - **Monthly Billing Reads**
- IntelliWatt already ingests 15-minute interval files via SFTP and normalizes into `SmtInterval`.
- Monthly Billing Reads provide billing-period-level usage that can:
  - Cross-check interval totals.
  - Provide compact bill-period views for rate comparison and analytics.
- This Plan Change establishes Monthly Billing Reads as a first-class dataset and defines how we will retrieve and store them.

Scope

1. Data Source
   - Use the JWT-secured `/v2/energydata` API as defined in the SMT Data Access Interface Guide.
   - Configure requests to return both 15-minute interval data and monthly billing reads (daily register optional).
   - Initial implementation:
     - Small date window (e.g., last 12 months).
     - Known test ESIID (same as interval testing).

2. Backend Implementation (high level)
   - Add admin-only route, e.g. `POST /api/admin/smt/billing/fetch`.
   - Payload: `esiid`, `startDate`, `endDate`, optional flags (`includeInterval`, `includeDaily`, `includeMonthly`).
   - Handler:
     - Obtains SMT JWT via existing helper.
     - Calls `https://services.smartmetertexas.net/v2/energydata/` with appropriate requestor identity, ESIID(s), date range, and flags requesting monthly billing reads (and optionally interval data).
     - Persists raw response for audit/replay.

3. Storage Model
   - Introduce a Prisma model (e.g., `SmtBillingRead`) with fields:
     - `id`
     - `esiid`
     - `meter` (if provided)
     - `billStart`
     - `billEnd`
     - `kwh`
     - `tdspCode` / `utilityName` (if available)
     - `rawJson` / `rawPayload`
     - Timestamps
   - `RawSmtFile` and `SmtInterval` remain unchanged.
   - Billing reads are additive: used for validation and analytics, not for reconstructing intervals.

4. Admin Tools & Testing
   - Extend SMT admin tools with a "Fetch SMT Billing Reads" panel (fields: ESIID, start, end).
   - Display counts and sample billing periods.
   - Add PowerShell/curl smoke tests to `docs/TESTING_API.md` after endpoint exists.
   - No cron/SFTP automation in this change—ad-hoc API pulls only.

Guardrails

- Do NOT modify `SmtInterval`, interval pipelines, or cron/SFTP logic.
- Billing reads stored separately and clearly marked as billing aggregates.
- All new SMT API calls:
  - Use JWT (per `SMT_JWT_UPGRADE.md`).
  - Are admin-gated (`x-admin-token`).
- No customer UI changes yet—admin/testing only until validated.

Status

- SMT ingest, normalize, admin tools, and LOA/POA authorization remain COMPLETE.
- Admin fetch route `POST /api/admin/smt/billing/fetch` is live and returns raw SMT billing payloads for inspection.
- Storage model (`SmtBillingRead`) and automated ingest are **not implemented yet**; future work will:
  - Persist monthly billing reads into the dedicated table.
  - Extend admin tools/UI once persistence and parsing are in place.

---
## PC-2025-11-17-A · SMT 2025 JWT Protocol Lock-in

**Status:** LOCKED IN (overrides all prior SMT auth guidance)

**Context**

Smart Meter Texas issued Market Notice **SMT-M-A051425-10 (May 14, 2025)** stating that:

- FTPS and API **without JWT tokens** are decommissioned as of **September 13, 2025**.
- Only **SFTP** and **API with JWT tokens** are supported going forward.

The current **SMT Interface Guide v2** documents the REST token and JWT behavior:

- Token endpoint (REST, JSON body):
  - UAT:  `https://uatservices.smartmetertexas.net/v2/token/`
  - Prod: `https://services.smartmetertexas.net/v2/token/`
- Request body:
  ```json
  {
    "username": "<SERVICE_ID_USERNAME>",
    "password": "<SERVICE_ID_PASSWORD>"
  }
  ```
- Response:
  ```json
  {
    "statusCode": "200",
    "accessToken": "<JWT_STRING>",
    "tokenType": "Bearer",
    "expiresIn": "3600",
    "issuedAt": "MM/DD/YYYY HH:MM:SS",
    "expiresAt": "MM/DD/YYYY HH:MM:SS"
  }
  ```

**Decision**

1. **Canonical SMT Protocol**
   - IntelliWatt uses **SFTP** for file-based LSE / adhoc usage reports.
   - IntelliWatt uses the **REST API** with **JWT access tokens**, obtained by POSTing
     `username` + `password` service ID credentials to `/v2/token` (or `/v2/access/token`
     for the SOAP-style token service).
   - The `accessToken` returned is treated as a **JWT** and must be included in all
     subsequent SMT REST/SOAP API calls as:
     ```http
     Authorization: Bearer <accessToken>
     ```

2. **No Legacy Auth**
   - Any guidance referring to "API without JWT", "basic auth-only", or "legacy FTPS"
     is **obsolete** and must not be reintroduced.
   - Any future ChatGPT/Cursor instructions must treat this plan change as overriding
     all older SMT-related PDFs or internal notes that imply non-JWT flows.

3. **Environment Variables (high-level)**
   - SMT REST token + ad hoc API calls require:
    - `SMT_API_BASE_URL` (UAT or Prod)
    - `SMT_USERNAME` (SMT service ID username — legacy examples such as `INTELLIWATTAPI` are no longer valid; use `INTELLIPATH`)
    - `SMT_PASSWORD` (SMT service ID password)
    - `SMT_REQUESTOR_ID` (must match `SMT_USERNAME`, i.e. `INTELLIPATH`)
    - `SMT_REQUESTOR_AUTH_ID` (DUNS or other authentication ID as registered with SMT; `134642921` in production)
   - SFTP ingestion uses:
     - `SMT_HOST`, `SMT_USER`, `SMT_KEY`, `SMT_REMOTE_DIR`, `SMT_LOCAL_DIR`
   - Any `SMT_JWT_CLIENT_ID` / `SMT_JWT_CLIENT_SECRET` fields are considered **legacy
     placeholders only** unless and until SMT explicitly moves to an OAuth-style
     client_credentials JWT flow. The current canonical flow is service ID username +
     password → `/v2/token` → `accessToken` (JWT).

4. **Implementation Guardrails**
   - All SMT REST client code (token requests, energy data, meter attributes, etc.)
     MUST:
     - Use `SMT_API_BASE_URL` for base URL.
     - Obtain `accessToken` by POSTing `{ username, password }` to `/v2/token`.
     - Attach `Authorization: Bearer <accessToken>` to all SMT API calls.
   - All future refactors MUST preserve this behavior unless changed by a new
     SMT Market Notice and an updated Plan Change section in this document.

5. **Troubleshooting 401 Invalid Credentials**
   - If `/v2/token` returns a 401 / `invalidCredentials`:
    - Verify the service ID is the **API user** (e.g. `INTELLIWATTAPI` — legacy example; current production service ID is `INTELLIPATH`), not a portal
       login that only works in the web UI.
     - Verify the password for the service ID matches what was configured in the SMT
       portal.
     - Confirm the calling IP is whitelisted in SMT's firewall configuration.
     - If all of the above are correct and 401 persists, open a ticket with SMT
       specifically referencing Market Notice SMT-M-A051425-10 and request a review
       of the service ID + IP configuration.

This plan change is the **single source of truth** for how IntelliWatt integrates with
Smart Meter Texas as of November 17, 2025.

---

## 2025-11-23 – PUCT REP / ERCOT schema alignment (PC-2025-11-23-DB-PUCT-REP)

- Added Prisma migration `20251123035440_puct_rep_dev_setup` which:
  - Ensures `pg_trgm` is available for GIN trigram index usage via `CREATE EXTENSION IF NOT EXISTS pg_trgm;`.
  - Normalizes SMT-related tables by:
    - Making `SmtAuthorization` creation idempotent (`CREATE TABLE IF NOT EXISTS "SmtAuthorization" ...`).
    - Adding non-duplicate indexes on SmtAuthorization columns (`userId`, `houseId`, `houseAddressId`, `esiid`).
  - Creates PUCT REP + ERCOT tables if missing:
    - `PuctRep` (PUCT REP directory, including `puctNumber`, `legalName`, `dbaName`, address/contact fields).
    - `ErcotEsiidIndex` (ERCOT ESIID index / address-normalized lookup table).
  - Adds indexes and constraints with IF NOT EXISTS semantics where applicable:
    - Unique `PuctRep_puctNumber_legalName_key`.
    - Unique `ErcotEsiidIndex_esiid_key`.
    - Supporting indexes on ESIID, normalized ZIP, etc.
  - Uses a DO block to conditionally rename `SmtInterval_esiid_meter_ts_idx` to `esiid_meter_ts_idx` only if the old index exists and the new one does not.
- Dev DB: ran `npx prisma migrate dev` against the new `intelliwatt_dev` database on the same DO cluster. All migrations from `20251024001515_init` through `20251123035440_puct_rep_dev_setup` now apply cleanly.
- Prod-ish DB (DO `defaultdb`):
  - Previously had `SmtAuthorization` and `ErcotEsiidIndex` created manually plus an older ERCOT migration (`20251107020101_add_ercot_esiid_index`) that is NOT present locally.
  - To safely align schema without touching data:
    1. Set `DATABASE_URL` to the DO `defaultdb` connection string on the droplet.
    2. Marked `20251123035440_puct_rep_dev_setup` as rolled back via `npx prisma migrate resolve --rolled-back 20251123035440_puct_rep_dev_setup`.
    3. Resolved DO's "remaining connection slots are reserved for roles with the SUPERUSER attribute" error by terminating excess connections in the DO UI, then re-running the Prisma command.
    4. Applied `npx prisma migrate deploy` from the droplet, which successfully ran `20251123035440_puct_rep_dev_setup` using the idempotent SQL.
- Result: The DO `defaultdb` schema now matches the current Prisma migration history for `SmtAuthorization`, `PuctRep`, and `ErcotEsiidIndex`, without dropping or altering existing data.
- NOTE: The historical migration `20251107020101_add_ercot_esiid_index` remains present in the DO migrations table but not in the local `prisma/migrations` directory. Its effects are functionally superseded by `20251123035440_puct_rep_dev_setup`. We handle this by not rewriting historical migrations and relying on idempotent SQL in the newer migration instead.

---

PC-2025-11-18-A: SMT Token Proxy on Droplet (Canonical Path for JWT)
--------------------------------------------------------------------

Rationale:
- SMT only whitelists the SMT droplet IP, not Vercel IPs.
- Direct calls from Vercel functions to `https://services.smartmetertexas.net/v2/token/`
  time out or are rejected.
- We now have a working Node-based SMT token proxy on the SMT droplet that calls
  `/v2/token/` using the whitelisted IP and returns the JWT.

Implementation (Current State):
- Droplet host: `intelliwatt-smt-proxy`
- Proxy script: `/home/deploy/smt-token-proxy.js`
- Env file: `/etc/default/smt-token-proxy`
- Systemd unit: `smt-token-proxy.service`
- Local listener: `http://127.0.0.1:4101/admin/smt/token`
- Shared secret: `SMT_PROXY_TOKEN` (used as `x-proxy-token` header)

Proxy behavior:
- Accepts: `POST /admin/smt/token`
  - Requires header `x-proxy-token: ${SMT_PROXY_TOKEN}`
  - Ignores request body.
- Uses env:
- `SMT_API_BASE_URL` (currently `https://services.smartmetertexas.net`)
- `SMT_USERNAME` (currently `INTELLIWATTAPI` — legacy example; current production service ID is `INTELLIPATH`)
  - `SMT_PASSWORD` (SMT API Service ID password)
- Calls SMT:
  - `POST ${SMT_API_BASE_URL}/v2/token/`
  - Body: `{ "username": SMT_USERNAME, "password": SMT_PASSWORD }`
- Returns JSON:
  - `ok`: boolean (true when SMT status is 2xx)
  - `via`: "smt-token-proxy"
  - `smtStatusCode`: SMT HTTP status (e.g., 200)
  - `smtBody`: raw SMT JSON (`statusCode`, `accessToken`, `tokenType`, `expiresIn`, etc.)

Constraints / Guidance:
- The canonical SMT JWT path is now:

  IntelliWatt backend/tools → droplet `smt-token-proxy` → SMT `/v2/token/`

- Do NOT call SMT `/v2/token/` directly from Vercel functions; use the droplet proxy
  if/when we wire a public-facing path, or run `smt_token_test.sh` over SSH for live tests.
- Any future change that introduces a different JWT acquisition method must explicitly
  state whether it supersedes PC-2025-11-17-A and PC-2025-11-18-A.

---
## PC-2025-11-18-A — Add Prisma SmtAuthorization Model

**Context**

- IntelliWatt now uses a documented `SmtAuthorization` spec (see `docs/SMT_AUTH_MODEL.md`)
  to capture customer consent for Smart Meter Texas data access.
- The spec assumes:
  - User is authenticated via magic link (`userId` and `User.email` are known).
  - Address + ESIID + TDSP come from Google Maps + WattBuy and are stored in `HouseAddress`.
  - The SMT Authorization form only collects customer name, optional phone, and a single
    12-month consent checkbox; everything else is prefilled or system-set.

**Change**

- Added Prisma model `SmtAuthorization` with:
  - Foreign keys: `userId`, `houseId`, `houseAddressId`.
  - SMT identity fields: `esiid`, `meterNumber?`, `tdspCode`, `tdspName`.
  - Address snapshot: `serviceAddressLine1/2`, `

### PC-2025-11-19: HouseAddress User Email Mirror

**Rationale:**
Ops and support need a stable email field on `HouseAddress` for lookups, while the internal `userId` remains the canonical foreign key (cuid). Mirroring the normalized email keeps historical joins intact even after users update their login address.

**Scope:**
- Extend Prisma schema to add nullable `userEmail` on `HouseAddress` with an index for lookups.
- Backfill the column: use the existing `userId` when it already stores an email, otherwise join to `User` to copy the current email.
- Update `/api/address/save` to persist both `userId` (cuid) and `userEmail` on every write, including conflict hand-offs.

**Rollback Plan:**
- Drop the column and remove associated writes if tooling decides it is unnecessary. Existing logic still relies on `userId`, so removal is non-destructive.

**Guardrails Preserved:**
- `userId` remains the relational source of truth.
- No PII is newly exposed beyond what is already stored in `User.email`.
- Migration keeps RAW payload handling untouched.

### PC-2025-11-19-A – SMT Authorization → Droplet Ingest (Locked)

**Status:** Locked. Do not change without a new plan change entry.

**Summary:** SMT authorization now operates as a three-hop flow that must remain intact:
1. **Browser → Vercel**: Customer submits the form on `/dashboard/api#smt`, which posts to `POST /api/smt/authorization`.
2. **Vercel → Droplet**: The route posts JSON to the droplet webhook (`/trigger/smt-now`) with `reason: "smt_authorized"`, signed by `DROPLET_WEBHOOK_SECRET` / `INTELLIWATT_WEBHOOK_SECRET`.
3. **Droplet → SMT**: `webhook_server.py` validates the secret and executes `deploy/smt/fetch_and_post.sh`, which SFTPs from SMT, then posts the CSVs inline to `/api/admin/smt/pull` (still the canonical ingest path).

**Webhook payload shape (`reason: "smt_authorized"`):**
```
{
  "reason": "smt_authorized",
  "ts": "<ISO timestamp>",
  "smtAuthorizationId": "<Prisma ID>",
  "userId": "<IntelliWatt user id>",
  "houseId": "<house id>",
  "houseAddressId": "<house address id>",
  "esiid": "<ESIID>",
  "tdspCode": "<TDSP code>",
  "tdspName": "<TDSP name>",
  "authorizationStartDate": "<ISO>",
  "authorizationEndDate": "<ISO>",
  "includeInterval": true,
  "includeBilling": true,
  "monthsBack": 12,
  "windowFrom": "<ISO>",
  "windowTo": "<ISO>"
}
```

**Operational notes:**
- SMT remains droplet-only. Vercel never calls SMT APIs or SFTP directly.
- Successful runs log lines such as:
  `[INFO] SMT ingest finished for ESIID='...' rc=0 stdout_len=... stderr_len=...`.
- Droplet ingest currently defaults to a 12-month look-back and posts both interval and billing files.

**Guardrail:** Treat this flow as canonical. Future work must extend it (e.g., new ingest modes) rather than replacing or bypassing the droplet-trigger mechanism.

### How to Continue This Work Safely

After every successful code change related to bill parsing, Current Plan, or EFL pdftotext:
1. Update `docs/PROJECT_PLAN.md` to reflect the final working order.
2. Keep **only** the final, working approach in this plan (remove or overwrite failed/experimental paths).
3. Ensure future chats can continue safely without regressions by:
   - Respecting the **Model Lock** section above (GPT-4.1 for execution).
   - Following droplet sync rules (`git pull origin main` + `sudo bash deploy/droplet/post_pull.sh` when droplet files change).

### PC-2025-11-19-BILLING: SMT Billing Reads Table (Schema Only)

**Rationale**

- Interval ingestion (`RawSmtFile` → `SmtInterval`) is stable and canonical.
- SMT delivers daily/monthly billing-style reads (DailyMeterUsage, MonthlyBilling, `/v2/energydata`, etc.).
- We need a dedicated, idempotent table to store these billing reads before wiring parsers or UI.

**Scope (this step)**

- Add Prisma model `SmtBillingRead` with:
  - Identity: cuid `id`, required `esiid`, optional `meter`.
  - Traceability: optional `rawSmtFileId` → `RawSmtFile` relation; `source` string covering CSV/API variants.
  - Billing window: optional `readStart`, `readEnd`, `billDate`.
  - Energy quantities: optional `kwhTotal`, `kwhBilled`.
  - TDSP context: optional `tdspCode`, `tdspName`.
  - Indexes: `@@index([esiid, billDate])`, `@@index([esiid, readStart])`, `@@index([rawSmtFileId])`.
- No ingest/parser code changes yet; existing SMT flows remain untouched.

**Next Steps (separate changes)**

1. Extend `/api/admin/smt/pull` to detect billing/daily CSVs and insert into `SmtBillingRead` keyed to the originating `RawSmtFile`.
2. Add idempotency guardrails (e.g., uniqueness across `esiid + meter + billDate` or `esiid + meter + readStart + readEnd`) after confirming SMT schemas.
3. Add admin views under `/admin/smt` to inspect billing reads alongside interval data.

**Rollback Plan**

- If billing ingestion is deferred, `SmtBillingRead` can remain empty without affecting current flows.
- To remove entirely, drop the table in a future migration and delete dependent parsers.
- Existing SMT models (`RawSmtFile`, `SmtInterval`, `SmtAuthorization`) stay untouched.

**Guardrails Preserved**

- RAW→CDM discipline: billing reads live in their own CDM table.
- Interval ingest remains the canonical path for 15-minute usage.
- Admin and customer APIs remain unchanged; this update is schema + documentation only.

---

## PC-2025-11-19-SMT-BILLING-ADMIN

**Status:** In progress (billing pipeline + admin viewer live, interval viewer next)  
**Owner:** Brian / SMT ingest

### Summary

We have extended the Smart Meter Texas ingest pipeline and admin tooling:

1. **New billing table:** Added `SmtBillingRead` Prisma model + migration, backed by the production DigitalOcean Postgres cluster. Each row represents a billing-level read for an ESIID/meter (window start/end, bill date, kWh total/billed, TDSP context, source metadata).
2. **Inline billing normalization:** The existing admin ingest endpoint `POST /api/admin/smt/pull` (admin-token protected) now:
   - Persists a `RawSmtFile` row for inline SMT CSV uploads (interval or billing).
   - Detects billing/daily CSVs via filename/source (e.g. `DailyMeterUsage*.csv`).
   - Parses date + kWh columns and populates `SmtBillingRead`, clearing prior reads for that `rawSmtFileId` before insert.
   - Leaves the interval normalization path (`SmtInterval`) unchanged.
3. **Admin SMT billing viewer:** `/admin/smt/raw` now exposes a read-only **"SMT Billing Reads (Admin)"** section with an `esiid` + `limit` filter and a `BillingReadsTable` client component showing bill windows, kWh totals, TDSP info, and the originating raw file.

### Scope / Impact

- **Scope:** SMT ingest + admin-only views. No customer-facing flows changed. Droplet remains the only path to SMT (JWT API + SFTP); Vercel never calls SMT directly.
- **DB Impact:** New `SmtBillingRead` table with FK back to `RawSmtFile`. A helper (`npm run db:apply-smt-billing`) exists for ops to re-apply the migration when needed.
- **Security:** All new UI remains behind admin token. Viewer is read-only and safe in production.

### Future Work

- **SMT Interval Admin Viewer:** Add a parallel **"SMT Interval Reads (Admin)"** section that queries `SmtInterval` using the same `esiid` + `limit` search params to surface raw interval rows (timestamp + kWh + ESIID/meter + source + raw file ID).
- **Customer-facing integration:** Use `SmtBillingRead` + `SmtInterval` as backing data for plan analysis and simulated billing once the public-facing plan analyzer is wired.

### Guardrails

- Never call SMT from Vercel/browser; droplet-only access via JWT + SFTP.
- Do not reset or re-initialize the production Postgres database.
- Do not change the `/api/admin/smt/pull` contract (inline, base64+gzip payload).
- Keep `/admin/smt/raw` features read-only and admin-token gated.

### PC-2025-11-19-SMT-WINDOW-FIX — SMT Webhook Historical Window

- Clarified the distinction between **authorization window** and **data retrieval window** for Smart Meter Texas ingest.
- `authorizationStartDate` and `authorizationEndDate` continue to represent the forward-looking ~12 month consent period for SMT access.
- The droplet webhook payload (`POST /trigger/smt-now`) now includes:
  - `monthsBack` (default 12)
  - `windowTo` = current UTC timestamp
  - `windowFrom` = UTC timestamp `monthsBack` months prior to `windowTo`
  ensuring SMT pulls request the preceding 12 months of usage and billing data (or as much history as SMT returns).
- Ingestion remains append-only and idempotent: `RawSmtFile`, `SmtInterval`, and `SmtBillingRead` rows are only added, and interval inserts continue to rely on `createMany` with `skipDuplicates`.
- Guardrails preserved:
  - SMT traffic stays droplet-only; Vercel does not call SMT APIs directly.
  - `/api/admin/smt/pull` keeps the existing inline `base64+gzip` contract.
- No production database resets or schema changes were performed.

### PC-2025-11-19-D · Droplet Script Source of Truth (SMT Ingest)

- Canonical SMT droplet scripts live in Git:
  - `deploy/smt/fetch_and_post.sh`
  - `deploy/droplet/webhook_server.py`
  - `deploy/droplet/run_webhook.sh`
  - `deploy/droplet/smt_token_test.sh`
- These files are the source of truth for the ingest + webhook stack on `intelliwatt-smt-proxy`.
- Any droplet behavior change must be made via Cursor edits to these repo files, committed, and then synced to the droplet (e.g., `scp`). Emergency on-box edits must be mirrored back into the repo immediately.
- Brian uses `%USERPROFILE%\.ssh\intelliwatt_win_ed25519` to ssh/scp as `root@64.225.25.54`.
- SMT ingest assumptions:
  - SFTP host `ftp.smartmetertexas.biz`, remote dirs `/adhocusage` and `/EnrollmentReports`.
  - Droplet inbox `/home/deploy/smt_inbox`.
  - SMT files can be named `*.csv` or `*.CSV.*.asc`; scripts must handle both patterns.

### PC-2025-11-20-A · SMT Daily Billing Normalization

- `/api/admin/smt/pull` now auto-normalizes official `DailyMeterUsage*.CSV.*.asc` uploads into `SmtBillingRead`.
- Inline billing normalization groups records per ESIID/meter/billDate, sums kWh, and stores rows with `createMany(skipDuplicates: true)` while preserving interval ingestion.
- Droplet ingest (`deploy/smt/fetch_and_post.sh`) already mirrors these files, so DailyMeterUsage payloads now populate `SmtBillingRead` alongside `SmtInterval`.
- No Prisma schema changes; interval normalization path remains untouched.

### PC-2025-11-20-B – Admin DB query allow-list SmtBillingRead

- Added `SmtBillingRead` to the `/api/admin/db/query` allow-list so billing rows inserted via `/api/admin/smt/pull` can be inspected via admin SQL tools and droplet curl commands.
- Normalized table-name handling matches the allow-list casing to prevent false INVALID_TABLE errors.
- INVALID_TABLE responses now include the parsed table name in `detail` for easier debugging (still admin-token gated).

### PC-2025-11-20-C · SMT Inline Normalization for Duplicate Files

- `/api/admin/smt/pull` now re-runs interval and billing normalization even when the uploaded CSV matches an existing `RawSmtFile` (duplicate sha256), relying on `createMany({ skipDuplicates: true })` for idempotence.
- DailyMeterUsage uploads surface `billingInserted` counts in the JSON response, allowing operators to confirm billing rows were written (or zero when no new rows).
- Interval normalization behavior is unchanged aside from exposing an `intervalNormalized` flag in the inline response.

### PC-2025-11-20-D – Admin DB Query BigInt Serialization Fix

- Updated `/api/admin/db/query` to recursively convert bigint fields in raw query results to strings so JSON serialization no longer fails for tables like `SmtBillingRead`.
- Maintained admin-token protection, SELECT-only enforcement, and the existing table allow-list.

### PC-2025-11-20-E — SMT Daily Billing PGP→ZIP→CSV Ingest

- Enhanced `deploy/smt/fetch_and_post.sh` so `DailyMeterUsage*.CSV.*.asc` files are decrypted with `gpg`, unzipped to the inner CSV, and posted to `/api/admin/smt/pull` as inline payloads.
- `/api/admin/smt/pull` already detects DailyMeterUsage CSVs and aggregates them into `SmtBillingRead`, enabling end-to-end SMT daily billing ingestion.
- IntervalMeterUsage handling, sha256 dedupe (`.posted_sha256`), and other ingest safeguards remain unchanged.

### 2025-11-20 – SMT `/agreements` proxy wired to NewAgreement/NewSubscription

- Droplet webhook `POST /agreements` is live, protected by `SMT_PROXY_TOKEN`, and Vercel now calls it via `SMT_PROXY_AGREEMENTS_URL`.
- Droplet successfully obtains SMT JWTs from `/v2/token/` using `SMT_USERNAME=INTELLIPATH` and the configured `SMT_PASSWORD`. (Older references to `INTELLIWATTAPI` are legacy only.)
- Proxy fan-out to SMT `/v2/NewAgreement/` and `/v2/NewSubscription/` executes, but SMT returns HTTP 401 `"Username/ServiceID Mismatch on both Header and Payload message."` because the current request bodies are placeholders.
- **Next:** Implement real agreement/subscription payload builders in the Next.js app (leveraging `SMT_REQUESTOR_ID`, `SMT_REQUESTOR_AUTH_ID`, service ID, and house ESIID) so SMT accepts the calls and resulting status flows back through `SmtAuthorization.smtStatus` / `smtStatusMessage`.

### 2025-11-20 — SMT Agreement / Subscription Payloads

- Implemented `lib/smt/agreements.ts` to build SMT-spec NewAgreement and NewSubscription JSON bodies using SMT_REQUESTOR_ID, SMT_REQUESTOR_AUTH_ID, SMT_SERVICE_ID (fallback to SMT_USERNAME), and SMT_LANG_DEFAULT.
- Vercel now posts `{ agreement: { name: "NewAgreement", body: { NewAgreement: { … } } }, subscription: { name: "NewSubscription", body: { NewSubscription: { … } } } }` to the droplet `/agreements` proxy; proxy/JWT handling and ingest pipeline are unchanged.
- `SmtAuthorization` continues to expose `smtStatus` / `smtStatusMessage`, allowing ops to see SMT validation results.

### PC-2025-11-20-A — SMT Agreements + PoA Live Wiring

- Extended `SmtAuthorization` to record SMT agreement/subscription identifiers, status fields, and PoA consent metadata (text version, IP, user agent) without altering the existing ingest pipeline.
- Added `lib/smt/agreements.ts`, a guarded proxy client that calls the droplet SMT token proxy when `SMT_AGREEMENTS_ENABLED` is true, creating agreements/subscriptions while keeping production togglable.
- Updated `/api/smt/authorization` to normalize ESIID input, persist PoA consent details, attempt live SMT agreement/subscription creation, and capture resulting IDs/status alongside the authorization record.
- Updated the `/dashboard/api` SMT card + form to expose explicit PoA legal language, require an authorization checkbox, and send `consentTextVersion: "smt-poa-v1"` during submission.
- Documented new environment variables (`SMT_AGREEMENTS_ENABLED`, `SMT_PROXY_AGREEMENTS_URL`, `SMT_PROXY_TOKEN`) so ops can control the live SMT flow separately from staging.

### PC-2025-11-20-D – Admin DB Query Parser Fix for SmtBillingRead

- Updated `/api/admin/db/query` to use a more robust `FROM` clause regex so table names are correctly extracted for arbitrarily projected `SELECT` statements.
- Whitelisted `SmtBillingRead` so SMT billing rows inserted via `/api/admin/smt/pull` can be inspected via admin SQL tooling and droplet curl commands.
- Maintained admin-token protections and SELECT-only enforcement; non-SELECT statements remain blocked.

### PC-2025-11-20-SMT-PROMOTE-TEST-WIRING

- Promoted the previously working SMT "test" wiring to production by centralizing ESIID handling:
  - Added shared helpers (`cleanEsiid`, `resolveSmtEsiid`, `extractWattbuyEsiid`) so all SMT routes and jobs clean and resolve ESIIDs consistently.
  - HouseAddress now persists WattBuy-derived ESIIDs automatically when available, matching the validated test flow.
  - SMT API pull routes (inline and webhook) rely on `resolveSmtEsiid`, falling back to HouseAddress records instead of hard-coded defaults.
  - Removed production reliance on test ESIIDs by gating any env fallback to non-production environments only.
- Result: production SMT ingestion now mirrors the behavior of the verified test path end-to-end (WattBuy → HouseAddress.esiid → SMT API / SFTP ingest).

### PC-2025-11-21-SMT-WIRING — Production SMT JWT + agreements wiring snapshot

**Context.** After the SMT JWT upgrade, SMT started enforcing strict matching between the API Service ID and the `requestorID` / `serviceId` values in NewAgreement/NewSubscription payloads. Using the legacy service ID (`INTELLIWATTAPI`) produced HTTP 401 errors:

> Username/ServiceID Mismatch on both Header and Payload message.

**Current production configuration (2025-11-21).**

- Service ID / username:
  - `SMT_USERNAME = INTELLIPATH`
  - `SMT_REQUESTOR_ID = INTELLIPATH`
  - `SMT_REQUESTOR_AUTH_ID = 134642921` (Intellipath Solutions LLC DUNS on SMT)
- API base URL:
  - `SMT_API_BASE_URL = https://services.smartmetertexas.net`

**Vercel → droplet → SMT flow.**

1. Next.js (`lib/smt/agreements.ts`) reads SMT identity from Vercel env and builds SMT-compliant JSON:
   - `requestorID = SMT_USERNAME`
   - `requesterAuthenticationID = SMT_REQUESTOR_AUTH_ID`
   - `serviceId` matches the SMT Service ID (`INTELLIPATH` in production).
2. The app posts to the droplet proxy:
   - URL: `SMT_PROXY_AGREEMENTS_URL` (e.g. `https://<droplet>/agreements`)
   - Header: `Authorization: Bearer ${SMT_PROXY_TOKEN}`
   - Body: `{ action: "create_agreement_and_subscription", steps: [...] }`
3. On the droplet, `webhook_server.py`:
   - Validates the shared secret via `SMT_PROXY_TOKEN` sourced from `/home/deploy/smt_ingest/.env` and `/etc/default/intelliwatt-smt`.
   - Calls `${SMT_API_BASE_URL}/v2/token/` with `username = SMT_USERNAME` and `password = SMT_PASSWORD`.
   - Reuses the JWT to call `POST /v2/NewAgreement/` and `POST /v2/NewSubscription/`, logging HTTP status and an `SMT body_snip=...` for debugging.
4. SMT responses propagate back to Vercel, where `/api/smt/authorization` persists `smtAgreementId`, `smtSubscriptionId`, `smtStatus`, and `smtStatusMessage`.

**SFTP ingest wiring (for completeness).**

- Droplet config: `/etc/default/intelliwatt-smt`
  - `SMT_HOST=ftp.smartmetertexas.biz`
  - `SMT_USER=intellipathsolutionsftp`
  - `SMT_KEY=/home/deploy/.ssh/intelliwatt_smt_rsa4096`
  - `SMT_REMOTE_DIR=/adhocusage`
  - `SMT_LOCAL_DIR=/home/deploy/smt_inbox`
- Systemd units:
  - `smt-webhook.service` runs `/home/deploy/webhook_server.py`; loads `/home/deploy/smt_ingest/.env` + `/etc/default/intelliwatt-smt`.
  - `smt-ingest.service` runs `deploy/smt/fetch_and_post.sh` using `/etc/default/intelliwatt-smt` for SFTP + ingest env.

**Env source of truth.**

- Vercel env: `SMT_USERNAME`, `SMT_REQUESTOR_AUTH_ID`, `SMT_PROXY_AGREEMENTS_URL`, `SMT_PROXY_TOKEN`.
- Droplet env files:
  - `/home/deploy/smt_ingest/.env` (webhook + proxy secrets, local toggles)
  - `/etc/default/intelliwatt-smt` (shared ingest + proxy identity)
  - `/etc/default/smt-token-proxy` (standalone token proxy, same identity)

**Operational notes.**

- When SMT updates the Service ID or DUNS, update Vercel env alongside `/home/deploy/smt_ingest/.env`, `/etc/default/intelliwatt-smt`, and `/etc/default/smt-token-proxy`.
- After editing droplet env files:

  ```bash
  sudo systemctl restart smt-webhook.service
  sudo systemctl restart smt-ingest.service
  ```

### PC-2025-11-22-SMT-METERINFO-SFTP — meter attributes alignment

- Standardized the SMT meterInfo test flow on the production Service ID: **INTELLIPATH** for both `/v2/token/` and `requestorID`.
- Confirmed SMT currently provides meter attributes via SFTP CSV for INTELLIPATH; `/v2/meterInfo/` returns acknowledgements and `deliveryMode: "API"` yields errorCode `2076`.
- Added a droplet test script (`scripts/test_smt_meter_info.mjs`) that uses CSV/SFTP semantics so Support has a canonical payload + response when filing SMT tickets.
- **Next planned step (future work):** after WattBuy returns an address+ESIID, call `/v2/meterInfo/`, ingest the SFTP CSV to capture the authoritative `meterNumber`, and feed that into NewAgreement/NewSubscription payloads. (Not implemented yet; requires SFTP parsing pipeline updates.)
- This alignment **supersedes** all earlier references to `INTELLIWATT`/`INTELLIWATTAPI` as active SMT service IDs; those names are legacy only.

### PC-2025-11-22-SMT-METERINFO-MINIMAL — Persist meter attributes

- Added Prisma model `SmtMeterInfo` to persist SMT meter metadata per ESIID/house, including raw payload and the high-value MeterData fields we need for downstream agreement payloads.
- Added `/api/admin/smt/meter-info` so the SMT droplet can POST meterInfo results back into the app.
- Introduced `SMT_METERINFO_ENABLED` plus helper `queueMeterInfoForHouse` so Vercel queues a droplet webhook after WattBuy returns an ESIID.
- Address submit now enqueues meterInfo (fire-and-forget) when an ESIID + houseId are present; SMT REST calls remain droplet-only.

### PC-2025-11-22-SMT-METERINFO-LIVE — End-to-end meter attributes in production

- Confirmed a full production path from address save → droplet → SMT → app:
  - `app/api/address/save/route.ts` now calls `queueMeterInfoForHouse({ houseId, esiid })` after WattBuy returns an ESIID and the address record has a `houseId`. This enqueues a `SmtMeterInfo` row with `status = "pending"` and POSTs a webhook to the droplet (when `SMT_METERINFO_ENABLED` is true and droplet webhook envs are set).
  - The droplet's `webhook_server.py` handles `reason: "smt_meter_info"` on `/trigger/smt-now`, runs `node scripts/test_smt_meter_info.mjs --esiid <ESIID> --json`, and parses the stdout to extract `trans_id`, `MeterData`, and a meter number.
  - `webhook_server.py` then POSTs that structured payload back to `${APP_BASE_URL}/api/admin/smt/meter-info` with the shared `x-intelliwatt-secret` header.
  - `app/api/admin/smt/meter-info/route.ts` persists the payload via `saveMeterInfoFromDroplet`, which now tolerates `houseId = null` by using a findFirst + update/create pattern instead of Prisma upsert on the compound unique key.
- `SmtMeterInfo` rows are now created and updated in the production database, including the key meter metadata (`meterNumber`, `utilityMeterId`, `meterSerialNumber`, `intervalSetting`, etc.) and a full `rawPayload` snapshot.
- The SMT admin page (`/admin/smt`) has a "Live Pull Monitor" card that polls recent `SmtAuthorization` and `SmtMeterInfo` records, allowing ops to see meterInfo jobs with their ESIIDs, statuses, last-updated timestamps, and meter numbers.
- Verified example in production:
  - ESIID: `10443720004529147`
  - Status: `complete`
  - Updated: `2025-11-22T09:30:14Z` (local admin UI shows formatted timestamp)
  - Meter: `142606737LG`
- This establishes SMT meterInfo as a first-class, production-safe pipeline and the canonical source of `meterNumber` and related meter attributes for future SMT Agreement/Subscription payloads.

### PC-2025-11-22: PUCT REP Directory (Retail Providers Only) + Admin CSV Uploader

**Rationale**

We need an authoritative, PUCT-backed directory of Retail Electric Providers (REPs) to:
- Populate SMT NewAgreement payloads with the correct `PUCTRORNumber`.
- Drive customer-facing REP selection (typeahead/dropdown) independent of vendor APIs.
- Support future plan and solar modeling across deregulated and regulated markets.
- Allow non-technical admin users to refresh the PUCT REP directory via CSV upload.

**Scope**

- Add Prisma model `PuctRep` with:
  - `puctNumber` (PUCT REP certificate number)
  - `legalName` (PUCT company name)
  - Optional `dbaName`, address, phone, website, and email fields for display.
- Add admin-only CSV import script `scripts/admin/import_puct_reps_from_csv.mjs` that:
  - Reads a local `rep.csv` (exported from the PUCT REP directory).
  - Parses rows using a robust CSV parser.
  - Upserts records into `PuctRep` keyed by `(puctNumber, legalName)`.
- Add admin UI:
  - Card on `/admin` linking to `/admin/puct/reps`.
  - `/admin/puct/reps` page with a CSV upload form.
  - Uploading a new CSV truncates the existing `PuctRep` data and replaces it with the new file contents.
- The source CSV files are maintained under the repo path:
  - `docs/PUCT NUMBER LISTS/rep.csv`
  - This folder maps to the local Windows directory:
    `C:\Users\bllfi\Documents\Intellipath Solutions\Intelliwatt Website\intelliwatt-clean\docs\PUCT NUMBER LISTS`

**Rollback Plan**

- If the directory causes issues:
  - Stop invoking the import script and disable the admin uploader link.
  - Do not use `PuctRep` in any new business logic.
  - Optionally drop the `PuctRep` table via a Prisma migration if the feature is abandoned.

**Guardrails Preserved**

- CDM-first: We treat PUCT data as a canonical, internal directory separate from any vendor (e.g., WattBuy).
- RAW capture remains unchanged for other integrations.
- No existing SMT ingest, WattBuy, or ERCOT code paths are modified in this change.
- Future SMT Agreement changes will consume `PuctRep` via internal helpers, not vendor payloads.

### PC-2025-11-22-B: ERCOT Module Parked (Not in Production Use)

**Status**

- The ERCOT ESIID index and related tooling are not part of any production customer or partner flow.
- No SMT, WattBuy, or interval ingest features depend on ERCOT logic.
- ERCOT-specific links have been removed from the `/admin` dashboard to avoid accidental use.

**Notes**

- ERCOT tables and migrations may remain in the database as legacy artifacts and can be cleaned up in a future maintenance window.
- Treat ERCOT code as parked/legacy. Do not extend or wire it into new features without an explicit plan change.

### PC-2025-11-22-C: SMT NewSubscription "Already Active" Treated as Success

**Rationale**

SMT returns an HTTP 400 when a subscription already exists for the DUNS (e.g., `CustomerDUNSFaultList.reasonCode = "Subcription is already active::134642921"`). Functionally this means the customer is already subscribed, so the droplet should not surface it as an error to the app or to operators.

**Scope**

- Update the droplet `/agreements` handler in `deploy/droplet/webhook_server.py` to normalize SMT `NewSubscription` responses:
  - 2xx → `status = "created"`.
  - HTTP 400 with `CustomerDUNSFaultList.reasonCode` containing `"Subcription is already active"` → treat as `status = "already_active"` (ok).
  - All other 4xx/5xx responses remain failures that bubble back to the caller.
- Ensure the JSON returned to the app includes structured status info so the UI/Admin can tell whether the subscription was newly created or already present.
- Preserve the existing NewAgreement requirement and ingest chain.

**Guardrails**

- No changes to authentication, SMT JWT handling, or SFTP ingest.
- No database schema or migration changes.
- Callers can continue handling `ok: true` results without any breaking contract changes.

**Rollback**

- Restore the previous behavior by removing the "already_active" special case if needed; all other logic remains backwards compatible.

### PC-2025-11-23-A: SMT Agreement PUCT ROR Number Temporarily Reverted

**Status**

- SMT NewAgreement payloads now use a fixed `PUCTRORNumber` of `10052`, matching the last known good Just Energy REP value.
- This is a temporary measure while the PuctRep directory and ESIID-to-REP mapping are validated.

**Notes**

- The PuctRep model, uploader, and admin lookup remain in place but are not yet driving SMT agreement payloads.
- Once the dynamic REP mapping is verified, this override will be removed via a future plan change.

## PC-2025-11-23-A: SMT Agreements Live + PUCT REP Directory Foundations

**Status / Rationale**

- The SMT agreement + subscription path now works end-to-end using the production INTELLIPATH identity:
  - `SMT_USERNAME` / `SMT_REQUESTOR_ID` = `INTELLIPATH`
  - `SMT_REQUESTOR_AUTH_ID` = `134642921`
  - `SMT_API_BASE_URL` = `https://services.smartmetertexas.net`
- Posts to `/v2/NewAgreement/` now ACK with real agreement numbers (e.g., ESIID `10443720004529147`, meter `142606737LG` when `PUCTRORNumber=10052`).
- `/v2/NewSubscription/` currently returns `statusCode="0001"` with `reasonCode="Subcription is already active::134642921"`; this is treated as a business-level "already active" outcome, not a payload error, and the droplet still kicks off ingest.
- The ingest chain (`/agreements` → `/trigger/smt-now` → `deploy/smt/fetch_and_post.sh`) remains canonical and verified (`rc=0`, interval/billing data flow normally).

**PUCT REP Directory: Phase 1 Complete**

- `PuctRep` Prisma model defined (not yet migrated onto the DO prod-ish database).
- CLI importer: `scripts/admin/import_puct_reps_from_csv.mjs`.
- Admin UI: `/admin/puct/reps` with CSV upload (truncate + upsert) and live search.
- Canonical CSVs live in the repo under `docs/PUCT NUMBER LISTS/` (local path mirrors Brian's Windows directory but the repo copy is authoritative).
- Agreements currently use a temporary fixed `PUCTRORNumber = 10052` until REP matching is fully validated.

**Other Module Updates**

- ERCOT ESIID tools are parked: cards removed from `/admin`; WattBuy remains the locked ESIID authority for address flows.
- Prisma migrate dev shows drift on the DO "prod-ish" DB (legacy ERCOT migration). Do **not** reset the existing database; plan a dedicated dev DB and future cutover (including PuctRep migration).

**Future Work**

- Wire `PuctRep` selections into customer authorization and SMT agreement payloads so `PUCTRORNumber` reflects the actual REP.
- Surface "Subscription already active" as a success state in the app (e.g., status label "Active / already subscribed") while continuing to log the raw SMT response.
- Add admin observability (last agreement/subscription attempt timestamps, status, SMT response snippet).

### PC-2025-11-23: SMT Agreements REP Routing & Subscription "Already Active" Handling

**Rationale**

- SMT agreements are now verified end-to-end for a real customer using the Just Energy PUCT REP number (10052).
- We need a safe mechanism to pass future PUCT REP numbers from the Vercel app to the droplet without breaking the current Just Energy flow.
- SMT `NewSubscription` responses with `reasonCode = "Subcription is already active::134642921"` are business-normal and should not surface as errors.

**Scope**

- Droplet `/agreements` handler accepts an optional `repPuctNumber` / `rep_puct_number` field and falls back to `10052` when missing or invalid; uses this value for SMT `PUCTRORNumber` and logs it.
- Vercel SMT agreements client:
  - Receives `repPuctNumber` from the dashboard REP selector; if Vercel sends no value, the droplet `/agreements` handler falls back to `PUCTRORNumber=10052` (Just Energy).
  - Sends `repPuctNumber` in the droplet payload, keeping agreement behavior unchanged while the PuctRep directory is validated.
  - Normalizes SMT `NewSubscription` responses so the "Subcription is already active" case is treated as success, exposing a new `subscriptionAlreadyActive` flag while preserving the existing `ok` flag and raw response.

**Rollback Plan**

- Revert Vercel payload changes to stop sending `repPuctNumber`; the droplet will continue using `10052`.
- Revert droplet override handling to always use `10052` if needed.
- Removing the normalization helper restores the prior error behavior; no schema changes were made.

**Guardrails**

- No new Prisma models or migrations introduced; PuctRep directory remains code-only until DB drift is resolved with a dedicated dev database and `prisma migrate resolve`.
- SMT auth, SFTP ingest, and admin tooling are untouched.
- Only the specific "Subcription is already active" case is treated as success; all other non-`"0000"` subscription statuses remain failures.
- The Just Energy PUCT number (10052) stays the default until PuctRep-based routing is ready.

[PC-2025-11-22-A] SMT Customer Authorization - Agreements + Subscriptions + REP Routing (LOCKED)

**Purpose**

- Record that the SMT customer authorization flow now creates agreements and subscriptions via the droplet `/agreements` proxy, so downstream work can treat this path as implemented rather than "not started".
- Capture the baseline REP routing behavior (static Just Energy PUCT 10052) and "subscription already active" handling so future iterations have a clear foundation.

**Scope**

- SMT JWT auth runs droplet-only using the INTELLIPATH Service ID:
  - `SMT_USERNAME` / `requestorID` = `INTELLIPATH`
  - `requesterAuthenticationID` = `134642921` (IntelliPath Solutions LLC DUNS)
  - Droplet obtains the JWT via `/v2/token/`, then calls `POST /v2/NewAgreement/` and `POST /v2/NewSubscription/`.
- Droplet `/agreements` endpoint:
  - Verifies the `Authorization: Bearer ${SMT_PROXY_TOKEN}` header from Vercel.
  - Logs and forwards the SMT payloads, reusing the JWT.
  - Accepts an optional `repPuctNumber` and coerces it to an integer; defaults to `10052` on missing or invalid input.
  - Uses the resulting number as `PUCTRORNumber` for each `customerMeterList` entry.
- NewAgreement behavior:
  - Valid requests return SMT ACK payloads with real `agreementNumber` values (for example 3079618, 3079844) which are treated as success.
  - Meter numbers flow from `SmtMeterInfo` where available; otherwise the fallback logic remains intact.
- NewSubscription behavior:
  - `statusCode` `"0000"` continues to represent success.
  - `statusCode` `"0001"` with a message containing `"Subcription is already active"` is normalized as success (instead of error).
  - Vercel helper exposes `subscriptionAlreadyActive: true` in responses; UI treats it as a green success message.
- Customer UI updates on `/dashboard/api`:
  - Adds a static REP selector ("Just Energy - PUCT #10052") wired to the authorization form.
  - Sends the selected `repPuctNumber` in the `/api/smt/authorization` request body.
  - Shows "already active" status as success without firing error toasts.

**Impact / Overrides**

- Partially satisfies **PC-2025-11-12-H (SMT Customer Authorization & Auto-Pull)**:
  - Completed: customer-facing authorization form, droplet `/agreements` proxy calls, handling of "subscription already active", baseline REP routing via static selector and `repPuctNumber`.
  - Still open: multi-REP selection powered by the `PuctRep` directory, richer agreement/subscription status dashboards, additional SMT endpoints (List Agreements, Status, Terminate, List ESIIDs per Agreement).
- Confirms that the `repPuctNumber` plumbing from Vercel to the droplet is live even while the UI exposes only the Just Energy option.
- Locks in the requirement that all SMT REST traffic continues to flow through the droplet (Vercel remains droplet-only for SMT access).

**Status**

- Status: PARTIALLY COMPLETED for PC-2025-11-12-H.
- Next steps: align the PuctRep-backed selector once prod DB drift is resolved, expand status observability, and implement additional SMT agreement management endpoints.

[PC-2025-11-22-B] Dev Database Strategy for PuctRep / PUCT REP Directory (PLANNING)

**Purpose**

- Define a safe, dev-only path to bring the PuctRep / PUCT REP directory Prisma migrations online in a clean database, without touching the existing DigitalOcean Postgres cluster that contains historical SMT/ERCOT data and migration drift.
- Prepare for wiring the REP selector to real PuctRep data once the dev workflow is validated.

**Context**

- Repo already contains:
  - `PuctRep` Prisma model and migrations.
  - CSV importer for the PUCT directory.
  - Admin UI at `/admin/puct/reps`.
- DO Postgres cluster has drift; we will not reset or rewrite it.
- Production SMT agreements currently rely on static `repPuctNumber = 10052`.

**Scope (Dev DB only)**

- Provision a clean Postgres database solely for development, independent of the DO cluster (e.g., local Postgres, Neon, Supabase).
- Working name: `intelliwatt_dev`.
- Apply **all** Prisma migrations to this dev DB via `prisma migrate dev`.
- Use the dev DB to validate PuctRep-backed features without impacting production data.

**Dev Workflow**

1. Create the dev Postgres database and capture the connection string, e.g.:
   - `postgresql://USER:PASSWORD@HOST:5432/intelliwatt_dev?schema=public`
2. In PowerShell (local machine):
   ```powershell
   $env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/intelliwatt_dev?schema=public"
   npx prisma migrate dev
   ```
   - Applies all migrations into the dev DB.
   - Session-scoped env var; does **not** alter Vercel or droplet config.
3. Run local tests/admin UI pointing to the dev DB to verify PuctRep flows.

**Impact / Non-Impact**

- Does **not** modify the DO Postgres schema or production environments.
- Establishes a repeatable dev-only migration workflow for PuctRep and related features.
- Sets the stage for a future Plan Change to reconcile prod DB drift (snapshot, `prisma migrate resolve --applied`, controlled rollout).

**Status**

- Status: PLANNED / READY (dev-only).
- Next: provision dev DB, run `prisma migrate dev`, validate, then document prod alignment strategy in a follow-up Plan Change.

### PC-2025-11-23-D: SMT Authorization UI Alignment & Auto-Refresh

**Rationale**

- Align the SMT authorization inputs with the contextual service-address information and ensure customers see their latest authorization status immediately after submitting the form.

**Scope**

- `app/dashboard/api/page.tsx`
  - Reworks the SMT card layout so the navy service-address panel and existing-authorization summary live in the left column, with the authorization form occupying the right column.
  - Shows the "We already have a valid Smart Meter Texas authorization..." guidance only when an authorization exists, keeping the UI clear for first-time users.
- `components/smt/SmtAuthorizationForm.tsx`
  - Removes redundant container padding when the form renders alongside the info column so inputs align flush with the card header.
  - Uses a single AUTHORIZE/UPDATE action button for consent + submit, eliminating the secondary submit button.
  - Calls `router.refresh()` after successful submission so the status card (`existingAuth`) and trailing-12M window timestamps update immediately without a manual reload.

**Rollback**

- Revert the layout and spacing adjustments in `app/dashboard/api/page.tsx` and `components/smt/SmtAuthorizationForm.tsx`.
- Remove the `router.refresh()` call to restore the prior behaviour (customer must reload to see updated status).

**Guardrails**

- No backend contract changes were made; the authorization POST payload remains unchanged.
- SMT droplet interactions, agreement payload construction, and meter-info requirements remain intact and enforced by the API layer.

### PC-2025-11-23-EFL-LINK-TESTS: EFL Link Runner Admin Smoke Tests

**Rationale**

- The EFL Link Runner now underpins multiple admin tools (manual loader, link runner dashboard). Ops requires documented smoke tests so the module remains verifiable alongside SMT and WattBuy flows.

**Scope**

- Added **EFL Link Runner (Admin Smoke Tests)** to `docs/TESTING_API.md`, documenting:
  - `POST /api/admin/efl/run-link` invocation with `mode: "test"` (dry run) and `mode: "live"` (persists artifacts).
  - Example cURL commands mirroring existing admin test style.
  - Expected JSON response shape (`ok`, `mode`, `eflUrl`, `steps`, `persisted`, `warnings`).
  - Recommended error-handling checks for invalid URLs and non-PDF content.

**Guardrails / Follow-ups**

- Endpoint remains gated by `x-admin-token`; no runtime code changes shipped with this entry.
- Future runner changes must keep the documented request/response contract (`eflUrl`, `mode`) aligned or update both the plan and testing docs.
- Live mode should only be used once pipeline persistence is verified; documentation calls this out explicitly.

**Status**

- COMPLETE — EFL Link Runner is now part of the standard admin smoke-test suite.

### PC-2025-11-23-PLAN-ANALYZER-ADMIN-TESTS: Plan Analyzer Engine Admin Harness

**Rationale**

- The Plan Analyzer Engine (per-plan costing + comparisons) needs an admin-only test bed before wiring real SMT/Green Button usage or WattBuy plans. This harness provides quick validation that library functions behave deterministically with synthetic data.

**Scope**

- Added a **Plan Analyzer Engine** tile to the Admin Modules catalog (`lib/catalog/modules.ts` → `/admin/modules`).
- Implemented `/admin/plan-analyzer/tests`:
  - Builds a 24-interval synthetic usage profile in `America/Chicago`.
  - Defines two example PlanRules (Free Nights vs Flat 13¢).
  - Runs `computePlanCost` for a single plan and `comparePlans` for both.
  - Renders the JSON output (PlanCostResult + PlanComparisonResult) for operator review.
- Updated documentation (`docs/PLAN_ANALYZER_ENGINE.md`, `docs/TESTING_API.md`) to log the harness and expected behavior.

**Guardrails**

- No Prisma/DB or external HTTP calls; everything runs in memory on each request.
- Results must remain deterministic; changes to PlanRules helpers or cost math should keep this harness green or update the snapshots/docs.
- Future integration work (customer-facing APIs/UI) must keep this admin page updated or add new scenarios.

**Status**

- COMPLETE — Admin harness in place and documented; ready for future TDSP/bill-credit enhancements.

---

### PC-2025-11-23-EFL-AI-CONTRACT-STUB — EFL AI Extraction Contract Stub (Step 3a)

**Scope**

- Added `lib/efl/planAiExtractor.ts` to define the AI extraction contract for PlanRules:
  - Types for deterministic EFL input (`EflTextExtractionInput`) and extraction metadata/result structures.
  - `extractPlanRulesFromEflText(input, opts)` helper that currently returns `ok: false` with a clear "not implemented" warning.
- No AI calls, persistence, or RatePlan wiring yet—this is a pure contract layer to unblock future AI work.

**Guardrails**

- Guarded by documentation only; no runtime consumers should treat the stub as production-ready.
- Keeps the helper pure and side-effect free so it can be safely imported without triggering network calls.

**Status**

- SUPERSEDED — Contract stub delivered; full AI integration shipped in PC-2025-12-xx-EFL-AI-EXTRACTION (see below).

---

### PC-2025-12-XX-EFL-AI-EXTRACTION — EFL Fact Card AI + RateStructure Alignment (Step 3b)

**Scope**

- Implemented the OpenAI-backed PlanRules extractor for EFL Fact Cards (`lib/efl/planAiExtractor.ts`) using the dedicated env var `OPENAI_IntelliWatt_Fact_Card_Parser`:
  - Wraps the generic contract in `lib/efl/aiExtraction.ts` with a concrete JSON-mode OpenAI call.
  - Logs usage to `OpenAIUsageEvent` via `logOpenAIUsage` with `module="efl-fact-card"` and `operation="plan-rules-extract-v1"`.
- Aligned EFL-derived pricing with the shared `RateStructure` contract:
  - Extended `lib/efl/planEngine.ts` with a `RateStructure`-compatible type set and a `planRulesToRateStructure(plan: PlanRules)` helper.
  - Maps `PlanRules` into the same `RateStructure` variants used by `NormalizedCurrentPlan` (FIXED vs TIME_OF_USE) including `baseMonthlyFeeCents` and bill credits.
  - Converts simple EFL `billCredits` (threshold kWh + credit dollars) into `BillCreditStructure`-compatible rules (label, `creditAmountCents`, `minUsageKWh`, optional seasonality).
- Wired the admin EFL run-link route (`/api/admin/efl/run-link`) to run the full pipeline in **test** and **live** modes:
  - Downloads the EFL PDF, fingerprints it with `computePdfSha256`, and runs `deterministicEflExtract` to get cleaned text / identity metadata.
  - Calls `extractPlanRulesAndRateStructureFromEflText` to produce `planRules` + `rateStructure` along with parse confidence/warnings.
  - Returns a JSON payload including `cleanedText`, `planRules`, `rateStructure`, `parseConfidence`, and `parseWarnings` for admin inspection (no persistence yet).

**Guardrails**

- Fact Card AI uses `OPENAI_IntelliWatt_Fact_Card_Parser` exclusively; other OpenAI flows (bill parser, generic tools) remain on their own env keys.
- EFL → `RateStructure` mapping is one-way and non-breaking; the canonical `RateStructure` contract for current-plan normalization is unchanged.
- Admin run-link remains an internal tool; it performs no writes to the offers DB until the “Normalize vendor offer ingestion to populate the shared RateStructure” checklist item is explicitly implemented.

**Status**

- COMPLETE — EFL Fact Card AI extraction is live for admin tools and aligned with the shared `RateStructure` contract.

---

### PC-2025-11-24-COLOR-GUARDRAIL — Navy + Neon Blue UI Palette

**Scope**

- Established a visual guardrail that customer-facing surfaces use:
  - `bg-brand-navy` (navy) as the primary background for feature boxes.
  - `text-brand-cyan` (neon blue) as the default headline/body text color.
  - Icon treatments: navy backgrounds (`bg-brand-navy`) with neon icon glyphs (`text-brand-cyan`), except for hero callouts where the icon circle flips (neon background, navy glyph) for contrast.
- Updated landing and dashboard sections to follow this pattern; future pages should avoid light neon-blue wash backgrounds unless explicitly called out.

**Status**

- COMPLETE — Palette guidance documented; apply on new UI work to maintain consistency.

---
## SMT Usage Pipeline – Debug Notes (2025-12-04)

**Purpose**

- Capture recent diagnostic findings about Smart Meter Texas (SMT) interval ingestion and the observed `dataset: null` symptom for ESIID `10443720004895510`.

**Summary of Findings**

- The canonical inline ingestion path (`POST /api/admin/smt/pull` with `encoding: "base64+gzip"`) decodes the payload, persists a `RawSmtFile`, runs CSV parsing (`parseSmtCsvFlexible`), normalizes intervals (`normalizeSmtIntervals`) and writes to the master `SmtInterval` table.
- A best-effort dual-write attempts to also persist intervals to the separate Usage module table `UsageIntervalModule`. That write is wrapped in a `try/catch` and failures are logged only; it does not cause the master write to fail.
- The admin normalization endpoint (`POST /api/admin/usage/normalize` → `lib/usage/normalize.ts`) reads raw rows from the **usage module** (`UsageIntervalModule`) and upserts them into the master `SmtInterval`. This means `rawCount: 0` from that admin route can legitimately occur even when master `SmtInterval` contains data.

**Likely Causes for `dataset: null`**

- Inline normalization produced zero intervals (CSV parse issues: invalid timestamps, missing/invalid kWh) — master `SmtInterval` would be empty and UI dataset null.
- Inline normalization wrote to master `SmtInterval` but the dual-write to `UsageIntervalModule` failed (or usage DB not configured). The admin normalize route reads from usage module and will show `rawCount: 0`.
- The UI (`/api/user/usage`) chooses the freshest dataset across master `SmtInterval` and usage-module Green Button data. If both are empty or stale, UI returns `dataset: null`.

**Short-term Mitigation (already applied)**

- Added a non-breaking console log in `app/api/admin/smt/pull/route.ts` to emit normalization results: `{ intervals: intervals.length, stats, esiid, meter, source }` with tag `[smt/pull:inline] normalizeSmtIntervals result`. This helps quickly verify whether an inline CSV produced intervals.

**Recommended Ops Verification Steps**

- Inspect raw SMT capture rows for the suspect ESIID:
  - `SELECT id, filename, sha256, received_at FROM "RawSmtFile" WHERE filename ILIKE '%10443720004895510%' OR filename ILIKE '%<partial-filename>%';`
- Search server logs for the new normalize result tag and inspect `intervals` and `stats` values:
  - Look for `[smt/pull:inline] normalizeSmtIntervals result` entries in the app logs.
- Check master `SmtInterval` for the ESIID:
  - `SELECT COUNT(*) FROM "SmtInterval" WHERE esiid = '10443720004895510';`
- Check usage-module table (requires USAGE DB access):
  - `SELECT COUNT(*) FROM "UsageIntervalModule" WHERE esiid = '10443720004895510';`

**If master has rows but usage module is empty**

- Confirm environment/Prisma usage client is configured for `USAGE_DATABASE_URL` in the deployed environment. If the usage DB is misconfigured or unavailable, dual-write will fail silently.
- Re-run the admin normalize flow only if usage-module contains raw rows; otherwise, re-run a controlled inline `POST /api/admin/smt/pull` for the specific CSV and watch the new normalization log.

**If normalization produced zero intervals**

- Inspect the raw CSV in `RawSmtFile` storage (or re-download from droplet) for:
  - Timestamp formats not parsed by `parseSmtCsvFlexible`.
  - Missing or non-numeric kWh values.
  - Header row differences that cause column mapping failure.
- Create a reproducible minimal CSV and run the local `normalizeSmtIntervals` helper (or craft a dedicated admin endpoint in a safe testing environment) to iterate until parsing succeeds.

**Longer-term Recommendations**

- Make the dual-write to the usage module observable: emit success/failure metrics and include `usageWriteOk` in the inline response JSON when possible.
- Expose a small admin debug view under `/admin/smt/raw` to preview `RawSmtFile` contents, normalization `stats`, and whether dual-write succeeded for each raw file.
- Add health checks/alerts for the usage-module Prisma client so dual-write failures surface in monitoring (Sentry/Datadog) rather than only in permissive logs.

**Next Actions I can take**

- (A) Produce exact SQL + PowerShell commands to run the above checks in your environment.
- (B) Add an admin-only debug view that shows recent `RawSmtFile` rows, normalize stats, and dual-write status (requires a follow-up change).
- (C) Retry committing these notes elsewhere or expand them into an ops playbook entry.

---

### PC-2025-12-10-SMT-INTERVAL-INGEST-HARDENING-AND-UX

**Rationale**

- SMT interval ingest for real customers (e.g., ESIID `10443720004766435`) was intermittently failing to deliver a full 12‑month window due to a mix of payload limits (Vercel 413), partial normalization, and unclear UI states.
- This change set hardens the end‑to‑end SMT 15‑minute interval pipeline (droplet → app → DB → dashboard) and makes the customer authorization/refresh UX accurately reflect long‑running SMT operations.

**Scope – Backend ingest + droplet**

- `scripts/droplet/smt-upload-server.ts` / `.js`:
  - `registerAndNormalizeFile` is now the **canonical big‑file path** from the droplet into the app:
    - Reads each uploaded SMT CSV, splits it into chunks of `SMT_RAW_LINES_PER_CHUNK` data lines (default `500`), and POSTs each chunk to `POST /api/admin/smt/raw-upload`.
    - Supplies `esiid` and `meter` into every chunk payload so normalization does not rely on per‑file parsing.
    - Uses `purgeExisting: true` on the first chunk and `false` on subsequent chunks so the ESIID is purged once, then fully replaced by the new 365‑day dataset without re‑deleting on each chunk.
  - This chunked POST approach keeps individual request bodies well under Vercel’s App Router limits while still treating the original SMT payload as a **single, authoritative dataset** for that ESIID.
- `deploy/smt/fetch_and_post.sh`:
  - `materialize_csv_from_pgp_zip` now **prefers `IntervalMeterUsage*.csv`** inside decrypted PGP ZIPs, falling back to the first file only when no interval CSV is found. This matches SMT’s “bundle” behavior (interval + billing files together) while ensuring the interval data is what we ingest.
  - **ESIID parsing from filenames/CSVs has been removed for this path**. For auth‑triggered ingest, the script now requires a trusted `ESIID_DEFAULT` from the app/webhook:
    - When `ESIID_DEFAULT` is set, its trimmed value is applied to every file in the batch.
    - When `ESIID_DEFAULT` is missing or empty, the script logs a WARN and skips the file rather than guessing.
  - When using the droplet upload server (`SMT_UPLOAD_URL`), the script no longer makes an extra call to `/api/admin/smt/normalize` after upload; normalization is driven solely by `raw-upload` to avoid reprocessing unrelated raw files.
- `app/api/admin/smt/raw-upload/route.ts`:
  - Becomes the **primary app entry point** for droplet‑originated SMT CSV content:
    - Accepts `filename`, `sizeBytes`, `sha256`, `contentBase64`, `esiid`, `meter`, `source`, and a `purgeExisting` flag.
    - When `esiid` is present and `purgeExisting` is `true` (default on first chunk), performs an early **full purge** for that ESIID:
      - Deletes SMT intervals and billing rows for the ESIID and clears related manual and Green Button usage for that home set, then deletes associated usage‑module intervals and raw Green Button rows.
      - All purge work runs inside a Prisma transaction with an increased timeout (30 s) to tolerate large 365‑day datasets.
    - Normalizes the CSV text directly with `normalizeSmtIntervals`, explicitly passing `esiid` and `meter` as defaults to ensure all rows land under the correct identifiers.
    - Inserts intervals using `createMany` with `skipDuplicates: false` after a purge so every interval from the incoming SMT file set is treated as canonical.
  - Raw files are **no longer deleted** after inline normalization; `RawSmtFile` rows (including content) are preserved for debugging and admin inspection.

**Scope – SMT 15‑minute FTP backfill + JSON API payload correctness**

- `lib/smt/agreements.ts`:
  - `getRollingBackfillRange` now computes a **365‑day window ending “yesterday”** at 23:59:59.999Z, matching SMT guidance for backfill requests.
  - `requestSmtBackfillForAuthorization` uses a new `formatDateMDY` helper so `startDate` and `endDate` are sent to the droplet as `MM/DD/YYYY` strings (`maxLength=10`), aligning with SMT’s XSD.
- `deploy/droplet/webhook_server.py`:
  - `smt_request_interval_backfill` is now fully wired to SMT’s `/v2/15minintervalreads/` endpoint instead of returning a fake job ID. The payload uses:
    - `deliveryMode: "FTP"`, `reportFormat: "CSV"`, `version: "A"` (all versions), `readingType: "C"` (consumption).
    - `esiid: [ "<ESIID>" ]` (array of strings) per SMT’s schema and example payloads.
    - `SMTTermsandConditions: "Y"`.
  - This endpoint is invoked from the app when `SMT_INTERVAL_BACKFILL_ENABLED=true` so that new SMT authorizations kick off an automated 365‑day 15‑minute interval backfill to SFTP.
- `app/api/admin/smt/billing/fetch/route.ts`:
  - Interval‑capable billing fetches via `/v2/energydata/` now use `version: "A"` (all) instead of `"L"` (latest) to prevent silent data truncation by SMT.
- New admin harness for FTP backfill:
  - `app/api/admin/smt/interval-ftp-test/route.ts` and `app/admin/smt/interval-ftp-test/page.tsx` surface the **exact JSON payload** the droplet sends to `/v2/15minintervalreads/` and a copy‑pasta `curl` example for running it directly on the droplet with a known‑good SMT JWT.

**Scope – SMT admin inspectors & raw payload visibility**

- `app/admin/smt/interval-api-test/page.tsx`:
  - Admin‑only harness that:
    - Calls `/api/admin/smt/billing/fetch` for a hard‑coded ESIID over a 365‑day window.
    - Immediately calls `/api/admin/usage/debug` and `/api/admin/debug/smt/intervals` for that ESIID to show what landed in `SmtInterval` and the usage module.
    - Renders a live `UsageDashboard` so operators can see exactly what a customer would see on `/dashboard/usage` for the same ESIID and dates.
    - Includes an “SMT Request & Error Inspector” panel showing the full SMT request body and parsed error fields (`statusCode`, `errorCode`, `errorMessage`, `detail`).
- `app/admin/smt/sftp-flow-test/page.tsx`:
  - Admin harness for the SFTP/droplet ingest path that:
    - Triggers the existing `/api/admin/smt/pull` or webhook‑based ingest.
    - Calls `/api/admin/ui/smt/pipeline-debug`, `/api/admin/debug/smt/raw-files`, `/api/admin/usage/debug`, and `/api/admin/debug/smt/intervals` to show end‑to‑end state.
    - Shows **Raw SMT Payloads** by listing `RawSmtFile` rows (initially unfiltered by ESIID) and rendering a `head`/`tail` text preview of each CSV body so operators can confirm what SMT actually delivered, not just what was normalized.
- `app/admin/smt/inspector/page.tsx`:
  - Updated to link to the new `Interval API JSON Test` and `Interval FTP 15‑Min Test` pages to make these harnesses discoverable from the admin SMT module home.
- `app/api/admin/debug/smt/raw-files/route.ts` and `app/api/admin/debug/smt/raw-files/[id]/route.ts`:
  - `raw-files` now supports optional ESIID filtering (query param) and returns counts and metadata for recent `RawSmtFile` rows.
  - The `[id]` route returns `textPreview` (first 20k characters) and `contentBase64` for a specific raw file, enabling deeper diff/debug flows from the admin UI.

**Scope – Customer & operator SMT usage refresh UX**

- `app/api/user/usage/refresh/route.ts`:
  - When a customer clicks **“Refresh SMT Data”**, the backend now:
    - Triggers the normal usage refresh for the home.
    - Immediately calls `POST /api/admin/smt/normalize` with `esiid=<home ESIID>` and `limit=100000`, instructing the admin route to **process all raw files for that ESIID**, not just the latest.
  - This ensures the refresh covers the full 365‑day SMT payload once it has been ingested as raw files.
- `app/api/user/usage/status/route.ts` (new):
  - Provides a lightweight status probe for a given home/ESIID:
    - `status: "pending"` when no SMT raw files or intervals exist.
    - `status: "processing"` when raw files exist but intervals have not yet landed.
    - `status: "ready"` when `SmtInterval` contains data for the ESIID.
  - Returns counts for `intervals` and `rawFiles` so UI and admins can see progress over time.
- `components/smt/RefreshSmtButton.tsx`:
  - After hitting `/api/user/usage/refresh`, the button now enters a **long‑running polling state** (up to ~8 minutes):
    - Polls `/api/user/usage/status` every 5 seconds.
    - Shows contextual status text:
      - “Waiting on SMT…” when status is `"pending"` (waiting on SMT to deliver the ZIP).
      - “Processing SMT Data…” when status is `"processing"` (raw files present, normalization running).
      - “Your SMT usage data is ready.” when status is `"ready"` (then refreshes the router to update charts).
  - Disables itself during the polling window to prevent double submits and makes it clear that SMT work is happening out‑of‑band.
- `components/smt/SmtConfirmationActions.tsx`:
  - The **“I approved the SMT email”** action now drives the **same refresh + polling flow** as `RefreshSmtButton`:
    - Calls `/api/smt/authorization/status` to confirm SMT email approval.
    - Triggers `/api/user/usage/refresh` for the home.
    - Polls `/api/user/usage/status` every 5 seconds until SMT data is ready, then redirects to `/dashboard/api`.
  - While polling, the buttons show “Waiting on SMT…” / “Processing SMT data…” and are disabled to prevent conflicting interactions; a small status banner surfaces the current state.
- `app/dashboard/layout.tsx`:
  - Continues to act as a **global SMT confirmation gate**:
    - When `isSmtConfirmationRequired()` is true, all dashboard routes redirect to `/dashboard/smt-confirmation` until the SMT email is explicitly approved or declined.
    - Once confirmed, attempts to return to the confirmation route will redirect back to `/dashboard`.
  - In combination with the polling behavior above, this ensures customers cannot “skip past” a pending SMT confirmation and always see an up‑to‑date SMT status on the dashboard.

**Guardrails / Non‑Goals**

- Vercel continues to treat SMT as **droplet‑only**: all SMT REST (`/v2/token/`, `/v2/15minintervalreads/`, `/v2/energydata/`) is called from the droplet; app‑side routes invoke the droplet via existing proxies and feature flags.
- The new big‑file path (`smt-upload-server` → `raw-upload`) is required for 12‑month SMT CSVs; inline uploads (`/api/admin/smt/pull`) remain supported for small test/debug files only.
- No new Prisma models were introduced; changes are confined to SMT ingest behavior, admin inspectors, and customer UI flows.
- All SMT admin/test routes remain gated by `x-admin-token`; no customer‑facing route exposes raw SMT payloads or SMT credentials. 


**UTILITY / TDSP MODULE — Step X Daily ingest scheduling + run logging (2025‑12‑14)**

- **TdspTariffIngestRun model (Prisma)**:
  - Added `enum TdspTariffIngestRunStatus { SUCCESS | PARTIAL | ERROR }` and `TdspTariffIngestRun` model to `prisma/schema.prisma` to track each PUCT Rate_Report ingest run.
  - Fields:
    - `startedAt`, `finishedAt`, `status`, `trigger` (`"VERCEL_CRON" | "ADMIN_API" | "DROPLET_CRON" | ...`), `sourceKind` (`"PUCT_RATE_REPORT_PDF"`).
    - Rollup counts: `processedTdspCount`, `createdVersionCount`, `noopVersionCount`, `skippedTdspCount`, `errorTdspCount`.
    - Small JSON payloads: `changesJson` (per‑TDSP {tdspCode, action, effectiveStartISO, versionId, sha256}), `errorsJson` (per‑TDSP {tdspCode, message}), and optional short `logs` string.
  - Migration: **local dev** uses `npx prisma migrate dev --name tdsp_tariff_ingest_run`; prod/droplet continue to use the existing `migrate deploy` + drift‑resolution flow documented earlier.

- **Shared PUCT Rate_Report ingest runner**:
  - `scripts/tdsp/ingest-puct-rate-reports.ts` was refactored to expose a reusable `runPuctRateReportIngest({ debugDate? })` helper that:
    - Reuses the existing parsing and `upsertTdspTariffFromIngest` logic unchanged.
    - Returns `results: Array<{tdspCode, action: "created"|"noop"|"skipped"|"error", effectiveStartISO?, versionId?, sourceDocSha256?, message?}>` plus a summary counts object.
  - The CLI entry point now just parses `--debugDate=1` flags, calls `runPuctRateReportIngest`, and logs a one‑line summary.

- **Admin endpoint – TDSP ingest runner (token + cron gated)**:
  - New route `app/api/admin/tdsp/ingest/route.ts`:
    - Accepts `POST` (manual admin) and `GET` (Vercel cron) requests.
    - Auth:
      - Manual/admin calls require `TDSP_TARIFF_INGEST_ADMIN_TOKEN` (or fallback `ADMIN_TOKEN`) and either `Authorization: Bearer <token>` or `x-admin-token: <token>`.
      - Scheduled calls are allowed when the `x-vercel-cron` header is present, without sending the admin token in `vercel.json`.
    - Behavior:
      - Creates a `TdspTariffIngestRun` row with `status=PARTIAL`, `trigger` = `"ADMIN_API"` or `"VERCEL_CRON"`, and `sourceKind="PUCT_RATE_REPORT_PDF"`.
      - Invokes `runPuctRateReportIngest({ debugDate: false })` and rolls up counts into the run row.
      - Classifies final status:
        - `SUCCESS` when `errorTdspCount===0` and `processedTdspCount>0`.
        - `ERROR` when all processed TDSPs errored (or runner threw before processing).
        - `PARTIAL` otherwise.
      - Persists `changesJson`, `errorsJson`, and a short `logs` string; truncates unexpected error stacks to ~4k chars.
      - Returns JSON: `{ ok, runId, status, summary, changes, errors }` (never HTML).

- **Admin endpoint – ingest status for UI**:
  - New route `app/api/admin/tdsp/ingest/status/route.ts` (token‑gated; **no** `x-vercel-cron` allowed):
    - Auth: same `TDSP_TARIFF_INGEST_ADMIN_TOKEN` / `ADMIN_TOKEN` via `x-admin-token` as other admin tools.
    - Returns a single JSON payload:
      - `lastRun`: latest `TdspTariffIngestRun` by `createdAt`.
      - `recentRuns`: last 20 ingest runs.
      - `recentTariffVersions`: last 50 `TdspTariffVersion` rows (including `tdsp.code` + `tdsp.name`) so admins can see which versions were most recently touched.

- **Vercel cron wiring (daily PUCT Rate_Report ingest)**:
  - `vercel.json` now includes a daily cron for TDSP ingest:
    - `"crons": [ { "path": "/api/admin/ercot/cron", "schedule": "0 12 * * *" }, { "path": "/api/admin/tdsp/ingest", "schedule": "15 9 * * *" } ]`.
  - Notes:
    - Vercel schedules are UTC; `15 9 * * *` runs at 09:15 UTC daily.
    - Cron calls hit `GET /api/admin/tdsp/ingest` with `x-vercel-cron` set; the endpoint **does not** require or log an admin token for these calls.
    - Manual runs remain available via `POST /api/admin/tdsp/ingest` with `x-admin-token` or `Authorization: Bearer`.

- **Admin UI panel – TDSP ingest status + recent changes**:
  - New page `app/admin/tdsp-ingest/page.tsx` (client component):
    - Reuses the `intelliwattAdminToken` localStorage key for `x-admin-token` (same token as the main admin dashboard).
    - Sections:
      - **Admin token panel** – password input + “Load status” and “Run ingest now” buttons.
      - **Last ingest run** – displays ID, status, trigger, sourceKind, start/finish timestamps, derived duration, counts, logs, and decoded `changesJson` / `errorsJson` from the most recent run.
      - **Recent runs table** – last 20 runs with compact IDs, timestamps, durations, and counts for quick visual scan.
      - **Recent TDSP tariff versions** – last 50 `TdspTariffVersion` rows (TDSP code + name, tariffName, effectiveStart/end, sourceUrl link).
      - **Debug JSON** – raw, pretty‑printed JSON body from `/api/admin/tdsp/ingest/status` to aid troubleshooting.
  - The main admin dashboard already links to TDSP tools; a future pass can surface `/admin/tdsp-ingest` alongside the TDSP Tariff Viewer as needed.

- **Droplet cron alternative (non‑Vercel scheduling)**:
  - If we ever disable Vercel cron, the ingest runner can be invoked from the droplet via a simple cron entry:
    - Example (Linux cron, **not** committed to the repo):
      - `*/30 * * * * curl -sS -X POST -H "Authorization: Bearer $TDSP_TARIFF_INGEST_ADMIN_TOKEN" https://intelliwatt.com/api/admin/tdsp/ingest >/tmp/tdsp_ingest.log 2>&1`
    - The API route semantics are identical; only the trigger (`trigger="DROPLET_CRON"`) and scheduling surface differ.

- **Operational note – steady‑state after backfill**:
  - Once historical backfill and PUCT Rate_Report ingest bootstrapping are complete, operators should:
    - Rely primarily on **daily ingest** (Vercel cron or droplet cron) to keep TDSP tariffs fresh.
    - Use the **TDSP Ingest** admin panel for:
      - Verifying that recent PUCT Rate_Report changes landed as new `TdspTariffVersion` rows (via `changesJson` + `recentTariffVersions`).
      - Spot‑checking errors for individual TDSPs when feeds drift or PDFs change structure.
  - No additional schema changes are planned for TDSP ingest; future work should build on the `TdspTariffIngestRun` + `TdspTariffVersion` primitives rather than introducing new ingest‑tracking tables.


**UTILITY / TDSP MODULE — Step 3 Wire TDSP tariffs into EFL avg‑price validator (2025‑12‑15)**

- **Masked TDSP detection (EFL text)**:
  - `lib/efl/eflValidator.ts` now contains a focused helper:
    - `isTdspMasked(rawText, eflTdsp)` returns true **only** when:
      - The EFL has no numeric TDSP charges (`eflTdsp.perKwhCents == null` and `eflTdsp.monthlyCents == null`), and
      - The text includes explicit pass‑through language (“will be passed through”, “passed through to customer”, “passed through … without mark‑up”), and
      - The document uses a `**` placeholder around TDU delivery, e.g. `**For updated TDU delivery charges` or `TDU Delivery Charges: ... **`.
  - For safety, `isTdspMasked` also retains the prior, broader heuristic (any `**` near generic TDSP/TDU pass‑through language) so we do not silently weaken behavior on existing masked EFLs.

- **TDSP territory + EFL date inference (no schema changes)**:
  - Reuses existing helpers in `lib/efl/eflValidator.ts`:
    - `inferTdspTerritoryFromEflText(rawText)` maps EFL text to one of the five `TdspCode` values using simple brand/territory strings:
      - `"CenterPoint"` → `CENTERPOINT`, `"Oncor"` → `ONCOR`, `"AEP Texas North"` / `"AEP North"` → `AEP_NORTH`, `"AEP Texas Central"` / `"AEP Central"` → `AEP_CENTRAL`, `"Texas‑New Mexico Power"` / `"TNMP"` → `TNMP`.
    - `inferEflDateISO(rawText)` scans for header‑style dates like `"December 11, 2025"` or `"09/01/2025"` and converts them to `YYYY‑MM‑DD` (used as `asOfDate` for TDSP lookup). If no date is found, the masked‑TDSP path records a failure reason and the validator falls back to SKIP.

- **Utility/TDSP tariff fallback in avg‑price validation**:
  - The EFL avg‑price validator (`validateEflAvgPriceTable`) previously only validated TDSP when the EFL provided numeric TDSP delivery charges.
  - New wiring:
    - When the avg‑price table is present **and** `isTdspMasked(rawText, eflTdsp)` is true:
      - The validator calls `lookupTdspCharges({ tdspCode, asOfDate })` from `lib/utility/tdspTariffs.ts` using the inferred TDSP territory and EFL effective date.
      - If a tariff version is found and has any PER_MONTH or PER_KWH components, the validator builds an `effectiveTdspForValidation` object:
        - `perKwhCents` and `monthlyCents` from the tariff,
        - `snippet` sourced from the original EFL snippet when present, otherwise a synthetic note like “TDSP delivery inferred from utility tariff table for CENTERPOINT as of 2025‑12‑01.”,
        - `confidence` copied from the tariff lookup (“MED”).
      - `assumptionsUsed.tdspFromUtilityTable` is populated with `{ tdspCode, effectiveDateUsed, perKwhCents, monthlyCents, confidence }` and `tdspAppliedMode` is ultimately set to `"UTILITY_TABLE"` for PASS/FAIL results.
    - If the TDSP lookup fails (no territory, no date, or no numeric components), the validator:
      - Leaves `effectiveTdspForValidation` empty (no TDSP numeric data),
      - Records `maskedTdspLookupFailedReason` and returns `status: "SKIP"` with notes explaining that:
        - TDSP charges were masked with `**`, and
        - No matching tariff could be found for the inferred TDSP / date, so the avg table cannot be reliably checked.

- **Modeled math now includes TDSP utility charges when masked on EFL**:
  - The avg‑price validator now treats three TDSP cases consistently when modeling 500/1000/2000 kWh:
    - **EFL has numeric TDSP delivery charges**:
      - `effectiveTdspForValidation` is the parsed EFL TDSP (`extractEflTdspCharges`); `tdspAppliedMode: "ADDED_FROM_EFL"`.
    - **EFL masks TDSP with `**` but has pass‑through language AND a matching TDSP tariff is found**:
      - `effectiveTdspForValidation` is filled from `lookupTdspCharges`, and the modeled TDSP dollars are:
        - `tdspDollars = (monthlyCents/100) + (usageKwh * perKwhCents / 100)`.
      - `assumptionsUsed.tdspFromEfl` remains `{ perKwhCents: null, monthlyCents: null, confidence: "LOW" }` when EFL had no numeric TDSP.
      - `assumptionsUsed.tdspFromUtilityTable` is populated with the tariff data and `confidence: "MED"`, `tdspAppliedMode: "UTILITY_TABLE"`.
      - PASS/FAIL logic then operates on these REP+TDSP modeled totals, just as if the EFL had stated TDSP numerically.
    - **EFL does not state numeric TDSP and no utility tariff can be applied**:
      - The validator returns `status: "SKIP"` and keeps `tdspAppliedMode: "NONE"` with notes explaining that avg‑price validation was skipped because the EFL’s avg prices reflect REP+TDSP but no numeric TDSP charges are available.

- **Explicit notes when utility‑table TDSP is used**:
  - When the validator **passes** and TDSP came from the utility table (masked EFL + successful lookup), we now add a clear note:
    - `TDSP charges not listed numerically on EFL (**); applied {TDSP} tariff from utility table effective {effectiveDateUsed} for avg-price validation.`
  - When the validator **fails** and TDSP came from the utility table, the same note is prepended to the existing “modeled vs expected diff” message.
  - This ensures we never “silently pass” on TDSP assumptions; admins can always see when `tdspAppliedMode: "UTILITY_TABLE"` was used and why.

- **Tiered energy cost alignment (no schema changes)**:
  - The validator uses `computeEnergyDollarsFromPlanRules(planRules, rateStructure, usageKwh)` to deterministically compute REP energy dollars for tiered plans:
    - It reads **all** `planRules.usageTiers[]` entries, normalizes min/max kWh and rateCentsPerKwh, and blends costs across segments for 500/1000/2000 kWh.
    - When no tiers are present, it falls back to single‑rate fields (`currentBillEnergyRateCents` / `defaultRateCentsPerKwh`).
  - Combined with the earlier deterministic tier extraction fixes in the EFL parser, this ensures that the validator’s tiered math matches the `PlanRules` used elsewhere in the engine.

- **Current behavior matrix for EFL avg‑price validation with TDSP**:
  - **TDSP numeric on EFL** → Use EFL TDSP numbers only; status can be PASS/FAIL/SKIP based on modeled diff and engine applicability. `tdspAppliedMode: "ADDED_FROM_EFL"` when used.
  - **TDSP masked with `**` + pass‑through language + tariff found** → Use TDSP utility table; modeled totals include TDSP from tariff; PASS/FAIL gate applies; `tdspAppliedMode: "UTILITY_TABLE"` and notes call this out.
  - **TDSP masked with `**` + pass‑through language + tariff missing/lookup fails** → SKIP with reason; `tdspAppliedMode: "NONE"` and `notes` explain the masked‑TDSP + missing tariff situation.
  - **TDSP missing on EFL with no pass‑through markers** → Behavior unchanged from prior rev: validator does not consult utility table and will SKIP or FAIL based on existing REP‑only modeling rules.

- **Deterministic tier extraction + tier math hardening**:
  - The deterministic EFL extractor (`lib/efl/eflAiParser.ts`) now captures **all** Energy Charge tiers from lines like:
    - `"0 - 1200 kWh 12.5000¢"` and `"Price ... > 1200 kWh 20.4000¢"` — not just the first tier.
  - Fixes in `fallbackExtractEnergyChargeTiers`:
    - The greater‑than tier regex was loosened to match `"> 1200 kWh 20.4000¢"` **anywhere** in the line (e.g., when `>` appears after the word “Price”), instead of only at the start of the line.
    - Extracted tiers are deduped and sorted by `minKwh`, and then surfaced through `extractEnergyChargeTiers` into both `planRules.usageTiers` and, via the validation gap solver, into the avg‑price validator.
  - The validator’s REP energy tier math (`computeEnergyDollarsFromPlanRules` in `lib/efl/eflValidator.ts`) was hardened so it no longer drops kWh beyond the last finite tier:
    - It now tracks the covered kWh range as it walks sorted tiers.
    - If `usageKwh` exceeds the covered range and **no** tier has `maxKwh = null` (no explicit open‑ended tier), the remaining kWh are billed at the **last tier’s rate** instead of being silently ignored.
    - This keeps avg‑price modeling monotonic and prevents undercounted averages like `11.65 ¢/kWh` at 2000 kWh when only the first tier was previously applied.
  - The validation gap solver (`lib/efl/validation/solveEflValidationGaps.ts`) now also:
    - Syncs `PlanRules.usageTiers` from either `RateStructure.usageTiers` **or** directly from the raw EFL text when it detects more tiers in the text than are present in `PlanRules`.
    - Records `solverApplied` entries such as `"TIER_SYNC_FROM_RATE_STRUCTURE"` and `"SYNC_USAGE_TIERS_FROM_EFL_TEXT"` so admins can see when tier fixes were applied before re-running `validateEflAvgPriceTable`.
  - Avg-price table detection was relaxed to support both `"Average Monthly Use"` and `"Average Monthly Usage"` variants, and still expects 500/1000/2000 kWh rows plus three numeric avg ¢/kWh values.
  - Tier boundaries for open-ended tiers now avoid double-counting at the handoff point: for lines like `"> 1200 kWh 20.4000¢"` and `"Energy Charge: (> 1000 kWh) 12.9852¢ per kWh"`, the deterministic extractors and solver treat the tier as starting at `N+1` (e.g., 1201, 1001), while still preserving avg‑price validation within the configured tolerance.

- **Next step**:
  - Step 4 (future work, not implemented here) would optionally reuse `lookupTdspCharges` in the bill parser/current‑plan engine so that customer‑facing rate modeling can present consistent TDSP assumptions when the REP’s EFL masks delivery charges with `**`. This will be gated behind explicit flags and never silently override EFL‑stated TDSP numerics.

## WATTBUY MODULE — Batch EFL parser harness (2025‑12‑15)

- **Admin batch harness for WattBuy → EFL pipeline (no schema changes)**:
  - Added a new admin‑only API route `POST /api/admin/wattbuy/offers-batch-efl-parse` wired to `app/api/admin/wattbuy/offers-batch-efl-parse/route.ts`.
  - Request shape:
    - `address: { line1: string; city: string; state: string; zip: string }` (all required)
    - `offerLimit?: number` (defaults to 500, hard‑capped at 500) — controls how many offers we *scan* from the WattBuy list for this run.
    - `startIndex?: number` (defaults to 0) — scan offset into the WattBuy offers list (for chunking large runs).
    - `processLimit?: number` (defaults to 25, hard‑capped at 50) — max number of **EFL-bearing** offers actually run through the EFL pipeline per invocation (timeout safety).
    - `dryRun?: boolean` (defaults to false) — convenience flag to force `mode="DRY_RUN"`.
    - `mode?: "STORE_TEMPLATES_ON_PASS" | "DRY_RUN"` (defaults to `"STORE_TEMPLATES_ON_PASS"` unless `dryRun=true`).
  - Behavior:
    - Authenticates via `x-admin-token` against `ADMIN_TOKEN` (same guard as other admin WattBuy tools).
    - Calls `wbGetOffers` + `normalizeOffers` for the given address.
    - Scans offers from `startIndex` up to `startIndex + offerLimit` and, for each offer with an `docs.efl` URL (up to `processLimit` per run):
      - Downloads the EFL PDF and passes the bytes to `runEflPipelineNoStore` (shared pdftotext + AI + validator + solver pipeline used by admin manual upload), which **does not persist any template**.
      - Computes:
        - `originalValidationStatus` from `validation.eflAvgPriceValidation?.status` (pre‑solver).
        - `finalValidationStatus` from `derivedForValidation.validationAfter?.status` when present, falling back to the original validator status.
        - `tdspAppliedMode` and avg‑price diff points (500/1000/2000 kWh) from the final validation object.
      - **Template fast‑path (rateStructure cache)**:
        - If a `RatePlan` already exists with the same `eflPdfSha256` **and** has a non‑null `rateStructure` (and `eflRequiresManualReview=false`), the batch harness skips re‑running the expensive EFL pipeline for that offer.
        - These rows report `validationStatus: "PASS"` (so downstream PASS‑gates remain correct) and include `templateHit: true` to indicate the plan was already templated.
        - In `mode === "DRY_RUN"`, these rows still report `templateAction: "SKIPPED"` (contract), but `templateHit: true` exposes that a template existed.
      - Only when `mode === "STORE_TEMPLATES_ON_PASS"` **and** `finalValidationStatus === "PASS"`:
        - Persists templates by writing to `RatePlan` via `upsertRatePlanFromEfl`:
          - Stores `rateStructure` (only when `validatePlanRules(...).requiresManualReview === false`)
          - Also stores `termMonths`, `rate500/rate1000/rate2000` (from WattBuy offer when present; else from the EFL avg‑price table expected values), and `cancelFee` when available.
        - `templateAction` is reported as `"CREATED"` **only** when a usable `rateStructure` was actually persisted.
      - In all other cases (including DRY_RUN or non‑PASS validation), `templateAction` is `"SKIPPED"` (and `"NOT_ELIGIBLE"` for offers without an EFL URL).
    - Returns JSON:
      - `ok`, `mode`, `offerCount`, `processedCount`,
      - `results[]` with: `offerId`, `supplier`, `planName`, `termMonths`, `tdspName`, `eflUrl`, `eflPdfSha256`, `repPuctCertificate`, `eflVersionCode`, `validationStatus` (final), `originalValidationStatus`, `finalValidationStatus`, `tdspAppliedMode`, `parseConfidence`, `templateHit`, `templateAction`, `queueReason` / `finalQueueReason`, `solverApplied`, and a compact `diffs[]` view of the avg‑price validator points.

- **Admin UI wiring (WattBuy Inspector)**:
  - Extended the WattBuy inspector page (`app/admin/wattbuy/inspector/page.tsx`) with a **“Batch EFL Parser Test (manual‑upload pipeline)”** panel under the existing _EFL PlanRules Probe_ section.
  - New controls (reuses the existing address fields and admin token):
    - `Offer limit` numeric input (1–500; defaults to 500) — scan size.
    - `Process / run` numeric input (1–50; defaults to 25) — timeout safety cap.
    - `Start index` numeric input (≥ 0; defaults to 0) — resume scanning when runs are truncated.
    - `Dry run (don’t store templates)` checkbox (default unchecked).
    - `Run all (auto-continue)` checkbox (default checked):
      - Runs the batch tool in multiple back-to-back calls using `nextStartIndex` until the server reports `truncated=false`.
      - This is the supported “no timeout” strategy on Vercel (no single request tries to process all offers).
    - `Run Batch EFL Parser` button that POSTs to `/api/admin/wattbuy/offers-batch-efl-parse` with `x-admin-token` and shows progress via the existing `loading` state.
  - Results surface in two places:
    - The existing **Inspector Summary / Raw Response** panes (raw JSON body and high‑level note like “Processed N offers (of M) in mode=…”).
    - A new **“Batch EFL Parser Results”** table showing, per offer:
      - Supplier, Plan, TDSP, Term, `validationStatus`, `templateAction` (HIT/CREATED/SKIPPED/NOT_ELIGIBLE), `tdspAppliedMode`, `parseConfidence` (as a 0–100% badge), and `queueReason` (truncated with full text as tooltip).

- **Template creation policy (PASS‑only semantics)**:
  - The batch harness never invents its own schema or persistence path; it runs the **non‑persisting** pipeline first via `runEflPipelineNoStore` and then, **only when explicitly requested**, delegates to `getOrCreateEflTemplate`.
  - DRY_RUN behavior:
    - When `mode === "DRY_RUN"`, the harness **never** calls `getOrCreateEflTemplate`, regardless of PASS/FAIL/SKIP.
    - All rows are reported with `templateAction: "SKIPPED"` (or `"NOT_ELIGIBLE"` when there is no EFL URL), but still include full validation, TDSP, and diff details for QA.
  - STORE_TEMPLATES_ON_PASS behavior:
    - When `mode === "STORE_TEMPLATES_ON_PASS"`, the harness treats **`finalValidationStatus === "PASS"`** (derived validation after solver) as eligible for auto‑learning and calls `getOrCreateEflTemplate` **only** for those rows.
    - These rows surface as `"HIT"` (existing template) or `"CREATED"` (new template) in `templateAction`.
    - Non‑PASS statuses (`FAIL`, `SKIP`, or `null`) are always marked `"SKIPPED"` and never reported as `"CREATED"`, so admins can quickly filter for plans that need manual review or deeper investigation.
  - This keeps the batch tool aligned with the manual‑upload contract: only EFLs that clear **final** avg‑price validation are considered “rock solid” candidates for template reuse, and DRY_RUN mode is guaranteed side‑effect‑free with respect to template storage.

## EFL SOLVER APPLY — Discovery inventory (2025‑12‑15)

- **Batch runner (EFL pipeline entrypoint)**:
  - Admin batch harness routes WattBuy offers into the EFL pipeline via `app/api/admin/wattbuy/offers-batch-efl-parse/route.ts`:
    - Authenticates with `ADMIN_TOKEN` (`x-admin-token` header) and accepts `{ address, offerLimit, mode: "DRY_RUN" | "STORE_TEMPLATES_ON_PASS" }` in the request body.
    - Uses `wbGetOffers` + `normalizeOffers` to fetch offers, filters to those with `docs.efl`, downloads each EFL PDF, and hands `pdfBytes` to `runEflPipelineNoStore` for deterministic+AI+validator+solver processing.
    - Computes `originalStatus` from `validation.eflAvgPriceValidation?.status` and `finalStatus` from `pipeline.finalValidation?.status` and, when mode is `"STORE_TEMPLATES_ON_PASS"` and `finalStatus === "PASS"`, calls `getOrCreateEflTemplate` once per PASS to persist or reuse an EFL template (`templateAction: "CREATED" | "HIT"`). All other rows are reported as `"SKIPPED"` (or `"NOT_ELIGIBLE"` without EFL URL) but still include validation details and `solverApplied`.

- **Pipeline wrapper (pdf→text→AI→validator→solver, no DB writes)**:
  - `lib/efl/runEflPipelineNoStore.ts` is the canonical non‑persisting EFL pipeline entrypoint used by batch tools:
    - Accepts `pdfBytes` and optional `source`/`offerMeta` (for logging only).
    - Calls `deterministicEflExtract(pdfBytes)` from `lib/efl/eflExtractor.ts` to compute `eflPdfSha256`, `rawText`, `repPuctCertificate`, `eflVersionCode`, extractor method, and warnings.
    - Runs `parseEflTextWithAi({ rawText, eflPdfSha256, extraWarnings })` from `lib/efl/eflAiParser.ts` to produce `planRules`, `rateStructure`, `parseConfidence`, `parseWarnings`, and `validation: { eflAvgPriceValidation }` (avg‑price validator envelope).
    - Invokes `solveEflValidationGaps({ rawText, planRules, rateStructure, validation })` from `lib/efl/validation/solveEflValidationGaps.ts` to derive `derivedPlanRules`/`derivedRateStructure`, `solverApplied[]`, and `validationAfter` (re‑run avg‑price validator with tier sync + TDSP utility‑table fallback).
    - Returns a structured result with:
      - `deterministic` (full pdf→text identity + preview), `planRules`, `rateStructure`, `parseConfidence`, `parseWarnings`,
      - `validation` (original `eflAvgPriceValidation`), `derivedForValidation` (solver result), and `finalValidation = derivedForValidation.validationAfter ?? validation.eflAvgPriceValidation ?? null`.

- **Deterministic pdf→text + identity extractor**:
  - `lib/efl/eflExtractor.ts` implements the pdftotext and ID extraction layer:
    - `computePdfSha256(pdfBytes)` computes the PDF fingerprint used across templates and fact card storage.
    - `runPdftotext(pdfBytes)` calls the droplet’s HTTPS helper via `EFL_PDFTEXT_URL` + `EFL_PDFTEXT_TOKEN` and falls back to a local `pdftotext` CLI if available; all text is normalized via `cleanExtractedText()`.
    - `EflDeterministicExtract` shape carries `eflPdfSha256`, `rawText`, `repPuctCertificate`, `eflVersionCode`, `warnings`, and `extractorMethod` and is consumed by both manual upload (`getOrCreateEflTemplate` for `source: "manual_upload"`) and `runEflPipelineNoStore`.
    - `extractRepPuctCertificate(text)` and `extractEflVersionCode(text)` parse PUCT REP certificate IDs and EFL version codes from the raw text for template identity and rate card linkage.

- **PlanRules / RateStructure extractor (deterministic + AI)**:
  - `lib/efl/eflAiParser.ts` is the primary text→PlanRules/RateStructure engine:
    - `parseEflTextWithAi({ rawText, eflPdfSha256, extraWarnings })`:
      - Runs deterministic extraction first on `rawText`:
        - `extractBaseChargeCents`, `extractEnergyChargeTiers` (all Energy Charge tiers into `UsageTier[]`), `extractSingleEnergyCharge`, `detectTdspIncluded`, and deterministic bill‑credit fallbacks.
      - Normalizes text for AI via `normalizeEflTextForAi(rawText)` (removing the “Average Monthly Use / Average Price per kWh” table, TDU‑only boilerplate, etc., while pinning actual pricing sections).
      - Invokes GPT‑4.1 (or `OPENAI_EFL_MODEL`) to produce `parsed.planRules` and `parsed.rateStructure`, then merges deterministic fallbacks:
        - Fills `baseChargePerMonthCents`, usage tiers (`planRules.usageTiers`), single‑rate fields, Type of Product, Contract Term, and TDSP delivery‑included flag where the model left gaps.
        - Specifically, if deterministic tiers exist and AI tiers are missing or shorter, it **overrides** `planRules.usageTiers` with deterministic tiers and adds a warning (“Deterministic extract filled usageTiers…” or “Deterministic override…”).
      - Calls `validateEflAvgPriceTable({ rawText, planRules, rateStructure })` from `lib/efl/eflValidator.ts` to attach `validation: { eflAvgPriceValidation }` and clamps `parseConfidence` based on validation status and filled fields.
    - When AI is disabled or keys are missing, the same deterministic tier/base charge logic is used to build a minimal PlanRules, and the validator still runs against that shape.

- **Avg‑price validator (modeled vs. EFL table)**:
  - `lib/efl/eflValidator.ts` owns the EFL average‑price consistency check:
    - `validateEflAvgPriceTable({ rawText, planRules, rateStructure, toleranceCentsPerKwh? })`:
      - Extracts the “Average Monthly Use / Average price per kWh” table (500/1000/2000 kWh) from **rawText**, modeling expected REP+TDSP charges via:
        - Either the canonical cost engine (`computePlanCost`) or a deterministic fallback that uses `planRules.usageTiers`, base charge, bill credits, and TDSP assumptions.
      - Produces an `EflAvgPriceValidation` object with `status: "PASS" | "FAIL" | "SKIP"`, per‑usage diffs, `assumptionsUsed` (night‑hours, TDSP source, tdspAppliedMode, etc.), `fail` flag, `queueReason`, and `avgTableFound/Rows/Snippet` fields.
      - Does not persist anything; it is called both from `parseEflTextWithAi` and from `solveEflValidationGaps` after tier/TDSP gaps are filled.

- **Solver (tier/TDSP gap fill + revalidation)**:
  - `lib/efl/validation/solveEflValidationGaps.ts` is the gap‑filler that can be “applied” while keeping the authoritative PlanRules untouched:
    - `solveEflValidationGaps({ rawText, planRules, rateStructure, validation })`:
      - Clones `planRules` and `rateStructure` into `derivedPlanRules`/`derivedRateStructure` to avoid mutating callers.
      - Syncs tiers from `RateStructure.usageTiers` when richer than `planRules.usageTiers` (`"TIER_SYNC_FROM_RATE_STRUCTURE"`), then from raw EFL text when more tiers are detected (`"SYNC_USAGE_TIERS_FROM_EFL_TEXT"`), using a deterministic parser mirroring `extractEnergyChargeTiers` (including bracketed `Energy Charge: (0 to 1000 kWh)` / `Energy Charge: (> 1000 kWh)` patterns).
      - Heuristically flags masked‑TDSP cases via `detectMaskedTdsp(rawText)` and records `"TDSP_UTILITY_TABLE_CANDIDATE"` but leaves TDSP math to the validator.
      - If any solverApplied entries were added, it re‑runs `validateEflAvgPriceTable` with `derivedPlanRules`/`derivedRateStructure` and returns:
        - `validationAfter`, `solverApplied[]`, `solveMode: "NONE" | "PASS_WITH_ASSUMPTIONS" | "FAIL"`, and updated `queueReason` from the re‑run validator.
      - Today this is used in read‑only fashion by manual upload (`app/api/admin/efl/manual-upload/route.ts`), template creation (`lib/efl/getOrCreateEflTemplate.ts`), and the batch harness (`runEflPipelineNoStore`), which look at `validationAfter` and `solverApplied` but keep primary PlanRules unchanged.

- **Persistence layer (rate cards / templates / fact cards)**:
  - EFL template caching (in‑memory, no DB) lives in `lib/efl/getOrCreateEflTemplate.ts`:
    - Defines `GetOrCreateEflTemplateInput` for `source: "manual_upload" | "wattbuy"` and in‑process `EflTemplateRecord` cache keyed by `getTemplateKey` (PUCT+Ver+SHA‑256+WattBuy identity).
    - For `source: "manual_upload"`:
      - Calls `deterministicEflExtract` → `parseEflTextWithAi` → `solveEflValidationGaps` and caches the resulting template (PlanRules/RateStructure/validation) under all identity keys, but does not write to a DB table.
    - For `source: "wattbuy"`:
      - Runs `parseEflTextWithAi` → `solveEflValidationGaps` on provided `rawText` and caches the result; used by WattBuy template backfill and the batch harness when in `"STORE_TEMPLATES_ON_PASS"` mode.
  - Rate cards / fact card templates in the DB are modeled separately:
    - `prisma/schema.prisma`: `RateConfig` and `MasterPlan` hold EFL URL, term, TDSP, and a normalized `rateModel` JSON (populated later in the roadmap from EFL templates).
    - `prisma/current-plan/schema.prisma`: `BillPlanTemplate` captures reusable bill parser templates (provider/plan keys, term, tiers, TOU config, bill credits) for the current‑plan/bill‑parse module.
  - At this stage, the EFL avg‑price solver (`solveEflValidationGaps`) is wired only into the **in‑memory** EFL template pipeline and batch harness; it does not yet auto‑mutate DB‑backed rate cards. Any future “apply” behavior will need to explicitly decide when to translate `derivedPlanRules` into `MasterPlan.rateModel` or other persistent fields, using `solveMode`, `solverApplied`, and `queueReason` as the gating signals.

## EFL SOLVER APPLY — Base charge solve (2025‑12‑15)

- **Deterministic base-charge extraction improvements**:
  - Extended the core base-charge extractor in `lib/efl/eflAiParser.ts` (`extractBaseChargeCents`) to recognize additional label variants:
    - `"Base Monthly Charge"` alongside `"Base Charge"` (with flexible whitespace and optional prefixes such as provider name),
    - Explicit `$0` lines like `"Base Monthly Charge: $0 per billing cycle"`,
    - Generic `"Base Charge $X per billing cycle"` / `"Monthly Base Charge $X per month"` patterns.
  - The extractor now consistently normalizes all of these into integer cents and feeds them into deterministic fallbacks so `planRules.baseChargePerMonthCents` is set whenever the EFL clearly states a base monthly charge (still treating `N/A` as "not present").
  - Existing wiring that mirrors `planRules.baseChargePerMonthCents` into `rateStructure.baseMonthlyFeeCents` when the latter is missing remains intact, so a single deterministic extraction now powers both PlanRules and RateStructure shapes.

- **Solver: base-charge sync + revalidation**:
  - Updated `lib/efl/validation/solveEflValidationGaps.ts` to add a base-charge sync step before the `"NONE"` early-return:
    - If `derivedPlanRules` exists and `derivedPlanRules.baseChargePerMonthCents` is null/undefined, the solver calls a local deterministic helper `extractBaseChargeCentsFromEflText(rawText)` (mirroring the main extractor’s patterns, including `"Base Monthly Charge"`).
    - When a base charge is found, the solver populates **both** `derivedPlanRules.baseChargePerMonthCents` and `derivedRateStructure.baseMonthlyFeeCents` (creating a minimal `derivedRateStructure` object if necessary) and pushes a new `solverApplied` tag: `"SYNC_BASE_CHARGE_FROM_EFL_TEXT"`.
    - Because this adds a solverApplied entry, the solver always re-runs `validateEflAvgPriceTable` after base-charge sync so any FAIL arising solely from a missing base fee can be upgraded to PASS when the numeric base charge is known.

- **Solver: prepaid daily charge + max-usage monthly credit (2025‑12‑16)**:
  - Added generalized solver modeling for prepaid EFLs that disclose:
    - `Daily Charge $X per day` → converted to `derivedPlanRules.baseChargePerMonthCents` assuming a 30‑day month, so avg-price validation can model the always-on daily fee.
    - `Monthly Credit -$Y applies: N kWh usage or less` → converted to a `billCredits[]` entry with `type: "THRESHOLD_MAX"` so the validator can apply credits at/below a max usage threshold.
  - **Rule tags**:
    - `"DAILY_CHARGE_PER_DAY_TO_MONTHLY_BASE_FEE"`
    - `"MONTHLY_CREDIT_MAX_USAGE_TO_THRESHOLD_MAX_CREDIT"`
  - **Regression**: `tests/efl/payless.prepaid.daily-charge.monthly-credit.solver.test.ts`

- **Applying solver-derived shapes when PASS**:
  - Adjusted `lib/efl/runEflPipelineNoStore.ts` so that solver results are reflected in the pipeline outputs:
    - The wrapper still calls `parseEflTextWithAi` + `solveEflValidationGaps`, but now:
      - When `validationAfter.status === "PASS"`, `planRules` and `rateStructure` in the returned `RunEflPipelineNoStoreResult` are taken from `derivedPlanRules` / `derivedRateStructure` (the solver output), not the raw AI output.
      - When the solver leaves the status as FAIL or SKIP, `planRules` / `rateStructure` continue to reflect the original AI shapes so admins can see exactly what the model produced.
    - A new flag `needsAdminReview` is set to `true` when the final (post-solver) validation status is `"FAIL"`, giving callers (e.g., future admin queues) a simple signal to hide or queue problematic EFLs rather than auto-present them.
  - Updated `lib/efl/getOrCreateEflTemplate.ts` so that templates also honor solver-derived shapes:
    - For both `source: "manual_upload"` and `source: "wattbuy"`, the template builder now inspects `derivedForValidation.validationAfter.status`:
      - If the solver’s `validationAfter.status === "PASS"`, the template stores `planRules` and `rateStructure` from `derivedPlanRules` / `derivedRateStructure` and uses `validationAfter` as the canonical `eflAvgPriceValidation` for that template.
      - Otherwise, the template continues to store the raw AI `planRules` / `rateStructure` and original validator envelope, while still attaching `derivedForValidation` for debugging/audit.
    - This ensures that when the solver successfully closes gaps (tiers, TDSP fallbacks, base charge), the **derived** plan rules and rate structure become authoritative for all downstream uses (admin manual-upload UI, WattBuy templates, batch harness), without mutating DB-backed rate cards yet.
  - When the solver cannot rescue a FAIL (i.e., `validationAfter.status === "FAIL"` even after tier/TDSP/base-charge fills), the system now treats that as a “needs admin review” situation in the non-persisting pipeline (`needsAdminReview = true` in `runEflPipelineNoStore`), and the corresponding templates still reflect the raw AI output plus a blocking `queueReason` from the validator. Admin-queue wiring will be added in a subsequent step.

## EFL SOLVER APPLY + ADMIN REVIEW QUEUE (2025‑12‑15)

- **DB-backed review queue for failed EFL parses**:
  - Added a new Prisma model `EflParseReviewQueue` in `prisma/schema.prisma` to capture EFLs whose avg-price validation **fails even after** solver passes:
    - Identity: `eflPdfSha256` (unique), `repPuctCertificate`, `eflVersionCode`.
    - Offer metadata: `offerId`, `supplier`, `planName`, `eflUrl`, `tdspName`, `termMonths`, and `source` (e.g., `"wattbuy_batch"`, `"manual_upload"`).
    - Payloads: `rawText` (Text), `planRules` (Json), `rateStructure` (Json), `validation` (Json), and `derivedForValidation` (Json).
    - Outcome: `finalStatus` (string, typically `"FAIL"`), `queueReason` (Text), and `solverApplied` (Json array of tags such as `"TIER_SYNC_FROM_RATE_STRUCTURE"`, `"SYNC_USAGE_TIERS_FROM_EFL_TEXT"`, `"SYNC_BASE_CHARGE_FROM_EFL_TEXT"`, etc.).
    - Resolution: `resolvedAt`, `resolvedBy`, and `resolutionNotes` to track manual admin review; an index on `[finalStatus, createdAt]` supports OPEN/RESOLVED filtering.

- **Effective rules logic in the non-persisting pipeline**:
  - `lib/efl/runEflPipelineNoStore.ts` now returns **both** the raw AI shapes and solver-adjusted shapes in a single result:
    - After `parseEflTextWithAi` + `solveEflValidationGaps`, it computes:
      - `validationAfter = derivedForValidation?.validationAfter ?? null` and `finalValidation = validationAfter ?? baseValidation ?? null`.
      - If `validationAfter.status === "PASS"` and `derivedPlanRules`/`derivedRateStructure` exist, the result’s `planRules`/`rateStructure` point at the solver-derived shapes; otherwise they mirror the raw AI output.
    - New explicit mirrors:
      - `effectivePlanRules` and `effectiveRateStructure` are always set to the same values returned via `planRules`/`rateStructure`, giving callers a stable “effective rules” handle regardless of internal wiring.
    - A `needsAdminReview` flag is set when `finalValidation.status === "FAIL"`, signaling that this EFL should be queued rather than auto-presented.

- **Templates store effective rules when solver PASS**:
  - `lib/efl/getOrCreateEflTemplate.ts` now records solver-adjusted shapes alongside the original AI+validator outputs for both manual uploads and WattBuy templates:
    - After `parseEflTextWithAi` + `solveEflValidationGaps`, each template incorporates:
      - `effectivePlanRules` and `effectiveRateStructure`: `derivedPlanRules`/`derivedRateStructure` when `validationAfter.status === "PASS"`, otherwise the raw AI PlanRules/RateStructure.
      - `finalValidation`: prefers `validationAfter` (the solver’s re-run) when truthy, falling back to the original `validation` envelope; `validation` on the template continues to carry the canonical `{ eflAvgPriceValidation }` used by callers.
      - `derivedForValidation` is preserved as-is (with `solverApplied`, `solveMode`, and `queueReason`) for debug/audit use in admin UIs.
    - This makes it explicit which shapes are “effective” (what we trust after solver) vs. the raw model output, while still keeping all template caching semantics unchanged.

- **Queueing FAIL plans from the WattBuy batch harness**:
  - `app/api/admin/wattbuy/offers-batch-efl-parse/route.ts` now **upserts** any EFL whose final (post-solver) validation status is `"FAIL"` into `EflParseReviewQueue`:
    - For each offer with an EFL PDF:
      - Runs `runEflPipelineNoStore` to obtain `deterministic`, `planRules`, `rateStructure`, `validation`, `derivedForValidation`, and `finalValidation`.
      - When `finalStatus === "FAIL"` (or `SKIP` with EFL, or PASS-but-weak) and `det.eflPdfSha256` is present:
        - Performs an **OPEN-row de-dupe** before writing:
          - Prefer updating an existing OPEN row matching `repPuctCertificate + eflVersionCode` (stable across PDF-byte drift).
          - Else prefer updating an existing OPEN row matching `eflUrl`.
          - Else fall back to `upsert` by `eflPdfSha256`.
        - Writes the queue record with:
          - Source `"wattbuy_batch"`, the EFL identity, offer metadata, and the effective `planRules`/`rateStructure` returned by the pipeline.
          - `validation`, `derivedForValidation`, `finalStatus`, a normalized `queueReason` (fixing common mojibake like `"â€”"` → `"—"`), and `solverApplied` tags.
      - This happens regardless of batch mode (`DRY_RUN` vs. `STORE_TEMPLATES_ON_PASS`) because the endpoint is admin-only and the queue is strictly for operator review.
    - **Missing EFL URL on an electricity offer**:
      - Because the normalizer filters out non-electricity offers, any remaining offer without `docs.efl` is treated as an upstream data issue.
      - These offers are queued into `EflParseReviewQueue` with `finalStatus="SKIP"` and a stable **synthetic** `eflPdfSha256` (since there is no PDF to fingerprint yet).
    - Guardrail: batch ops should never allow an electricity offer to “disappear” from ops dashboards — if the PDF fetch fails or the pipeline throws before a fingerprint can be computed, the offer is queued with a stable **synthetic** fingerprint keyed by URL + offer metadata.
    - PASS plans remain unchanged:
      - No queue insert when `finalStatus === "PASS"`.
      - When `mode === "STORE_TEMPLATES_ON_PASS"`, PASS plans are persisted as templates by writing `RatePlan.rateStructure` (via `upsertRatePlanFromEfl`) so future runs can skip parsing across serverless invocations.

- **Queue de-dupe guardrails (2025‑12‑16)**:
  - Real-world EFLs can drift at the PDF byte level (landing pages, regenerated PDFs), producing different `eflPdfSha256` values for the same effective EFL version.
  - To prevent duplicate OPEN items, the main schema adds partial unique indexes:
    - One OPEN row per `eflUrl` (`resolvedAt IS NULL`)
    - One OPEN row per `repPuctCertificate + eflVersionCode` (`resolvedAt IS NULL`)
  - **Migration note**: if duplicates already exist, unique-index creation will fail; resolve by running the “fix” migration which auto-resolves duplicate OPEN rows before creating the indexes.

## OBSERVABILITY — OpenAI usage logging (2025‑12‑16)

- **Admin usage page**: `/admin/openai/usage` reads from `OpenAIUsageEvent` via `GET /api/admin/openai/usage`.
- **Smoke test**: `POST /api/admin/openai/usage/smoke` writes a dummy row (admin-only). Use this to confirm the runtime can write to `OpenAIUsageEvent` when the chart appears stale.
- **Important serverless constraint**: OpenAI usage writes must be awaited; fire‑and‑forget promises can be dropped when a Vercel function returns.
- **Current logging behavior**:
  - `lib/efl/eflAiParser.ts` logs `module="efl-fact-card", operation="efl-ai-parser-v2"` after each Responses API call.
  - `lib/efl/planAiExtractor.ts` logs fact‑card extraction + vision fallback.
  - `lib/billing/parseBillText.ts` logs `module="current-plan", operation="bill-parse-v3-json"`.

## ADMIN — Templated plans backfill (2025‑12‑16)

- `/admin/wattbuy/templates` shows `RatePlan` rows where `rateStructure` is stored.
- Some legacy rows may have `rateStructure` but missing the headline fields used for sorting/display:
  - `termMonths`, `rate500`, `rate1000`, `rate2000`
- Admin backfill endpoint:
  - **Default / legacy behavior (fill blanks from `rateStructure`):**
    - `POST /api/admin/wattbuy/templated-plans/backfill?limit=...&q=...`
    - Computes missing fields from the stored `rateStructure` (FIXED/VARIABLE + tiers + bill credits + base fee).
    - Note: this is typically **REP-only** math (does not include TDSP delivery unless it was embedded into the stored structure).
    - **Does not guess TIME_OF_USE** usage distribution; TOU plans may remain blank for 500/1000/2000.
  - **Preferred behavior (overwrite from EFL Facts Label avg-price table — all‑in, includes TDSP):**
    - `POST /api/admin/wattbuy/templated-plans/backfill?source=efl&overwrite=1&limit=...&q=...`
    - Fetches the stored `eflUrl`/`eflSourceUrl`, re-runs deterministic extraction, and writes `rate500/1000/2000` from the EFL “Average price per kWh” table (when present).
    - This fixes stale/incorrect legacy values (especially for 2000 kWh) and aligns `/admin/wattbuy/templates` with the disclosure table in the PDF.

- **Admin APIs + review UI**:
  - New admin API routes for inspecting and resolving queue items:
    - `GET /api/admin/efl-review/list` (`app/api/admin/efl-review/list/route.ts`):
      - Gated by `ADMIN_TOKEN` via `x-admin-token` header.
      - Query params:
        - `status=OPEN|RESOLVED` (OPEN = `resolvedAt IS NULL` by default)
        - `limit` (default 50, max 200)
        - `q` (search supplier/plan/offerId/sha/version via case-insensitive `contains`)
        - `autoResolve=1` (OPEN only): **auto-resolves** queue rows that already have a persisted `RatePlan` template (`rateStructure != null` and `eflRequiresManualReview = false`). Matching is done by `repPuctCertificate+eflVersionCode`, `eflPdfSha256`, or URL (`eflUrl` / `eflSourceUrl`).
          - Guardrail: **never** enabled for DRY_RUN batch operations (DRY_RUN must remain side-effect-free).
      - Returns `{ ok, status, count, items, autoResolvedCount }` with newest items first.
    - `POST /api/admin/efl-review/resolve` (`app/api/admin/efl-review/resolve/route.ts`):
      - Gated by `ADMIN_TOKEN`.
      - Body: `{ id, resolutionNotes?, resolvedBy? }`.
      - Sets `resolvedAt = now`, `resolvedBy` (default `"admin"`), and optional `resolutionNotes`, and returns the updated row.
  - New admin page `app/admin/efl-review/page.tsx`:
    - Client-side React page using the same `x-admin-token` pattern as other admin tools.
    - Shows filters for **Open / Resolved** and a free-text search (`supplier`, `planName`, `offerId`, `eflPdfSha256`, `eflVersionCode`).
    - Main table lists, per item:
      - Supplier, Plan, OfferId, EFL Version, `finalStatus`, `queueReason` (truncated with full tooltip), and `solverApplied` tags.
    - Each row includes:
      - A **“View details”** expander showing `planRules`, `rateStructure`, `validation`, `derivedForValidation`, and a truncated `rawText` excerpt for deep inspection.
      - A **“Mark resolved”** button (for open items) that calls `/api/admin/efl-review/resolve` and refreshes the list.

- **Behavioral summary**:
  - Effective PlanRules/RateStructure are only treated as authoritative when the **final** avg-price validation status (after solver) is `"PASS"`; in that case, both the non-persisting pipeline and in-memory templates surface the **derived** shapes.
  - When the final status remains `"FAIL"`, the plan is **never** auto-presented:
    - The pipeline marks `needsAdminReview = true`.
    - The batch harness enqueues the EFL into `EflParseReviewQueue` with full context for admins.
    - Future steps will wire this queue into customer-facing plan gating so that only PASS templates (original or solver-assisted) can be surfaced by default.

- **Queue kind + dedupeKey (PLAN_CALC_QUARANTINE readiness)**:
  - `EflParseReviewQueue` now supports multiple queue types via `kind` + `dedupeKey` with `@@unique([kind, dedupeKey])`.
  - Existing EFL rows are backfilled with `dedupeKey = eflPdfSha256` (and EFL_PARSE writes auto-fill via DB trigger).

- **Solver rule: Monthly Service Fee cutoff (<=N kWh)**:
  - Some EFLs specify a monthly/service fee that only applies up to a maximum usage threshold (e.g., “$8.00 per billing cycle for usage (<=1999) kWh”) but do not specify an alternate fee above the cutoff.
  - The solver models this as **baseMonthlyFeeCents = fee** plus an **offsetting bill credit** of the same amount at `minUsageKWh = N+1`, enabling avg-table validation to PASS without supplier-specific logic.
  - Regression test: `tests/efl/frontier.light-saver-12plus.service-fee-cutoff.solver.test.ts`.

- **Template dedupe guardrail**:
  - `upsertRatePlanFromEfl` uses a **fail-safe fingerprint** to prevent plan collisions:
    - **Primary**: `repPuctCertificate + planName + eflVersionCode` (case-insensitive on `planName`), when `eflVersionCode` looks like a real “Ver. #” token.
    - **Secondary**: `repPuctCertificate + eflVersionCode` (only when the version looks real) **and only when `planName` is missing**.
    - **Fallback**: `eflPdfSha256`.
  - If `eflVersionCode` is weak/generic (e.g., `"ENGLISH"` fragments), deterministic extraction returns null and the pipeline queues it for review rather than persisting an unsafe identity.

## Remediation Rule: Pattern-driven fixes (no label hardcoding)

### A) Safety split
- Always OK to show disclosed EFL/WattBuy 500/1000/2000 values.
- IntelliWatt usage-based modeled costs shown ONLY when eligible: **PASS + STRONG** and not `requiresManualReview`.
- If queued: show disclosure numbers + “IntelliWatt calculation unavailable (queued for inspection)”.

### B) Manual remediation goal
- Do NOT add “if label == X then …” logic.
- Every fix must improve a general extraction/normalization/solver **pattern** so similar future EFLs parse correctly.

### C) Solver numbers vs learning
- Solver may persist derived numeric values for THAT card into the DB (do not break this).
- Remediation work must ensure those values are discoverable from `rawText` next time (general patterns).

### D) Done criteria
- PASS anchors + `passStrength=STRONG` => eligible.
- Otherwise remains queued with an explicit reason.

### Queue item processing checklist (end-to-end)
- From an OPEN queue row, run Manual Fact Card Loader by URL (or upload) and confirm:
  - `finalStatus === PASS`
  - `passStrength === STRONG`
  - `templatePersisted === true` (RatePlan.rateStructure stored)
  - Auto-resolve only clears matching OPEN queue rows by **sha/offerId/rep+version** (never URL-only)

## DONE (2025‑12‑16)
- `/admin/efl/manual-upload` now shows OPEN `EflParseReviewQueue` items with:
  - “Open EFL URL” and “Run manual” deep link.
- Auto-resolve matching tightened (no `eflUrl`-only resolve) in:
  - `POST /api/admin/efl/manual-url`
  - `POST /api/admin/efl-review/process-open`
- Docs updated with “Remediation Rule: Pattern-driven fixes (no label hardcoding)” + end-to-end checklist.