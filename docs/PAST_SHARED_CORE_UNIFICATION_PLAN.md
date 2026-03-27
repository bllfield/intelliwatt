# Past Shared-Core Unification Plan

## Overview

Single internal entrypoint for Past simulation and GapFill scoring, with one shared weather loader, one shared artifact identity/fingerprint, and truthful weather provenance. GapFill is scoring/reporting only and must consume output from the shared Past simulator path (cached artifact restore or fresh shared build), not a separate compare artifact.

## Implemented wiring (verification checklist still open)

- **Shared module** `modules/simulatedUsage/simulatePastUsageDataset.ts`
  - `simulatePastUsageDataset(args)`: single entrypoint; accepts houseId, userId, esiid, startDate, endDate, timezone, travelRanges, buildInputs, buildPathKind (`cold_build` | `recalc` | `lab_validation`), optional preloaded actualIntervals.
  - `loadWeatherForPastWindow(args)`: single weather loader; reads persisted daily weather first and short-circuits when canonical dates are fully covered by non-stub `ACTUAL_LAST_YEAR` rows, otherwise backfills/repairs only missing or `STUB_V1` dates before returning actualWxByDateKey, normalWxByDateKey, and provenance (weatherKindUsed, weatherSourceSummary, weatherFallbackReason, weatherProviderName, weatherCoverageStart/End, weatherStubRowCount, weatherActualRowCount).
  - Weather fallback reasons: `missing_lat_lng`, `api_failure_or_no_data`, `partial_coverage`, `unknown` (or null when full actual).
- **service.ts**
  - `getPastSimulatedDatasetForHouse`: delegates to `simulatePastUsageDataset(..., buildPathKind: 'cold_build' | 'lab_validation')`; preserves overlay and dailyWeather; optional `buildPathKind` parameter.
  - Recalc Past block: uses `simulatePastUsageDataset(..., buildPathKind: 'recalc')`; sets pastPatchedCurve and monthlyTotalsKwhByMonth from returned stitchedCurve.
  - Cache restore: sets `buildPathKind: 'cache_restore'`; when cached weather provenance missing, sets `weatherSourceSummary` and `weatherFallbackReason` to `'unknown'`.
- **modules/weather/backfill.ts**
  - `ensureHouseWeatherBackfill` returns `{ fetched, stubbed, skippedLatLng?: boolean }`; `skippedLatLng: true` when house has no lat/lng (no API call).
- **GapFill Lab**
  - `lib/admin/gapfillLabPrime.ts` calls `getPastSimulatedDatasetForHouse` with `buildPathKind: 'lab_validation'`; production Past path inherits shared core.
- **Metadata**
  - dataset.meta includes: buildPathKind, sourceOfDaySimulationCore, simVersion, derivationVersion, weatherKindUsed, weatherSourceSummary, weatherFallbackReason, weatherProviderName, weatherCoverageStart/End, weatherStubRowCount, weatherActualRowCount, dailyRowCount, intervalCount, coverageStart/End, actualDayCount, simulatedDayCount, stitchedDayCount, actualIntervalsCount, referenceDaysCount, shapeMonthsPresent, excludedDateKeysCount, leadingMissingDaysCount, usageShapeProfileDiag, etc.
- **UsageDashboard**
  - `getWeatherBasisLabel(meta)` surfaces weatherFallbackReason for stub/mixed (e.g. "no coordinates", "partial coverage", "API unavailable"); does not imply actual weather when summary is stub_only, mixed, or unknown.

## Target: Gap-Fill data pool and holdout scoring (product intent)

Authoritative expanded write-up: `docs/USAGE_SIMULATION_PLAN.md` → **Gap-Fill Lab: Target architecture (data pool, single run, scoring)**.

Summary:

- **Reference / good-data pool** for the shared Past sim includes **test compare** days’ **actual** intervals (they are trustworthy at-home usage). **Only** travel/vacant (and similar exclusions) are **withheld** from that pool as bad reference signal.
- **Travel/vacant** days are **not** in the pool; they are **filled** by the same shared sim using the **rest** of the good window.
- **One** shared execution: union of scored test dates and travel/vacant parity dates (selected-days mode) or full-window proof; then **slice** for parity vs scoring—not two engines.
- **Target for test rows:** “Fresh sim” in Gap-Fill grading is **modeled** by that same day-level logic as travel fills via **`forceModeledOutputKeepReferencePoolDateKeys`** (see `USAGE_SIMULATION_PLAN.md` § Gap-Fill Lab target architecture §6).

## What changed to match the target (engineering checklist)

- **Gap-Fill compare path:** `buildGapfillCompareSimShared` passes bounded scored test dates as **`forceModeledOutputKeepReferencePoolDateKeysLocal`** into **`simulatePastSelectedDaysShared` / `simulatePastFullWindowShared`** → **`simulatePastUsageDataset`** → **`buildPastSimulatedBaselineV1`**. Test-day actuals **remain** in the reference pool; stitched **compare** output for those days is **modeled** (`GAPFILL_MODELED_KEEP_REF`), not meter-as-sim.
- **Engine / flags:** Complements **`forceSimulateDateKeys`** (which **excludes** days from the reference pool). Keep-ref keys must stay **disjoint** from forced-sim keys for the same calendar day.
- **UI / API truth:** Route payload includes **`gapfillScoringDiagnostics`**; Gap-Fill Lab shows a **scoring source diagnostics** panel. Truth tables still use **`freshCompareScoredDaySimTotalsByDate`** for scored-day simulated totals (simulator-owned).
- **Docs/tests:** Service artifact tests assert keep-ref args and diagnostics; shared-window ownership rules unchanged.

## Active architecture authority

- Past Sim and GapFill compare use the same shared artifact identity/fingerprint and the same shared simulator logic.
- Travel/vacant days are the only excluded ownership days for the shared artifact fingerprint.
- Test days remain included in the shared artifact population and are only selected by GapFill for scoring against actual usage.
- GapFill must consume simulated intervals from shared simulator output for that artifact identity (cached restore or fresh shared build). It must not create a compare artifact, create a compare-mask fingerprint, change artifact identity, or rebuild simulated intervals locally.
- GapFill default scoring mode is selected-day fresh shared execution (`compareFreshMode=selected_days`) with artifact-backed display output retained.
- Lightweight selected-days `compare_core` must reduce early: keep selected-day actual/simulated intervals, canonical artifact simulated-day totals, and compact truth metadata only; do not serialize full-window diagnostics/weather arrays in the core response.
- DB travel/vacant dates are not guardrail-only metadata in compare-core: the shared/service layer must pull the bounded DB travel set, execute those dates through the same shared simulator family used by Past Sim, and validate canonical artifact simulated-day totals against fresh shared compare day totals. In Gap-Fill selected-days mode, travel/vacant parity-validation days must be simulated in the **same** shared selected-days execution as scored test days (union of local date keys), then sliced for parity vs compare—not a second Gap-Fill-only simulation path for travel/vacant alone.
- Compare-core must also return compact scored-day weather truth from the shared compare/service execution for the scored local dates only; route/UI consumers must not reconstruct scored-day weather independently.
- Scored-day compare/sim integrity: simulated-side fields come only from canonical shared simulated outputs (`simulatePastSelectedDaysShared` / `simulatePastFullWindowShared` and artifact canonical simulated-day totals). **ACTUAL must never substitute for simulated** on the simulated side; missing simulated references stay missing with explicit `missing_expected_reference` / reason codes, not silent recovery. If `SimulatedDayResult.localDate` disagrees with interval-timestamp-derived local date keys, shared paths fail with `simulated_day_local_date_interval_invariant_violation` (no fallback to `localDate`).
- Full-window fresh shared compare remains available as an explicit heavy proof mode (`compareFreshMode=full_window`), not a default route path.
- Heavy diagnostics/report retries should use compact merge-only response shaping so the heavy step returns diagnostics/report data without re-serializing the full core payload.
- Heavy report expands the same compact scored-day weather truth into richer weather inspection/report output; no separate route-only weather path is allowed.
- Compare success must not claim shared-path parity for DB travel/vacant validation unless both canonical artifact simulated-day totals and fresh shared compare day totals exist for those dates; exact-identity-sensitive runs must fail explicitly when that proof cannot be established.
- When `artifactIdentitySource=same_run_artifact_ensure` and exact compare is requested, the handoff must stay on the exact rebuilt artifact identity: no latest-scenario fallback is allowed, and route/service must fail early with an artifact identity error before travel/vacant parity proof runs.
- Rebuilt shared artifacts must persist `canonicalArtifactSimulatedDayTotalsByDate` on the exact saved row, and exact compare/parity reads must source DB travel/vacant artifact references from that canonical field rather than display rows.
- Artifact fingerprint ownership and usage-shape identity contracts are unchanged by this step; deferred profile/hash contract work remains separate.
- Current branch caveat: `simulatePastSelectedDaysShared()` is a pure post-output slicer, canonical simulated-day totals are owned by `buildSimulatedUsageDatasetFromCurve()`, and selected-day compare now consumes the surfaced canonical selected-day day-total map directly. The remaining narrow caveat is historical artifact provenance, not an active selected-day authority split.
- Current branch caveat: shared window/date ownership is still correct and must stay locked. Compare identity uses `resolveWindowFromBuildInputsForPastIdentity()`, metadata/report coverage uses `resolveCanonicalUsage365CoverageWindow()`, and scored/test dates must not widen travel/vacant exclusion ownership or artifact identity.
- Authoritative shared simulator call chain:
  - `getPastSimulatedDatasetForHouse`
  - `simulatePastUsageDataset`
  - `loadWeatherForPastWindow`
  - `buildPastSimulatedBaselineV1`
  - `buildCurveFromPatchedIntervals`
  - `buildSimulatedUsageDatasetFromCurve`

Modeling guidance alignment:
- Canonical simulation-logic reference is `docs/USAGE_SIMULATION_PLAN.md`.
- For observed-history reconstruction in this shared Past core, empirical interval history + weather/day-time response is primary.
- Home/appliance/occupancy details remain required and normalized, but are supportive priors/fallback in observed-history mode; they are primary in overlay and synthetic/sparse-data modes.

## Current runtime state + next stabilization follow-up

- Current runtime state now includes compare-run persistence from `compare_core`: compare-core creates a durable compare-run record keyed by `compareRunId` and finalizes a compact compare snapshot on successful completion.
- `compareRunId` handoff is implemented in current runtime (`compareRunId`, `compareRunStatus`, `compareRunSnapshotReady`).
- Staged snapshot-read-only heavy readers are now implemented in current runtime:
  - `compare_heavy_manifest`
  - `compare_heavy_parity`
  - `compare_heavy_scored_days`
- Canonical admin heavy follow-up now reads staged snapshot projections via `compareRunId` readers.
- Legacy `compare_heavy` compatibility may still exist, but it is not the canonical admin heavy path.
- Next work is still narrow: optional admin polish remains, but strict shared-sim follow-up on the current branch is now limited to historical-artifact provenance/readback hardening without changing shared-window ownership.
- GapFill remains scoring/reporting-only and must continue using the shared simulation/artifact/weather path; snapshot work changes orchestration/persistence only, not modeling ownership.

## LEGACY / NON-AUTHORITATIVE

- `gapfill_test_days_profile` may appear as a historical validation label in older notes or diagnostics. It does not represent a separate simulation engine, separate artifact, separate fingerprint, or separate ownership scope.

## Call graph (production Past)

```mermaid
flowchart LR
  subgraph entry [Entrypoints]
    cold[getPastSimulatedDatasetForHouse cold_build]
    recalc[recalcSimulatorBuild Past block]
    lab[gapfillLabPrime lab_validation]
  end
  subgraph shared [Shared core]
    sim[simulatePastUsageDataset]
    wx[loadWeatherForPastWindow]
    engine[buildPastSimulatedBaselineV1]
    curve[buildCurveFromPatchedIntervals]
    dataset[buildSimulatedUsageDatasetFromCurve]
  end
  cold --> sim
  recalc --> sim
  lab --> getPast[getPastSimulatedDatasetForHouse]
  getPast --> sim
  sim --> wx
  sim --> engine
  sim --> curve
  sim --> dataset
```

## Post-implementation verification checklist

- [ ] **Cold build vs recalc parity**: Same house/window/travel produces same intervals and monthly totals whether built via cold (house fetch) or via recalc; both use `simulatePastUsageDataset` with `useUtcMonth: true`.
- [ ] **Cache restore parity**: Restored dataset has same daily/monthly as when first built; `buildPathKind: 'cache_restore'`; no re-run of weather backfill on restore.
- [ ] **Truthful missing_lat_lng stub labeling**: When house has no lat/lng, UI shows stub weather and fallback reason (e.g. "no coordinates"); `weatherSourceSummary` = stub_only, `weatherFallbackReason` = missing_lat_lng.
- [ ] **Truthful partial coverage labeling**: When some days have actual weather and some stub, UI shows mixed and fallback reason (e.g. "partial coverage") where applicable.
- [ ] **GapFill scoring parity**: Selected test days are scored from the same shared artifact and same shared simulator output used by Past production; reports may expose parity metadata but must not imply a separate engine or artifact.
