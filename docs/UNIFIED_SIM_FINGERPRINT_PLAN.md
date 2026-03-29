# 1. Purpose of this build plan
This document is the implementation plan for building unified fingerprint architecture on top of the existing canonical shared simulator chain, including exact runtime behavior for the admin Gap-Fill / Calibration Lab.

This plan exists to prevent drift into duplicate simulator paths, route-local simulation math, admin-only simulation engines, separate output families, or duplicate fingerprint builders.

The plan is written to be complete enough to guide implementation, operations, and debugging without improvising behavior in routes or UI.

**Near-term priority:** Before routing every low-data mode through an upgraded shared calculator, the program must complete the next shared calculation-logic upgrade (temperature-driven day modeling and fingerprint integration), **measure** its runtime and memory cost on real houses, and **decide** whether the heavy shared workload remains viable on Vercel or must move to droplet (or similar) for orchestration. The program must **not** finish a large Vercel-centric unification of all modes first and only afterward discover that the real shared engine must run off-box.

**Final target (unchanged):** Actual-data, manual monthly, manual annual, and new-build / zero-data modes all terminate in the same shared simulator chain. **Sequencing differs from rollback:** hosting and orchestration are decided early; architecture rules below stay fixed.

# 2. Final target architecture vs near-term implementation sequence
| Dimension | Final target | Near-term sequence rule |
|---|---|---|
| Simulator | One shared chain for all modes | Upgrade shared day-level modeling and fingerprint contracts first |
| Modes | All modes through shared chain | Broad low-data unification **after** hosting decision is clear |
| Hosting | Wherever measured workload fits | Measure first; move heavy shared work to droplet **before** deep multi-mode wiring if Vercel limits fail |
| Fingerprints | Shared builders only | Same builders for background prebuild and inline recalc; orchestration is timing-only |

# 3. Locked current canonical simulator chain
| step | owner function/module | file path | responsibility |
|---|---|---|---|
| 1 | `POST` recalc route | `app/api/user/simulator/recalc/route.ts` | Auth, house ownership checks, mode validation (`SMT_BASELINE`, `MANUAL_TOTALS`, `NEW_BUILD_ESTIMATE`), reads `userDefaultValidationSelectionMode`, dispatches canonical recalc |
| 2 | `dispatchPastSimRecalc` | `modules/usageSimulator/pastSimRecalcDispatch.ts` | Canonical dispatch entry; inline or queued path; both paths call same `recalcSimulatorBuild` |
| 3 | `enqueuePastSimRecalcDropletJob` (optional async) | `modules/usageSimulator/simDropletJob.ts` | Persists `SimDropletJob` queue payload; webhook handoff only; no separate simulator math |
| 4 | `runPastSimRecalcQueuedWorker` (optional async) | `modules/usageSimulator/pastSimRecalcQueuedWorker.ts` | Loads queued payload and calls same `recalcSimulatorBuild` |
| 5 | `recalcSimulatorBuild` | `modules/usageSimulator/service.ts` | Canonical recalc authority: loads inputs, builds shared inputs, resolves validation selection, runs shared sim path, persists build/artifact metadata |
| 6 | `buildSimulatorInputs` | `modules/usageSimulator/build.ts` | Mode-specific input construction and constraints preparation before shared simulator |
| 7 | `simulatePastUsageDataset` | `modules/simulatedUsage/simulatePastUsageDataset.ts` | Shared past simulation entry, `loadWeatherForPastWindow`, shared simulation orchestration |
| 8 | `buildPastSimulatedBaselineV1` + `simulatePastDay` | `modules/simulatedUsage/engine.ts`, `modules/simulatedUsage/pastDaySimulator.ts` | Shared day-level modeling core used for modeled days |
| 9 | `buildCurveFromPatchedIntervals` + `buildSimulatedUsageDatasetFromCurve` | `modules/usageSimulator/dataset.ts` | Canonical curve/dataset materialization, metadata, daily/monthly/summary shaping |
| 10 | persisted canonical build/artifact family | `prisma/schema.prisma`, `prisma/usage/schema.prisma` | Build identity in `UsageSimulatorBuild`; past artifact cache in `PastSimulatedDatasetCache` |
| 11 | `getSimulatedUsageForHouseScenario` | `modules/usageSimulator/service.ts` | Canonical read family, projection application, compare projection attachment |
| 12 | `GET` simulated house route | `app/api/user/usage/simulated/house/route.ts` | User output serialization from shared service; compare sidecar serialization only |

# 4. Locked architectural rules
- One shared simulator chain only.
- One canonical output family only.
- One shared compare engine family only (`compareProjection` from shared modules).
- Same last-365-day weather timeline concept for all modes.
- Mode behavior differences belong in input builders, constraint adapters, and fingerprint resolution, not separate simulators.
- Validation/test days remain actual in baseline.
- Modeled values for validation/test days appear only in `compareProjection`.
- Routes orchestrate and serialize only.
- Admin UI owns no shared business logic.
- **One shared temperature/day-level modeling implementation** (`buildPastSimulatedBaselineV1` / `simulatePastDay` and successors in the same modules).
- **One shared builder implementation** for `UsageFingerprint` (no second builder for background vs recalc).
- **One shared builder implementation** for `WholeHomeFingerprint` (no second builder for background vs recalc).
- **One shared resolver** producing `ResolvedSimFingerprint` (optional cache of outputs does not imply a second resolver implementation).
- Same shared date/window logic (`resolveCanonicalUsage365CoverageWindow` and shared window helpers).
- Shared business logic ownership remains in shared modules:
  - selection: `modules/usageSimulator/validationSelection.ts`
  - projection: `modules/usageSimulator/compareProjection.ts`
  - weather load ownership: `modules/simulatedUsage/simulatePastUsageDataset.ts` (`loadWeatherForPastWindow`)
  - day-level modeling: `modules/simulatedUsage/engine.ts` + `modules/simulatedUsage/pastDaySimulator.ts`
- Implementation is forbidden from introducing:
  - manual-monthly-only simulator
  - manual-annual-only simulator
  - new-build-only simulator
  - compare-only simulator
  - admin-only simulator
  - route-local day-modeling math
  - separate mode-specific output family
  - second compare engine
  - second truth source
  - **a background fingerprint builder that differs from the recalc-time builder**
  - **one main path plus several heavy fallback paths that repeat near-duplicate work**
  - **repeated full rebuild attempts in the same request path**
  - **multiple artifact reads when one shared read can serve the page**
  - **background rebuild jobs that use different math than inline `recalcSimulatorBuild`**

## Single write authority for modeled results
- `recalcSimulatorBuild` in `modules/usageSimulator/service.ts` and the shared simulation modules it calls are the only authority allowed to produce modeled day outputs.
- Shared modeled day outputs are produced through the canonical chain:
  - `recalcSimulatorBuild`
  - `simulatePastUsageDataset`
  - `buildPastSimulatedBaselineV1`
  - `simulatePastDay`
  - `buildSimulatedUsageDatasetFromCurve`
- Once modeled outputs are written into the canonical build/artifact family, downstream code may only read and project them (`getSimulatedUsageForHouseScenario`, `projectBaselineFromCanonicalDataset`, `compareProjection` attach path).
- Downstream code is forbidden from:
  - recomputing modeled day results
  - normalizing modeled day results
  - overriding modeled day results
  - reinterpreting modeled day results into different values
  - applying route-local or UI-local math to change modeled outputs
- Persistence of modeled results must happen once in the canonical shared path, not in route or UI wrapper code.

## Four distinct shared responsibilities (hard architecture rule)
Final implementation must treat these as four separate shared responsibilities. They stay in shared modules; routes remain orchestration only.

### A. Fingerprint builder
- Heavy path allowed.
- May require droplet or orchestrated execution when measured workload requires it.
- May inspect full interval history, weather history, usage buckets, home details, appliances, and cohort priors.
- Produces `WholeHomeFingerprint`, `UsageFingerprint`, and inputs consumed by `ResolvedSimFingerprint` resolution.

### B. Day simulator
- Must stay lightweight relative to fingerprint building.
- Inputs: resolved simulator inputs (including fingerprint-derived parameters), target modeled dates, target-day weather.
- Outputs: simulated day-level results for those dates.
- Must not pull full interval history during compare calls or stitch calls.
- Uses the same shared day-level modeling logic for travel/vacant modeled days and validation/test modeled days (`buildPastSimulatedBaselineV1` / `simulatePastDay` in `modules/simulatedUsage/engine.ts` and `modules/simulatedUsage/pastDaySimulator.ts`, orchestrated by `simulatePastUsageDataset`).

### C. Stitch module
- Consumes the canonical actual baseline dataset plus simulated travel/vacant day outputs from the shared day simulator path.
- Produces the Past Sim baseline dataset, chart, and curve materialization used for user and admin baseline views (`buildCurveFromPatchedIntervals` and `buildSimulatedUsageDatasetFromCurve` in `modules/usageSimulator/dataset.ts` per Section 3).
- This is where travel/vacant simulated days are stitched into baseline output.
- Current successful Past Sim stitch behavior must be preserved (see **Past Sim stitch preservation** below).

### D. Compare module
- Consumes modeled outputs for selected validation/test days plus actual usage for only those same days.
- Produces compare rows and metrics only (`compareProjection` in `modules/usageSimulator/compareProjection.ts`; attach path `attachValidationCompareProjection` / `buildValidationCompareProjectionSidecar` from `getSimulatedUsageForHouseScenario` in `modules/usageSimulator/service.ts`).
- Must stay lightweight.
- Must not pull a full-year actual interval dataset.
- Validation/test days are not stitched into baseline; they remain actual in baseline and appear modeled only in `compareProjection`.

## Stitch and compare are consumers only
- The stitch module may only consume:
  - the canonical baseline artifact/output
  - modeled travel/vacant day outputs already produced by the shared simulator
- The stitch module may not:
  - recompute modeled day outputs
  - derive new modeled totals
  - alter modeled day values
  - rebuild fingerprint logic
- The compare module may only consume:
  - modeled validation/test day outputs already produced by the shared simulator
  - actual data for only the selected validation/test compare days (`actualContextHouseId`, `validationOnlyDateKeysLocal`, and related dataset meta as wired through `getSimulatedUsageForHouseScenario`)
- The compare module may not:
  - act like a second simulator
  - recompute modeled day outputs
  - alter modeled day values
  - pull full-year actual interval history unless a proven separate measured requirement is documented and approved
- Validation/test days remain actual in baseline.
- Travel/vacant modeled days are stitched into baseline.
- Compare is only a reader and consumer of simulator output plus selected actual-day data.
- Stitch consumes modeled travel/vacant outputs; compare consumes modeled validation/test outputs; neither module is allowed to change those modeled outputs.

## Full-interval history ownership (hard rule)
- Full-interval history work belongs in fingerprint building, not in compare.
- Compare must pull actual usage only for the selected validation/test compare days (current wiring uses `actualContextHouseId` and validation day key sets such as `validationOnlyDateKeysLocal` on the dataset meta consumed by `getSimulatedUsageForHouseScenario`).
- Stitch must use the canonical baseline artifact output plus simulated travel/vacant day outputs; it must not reload full-year intervals to perform stitch.
- The day simulator must not pull a full-year interval dataset during compare operations or stitch operations.

## Past Sim stitch preservation (hard rule)
- Current Past Sim stitch behavior for travel and vacant days must not regress because of the fingerprint or shared calculation upgrade.
- Implementation must preserve current successful Past Sim baseline stitching semantics in the shared curve/dataset path (`buildCurveFromPatchedIntervals`, `buildSimulatedUsageDatasetFromCurve` in `modules/usageSimulator/dataset.ts`).
- The upgrade is allowed to improve how simulated travel/vacant day outputs are calculated upstream (`simulatePastUsageDataset`, `loadWeatherForPastWindow`, `buildPastSimulatedBaselineV1`, `simulatePastDay`).
- Redesigning or destabilizing how travel/vacant simulated days are stitched into the Past Sim baseline is forbidden unless fixing a proven production bug, and any such fix requires explicit regression coverage for stitch behavior.

## Droplet scope (hard rule)
- When measured runtime requires droplet, the first and primary workload to move is fingerprint building and heavy shared preprocessing that feeds the canonical recalc path.
- This decision does not authorize moving compare into its own heavy workflow.
- This decision does not authorize a droplet-only simulator fork.
- This decision does not authorize changing stitch semantics as a hosting workaround.
- Droplet execution must still call the same shared module entrypoints as inline execution (`recalcSimulatorBuild`, shared fingerprint builders, shared resolver, same stitch and compare modules).

## Canonical Past Sim data flow (hard rule)
Pipeline steps (conceptual; file names are current owners):
1. Actual intervals plus home and appliance details plus weather history feed the fingerprint builder (and existing `buildSimulatorInputs` / `recalcSimulatorBuild` preparation). `UsageFingerprint` training consumes interval history here; compare does not re-ingest the full year for scoring.
2. Resolved fingerprint (via `ResolvedSimFingerprint` resolution) plus target modeled dates plus target-day weather feed the day simulator (`simulatePastUsageDataset` calling `buildPastSimulatedBaselineV1` / `simulatePastDay`).
3. Actual baseline dataset plus simulated travel/vacant day outputs feed the stitch module (`buildCurveFromPatchedIntervals`, `buildSimulatedUsageDatasetFromCurve`) producing the Past Sim baseline dataset surfaced through `projectBaselineFromCanonicalDataset` / `getSimulatedUsageForHouseScenario`.
4. Modeled validation/test day outputs (including `canonicalArtifactSimulatedDayTotalsByDate` usage in the compare path) plus actual data for the same validation/test day keys feed the compare module (`attachValidationCompareProjection`, `buildValidationCompareProjectionSidecar`, `compareProjection` helpers) producing `compareProjection` rows and metrics.

Invariants stated explicitly:
- Validation/test days stay actual in baseline.
- Travel/vacant modeled days are stitched into baseline output by the stitch module.
- Compare is only a consumer of day-simulator output for the selected keys; compare is not a simulator.

## Allowed wrappers vs forbidden wrappers
**Allowed wrappers** (routes such as `app/api/user/simulator/recalc/route.ts`, `app/api/user/usage/simulated/house/route.ts`, `app/api/admin/tools/gapfill-lab/route.ts`, dispatch in `pastSimRecalcDispatch.ts`, UI shells):
- authentication and authorization checks
- timeout guards
- queue and droplet dispatch
- request validation
- serialization and deserialization
- selecting which shared module to call
- explicit error handling
- lightweight orchestration that does not change modeled outputs

**Forbidden wrappers:**
- wrappers that change defaults or arguments in a way that changes modeled results for the same logical input set
- wrappers that add route-local simulation math
- wrappers that alter modeled outputs before or after persistence
- wrappers that make admin and user produce different modeled results for the same inputs
- wrappers that add a second compare engine
- wrappers that create a second truth source
- wrappers that adjust or "improve" results outside the shared modules

Route and UI wrappers may control execution and presentation, but they are not allowed to change simulation results.

# 5. Authoritative data boundaries
- The fingerprint builder is allowed to read full interval history, weather history, usage buckets, home details, appliance details, and cohort data.
- The day simulator is not allowed to read full interval history as part of normal compare or stitch work.
- The stitch module is not allowed to alter modeled outputs.
- The compare module is not allowed to alter modeled outputs.
- Route code is not allowed to alter modeled outputs.
- UI code is not allowed to alter modeled outputs.
- Only the canonical shared simulation write path (`recalcSimulatorBuild` and the modules it calls per Section 4 **Single write authority**) is allowed to create modeled outputs.
- Everything after modeled outputs are written is read, consume, project, serialize, and display only.
- The canonical persisted build/artifact family (`UsageSimulatorBuild`, `PastSimulatedDatasetCache`, related usage schema per Section 3) is the single source of truth for modeled day outputs.
- Any downstream module that changes modeled values is a design violation.

# 6. Observability and error logging requirements
Implementation must emit structured log events for major stages. Logs must include a shared **correlation id** or equivalent **trace id** that propagates across recalc, fingerprint build, shared simulation, compare attach, admin lab actions, and route serialization responses.

**Required fields on log records where available:** `houseId`, `sourceHouseId`, `testHomeId`, `userId`, `scenarioId`, `buildId`, `artifactId`, `treatmentMode`, `validationMode`, `weatherMode`, `durationMs`, `failureCode`, `failureMessage`, `staleReason`.

## A. Recalc flow
- recalc start
- recalc success
- recalc failure
- recalc timeout

## B. Fingerprint flow
- `WholeHomeFingerprint` build start
- `WholeHomeFingerprint` build success
- `WholeHomeFingerprint` build failure
- `UsageFingerprint` build start
- `UsageFingerprint` build success
- `UsageFingerprint` build failure
- `ResolvedSimFingerprint` resolution start
- `ResolvedSimFingerprint` resolution success
- `ResolvedSimFingerprint` resolution failure

## C. Shared simulation flow
- day simulation start
- day simulation success
- day simulation failure
- stitch start
- stitch success
- stitch failure
- `compareProjection` start
- `compareProjection` success
- `compareProjection` failure

## D. Artifact, cache, and freshness flow
- artifact cache hit
- artifact cache miss
- artifact stale detected
- fingerprint stale detected
- fingerprint `building` state entered
- fingerprint `failed` state entered

## E. Admin lab flow
- source house selected
- test home replaced
- test home input save
- admin treatment mode used
- admin validation mode used
- system default validation mode used (`UsageSimulatorSettings.userDefaultValidationSelectionMode` and effective selection including `effectiveValidationSelectionMode` where surfaced)

**Forbidden:**
- swallowing errors without structured log plus surfaced `failureCode`
- treating platform HTML timeout pages as normal application success
- returning generic unknown failures when a typed `failureCode` can be returned

# 7. Backend API and contract surface to build or update
Route files remain orchestration and serialization only. No hidden rebuild, compare math, or fingerprint logic in routes. `compareProjection` payload shape remains owned by shared modules, not route-specific transforms.

| surface | owner file | purpose | request contract | response contract | required error states | audience |
|---|---|---|---|---|---|---|
| User Past Sim recalc | `app/api/user/simulator/recalc/route.ts` | Authenticated POST; validates mode (`SMT_BASELINE`, `MANUAL_TOTALS`, `NEW_BUILD_ESTIMATE`); reads `userDefaultValidationSelectionMode`; dispatches `dispatchPastSimRecalc` → `recalcSimulatorBuild` | Preserve existing body and auth expectations; extend only additively with typed fields for fingerprint or validation overrides | Success returns canonical build/artifact identity; failures return typed `failureCode` and `failureMessage` | Auth failure, validation failure, timeout, upstream shared-module failure | User-facing |
| User Past Sim read | `app/api/user/usage/simulated/house/route.ts` | GET serialized output from `getSimulatedUsageForHouseScenario`; baseline and compare sidecar only | Query parameters and house ownership unchanged unless additive | JSON matches shared service output; `compareProjection` via `buildValidationCompareProjectionSidecar` / `attachValidationCompareProjection` path | Not found, auth, stale/building policy responses, timeout | User-facing |
| Admin Gap-Fill Lab | `app/api/admin/tools/gapfill-lab/route.ts` | Admin-only orchestration for test-home actions and canonical recalc against test context | Preserve action dispatch contracts for lab operations | Structured success and failure with diagnostics (`validationSelectionDiagnostics` and related fields where implemented) | Auth, invalid action payload, shared-module failure, timeout | Admin-only |

**Admin lab actions (must remain explicit in contract and logging):**
- `lookup_source_houses`
- `replace_test_home_from_source`
- `save_test_home_inputs`
- `run_test_home_canonical_recalc`

**Requirements:**
- Expected failure cases return explicit `failureCode` and `failureMessage` in the API response body where the client must branch.
- No silent second recalc or compare pass triggered only from the route layer.
- Droplet queue (`simDropletJob.ts`, `pastSimRecalcQueuedWorker.ts`) preserves the same `recalcSimulatorBuild` entrypoint; logging includes correlation id on enqueue and worker completion.

# 8. UI states and failure behavior
## User simulated usage page (`components/usage/UsageSimulatorClient.tsx` and shared usage components)
**Required states:** loading, ready, stale or building (when artifact or fingerprint policy exposes it), failed, timeout, empty or no-data, retry available when the shared API exposes a retry path.

**Rules:**
- The UI must not present success when the shared recalc or read path failed.
- The UI must not compute modeled outputs locally.
- The UI may only render shared payloads and shared diagnostics returned by the API and service layer.
- Timeout must show an explicit timeout message, not a generic blank or success shell.

**User page also:** baseline presentation stays the canonical baseline family; compare remains a separate section; compare math stays out of the component (no local reimplementation of `compareProjection`).

## Admin Gap-Fill / Calibration Lab (`app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx` and related admin usage components)
**Required states:** same set as user page: loading, ready, stale/building, failed, timeout, empty/no-data, retry where applicable.

**Admin page must visibly show when data exists:** source house id, test home id (including linkage context such as `GapfillLabTestHomeLink` where used), admin treatment mode, admin validation mode, system default validation mode (`userDefaultValidationSelectionMode`), fingerprint freshness summary aligned with Section 13 state fields, and `failureCode` / `failureMessage` when the API provides them.

**Rules:** same as user page: no fake success, no local modeled math, explicit timeout copy.

# 9. Troubleshooting and triage flow
Work in this order. Troubleshoot shared modules before routes and UI. Do not patch bad outputs in route or UI code.

1. **Confirm persisted inputs:** home profile (`HomeProfileSimulated` in `prisma/home-details/schema.prisma`), appliance profile (`ApplianceProfileSimulated` in `prisma/appliances/schema.prisma`), scenario events and build rows (`prisma/usage/schema.prisma`), validation selection mode (`UsageSimulatorSettings`, `effectiveValidationSelectionMode`, `validationSelectionDiagnostics`), admin treatment mode when in admin lab.
2. **Confirm fingerprint state:** `WholeHomeFingerprint` readiness and staleness, `UsageFingerprint` readiness and staleness, `ResolvedSimFingerprint` provenance and confidence.
3. **Confirm weather basis:** actual versus normalized mode, coverage, provenance from shared weather load (`loadWeatherForPastWindow` owner path).
4. **Confirm modeled outputs:** modeled day outputs exist for required dates, modeled day classification, modeled totals, engine diagnostics and confidence fields from shared outputs.
5. **Confirm stitch output:** travel and vacant days stitched per preserved semantics; validation and test days remain actual in baseline.
6. **Confirm `compareProjection` output:** compare uses actual compare days only; modeled compare values come from shared simulator artifacts; row metrics align with attached compare metadata.
7. **Confirm route and UI serialization last:** only after upstream artifacts and diagnostics validate.

# 10. Module-by-module build checklist
For each group: allowed changes are additive contracts, diagnostics, and wiring to shared owners; forbidden changes are duplicate math, route-local simulation, or output mutation.

| Group | Allowed | Forbidden |
|---|---|---|
| Shared fingerprint builder modules | New builders, hashes, provenance fields, shared stale rules | Second builder implementation, route-local fingerprint math |
| Shared `ResolvedSimFingerprint` resolver | Resolver stages, blend rules, persisted build metadata | Duplicate resolver per channel |
| Shared day-model diagnostics contract | Fields surfaced from `simulatePastUsageDataset` / engine outputs | Copied meter as simulated |
| Shared artifact metadata additions | Additive keys on build/artifact JSON aligned to Section 17 | Hidden second artifact family |
| Shared `compareProjection` path | `compareProjection.ts`, attach helpers in `service.ts` | Route-shaped compare, admin-only compare math |
| Shared validation selection path | `validationSelection.ts`, `validationOnlyDateKeysLocal` contracts | UI-local validation day picks |
| User recalc route contract | Typed errors, correlation headers or body fields | Hidden rebuild, argument rewriting that changes outputs |
| User simulated-house read contract | Stable JSON mapping from `getSimulatedUsageForHouseScenario` | Local projection math |
| Admin gapfill-lab route actions | Action handlers for the four lab actions, diagnostics passthrough | Forked simulator entry |
| Admin calibration UI panels | Display of modes, freshness, failure codes | Local simulation or compare |
| User compare section UI | Renders shared compare payload only | Component-level compare math |
| Structured logging hooks | Shared logger calls at stage boundaries | Swallowed errors |
| Tests | Artifact-only and route contract tests per Section 27 | Snapshot drift without semantic assert |

# 11. Fingerprint prebuild and orchestration model
Orchestration may **schedule** work early; it must **call** the same shared fingerprint builders and resolver modules that recalc uses. Orchestration is a **timing optimization only**. Orchestration does not own separate fingerprint math.

## A. UsageFingerprint prebuild trigger
- When actual interval usage data is fully ingested and the canonical usage buckets / daily summaries required for modeling are ready, trigger `UsageFingerprint` build or update.
- That build must use the **same shared UsageFingerprint builder** that recalc invokes when the fingerprint is missing or stale.
- A separate orchestration-only implementation is forbidden.

## B. WholeHomeFingerprint prebuild trigger
- When home details are saved, trigger `WholeHomeFingerprint` build or update.
- When appliances are saved or changed, trigger `WholeHomeFingerprint` rebuild or update.
- Each build must use the **same shared WholeHomeFingerprint builder** that recalc invokes when the fingerprint is missing or stale.
- A separate orchestration-only implementation is forbidden.

## C. ResolvedSimFingerprint build timing
- Final `ResolvedSimFingerprint` is built at recalc time from the latest ready source fingerprints and constraints.
- Optional precompute/cache of resolved outputs is allowed later if it uses the **same shared resolution function** and does not introduce a duplicate resolver.
- The build plan does not require a second resolver implementation for cache hits.

## Background vs inline
- Background jobs may prebuild fingerprints to reduce recalc latency.
- If a fingerprint is missing, stale, or not ready at recalc time, **recalc must invoke the same shared builders/resolver** as background would have used—not a fork.
- There must not be one fingerprint builder in the background path and another hidden builder in recalc.

# 12. Performance and hosting decision gate
Implementation must **measure** real runtime and memory cost of the upgraded shared path on representative houses before committing to broad mode unification on Vercel.

**Required measurements (concrete):**
- Temperature-driven day modeling (shared engine step: `buildPastSimulatedBaselineV1` / `simulatePastDay` and integrated `simulatePastUsageDataset` cost).
- `UsageFingerprint` build (shared builder).
- `WholeHomeFingerprint` build (shared builder).
- Resolved fingerprint resolution (shared resolver).
- `compareProjection` generation where it adds measurable work beyond artifact read (attach path in `getSimulatedUsageForHouseScenario` / `compareProjection.ts`).

**Decision rule (concrete build-order rule):**
- If the upgraded shared calculation and/or fingerprint build exceeds Vercel time or memory limits in measured runs, **move the heavy shared calculation and/or fingerprint orchestration to droplet (or equivalent) before** completing broad low-data mode wiring across the product.
- Primary droplet candidate remains fingerprint building and heavy shared preprocessing (Section 4 **Droplet scope**). Compare is not promoted to a heavy droplet workflow unless Phase 3 measurements show a proven, isolated compare cost problem.
- Do **not** keep spending engineering time wiring every mode deeper into Vercel routes if measured shared-engine cost already shows Vercel is unsuitable for the final shape of the work.

**Ordering implication:** Hosting and orchestration strategy is **first-class** and decided **after** shared upgrade + measurement, **before** full multi-mode rollout.

# 13. Fingerprint and artifact freshness state model
Recalc and read paths need a practical notion of whether to use, rebuild, or wait on fingerprint artifacts.

Implementation must track state **equivalent to** the following (exact storage is an implementation choice; semantics are required):

| Field | Role |
|---|---|
| `ready` | Fingerprint is valid for consumption by resolver/recalc. |
| `stale` | Inputs or upstream hashes changed; rebuild required before treating as authoritative. |
| `building` | Async job in progress; recalc may wait, fall back to inline shared build per policy, or reject with explicit reason—policy must not use a different builder. |
| `failed` | Last build failed; inline retry uses same shared builder. |
| `builtAt` | Timestamp of last successful build. |
| `sourceHash` / dependency hash | Hash over inputs that define validity (home profile, appliance JSON, interval fingerprint slice, cohort version, weather identity slice—exact composition is implementation-defined but must be explicit per fingerprint type). |
| `staleReason` | Machine- or operator-readable reason when `stale` or `failed`. |

This model exists so recalc can choose use vs rebuild without silent drift or duplicate math.

# 14. Admin lab and user page: shared use of prebuilt fingerprints
- Admin lab runs may use prebuilt fingerprints when available.
- User Past Sim may use prebuilt fingerprints when available.
- If prebuilt fingerprints are missing or stale, **both** use the **same shared fallback build path** (same builders/resolver as background).
- No admin-only fingerprint logic.
- No user-only fingerprint logic.

# 15. Lightweight-first execution rule
Implementation must prefer the lightest viable process everywhere possible. Hard rules:

- Do not introduce heavy orchestration when a lightweight shared-path solution satisfies the requirement.
- Do not duplicate reads, rebuilds, or artifact fetches without measured cause.
- Do not add background workflows unless they provide measured benefit (latency, cost, or reliability).
- Do not add droplet or off-box work unless measured shared calculation workload shows Vercel is not practical.
- Keep routes thin.
- Keep projections lightweight; keep compare generation lightweight (reuse persisted compare metadata where possible). Compare stays a thin consumer of simulator output for selected validation keys; do not turn compare into a second heavy pipeline or a hosting offload target unless Phase 3 measurements justify that narrow exception.
- Reuse existing persisted artifacts and build outputs whenever possible.
- Avoid extra multi-read flows (raw + baseline + compare) unless strictly required; prefer single-read shared-projection patterns where possible.
- Prefer additive shared-module changes over new workflow layers.

# 16. Measure before adding heavy work
- Measure real runtime and memory **first** on candidate changes.
- Then decide whether heavier orchestration, extra caching layers, or extra persistence layers are justified.
- Do not assume droplet, background jobs, new cache tiers, or new tables by default.

# 17. Runtime artifacts/contracts to build
## WholeHomeFingerprint
- **Purpose:** Home/appliance-prior behavior contract for homes without strong interval history and as a blend component for homes with interval history.
- **Source inputs (audited families):**
  - `HomeProfileSimulated` fields in `prisma/home-details/schema.prisma` and `modules/homeProfile/repo.ts`:
    - `squareFeet`, `stories`, `insulationType`, `windowType`, `foundation`
    - `occupantsWork`, `occupantsSchool`, `occupantsHomeAllDay`
    - `summerTemp`, `winterTemp`
    - `fuelConfiguration`, `hvacType`, `heatingType`
    - `hasPool`, `poolPumpType`, `poolPumpHp`, `poolSummerRunHoursPerDay`, `poolWinterRunHoursPerDay`, `hasPoolHeater`, `poolHeaterType`
    - EV fields: `evHasVehicle`, `evCount`, `evChargerType`, `evAvgMilesPerDay`, `evAvgKwhPerDay`, `evChargingBehavior`, `evPreferredStartHr`, `evPreferredEndHr`, `evSmartCharger`
  - `ApplianceProfileSimulated.appliancesJson` in `prisma/appliances/schema.prisma` and `modules/applianceProfile/repo.ts`
- **Provenance/confidence required:** cohort version, similarity feature vector version, confidence score per major behavior component.
- **Persistence recommendation:** persisted artifact (additive model in usage domain or dedicated fingerprint storage model).
- **Consumer:** resolved-fingerprint builder stage before shared simulator call.
- **Freshness:** governed by Section 13.

## UsageFingerprint
- **Purpose:** House-specific behavior model learned from house interval history.
- **Minimum content:**
  - baseload behavior
  - day-of-week behavior
  - weekday/weekend behavior
  - temperature response (heating/cooling response)
  - intraday shape tendencies
  - support/confidence by regime
- **Source inputs:** actual intervals and shared weather timeline aligned to canonical window (`SMT_BASELINE` actual-context path in `recalcSimulatorBuild` / `simulatePastUsageDataset`).
- **Prebuild trigger:** Section 11.A.
- **Provenance/confidence required:** training window, usable-day counts, regime coverage, confidence per component.
- **Persistence recommendation:** persisted artifact to make behavior reproducible and auditable across recalc/read flows.
- **Consumer:** resolved-fingerprint builder stage before shared simulator call.
- **Freshness:** governed by Section 13.

## ResolvedSimFingerprint
- **Purpose:** Final simulator input contract consumed by shared simulator chain.
- **Allowed resolution states:**
  - whole-home only
  - usage only
  - blended whole-home + usage
  - constrained by monthly totals
  - constrained by annual total
- **Required contract fields:** resolved components, applied constraints, provenance links to source fingerprints, confidence.
- **Build timing:** Section 11.C.
- **Persistence recommendation:** persist in build metadata for reproducibility; full materialization can be persisted or derived deterministically per build.
- **Consumer:** `recalcSimulatorBuild` -> `simulatePastUsageDataset` shared chain.

## Required distinction
- `WholeHomeFingerprint` is not `UsageFingerprint`.
- Low-data homes start from `WholeHomeFingerprint`.
- Actual-data homes can derive `UsageFingerprint` directly.
- Shared simulator consumes `ResolvedSimFingerprint`, never mode-specific route math.

# 18. Cohort prior builder to build
- **Objective:** Build cohort/archetype priors to support low-data modes without copying one house.
- **Forbidden approach:** single-house copy prior.
- **Similarity drivers (audited current fields):**
  - envelope and structure: `squareFeet`, `stories`, `insulationType`, `windowType`, `foundation`
  - occupancy: `occupantsWork`, `occupantsSchool`, `occupantsHomeAllDay`
  - HVAC/fuel: `fuelConfiguration`, `hvacType`, `heatingType`, appliance fuel/HVAC rows
  - major loads: pool and EV families listed in Section 17
  - climate context: shared canonical weather window concept
- **Output:** cohort prior artifact that feeds `WholeHomeFingerprint` generation.
- **Consumer:** low-data mode adapters and optional blend stage for actual-data mode.
- **Anti-drift constraints:**
  - cohort builder must be shared module logic
  - no route-local cohort math
  - no admin-only cohort logic fork

# 19. Mode adapters to build
Manual monthly, manual annual, and new build do not yet terminate in the same shared day-level weather-driven simulation contract as the canonical Past `SMT_BASELINE` path. Closing this remains the **final** architecture objective. **Rollout order:** Section 26 defines implementation phases; broad adapter unification follows the performance/hosting gate in Section 12.

| mode | input builder to implement or upgrade | fingerprint source | hard constraints | shared weather timeline | shared simulator chain | output family | current gap |
|---|---|---|---|---|---|---|---|
| actual-data (`SMT_BASELINE`) | upgrade recalc fingerprint resolver in `modules/usageSimulator/service.ts` | `UsageFingerprint` with optional `WholeHomeFingerprint` blend | none beyond existing canonical requirements | same 365-day concept via shared weather owner | required | required | needs explicit persisted `UsageFingerprint` and resolved-fingerprint contract |
| manual monthly (`MANUAL_TOTALS`) | implement monthly constraint adapter in shared module, consumed by `buildSimulatorInputs`/service | `WholeHomeFingerprint` (+ optional low-confidence blend) | monthly totals are hard constraints | same 365-day concept; no separate weather path | required | required | currently monthly handling exists but does not terminate in same shared day-level weather-driven contract |
| manual annual (`MANUAL_TOTALS`) | implement annual constraint adapter in shared module | `WholeHomeFingerprint` (+ optional low-confidence blend) | annual total is hard constraint | same 365-day concept; no separate weather path | required | required | currently annual handling exists but does not terminate in same shared day-level weather-driven contract |
| new build / zero-data (`NEW_BUILD_ESTIMATE`) | implement cohort-prior-backed input builder and resolved-fingerprint path | `WholeHomeFingerprint` from cohort prior + home/appliance inputs | no actual-usage hard constraint required | same 365-day concept; no climate-only side simulator | required | required | currently estimator path exists but not unified into canonical shared day-level weather-driven contract |

# 20. Shared weather contract to implement
- All modes must use the same target last-365-day weather timeline concept for house location:
  - actual historical weather over last 365 days, or
  - normalized/average weather over that same 365-day window concept.
- Ownership remains shared module responsibility, not route ownership.
- `loadWeatherForPastWindow` is current shared owner for canonical past simulation; implementation must unify non-`SMT_BASELINE` modes into the same timeline contract semantics.
- New build must not use a separate climate-only simulator concept.
- Manual monthly/annual must not use separate weather logic outside this shared contract.

# 21. Shared day-level temperature modeling target
- Modeled daily totals must be primarily temperature-response driven, with house-specific behavior.
- Day-of-week and weekday/weekend behavior must be modeled explicitly.
- Intraday shape should distribute day total; it must not dominate day total determination.
- Same shared day-level logic must apply to:
  - travel/vacant modeled days
  - validation/test modeled compare days
- Intended matching design:
  - weekday-aware and temperature-aware nearest-match/weighted-bin behavior
  - regime confidence weighting
- Permanent rigid quotas are forbidden as architecture rules (example rigid pattern: fixed count per weekday per static temperature bucket).
- Copied meter totals as modeled output is forbidden.
- `ACTUAL` passthrough labeled as simulated output is forbidden.

# 22. Canonical output family rules
- One saved output family remains canonical.
- Baseline dataset remains canonical baseline projection output.
- Validation/test days remain `ACTUAL` in baseline dataset/charts/totals.
- Modeled values for the same validation/test days appear only in `compareProjection`.
- `compareProjection` remains shared family owned by `modules/usageSimulator/compareProjection.ts`.
- User and admin routes both consume same compareProjection family.
- Canonical date/window logic remains shared (`resolveCanonicalUsage365CoverageWindow` and shared window helpers).

# 23. Admin calibration lab runtime features to build
## Dedicated test-home flow
- Keep existing reusable test-home model and actions:
  - `lookup_source_houses`
  - `replace_test_home_from_source`
  - `save_test_home_inputs`
  - `run_test_home_canonical_recalc`
- Keep current source/test-home identity visibility in admin lab.
- Keep test-home data isolation: edits and recalc effects are isolated to test-home context unless an explicit separate future action is designed.
- Admin lab benefits from prebuilt fingerprints per Section 14; same shared fallback as user when stale or missing.

## Three-selector model (all required)
### A. System-wide user-facing validation-day mode selector
- Persists setting via `UsageSimulatorSettings.userDefaultValidationSelectionMode`.
- Controls future user recalcs only.
- Does not rewrite existing artifacts.

### B. Admin-lab validation-day mode selector
- Per admin run behavior.
- Does not automatically change user default.

### C. Admin-only simulation treatment selector
- Admin-lab only.
- Changes fingerprint/input-builder/constraint treatment for admin run before shared simulator call.
- Uses same shared simulator chain and same shared compareProjection family.
- Does not alter source-house user-facing behavior or artifacts by itself.

## Exact page sections required
### A. Source/Test Home Identity Section (read-only)
- source house id
- source user id/email when available
- test home id
- current scenario/build identity when available
- current artifact identity/hash when available
- current admin treatment mode
- current admin validation-day mode
- current system-wide user-facing validation-day mode
- fingerprint freshness summary (Section 13 fields at high level)

### B. Home Property Inputs Section (editable)
- `squareFeet`
- `stories`
- `insulationType`
- `windowType`
- `foundation`
- `summerTemp`
- `winterTemp`
- `occupantsWork`
- `occupantsSchool`
- `occupantsHomeAllDay`
- `fuelConfiguration`
- `hvacType`
- `heatingType`
- any additional audited home-profile fields currently present and relevant

### C. Pool / EV / Major Loads Section (editable)
- `hasPool`
- `poolPumpType`
- `poolPumpHp`
- `poolSummerRunHoursPerDay`
- `poolWinterRunHoursPerDay`
- `hasPoolHeater`
- `poolHeaterType`
- EV fields from `HomeProfileSimulated` (including `evHasVehicle`, `evCount`, `evChargerType`, `evAvgMilesPerDay`, `evAvgKwhPerDay`, `evChargingBehavior`, `evPreferredStartHr`, `evPreferredEndHr`, `evSmartCharger` where stored)
- relevant major-load rows in `ApplianceProfileSimulated.appliancesJson` (same structure as user appliance profile)

### D. Appliance Inputs Section (editable)
- Render editable appliance and load profile inputs from `ApplianceProfileSimulated.appliancesJson`.
- Render `fuelConfiguration` where relevant.
- Use the real current canonical appliance JSON structure consumed by production appliance flows. Do not introduce a separate admin-only appliance schema.

### E. Travel/Vacant and Validation Controls Section
- travel/vacant ranges (DB-backed on test home)
- validation-day mode controls (admin lab run and system default where surfaced)
- validation-day selection diagnostics
- weather option controls
- manual, random, customer-style seasonal mix, and stratified weather-balanced controls where applicable
- visibility of current admin treatment mode where useful for operator clarity

### F. Diagnostics Section (read-only)
- fingerprint provenance
- fingerprint confidence
- cohort provenance
- weather basis and weather provenance
- selected validation days
- validation-selection diagnostics
- compare diagnostics
- constraint satisfaction diagnostics
- fingerprint freshness summary (aligned with Section 13)

### G. Normal Baseline Display Section
- Render using the canonical output family baseline display path (same artifact family as user Past Sim baseline semantics).
- Validation days remain actual in charts and totals.
- Compare-only modeled values must not appear in baseline charts or baseline totals.

### H. Validation / Test Day Compare Section
- date
- actual day kWh
- simulated day kWh
- error kWh
- percent error
- summary metrics
- same shared `compareProjection` family as the user Past Sim page (no admin-specific compare math)

# 24. Admin-only simulation treatment matrix
Treatment modes, page sections in Section 23, and test-home inputs are admin-lab-only; they do not alter user-facing artifacts on source houses or normal user scenarios by themselves.

| admin treatment mode | fingerprint source | hard constraints | shared simulator chain | compare engine | user-facing impact |
|---|---|---|---|---|---|
| `actual_data_fingerprint` | house-specific `UsageFingerprint` path (optional blend with `WholeHomeFingerprint`) | none beyond canonical mode constraints | same canonical chain in Section 3 | shared `compareProjection` family only | admin-lab-only; does not alter user-facing artifacts by itself |
| `whole_home_prior_only` | `WholeHomeFingerprint` / cohort prior only; do not use house usage fingerprint for this treatment | none beyond selected run constraints | same canonical chain in Section 3 | shared `compareProjection` family only | admin-lab-only; does not alter user-facing artifacts by itself |
| `manual_monthly_constrained` | `WholeHomeFingerprint` with monthly constraint adapter | Monthly totals are hard constraints. For admin lab runs on a real house, monthly constraints are derived from that house’s actual usage history for the test run unless explicit manual monthly inputs are present on the dedicated test home. | same canonical chain in Section 3 | shared `compareProjection` family only | admin-lab-only; does not alter user-facing artifacts by itself |
| `manual_annual_constrained` | `WholeHomeFingerprint` with annual constraint adapter | Annual total is a hard constraint. For admin lab runs on a real house, annual constraint is derived from that house’s actual usage history for the test run unless explicit manual annual input is present on the dedicated test home. | same canonical chain in Section 3 | shared `compareProjection` family only | admin-lab-only; does not alter user-facing artifacts by itself |

# 25. User page runtime changes to build
- User page keeps baseline unchanged as canonical baseline behavior.
- User page renders separate Validation / Test Day Compare section from shared compareProjection family.
- User route remains orchestration/serialization only.
- User route must not compute compare math locally.
- Baseline contamination is forbidden: validation modeled values must not be inserted into baseline chart/totals.
- User Past Sim uses prebuilt fingerprints when available; same shared fallback as admin when stale or missing (Section 14).

# 26. Exact implementation phases (reordered near-term priority)
Execution follows Sections 5–10 for data boundaries, observability, API contracts, UI states, triage order, and module ownership; phases below do not replace those binding rules.

## Phase 1: Shared temperature-driven day modeling upgrade
- **Components:** Upgrade shared day-level modeling in `modules/simulatedUsage/engine.ts` / `pastDaySimulator.ts` and integration in `simulatePastUsageDataset` per Section 21 targets.
- **Stitch preservation:** Preserve current Past Sim stitch semantics in `modules/usageSimulator/dataset.ts` (`buildCurveFromPatchedIntervals`, `buildSimulatedUsageDatasetFromCurve`). Improve upstream simulated travel/vacant day outputs only; do not redesign stitch without a proven bug and regression tests (Section 4 **Past Sim stitch preservation**).
- **Responsibility:** Day simulator (Section 4.B) only for modeling changes; stitch module (Section 4.C) remains integration-only in this phase.
- **Dependencies:** current canonical chain (Section 3).
- **Anti-drift guard:** single implementation path; no mode forks.

## Phase 2: Shared fingerprint builders and freshness state model
- **Components:** `UsageFingerprint` builder, `WholeHomeFingerprint` builder, `ResolvedSimFingerprint` resolver in shared modules; persistence hooks; **Section 13** state fields.
- **Responsibility:** Fingerprint builder layer (Section 4.A); this is the layer that may ingest full interval history and other heavy priors.
- **Dependencies:** Phase 1 contract boundaries clear enough to define fingerprint inputs.
- **Anti-drift guard:** same builders for background and recalc (Section 11).

## Phase 3: Measure runtime, memory, and orchestration cost
- **Components:** Instrumented runs on real houses; capture cost of day modeling, fingerprint builds, resolution, and the compare attach path (`attachValidationCompareProjection` / `buildValidationCompareProjectionSidecar` / `compareProjection` as invoked from `getSimulatedUsageForHouseScenario`).
- **Compare expectation:** Treat compare as lightweight by default; document compare as a heavy-hosting candidate only if measurements isolate compare cost from fingerprint and day-simulator work.
- **Dependencies:** Phases 1–2 runnable on staging or production-like data.
- **Output:** Go/no-go for Vercel-only execution of the upgraded stack.

## Phase 4: Performance and hosting decision
- **Components:** If Phase 3 shows Vercel time or memory limits are exceeded, move the **same** shared recalc path and fingerprint builders behind droplet orchestration (queue worker invokes the same modules as inline execution).
- **Primary offload:** Fingerprint building and heavy shared preprocessing first (Section 4 **Droplet scope**). Stitch semantics and compare architecture stay fixed; compare is not moved to droplet as a default response to recalc pressure.
- **Droplet rule:** Droplet orchestration must call the **same** shared modules (`recalcSimulatorBuild`, shared fingerprint builders, shared resolver). Do not build a droplet-only simulator. Do not fork simulator logic for droplet versus inline. Hosting and process placement may change; shared calculation logic may not.
- **Dependencies:** Phase 3 measurements.
- **Rule:** Do not proceed to broad mode unification until this decision is recorded.

## Phase 5: Contract and persistence foundation (remaining)
- **Components:** additive schema for fingerprint rows if not fully covered in Phase 2, build metadata wiring, provenance contracts.
- **Dependencies:** Phase 4 decision for where long runs execute.

## Phase 6: Cohort prior builder
- **Components:** shared cohort similarity and `WholeHomeFingerprint` derivation from cohort priors.
- **Dependencies:** audited field families and weather contract.

## Phase 7: Resolved fingerprint adapter layer (full mode coverage)
- **Components:** shared resolver for all modes feeding `ResolvedSimFingerprint`.
- **Dependencies:** Phases 5–6 and stable hosting story from Phase 4.

## Phase 8: Manual monthly/annual/new-build adapter unification
- **Components:** shared constraint adapters terminating in same shared day-level weather-driven contract.
- **Dependencies:** Phase 7.
- **Anti-drift guard:** no mode-specific simulator forks.

## Phase 9: Weather contract unification across non-Past builders
- **Components:** wire `loadWeatherForPastWindow` timeline semantics into manual/new-build paths per Section 20.
- **Dependencies:** Phase 8.

## Phase 10: Admin calibration selector integration
- **Components:** admin treatment selector, diagnostics, Section 23 UI requirements.
- **Dependencies:** resolver availability.

## Phase 11: Projection and output-family protection pass
- **Components:** verify baseline-vs-compare and shared compareProjection for user/admin; lightweight read paths; confirm compare still pulls actuals only for validation/test keys and does not load full-year intervals; confirm stitch output still matches preserved travel/vacant baseline semantics.
- **Dependencies:** prior phases.

## Phase 12: Hardening and release checks
- **Components:** regression tests, load tests, migration rollout.
- **Dependencies:** Phase 11.

# 27. Required tests for implementation
- **Canonical chain identity tests:** all modes traverse the canonical shared chain.
- **No second simulator tests:** detect mode-specific simulator branches, compare-only simulators, admin-only simulators.
- **Projection integrity tests:** validation days actual in baseline; modeled only in `compareProjection`.
- **Mode adapter constraint tests:** monthly and annual hard constraints; new-build cohort path uses shared chain.
- **Weather contract tests:** all modes use same 365-day weather timeline concept.
- **Admin treatment isolation tests:** treatment impacts admin test-home run only; no source-house mutation by selector-only actions.
- **Shared ownership tests:** compareProjection and selection logic not reimplemented in routes/UI.
- **Fingerprint builder identity tests:** background job and inline recalc invoke the same shared builder entrypoints (mock or spy at module boundary).
- **Performance smoke tests:** recorded duration and memory bounds for Phase 3 measurement targets on a fixed fixture house.
- **Diagnostics completeness tests:** provenance, confidence, constraint diagnostics present.
- **No duplicate fallback tests:** single rebuild per request path under failure injection; no stacked heavy fallbacks.
- **Observability tests:** where practical, verify structured log events and correlation id propagation for stages listed in Section 6 (recalc, fingerprint, simulation, compare attach, artifact freshness, admin lab actions).
- **User page failure-state tests:** loading, failed, timeout, stale/building, empty states; UI does not show success on API failure.
- **Admin page failure-state tests:** same state coverage for Gap-Fill Lab; failure codes surfaced when API returns them.
- **API failure contract tests:** `failureCode` and `failureMessage` present for defined error paths on user recalc, user simulated-house read, and admin gapfill-lab actions.
- **Typed timeout tests:** timeout responses are explicit (typed code or documented timeout signal), not silent success and not generic HTML timeout bodies treated as JSON success.
- **Troubleshooting diagnostics tests:** `validationSelectionDiagnostics`, fingerprint freshness fields, and compare attach metadata present when builds succeed (artifact-only or integration tests as appropriate).

# 28. Anti-drift “DO NOT DO THIS” list
The rules in Section 4 (**Single write authority**, **Stitch and compare are consumers only**, **Allowed wrappers vs forbidden wrappers**), Section 5 **Authoritative data boundaries**, Section 6 **Observability and error logging requirements**, and Section 7 **Backend API and contract surface** are binding for wrappers, logging, routes, and downstream mutation.

- Do not create a second simulator.
- Do not create mode-specific simulator branches.
- Do not create route-local simulation math.
- Do not create admin-only simulation math.
- Do not create a compare-only simulator.
- Do not create a second compare engine.
- Do not create a second output family.
- Do not label actual meter totals as simulated outputs.
- Do not place shared selection/compare/weather/day-model logic in route or UI files.
- Do not bypass shared canonical window ownership.
- Do not add orchestration-specific fingerprint math parallel to recalc.
- Do not stack multiple heavy fallback paths that repeat the same work.
- Do not implement compare so it pulls full-year actual interval datasets.
- Do not implement compare so it recomputes day totals like a second simulator.
- Do not implement stitch so it re-derives fingerprint logic (stitch consumes baseline plus simulated travel/vacant outputs).
- Do not create a droplet-only simulator fork.
- Do not rewrite stable Past Sim stitch behavior for travel/vacant without a proven bug and regression proof.
- Do not alter modeled outputs in route code.
- Do not alter modeled outputs in UI code.
- Do not swallow errors without logs and surfaced failure signals.
- Do not ship generic unknown failures for cases where a typed `failureCode` is defined.
- Do not add debug-only simulation or compare math paths that diverge from production shared modules.
- Do not add route-specific `compareProjection` shaping that changes numeric results versus shared module output.
- Do not add admin-specific compare row or metric math.
- Do not add user-specific compare row or metric math.

# 29. Decisions still to lock before implementation starts
- Exact persistence shape/location for `WholeHomeFingerprint` artifact.
- Exact persistence shape/location for `UsageFingerprint` artifact.
- Persisted versus ephemeral strategy for `ResolvedSimFingerprint` (must remain reproducible in build metadata regardless).
- Exact cohort partitioning and weighting algorithm version policy.
- Exact storage location for admin treatment provenance in build/artifact metadata for reproducible compare runs.
- **Vercel versus droplet (or hybrid) for long-running shared recalc + fingerprint orchestration:** decided using Phase 3–4 measurements, not assumed upfront.
- **Operator-visible policy when `building`:** wait vs inline shared build vs user-visible retry (must preserve single builder).
