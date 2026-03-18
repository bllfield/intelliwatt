# Past Shared-Core Unification Plan

## Overview

Single internal entrypoint for Past simulation and GapFill scoring, with one shared weather loader, one shared artifact identity/fingerprint, and truthful weather provenance. GapFill is scoring/reporting only and must consume output from the shared Past simulator path (cached artifact restore or fresh shared build), not a separate compare artifact.

## Implemented wiring (verification checklist still open)

- **Shared module** `modules/simulatedUsage/simulatePastUsageDataset.ts`
  - `simulatePastUsageDataset(args)`: single entrypoint; accepts houseId, userId, esiid, startDate, endDate, timezone, travelRanges, buildInputs, buildPathKind (`cold_build` | `recalc` | `lab_validation`), optional preloaded actualIntervals.
  - `loadWeatherForPastWindow(args)`: single weather loader; uses house lat/lng to call `ensureHouseWeatherBackfill` + `getHouseWeatherDays` or `ensureHouseWeatherStubbed` + `getHouseWeatherDays`; returns actualWxByDateKey, normalWxByDateKey, and provenance (weatherKindUsed, weatherSourceSummary, weatherFallbackReason, weatherProviderName, weatherCoverageStart/End, weatherStubRowCount, weatherActualRowCount).
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

## Active architecture authority

- Past Sim and GapFill compare use the same shared artifact identity/fingerprint and the same shared simulator logic.
- Travel/vacant days are the only excluded ownership days for the shared artifact fingerprint.
- Test days remain included in the shared artifact population and are only selected by GapFill for scoring against actual usage.
- GapFill must consume simulated intervals from shared simulator output for that artifact identity (cached restore or fresh shared build). It must not create a compare artifact, create a compare-mask fingerprint, change artifact identity, or rebuild simulated intervals locally.
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
