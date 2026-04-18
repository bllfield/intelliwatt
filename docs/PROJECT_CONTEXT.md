## Customer Flow: IntelliWatt Plan Analyzer

1. **Address Capture**
   - User provides service address (with optional bill upload for prefill).
   - System resolves TDSP/utility, ESIID, and meter metadata.
2. **SMT API Authorization**
   - User consents to Smart Meter Texas access (~12 months).
   - Backend triggers agreement/subscription and begins pulling usage/billing.
3. **Usage Normalization**
   - Normalize SMT interval/billing (or alternate sources) into canonical usage for the last 12 months.
4. **Rate Plan Analyzer Output (Plans/Rates)**
   - Recommend plans based on real usage.
   - Users can view plan details and sign up from the plan details page.
5. **Current Plan Details (Optional, +1 Entry; required for Compare)**
   - Screen title: “Current Rate Details — Add your current plan info for a more detailed comparison.”
   - Paths:
     - **Upload your bill** (photo/image/PDF) for future OCR extraction.
     - **Enter manually** (plan name, primary rate, base fee, contract expiration, notes).
   - Copy explicitly states:
     - Step is optional; skipping still yields usage-based recommendations.
     - Completing it unlocks side-by-side Compare and highlights how current contract costs compare against IntelliWatt recommendations and projected renewal costs.
     - Completing grants **+1 HitTheJackWatt jackpot entry.**
6. **Compare (Current vs New)**
   - Side-by-side comparison for a selected plan vs the user’s current plan.
   - Users can sign up from the Compare page.
6. **Home Details**
7. **Appliances**
8. **Upgrades**
9. **Optimal Energy (future)**

## IntelliWattBot (Dashboard Guidance)

- The customer dashboard includes an **IntelliWattBot** helper that guides users through the intended onboarding flow (address → usage → plans → optional current plan → compare → home → appliances).
- Bot messages are **per-page configurable** via admin tool: `/admin/tools/bot-messages` (admin-token required).
- Customer pages fetch the current message via `GET /api/bot/message?path=/dashboard/<page>`.
# IntelliWatt Project Context

**Purpose**: This document provides operational context for the IntelliWatt project, including current deployment state, database information, and development guidelines for AI chat sessions.

**Last Updated**: April 2026

---

## How We Build & Deploy (Read First)

- Coding happens in Cursor using single, copy-ready GPT blocks with explicit file targets and surgical edits.

- Production deploys happen via Git; pushing to `main` triggers Vercel Production builds automatically.

- The DigitalOcean droplet is only for Smart Meter Texas (SMT) SFTP/ingestion—not web-app deploys.

- Avoid `&&` in command examples; keep one command per line.

**Compare / simulation integrity:** GapFill and shared Past compare must not use hidden fallbacks. Missing simulated data stays missing (explicit nulls/reason codes). Actual usage must never populate simulated-side fields for parity or scoring. Simulated-day rows must not silently prefer `localDate` over interval-derived local dates—invariant violations fail the shared compare path with an explicit error/reason code.

**Authoritative docs:**

- Workflow overview: `docs/QUICK_START.md` (Development & Deploy Workflow)

- GPT/Cursor collaboration rules: `docs/GPT_COLLAB.md`

- System-wide expectations: `docs/ARCHITECTURE_STANDARDS.md` (Operational Standards, Auth Standards, Health/Debug)

- ERCOT daily pull system: `docs/DEPLOY_ERCOT.md` (complete guide including migration, deployment, and troubleshooting)

- Usage layer contract map: `docs/USAGE_LAYER_MAP.md` (canonical interval-series layer meanings + endpoint/function mapping)
- Architecture lockstep rule: structural simulation/lockbox changes must update `docs/CHAT_BOOTSTRAP.txt`, `docs/PROJECT_PLAN.md`, `docs/USAGE_SIMULATION_PLAN.md`, `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`, `docs/PROJECT_CONTEXT.md`, and `docs/ONE_PATH_SIM_ARCHITECTURE.md` in the same pass. No code-only architecture changes.

- Manual-usage product semantics: `docs/PROJECT_PLAN.md` and `docs/USAGE_SIMULATION_PLAN.md` are authoritative for the two-stage manual model: monthly Stage 1 bill-cycle semantics, annual Stage 1 annual-total semantics, then shared Stage 2 normalized Past Sim behavior. Current implementation keeps `statementRanges[]` as Stage 1 bill-period constraint inputs plus reconciliation metadata, keeps Manual Usage Lab and GapFill as separate surfaces, and centralizes shared Stage 1/pre-lockbox monthly+annual helper ownership in `modules/manualUsage/prefill.ts`.
- GapFill manual monthly/manual annual now reuse that same shared Stage 1 helper family and the shared recalc dispatch/readback contract: the route triggers the canonical Past recalc, then loads persisted manual compare/reconciliation views from the artifact. Recalc may return `readbackPending: true` plus `canonicalArtifactInputHash`, and admin clients poll readback using that exact artifact hash. Actual House remains the interval-backed source truth; Test Home shows the constrained shared result.
- Shared manual compare/reconciliation now publishes one canonical bill-period-first read model from artifact-backed readback (`ManualBillPeriodTarget[]`, `manualBillPeriodTotalsKwhById`, and shared bill-period compare rows). User manual surfaces, Manual Monthly Lab, and GapFill manual compare all consume that shared read model after recalc/readback instead of route-local manual truth math.
- GapFill Actual House summary/monthly/diagnostic display must read from the same shared Past artifact/read-model truth as interval Actual House. If shared diagnostics/readback already carry actual-house identity, coverage, or compare facts, the admin surface must project those values from the shared path rather than blank/local fallbacks.
- Actual compare totals use that same shared actual-house truth source as the Actual House monthly display; annual compare labels must not silently switch to a different aggregate or alternate monthly source.
- Manual Lab remains the reference Stage 1 contract implementation for manual-entry modes, but the saved customer/source manual payload remains the data truth. GapFill manual monthly/manual annual now resolve and persist that same shared manual payload contract before recalc, and manual payload travel ranges are the authoritative manual travel input on `MANUAL_TOTALS`.
- Manual monthly Stage 2 input is totals-only: entered/source-derived month or bill-period totals may cross into simulation input, but raw actual intervals, source daily rows, donor-day truth, and actual intraday shapes are compare-only.
- GapFill `MANUAL_MONTHLY` is the pure manual monthly test-home mode. It uses the saved/manual Stage 1 payload as the only monthly constraint input; actual interval data remains attached only for compare/scoring/diagnostics.
- GapFill `MONTHLY_FROM_SOURCE_INTERVALS` remains distinct. It is the explicit source-derived monthly-anchor mode and must not be presented as the same thing as pure manual monthly.
- Manual monthly source-backed periods that overlap travel/vacant dates no longer own source-truth totals for simulation. They remain visible in Stage 1/readback parity, but the shared simulation path fills them instead of reusing actual-derived totals.
- Manual annual Stage 2 input is annual-only: the simulator receives the annual total plus anchor window and derives month/day/hour allocation internally rather than inheriting a precomputed monthly split.
- Manual compare Actual kWh must be summed from shared actual-house interval-backed truth by the displayed bill periods when that truth exists. Missing actual-backed compare truth stays null/unavailable; `0.00` is not a valid fallback.
- Pure manual readback must not expose source-derived anchors as active truth. If those anchors are intentionally active, the run must stay labeled as `MONTHLY_FROM_SOURCE_INTERVALS` / `ANNUAL_FROM_SOURCE_INTERVALS`.
- `MANUAL_TOTALS` recalc is intentionally lean on that shared path: exact-interval fingerprint/profile tuning work is not part of manual monthly/annual truth production, full actual-interval payloads are suppressed for the low-data/manual baseline branch, non-critical post-artifact persistence can defer, and admin-facing compare/diagnostic enrichment belongs on persisted readback after recalc succeeds. Constrained manual non-travel modeled days now stay on manual-constrained ownership semantics even when the resolved path lands on `whole_home_only`; explicit travel ranges remain the only travel-vacant ownership source.
- Manual Lab and GapFill manual readbacks now expose the same compact parity summary from shared artifact-backed truth so contract drift, travel-range drift, shared-path drift, and compare-attachment drift are visible without relying on raw route dumps.
- Current manual-monthly low-data runs also attach `manualMonthlyWeatherEvidenceSummary` from eligible non-travel Stage 1 bill-period targets plus actual weather pressure. Travel-touched bill periods stay visible for reconciliation but are excluded from evidence fitting and totals-to-match shaping; the shared summary now records the eligible driving bill periods, excluded travel bill periods, eligible/travel day counts, weather inputs used, and whole-home/prior fallback weight. Shared constrained artifact diagnostics also retain the bill-period-first contract plus attached source-derived monthly anchors when GapFill monthly-from-source semantics are active. That shared evidence currently drives daily weather classification, weather-scaled-day activation, daily totals, and low-data curve-amplitude response. Stronger monthly weather evidence, stronger baseload inference, and stronger HVAC-share inference remain future work after this architecture pass.
- Travel/vacant simulated days and manual-constrained simulated days use the same shared day-simulation family and shaping logic. Their difference is ownership/constraint semantics, not a separate flat/frozen simulator path.
### Plan Change (2026-04) — Manual Monthly Canonical Actual + Active Contract Pass
- One canonical actual-house artifact source now owns compare/reconciliation actual-reference. If actual-backed truth exists on the shared actual-house artifact/read model, manual compare and annual/monthly actual readouts must use it instead of a second aggregate, `0.00`, or a blank placeholder.
- Active GapFill `MANUAL_MONTHLY` readback must reflect the same saved/effective manual-travel contract used for the run being shown. Historical saved payload travel ranges may remain visible only as historical context, not as active artifact truth.
- `TRAVEL_VACANT` and `MANUAL_CONSTRAINED` stay on one shared modeled-day family. Travel/vacant runs may lack bill-period reconciliation, but they must still use the shared weather-responsive day-total and interval-shape path whenever shaping evidence is available.
- Pure `MANUAL_MONTHLY` travel/vacant simulation now uses same-run simulated non-travel manual days as donor/reference truth inside the shared Stage 2 runtime. It is the manual-monthly analog of Past simulated-day logic without actual interval donor truth.
- Manual Usage Lab and GapFill pure manual monthly both use that same shared runtime behavior; there is no GapFill-only or Manual-Lab-only travel/vacant simulator.
- Source actual intervals remain compare-only for pure manual monthly, while `MONTHLY_FROM_SOURCE_INTERVALS` remains a separate source-derived mode and keeps its existing semantics.
- Weather sensitivity / home efficiency scoring follows the same shared-logic rule: one shared owner computes the score, the shared downstream calculation path consumes `weatherEfficiencyDerivedInput`, and customer Usage, customer Simulation, admin GapFill, the dedicated Admin Tools lab, and One Path consume that same contract. Weather remains one shared owner with exactly two scoring paths only: `INTERVAL_BASED` and `BILLING_PERIOD_BASED`. No third path and no page-local or route-local weather math are allowed.
- Interval-backed homes score from actual daily usage versus actual daily weather; manual-monthly homes score from entered bill totals versus weather over those exact bill dates. Insulation/window details remain optional at first and become the next prompt only when the shared score indicates inefficiency or under-explained weather sensitivity.
- When a Manual Usage Lab run is shown, the visible Stage 1 contract must come from the artifact-backed lab payload for that run so the lab does not keep showing stale travel ranges or stale monthly totals after the shared runtime has moved on.
- GapFill `MANUAL_MONTHLY` now owns one rolling admin auto-date contract: active anchor/bill-end date = current Chicago date minus 2 days.
- Manual Usage Lab monthly popup now exposes `CUSTOMER_DATES`, `AUTO_DATES`, and `ADMIN_CUSTOM_DATES` for the isolated lab payload only.
- Customer/source manual usage payloads are read-only context in Manual Lab and GapFill admin flows. Admin date edits, total edits, and travel edits must persist only on lab/test-home payloads and must never mutate or sync back into customer/source payloads.
- GapFill manual modes now expose a dedicated Stage 1 UI panel for test-home manual-monthly/manual-annual readback. Actual House remains the unchanged shared Past Sim chart/data/compare source.
- Manual monthly compare/reconciliation now treats non-travel-eligible bill periods as exact-match-required and travel-overlapped periods as explicit excluded/partial context.
- The Actual House top lockbox/header summary must read the same shared artifact truth as the diagnostics block for `sourceHouseId`, `profileHouseId`, `intervalFingerprint`, and `weatherIdentity`.
- This overrides any prior wording that tolerated alternate compare totals, stale active travel-contract readback, or separate flat travel-day behavior.
- Exact-interval observed-history modeling intent is now explicit in runtime and docs: bounded K-nearest weather-similar donor blending leads modeled-day reconstruction in actual-backed mode, donor-pool variance guardrails damp noisy donor cohorts, heating-day donor ranking weights HDD/min-temp more strongly, broader calendar ladders are fallback-only, bounded post-donor weather tuning is secondary, and home/appliance profiles stay supportive context rather than the main selector.
- GapFill tuning surfaces must report donor-path usage separately from true broad fallback usage, and the Actual House lockbox-flow panel must read the same shared-diagnostics truth already attached to the artifact.
- Manual-usage wiring work must not replace or weaken that exact-interval path; Daily Curve Compare, calculation-logic exact-interval summaries, and actual/test parity stay on the existing shared donor-tuning branch.
- Admin-only manual-mode failures may surface root-cause infrastructure detail such as Prisma pool exhaustion (`P2024`) for debugging without changing customer-page semantics.
- Custom Prisma client packaging is now tracked as a deployment concern: `next.config.js` uses real App Router URL-path tracing, and Home Details currently imports from `@prisma/home-details-client` with schema output under `node_modules/@prisma/home-details-client`.

## Where To Start

1. Open `docs/QUICK_START.md` and follow the workflow steps.

2. Use Cursor to apply changes via single GPT blocks.

3. Push to `main` to deploy and verify with `/api/admin/env-health`.

---

## Environment & Deployment

### Production Infrastructure
- **Deployment**: https://intelliwatt.com (Vercel)
- **Database**: DigitalOcean PostgreSQL (production)
- **CMS**: Connected to DigitalOcean managed database
- **Build System**: Next.js 14+ with App Router

### Infrastructure
- **Database**: DigitalOcean managed PostgreSQL cluster
- **Hosting**: Vercel for frontend/API deployment
- **CDN**: Vercel Edge Network for static assets
- **Monitoring**: Integrated with Vercel Analytics

#### Infrastructure (SMT Proxy)
- **Droplet**: DigitalOcean — `intelliwatt-smt-proxy`
- **IP**: `64.225.25.54`
- **OS/User**: Ubuntu 22.04+, user `deploy`
- **Purpose**: Pull SMT files (SFTP), post RAW files to IntelliWatt API
- **Key Path**: `/home/deploy/.ssh/intelliwatt_smt_rsa4096` (private), `.pub` uploaded to SMT

### Environment Strategy
⚠️ **CRITICAL**: Use Preview deployments for testing, treat Production as read-only

- **Preview Deployments**: For all testing, development, and experimental changes
  - Every branch/PR gets a unique preview URL
  - Safe to test data modifications
  - Connected to same production database (use with caution)
  
- **Production**: Read-only for verified flows and data queries
  - Only use for querying existing data
  - Avoid running cleanup or modification endpoints
  - Verified flows only

### Development Guidelines
⚠️ **IMPORTANT**: Do not attempt to start a local dev server or query the database directly during development.

- Production data is available via deployed API endpoints
- **Prefer Preview deployments** for all testing and debugging
- Use Production API only for read-only verified flows
- No local database connection needed
- Migration scripts have been applied
- **Gap-Fill target semantics (data pool):** The shared Past sim’s **good-data / reference pool** includes **test compare** days’ **actual** intervals (good at-home signal). **Only** travel/vacant-style days are **excluded** from that pool as bad reference data. Travel/vacant days are still **simulated** from the rest of the window. **Implemented:** scored test days use **`forceModeledOutputKeepReferencePoolDateKeys`** so compare output is **modeled** (`GAPFILL_MODELED_KEEP_REF`) while actuals stay in the pool; **`gapfillScoringDiagnostics`** + Gap-Fill Lab UI confirm sources. See `docs/USAGE_SIMULATION_PLAN.md` (Gap-Fill Lab: Target architecture §6) and `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`.
- Gap-Fill Lab canonical actions (`run_test_home_canonical_recalc`) are expected to stay lightweight: shared simulator math remains authoritative, but the response should avoid heavy snapshot-only report payloads.
- Gap-Fill Lab main UI path uses a single reusable test-home identity loaded from a selected source house, then recalc/read from the same canonical simulator service chain and saved artifact family as `/api/user/usage/simulated/house`.
- GapFill Actual House now reads the same shared persisted Past artifact/display path as the user Past page. GapFill may layer diagnostics onto that artifact, but it must not create a separate actual-house truth path.
- One Path Sim architecture note: `docs/ONE_PATH_SIM_ARCHITECTURE.md` is the canonical rescue-architecture reference. One Path Sim Admin is currently pre-cutover only, the existing usage page / usage pipeline remains the upstream source of truth, baseline now reuses persisted upstream usage truth and may seed it through the existing shared usage refresh owner when missing, and Past Sim remains the first place simulation/final chart structuring happen.
- Current verified repo state: live app surfaces remain quarantined from One Path, and `modules/onePathSim/**` is internally sealed from live behavior-owner imports under `modules/usageSimulator/**`, `modules/manualUsage/**`, `modules/weatherSensitivity/**`, and `modules/simulatedUsage/**`.
- That internal seal does not mean cutover is complete. GapFill and user sim pages are still not cut over to One Path; Manual Lab now shares the One Path Stage 2 calc/read path while keeping its own admin Stage 1 surface.
- One Path sandbox tuning now uses a code-backed known-house scenario registry/preset loader under `modules/onePathSim/**` so repeated admin runs can preload keeper-user identity, house/context selection strategy, scenario selection, validation inputs, travel ranges, and review expectations without live persistence. This remains sandbox-only and must not wire into live app surfaces.
- One Path manual Stage 1 now publishes through One Path-owned manual wrappers/read models and does not use the current user manual page as its source of truth.
- Lean One Path manual reads now return the same Stage 1 contract plus the same Stage 2 display-ready Past view the future lightweight user-style manual path is expected to use; debug ON layers richer diagnostics on top of that same core read path.
- **Droplet async sim (optional):** Past sim recalc may enqueue via **`SimDropletJob`** + **`recalcSimulatorBuild`** on the worker—same TS service layer as Vercel, not a second engine. Canonical Gap-Fill compare is inline, artifact-backed, and snapshot-reader-based; any droplet `gapfill_compare` behavior is legacy/rollback only and is not the canonical compare truth path. Inline overrides: **`PAST_SIM_RECALC_INLINE`** or global **`SIM_DROPLET_EXECUTION_INLINE`**. See `docs/CHAT_BOOTSTRAP.txt`, `docs/PROJECT_PLAN.md`, and `docs/ONE_PATH_SIM_ARCHITECTURE.md`.
- Shared weather truth for both Past Sim and Gap-Fill compare is owned by `loadWeatherForPastWindow`: it must reuse persisted non-stub `ACTUAL_LAST_YEAR` daily weather rows when the requested canonical window is already covered, and only backfill/repair missing or `STUB_V1` dates.
- Shared weather provenance must remain truthful when that loader runs: `weatherSourceSummary` should reflect whether the window is `actual_only`, `mixed_actual_and_stub`, or `stub_only`, rather than implying a fresh pull when saved actual weather already exists.
- Gap-Fill Lab DB travel/vacant ranges are not guardrails only: compare-core must execute the bounded DB travel dates through the same shared simulator family used by Past Sim so canonical artifact simulated-day totals can be validated against fresh shared compare day totals.
- Gap-Fill Lab selected-days scored actual days should not be reported as missing artifact simulated-day parity defects when the artifact only stores canonical simulated-day totals for true simulated ownership days (for example travel/vacant patches); surface an explicit not-applicable parity state instead.
- Gap-Fill Lab heavy diagnostics retries should return a compact merge-only payload with heavy timing fields, rather than re-sending the entire core compare response.
- Gap-Fill Lab compare-core must include compact scored-day weather truth for the scored local dates, owned by the shared compare/service path; heavy report may expand that truth, but route/UI layers must not recompute scored-day weather on their own.
- Gap-Fill Lab must fail explicitly when a run claims DB travel/vacant parity validation or exact shared artifact proof but the canonical artifact day totals or fresh shared compare day totals needed for that proof are missing.
- Gap-Fill Lab exact compare requests that inherit identity from `same_run_artifact_ensure` must prove exact hash ownership before compare proceeds: `artifactSourceMode` must be exact, `requestedInputHash` must equal `artifactInputHashUsed`, and fallback identity handoff must fail early with `artifact_exact_identity_unresolved` / `ARTIFACT_ENSURE_EXACT_HANDOFF_FAILED`.
- Gap-Fill Lab travel/vacant parity must read canonical artifact references from the exact artifact row's persisted `canonicalArtifactSimulatedDayTotalsByDate`; if exact identity is unresolved, do not continue into travel/vacant parity validation.
- Shared tuning config is now expected to live in the shared simulation variable policy store with mode-aware buckets only (`sharedDefaults`, `intervalOverrides`, `manualMonthlyOverrides`, `manualAnnualOverrides`, `newBuildOverrides`). Admin tooling may edit that shared config, but must not add route-local or page-local calculation variables.
- Canonical readback should expose `effectiveSimulationVariablesUsed` for the exact run/artifact identity so tuning surfaces can inspect resolved values and whether each came from a shared default, a mode override, or an explicit admin override.

### Active Focus (Runtime)

- Fresh shared producer-chain alignment is now true for Past Sim and Gap-Fill compare (`simulatePastUsageDataset` -> `buildPastSimulatedBaselineV1` -> `buildCurveFromPatchedIntervals` -> `buildSimulatedUsageDatasetFromCurve`).
- Shared weather reuse/provenance is already true in current runtime code (`loadWeatherForPastWindow` persisted-weather-first behavior).
- Canonical simulated-day total authority now lives in `buildSimulatedUsageDatasetFromCurve()` via `canonicalArtifactSimulatedDayTotalsByDate`; `modules/usageSimulator/service.ts` reads that authority through `readCanonicalArtifactSimulatedDayTotalsByDate*()` and no longer owns service-side canonical total builders/attachers.
- Shared window/date ownership is still locked correctly on the current branch: compare identity uses `resolveWindowFromBuildInputsForPastIdentity()`, metadata/report coverage uses `resolveCanonicalUsage365CoverageWindow()`, and scored/test dates must not mutate artifact input hash or travel/vacant exclusion ownership.
- Selected-day result slicing and selected-day compare ownership stay on one timestamp-derived local-date rule; the retired `localDate` fallback path is no longer current runtime behavior.
- Travel/test scoring still does not change artifact hash ownership or `excludedDateKeysFingerprint`.
- Strict shared-sim calculation alignment is now complete for the active compare/parity paths on the current working tree: selected-day compare consumes surfaced `canonicalSimulatedDayTotalsByDate` from `simulatePastSelectedDaysShared()`. In default selected-days mode, DB travel/vacant parity-validation days are included in the **same** `simulatePastSelectedDaysShared` run as scored test days (union of local date keys); compare vs travel/vacant parity differ only in post-sim slicing and reporting, not a second simulation path. When exact artifact proof requires it (`requireExactArtifactMatch` with travel/vacant parity dates), a single shared full-window execution may still be used and both compare and parity slice from that one run.
- Broad focus remains shared simulation-core accuracy.
- `compareRunId` plus durable compare-run persistence now exist in runtime (`GapfillCompareRunSnapshot`).
- `compare_core` now returns compare-run state fields (`compareRunId`, `compareRunStatus`, `compareRunSnapshotReady`).
- Staged heavy snapshot readers now exist in runtime (`compare_heavy_manifest`, `compare_heavy_parity`, `compare_heavy_scored_days`) and require `compareRunId`.
- Canonical heavy follow-up path is now snapshot-read-only over persisted compare snapshot state (no recompute in canonical admin flow).
- Gap-Fill admin stabilization pass is complete for current runtime flow (snapshot-reader history/debug clarity + stage-scoped retry + reader-stage label clarity).
- Legacy `compare_heavy` compatibility may still exist, but it is not the canonical admin heavy path.
- Remaining caveat is narrow and historical-data-only: `reconcileRestoredDatasetFromDecodedIntervals()` still backfills missing legacy display aggregates, and exact parity intentionally trusts persisted canonical artifact totals rather than decoding intervals as a second truth source. Historical artifacts with wrong stored canonical totals therefore need rebuild, not parity-side recomputation.

**Security note (Oct 2025):** Admin/Debug routes are now gated with `ADMIN_TOKEN`.
- **Production:** `ADMIN_TOKEN` is required; requests must include header `x-admin-token`.
- **Preview/Dev:** If `ADMIN_TOKEN` is set, it is required; if it is **not** set, access is allowed to prevent lockout.
- See **ENV_VARS.md → ADMIN_TOKEN** for details and usage examples.
- **Admin/debug calls:** Use the wrapper `scripts/admin/Invoke-Intelliwatt.ps1` so requests automatically include `x-admin-token`. See **docs/ADMIN_API.md**.

## Engineering Guardrail: No Duplicate Logic

- Do not write the same function or functional logic in two places.
- All shared behavior must live in a module and be imported where needed.
- Routes, pages, and admin tools must import shared modules instead of reimplementing business logic.
- If logic appears duplicated, stop and consolidate it into one canonical module before continuing.
- Do not create a second derivation path for the same output or artifact.
- This is a project-level rule for all future work.
- Canonical source for this rule: `docs/ARCHITECTURE_STANDARDS.md` (`## Single Implementation Rule`).

========================================
GAPFILL + SIM USAGE SHARED MODULES (CANONICAL)
========================================

Audit baseline (2026-03-13): all GapFill/simulation tests and admin tools must use shared modules below; do not duplicate business logic in routes/tests/tools.

1) Core simulation orchestration:
- `modules/usageSimulator/service.ts`
- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `modules/simulatedUsage/engine.ts`
- `modules/simulatedUsage/pastDaySimulator.ts`

2) Past identity/hash/window/cache:
- `modules/usageSimulator/windowIdentity.ts`
- `modules/usageSimulator/pastCache.ts`
- `modules/weather/identity.ts`
- `lib/usage/actualDatasetForHouse.ts` (`getIntervalDataFingerprint`)
- `modules/simulatedUsage/simulatePastUsageDataset.ts` (`getUsageShapeProfileIdentityForPast`)

3) Build/dataset/day-grid shared helpers:
- `modules/usageSimulator/build.ts`
- `modules/usageSimulator/dataset.ts`
- `modules/usageSimulator/pastStitchedCurve.ts`
- `lib/time/chicago.ts`

4) Canonical interval source + persisted artifact reads:
- `modules/realUsageAdapter/actual.ts`
- `lib/usage/actualDatasetForHouse.ts`
- `lib/usage/resolveIntervalsLayer.ts`
- `lib/usage/intervalSeriesRepo.ts`

5) Usage-shape profile dependencies for sim:
- `modules/usageShapeProfile/repo.ts`
- `modules/usageShapeProfile/derive.ts`
- `modules/usageShapeProfile/actualIntervals.ts`
- `modules/usageShapeProfile/autoBuild.ts`

6) Manual-usage shared helpers:
- `modules/manualUsage/prefill.ts`
- `modules/manualUsage/store.ts`
- `modules/manualUsage/reconciliation.ts`

7) Admin/shared tooling modules:
- `lib/admin/gapfillLab.ts`
- `lib/admin/gapfillLabPrime.ts`
- `lib/admin/simulatorDiagnostic.ts`
- `modules/usageSimulator/calculationLogicSummary.ts`
- `modules/usageSimulator/dailyCurveCompareSummary.ts`
- `modules/usageSimulator/profileDisplay.ts`
- `modules/usageSimulator/simulationDataAlerts.ts`
- `modules/usageSimulator/simulationVariablePresentation.ts`
- `modules/usageSimulator/repo.ts`

Mandatory enforcement rules:
- Routes, pages, admin tools, and tests may orchestrate and format only; reusable business logic must stay in shared modules.
- Tests must validate via the same shared modules or route contracts; no test-only duplicate business math.
- Rebuild/parity/diagnostic paths must be explicit; default reads should be artifact/cache-first where possible.
- If functionality already exists in one of the shared modules above, Cursor must use or extend that module instead of writing similar logic elsewhere.
- If a new reusable module is created in the future, it must be added to the canonical architecture docs listed in `docs/CHAT_BOOTSTRAP.txt` under the doc-alignment override.
- If this task creates any new reusable shared module or shared helper, Cursor must update those canonical architecture docs in the same change before finishing.
- Any new route/tool/test that depends on GapFill or simulated usage must first check this canonical registry before adding logic.
- No duplicate code is allowed for date/window logic, weather identity logic, interval source selection, artifact identity/hash logic, profile identity logic, simulation-day generation, stitched Past artifact building, or diagnostic orchestration.

### Shared Simulation Architecture Authority

- Past Sim and GapFill compare use the same shared artifact identity/fingerprint and shared simulator logic path.
- Travel/vacant days are the only excluded ownership days for the shared artifact fingerprint.
- Test days remain included in the shared artifact population and are only selected by GapFill for scoring against actual usage.
- GapFill is a scoring/reporting workflow only. It must not create a compare artifact, create a compare-mask fingerprint, change artifact identity, or rebuild simulated intervals locally; scoring reads shared simulator output through cached artifact restore or fresh shared-build path.
- GapFill core/default scoring mode is selected-day fresh shared execution (`compareFreshMode=selected_days`) while chart/table display stays artifact-backed.
- GapFill full-window fresh shared scoring (`compareFreshMode=full_window`) is retained as an explicit heavy proof path only.
- GapFill admin-only calculation-logic explanations are read-side summaries of persisted shared diagnostics / lockbox metadata / artifact context through `modules/usageSimulator/calculationLogicSummary.ts`; they must not introduce a second truth path.
- GapFill admin-only daily curve compare is a read-side summary of persisted actual/test-house interval artifacts plus compare-day selections through `modules/usageSimulator/dailyCurveCompareSummary.ts`; it must not introduce a second compare or simulator path.
- Artifact fingerprint ownership and usage-shape profile identity rules are unchanged here; deferred identity/profile contract changes remain out of scope.
- Shared weather truth is owned by `loadWeatherForPastWindow`, which must read saved non-stub daily actual weather first and only backfill missing or `STUB_V1` dates.
- Weather provenance from that shared loader is part of the contract for both Past Sim and GapFill; docs and callers must not imply a fresh weather pull when persisted actual weather already covers the requested window.
- Route-level or tool-level simulation math is not acceptable when the shared simulator output already exists.
- Authoritative shared simulator call chain:
  - `getPastSimulatedDatasetForHouse`
  - `simulatePastUsageDataset`
  - `loadWeatherForPastWindow`
  - `buildPastSimulatedBaselineV1`
  - `buildCurveFromPatchedIntervals`
  - `buildSimulatedUsageDatasetFromCurve`

LEGACY / NON-AUTHORITATIVE historical drift notes:
- Older notes referenced unresolved shared identity wiring work in simulation engines diagnostics.
- Treat these as historical context only; fresh producer-chain alignment is now in place, but strict finalized-output alignment still has remaining service-level caveats on the current branch.
- Canonical simulation-logic reference is `docs/USAGE_SIMULATION_PLAN.md`; this context doc should stay shorter and aligned to that source.

### Simulation Modeling Modes (authoritative summary)

- **Observed-history reconstruction mode** (Past Sim + GapFill compare): prioritize actual intervals, weather, weekday/weekend, time-of-day, and similar-day empirical behavior.
- **Overlay/delta mode**: apply structured deltas from home/appliance/occupancy/HVAC/thermostat/pool/EV/envelope factors.
- **Synthetic/sparse-data mode** (manual/new-build/low-history): prioritize declared home/appliance/occupancy details + weather + learned priors.
- Home details are required and normalized for all homes. In observed-history reconstruction they are supportive context/priors/fallback, while overlay/synthetic modes weight them as primary modeling inputs.

---


### Database Schema
- **Models**: 
  - `HouseAddress` (in `prisma/schema.prisma`) - Address collection with ESIID (conflict handling now transfers meters to the newest user and preserves raw vendor payloads). As of Nov 19, 2025 we also mirror the normalized `userEmail` alongside the cuid `userId` so ops can search by email even if the login address changes.
  - `UserProfile` - Stores household metadata and now tracks ESIID attention flags (`esiidAttentionRequired`, `esiidAttentionCode`, `esiidAttentionAt`) so Customer Ops can email prior owners when a meter moves. The address save endpoint now emits a warning (instead of crashing) if those columns are still missing, reminding ops to run `npx prisma migrate deploy`.
  - `ErcotIngest` - ERCOT file ingestion history tracking
  - `ErcotEsiidIndex` - Normalized ESIID data from ERCOT extracts
  - `RatePlan` - Normalized electricity plans (REP plans and utility tariffs)
  - `RawSmtFile` - Raw SMT file storage
  - `SmtInterval` - SMT usage interval data
- **Validation Source**: Enum values (NONE, GOOGLE, USER, OTHER)
- **Indexes**: userId, placeId, addressState+addressZip5, esiid
- **ERCOT Indexes**: normZip, normLine1 (GIN trigram for fuzzy matching)

---

## Windows Environment Notes

### Shell Configuration
- **Shell**: Windows PowerShell
- **Location**: `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`

### Command Syntax Requirements
⚠️ **CRITICAL**: Never use bash-style command chaining

❌ **DO NOT USE**:
```bash
git add . && git commit -m "message" && git push
```

✅ **USE INSTEAD**:
```powershell
git add .; git commit -m "message"; git push
```

Or use separate commands:
```powershell
git add .
git commit -m "message"
git push
```

### Example Production API Commands
```powershell
# Admin token required for all debug endpoints
$headers = @{ "x-admin-token" = "<ADMIN_TOKEN>" }

# PowerShell syntax for API calls
Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/list-all-addresses" -Method GET

# Parse JSON response
$data = Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/list-all-addresses" -Method GET

# Check specific address
Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/check-address?email=bllfield@yahoo.com" -Method GET
```

---

## Architecture Overview

### Project Structure
```
app/                     # App Router (Next.js 14+)
├── api/                # API routes
│   ├── admin/          # Admin endpoints
│   ├── debug/          # Debug utilities
│   └── address/        # Address management
lib/                     # Core libraries
├── db.ts               # Prisma client
├── normalizeGoogleAddress.ts  # Address normalization
└── wattbuy/           # WattBuy integration
prisma/                 # Database schema
├── schema.prisma       # Prisma models
└── migrations/         # Migration history
components/             # React components
├── QuickAddressEntry.tsx  # Google autocomplete
└── plan/              # Plan-related components
```

### Key Files
- **Prisma Client**: `lib/db.ts` (import as `import { prisma } from '@/lib/db'`)
- **Address Save**: `app/api/address/save/route.ts` (upsert logic)
- **Normalization**: `lib/normalizeGoogleAddress.ts`
- **Google Setup**: `docs/GOOGLE_MAPS_SETUP.md`

### API Endpoints

#### Debug/Utility Endpoints (admin-gated)
> ⚠️ These endpoints now require header `x-admin-token: <ADMIN_TOKEN>`.  
> Prefer **Preview** for testing; treat **Production** as read-only for verified flows.

- `GET https://intelliwatt.com/api/debug/list-all-addresses` - List all addresses
- `GET https://intelliwatt.com/api/debug/check-address?email=...` - Check specific user
- `POST https://intelliwatt.com/api/debug/cleanup` - Remove duplicates
- `GET https://intelliwatt.com/api/migrate` - Run migrations
- `GET https://intelliwatt.com/api/admin/env-health` - Check environment variable status

#### WattBuy Admin Endpoints (admin-gated)
- `GET /api/admin/wattbuy/retail-rates-test` - Test retail rates (utilityID+state OR address auto-derive)
- `GET /api/admin/wattbuy/retail-rates-zip` - Retail rates by ZIP (auto-derives utilityID)
- `GET /api/admin/wattbuy/retail-rates-by-address` - Retail rates by address (convenience)
- `GET /api/admin/wattbuy/retail-rates` - Main retail rates endpoint (with DB persistence)
- `GET /api/admin/wattbuy/electricity` - Robust electricity catalog (with fallback)
- `GET /api/admin/wattbuy/electricity-probe` - Electricity probe endpoint
- `GET /api/admin/wattbuy/electricity/info` - Electricity info endpoint

#### ERCOT Admin Endpoints (admin-gated)
- `GET /api/admin/ercot/cron` - Vercel cron endpoint (header `x-cron-secret` or query `?token=CRON_SECRET`)
- `GET /api/admin/ercot/fetch-latest` - Manual fetch by explicit URL
- `GET /api/admin/ercot/ingests` - List ingestion history
- `GET /api/admin/ercot/debug/last` - Get last ingest record
- `GET /api/admin/ercot/debug/url-sanity` - Test URL resolution
- `POST /api/admin/ercot/lookup-esiid` - Lookup ESIID from address using ERCOT data

#### SMT Admin Endpoints (admin-gated)
- `POST /api/admin/smt/pull` - Trigger SMT data pull via webhook
- `POST /api/admin/smt/ingest` - SMT file ingestion
- `POST /api/admin/smt/upload` - SMT file upload
- `GET /api/admin/smt/health` - SMT health check

#### Data Endpoints
- `POST https://intelliwatt.com/api/address/save` - Save/update address
- `GET https://intelliwatt.com/api/v1/houses/{id}/profile` - Get house profile

#### Public Endpoints
- `GET /api/ping` - Health check (JSON)
- `GET /api/ping.txt` - Health check (plain text)

---

## Feature Implementation Details

### Address Collection System
- **Component**: `components/QuickAddressEntry.tsx`
- **Integration**: Google Places Autocomplete with manual fallback
- **Storage**: `HouseAddress` model in database
- **Normalization**: Google → normalized via `lib/normalizeGoogleAddress.ts`
- **Consent**: Smart Meter consent checkbox integrated
- **Email Normalization**: All emails normalized to lowercase via `lib/utils/email.ts` to prevent duplicate accounts

### Google Maps Setup
- **API Key**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (env var)
- **Script**: Loaded in `app/layout.tsx`
- **Autocomplete**: Reads full place details
- **Fallback**: Manual entry parsing via `lib/parseManualAddress.ts`

### Address Save Flow
1. User enters address (autocomplete or manual)
2. Optional unit/apartment number entry
3. Smart Meter consent checkbox
4. POST to `/api/address/save` with normalized fields
5. Upsert logic finds existing userId, updates; else creates

---

## Known Issues & Limitations

### Performance
- **Vercel Cold Starts**: 20 seconds to 2 minutes latency on first request
- **Database Latency**: Network latency (not Prisma issues)
- **Query Delays**: Connection pooling may cause delays

### Autocomplete
- Autocomplete may not initialize properly
- Falls back to manual entry gracefully
- Google API key restrictions configured

---

## Next Steps & Considerations

### Recent Features Implemented
- ✅ ERCOT daily pull system for ESIID data ingestion
- ✅ WattBuy retail rates and electricity catalog integration
- ✅ Email normalization to prevent duplicate accounts
- ✅ SMT integration with webhook triggers
- ✅ Admin inspector UIs for WattBuy, SMT, and ERCOT
- ✅ Robust electricity endpoint with fallback strategies
- ✅ Rate plan normalization and database persistence

### Planned Features
- Add database indexes and accelerate connection pooling
- Allow multiple addresses per user (add houseId field)
- Add validation/geocoding with retries
- Complete ERCOT file URL resolution (currently manual)

### Optimization Opportunities
- Implement caching strategies
- Accelerate Vercel cold starts
- Optimize database connection pool
- Add retry logic for external APIs

---

## Important Files Reference

### Database & Schema
- `prisma/schema.prisma` - Database models and enums
- `lib/db.ts` - Prisma client setup

### Address Management
- `app/api/address/save/route.ts` - Address save/update logic
- `lib/normalizeGoogleAddress.ts` - Google to normalized address mapping
- `components/QuickAddressEntry.tsx` - Autocomplete UI component

### Configuration
- `app/layout.tsx` - Google Maps script loading
- `middleware.ts` - Request middleware
- `lib/flags/index.ts` - Feature flags

### Documentation
- `docs/GOOGLE_MAPS_SETUP.md` - Google Maps integration guide
- `docs/ARCHITECTURE_STANDARDS.md` - Core architecture principles
- `docs/PROJECT_PLAN.md` - Authoritative project plan
- `docs/API_CONTRACTS.md` - API versioning and contracts
- `docs/USAGE_LAYER_MAP.md` - Canonical usage interval-series layer mapping
- `docs/ENV_VARS.md` - Environment variables
- `docs/OBSERVABILITY.md` - Logging and monitoring
- `docs/STANDARDS_COMPONENTS.md` - Component-specific standards

---

## Quick Commands Reference

### Admin Authentication Required
All debug/admin endpoints now require `x-admin-token` header matching `ADMIN_TOKEN` env var.

```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
```

### Check Current Addresses (PowerShell)

**Preview (Recommended):**
```powershell
# Replace <your-preview> with your Vercel preview deployment URL
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
$response = Invoke-RestMethod -Headers $headers -Uri "https://<your-preview>.vercel.app/api/debug/list-all-addresses" -Method GET
$response.recentAddresses
```

**Production (Read-Only):**
```powershell
$headers = @{ "x-admin-token" = "<YOUR_ADMIN_TOKEN>" }
$response = Invoke-RestMethod -Headers $headers -Uri "https://intelliwatt.com/api/debug/list-all-addresses" -Method GET
$response.recentAddresses
```

### Check User Address (PowerShell)

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

### Run Cleanup (PowerShell)

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

## Database Connection (DO NOT COMMIT SECRETS)

- All DB URLs must be stored only in:
  - **Vercel Environment Variables** (Preview + Production)
  - local `.env.local` (gitignored) or PowerShell session env vars

**Dev master DB (requested)**
```
DATABASE_URL="postgresql://doadmin:<PASSWORD>@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_dev?sslmode=require"
```

**WattBuy Offers module DB (Production / Vercel env vars)**
```
INTELLIWATT_WATTBUY_OFFERS_DATABASE_URL="postgresql://doadmin:<PASSWORD>@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25061/intelliwatt_wattbuy_offers?sslmode=require"
INTELLIWATT_WATTBUY_OFFERS_DIRECT_URL="postgresql://doadmin:<PASSWORD>@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/intelliwatt_wattbuy_offers?sslmode=require"
```

- **Droplet update (run exactly as written when connected as `root`)**
  ```bash
  sudo nano /etc/environment
  ```
  Paste your environment lines at the end of the file (do not commit them to git), then save (`Ctrl+O`, Enter) and exit (`Ctrl+X`).
  Reload the session so the env vars are active:
  ```bash
  source /etc/environment
  ```
  Restart any services or scripts after updating.

- **Prisma Studio**
  - Uses whichever value `DATABASE_URL` currently holds.
  - Always close Studio (`Ctrl+C`) when finished so pooled connections are released.

- **Migration Status**: Applied (HouseAddress model exists)
- **Client Import**: `import { prisma } from '@/lib/db'`

---

## Related Documentation

For detailed information about specific areas, see:
- **[Google Maps Setup](./GOOGLE_MAPS_SETUP.md)** - Google Places API configuration
- **[Architecture Standards](./ARCHITECTURE_STANDARDS.md)** - Core principles and patterns
- **[Project Plan](./PROJECT_PLAN.md)** - Authoritative project guardrails
- **[Usage Simulation Plan](./USAGE_SIMULATION_PLAN.md)** - Authoritative manual-monthly and shared Past Sim semantics
- **[API Contracts](./API_CONTRACTS.md)** - API versioning strategy
- **[Usage Layer Map](./USAGE_LAYER_MAP.md)** - Canonical interval-series layer map and route/function mapping
- **[Environment Variables](./ENV_VARS.md)** - Required env vars
- **[Observability](./OBSERVABILITY.md)** - Logging and monitoring
- **[Component Standards](./STANDARDS_COMPONENTS.md)** - Component implementations

---

## Company Identity Snapshot (CSP / SMT)

This snapshot is canonical for SMT, PUCT, and CSP-related integrations.

- Legal Name: Intellipath Solutions LLC
- DBA: IntelliWatt
- DUNS: 134642921
- PUCT Aggregator Registration Number: 80514
- Official Business Phone (for PUCT / SMT / CSP matters): 817-471-0579
- Primary Business Email: brian.littlefield@intellipath-solutions.com

Smart Meter Texas Integration Context:

- CSP identity: Intellipath Solutions LLC / DBA IntelliWatt
- Current usage:
  - WattBuy is the active ESIID source of truth.
  - SMT SFTP + API handle customer-authorized interval data (Agreements / Subscriptions / Enrollment).
- Support contacts in practice:
  - Primary SMT support: support@smartmetertexas.com
  - SMT service desk (tickets): rt-smartmeterservicedesk@randstadusa.com

All CSP documentation, SMT tickets, and API requests must reference these identifiers unless superseded by a future LOCKED plan entry.

---

## Security Updates (Brief)

- **Oct 2025:** Introduced `ADMIN_TOKEN` gating for `/api/debug/*`, `/api/migrate`, and `/api/admin/*`. Production requires the token; Preview/Dev requires it only if set.

### Current System State (Post Weather Stub Integration)

- Weather storage added (`HouseDailyWeather` model).
- Stub population implemented.
- Past SMT patch engine is weather-aware.
- Overlay logic not yet applied to Past.
- Future baseline not yet using weather normalization.
- No changes to plan engine.

### Time Alignment Architecture Context

Usage = canonical UTC 15-minute timestamps. Weather = station-based daily lookup by UTC `dateKey` for temp/HDD/CDD drivers. Solar (future) = separate tile/grid source aligned to the same canonical UTC 15-minute timestamps (or deterministic upsample), not station-based.

### Validation-Day Selection Context (2026-03-28)

- Canonical selector modes are shared and additive:
  - `manual`
  - `random_simple`
  - `customer_style_seasonal_mix`
  - `stratified_weather_balanced`
- A system-wide setting controls the default mode for future user recalcs.
- Admin lab can choose a run-only mode independently.
- Saved artifacts are immutable with respect to mode changes; existing artifacts are not retroactively rewritten.
- Validation-day compare values are surfaced as a sidecar projection from the same canonical artifact family.

