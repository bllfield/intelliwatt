# Final Strict Shared Sim Alignment Audit

> Historical implementation audit only. This file documents point-in-time runtime/code analysis and is not the canonical written architecture contract.
>
> Canonical architecture references:
> - `docs/ONE_PATH_SIM_ARCHITECTURE.md`
> - `docs/USAGE_SIMULATION_PLAN.md`
> - `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`

Date: 2026-03-24

## Scope

This is a report-only audit of the current strict shared-sim alignment invariant across Past Sim, Gap-Fill compare, exact travel/vacant parity, artifact rebuild/storage, artifact restore/read reconciliation, and selected-day slicing.

Files audited:
- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `modules/simulatedUsage/engine.ts`
- `modules/simulatedUsage/pastDaySimulator.ts`
- `modules/usageSimulator/service.ts`
- `modules/usageSimulator/dataset.ts`
- `modules/usageSimulator/requirements.ts`
- `app/api/admin/tools/gapfill-lab/route.ts`
- `docs/USAGE_SIMULATION_PLAN.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`

Verdict:
- Fresh simulated-day calculation is now largely unified.
- The repo does **not** fully satisfy the strict invariant yet.
- The remaining breaks are no longer in the core day simulator entry chain itself.
- The remaining breaks are in post-sim day-total/reference construction and one remaining fallback date interpretation in compare service code.

## 1) Invariant

Plain statement of the invariant being audited:

- same date in
- same prepared dependencies in
- same shared sim calculation chain
- same finalized simulated day out

Strict meaning in this repo:

- If a day is simulated anywhere, it should be simulated through `simulatePastUsageDataset()` and its single downstream chain.
- Allowed differences are limited to which dates are requested and what a caller does with already-finished canonical outputs.
- No wrapper may change prepared dependencies, weather handling, usage-shape handling, incomplete-day handling, curve shaping, interval generation, day-total generation, or finalized simulated-day construction.
- Selected-day membership must use one timestamp-to-local-date rule only.

## 2) End-to-End Path Traces

### A. Past Sim vacant/travel artifact generation path

Entrypoint:
- `getPastSimulatedDatasetForHouse()` in `modules/usageSimulator/service.ts`

Ordered path:
1. `getPastSimulatedDatasetForHouse()`
2. `simulatePastUsageDataset()`
3. `loadWeatherForPastWindow()`
4. `buildPastSimulatedBaselineV1()`
5. `simulatePastDay()` inside `buildPastSimulatedBaselineV1()`
6. incomplete-day blend inside `buildPastSimulatedBaselineV1()` when actual intervals exist for some slots
7. `buildCurveFromPatchedIntervals()`
8. `buildSimulatedUsageDatasetFromCurve()`
9. caller attaches `dailyWeather` only

Dependency prep before simulation:
- actual intervals via `getActualIntervalsForRange()`
- canonical window grid via `enumerateDayStartsMsForWindow()`
- excluded dates via `travelRangesToExcludeDateKeys()` then `boundDateKeysToCoverageWindow()`
- weather via `loadWeatherForPastWindow()`
- home/appliance profiles via profile repos and snapshot fallback
- usage shape via `ensureUsageShapeProfileForSharedSimulation()`

Exact interval-generation function:
- `simulatePastDay()` in `modules/simulatedUsage/pastDaySimulator.ts`

Post-interval transforms before surfacing:
- incomplete-day blend in `buildPastSimulatedBaselineV1()` can materially change interval values for incomplete days
- `buildCurveFromPatchedIntervals()` repackages intervals into stitched curve form; no day math change
- `buildSimulatedUsageDatasetFromCurve()` constructs `dataset.daily`, `dataset.monthly`, `summary`, `totals`, `usageBucketsByMonth`, and display-day values; materially constructs finalized output
- `dailyWeather` attachment is packaging only

Assessment:
- This is the canonical shared producer chain.

### B. Scored-day Compare fresh simulation path

Entrypoint:
- `buildGapfillCompareSimShared()` in `modules/usageSimulator/service.ts`

Current selected-days fresh path:
1. `buildGapfillCompareSimShared()`
2. `runSelectedDaysFreshExecution()`
3. `simulatePastSelectedDaysShared()`
4. `simulatePastFullWindowShared()`
5. `simulatePastUsageDataset()`
6. `loadWeatherForPastWindow()`
7. `buildPastSimulatedBaselineV1()`
8. `simulatePastDay()`
9. incomplete-day blend inside `buildPastSimulatedBaselineV1()`
10. `buildCurveFromPatchedIntervals()`
11. `buildSimulatedUsageDatasetFromCurve()`
12. post-output slicing in `simulatePastSelectedDaysShared()`:
   - intervals filtered by `dateKeyInTimezone()`
   - `simulatedDayResults` filtered by `simulatedDayResultIntersectsLocalDateKeys()`
13. post-output compare-service shaping in `runSelectedDaysFreshExecution()`:
   - interval normalization via `canonicalIntervalKey()`
   - `dailyTotalsByDate` derived from `selectedDaysResult.simulatedDayResults`
   - simulator-owned interval filtering based on derived simulated-day ownership

Dependency prep before simulation:
- same full identity window as artifact path
- same travel ranges
- same build inputs
- same timezone
- same shared weather loader
- same shared usage-shape ensure path

Exact interval-generation function:
- `simulatePastDay()`

Post-interval transforms before compare:
- wrapper slicing in `simulatePastSelectedDaysShared()` is intended to be harmless post-output slicing
- compare-service ownership and day-total derivation in `runSelectedDaysFreshExecution()` can materially change which intervals/daily totals are treated as compare-owned

Assessment:
- The fresh simulation chain itself matches Past Sim.
- The compare service still performs behavior-relevant ownership/day-total interpretation after canonical output exists.

### C. Exact travel/vacant fresh parity proof path

Entrypoint:
- `buildGapfillCompareSimShared()` in `modules/usageSimulator/service.ts`

Ordered path:
1. `buildGapfillCompareSimShared()`
2. `runFullWindowFreshExecution()`
3. `simulatePastFullWindowShared()`
4. `simulatePastUsageDataset()`
5. `loadWeatherForPastWindow()`
6. `buildPastSimulatedBaselineV1()`
7. `simulatePastDay()`
8. incomplete-day blend inside `buildPastSimulatedBaselineV1()`
9. `buildCurveFromPatchedIntervals()`
10. `buildSimulatedUsageDatasetFromCurve()`
11. service-level exact parity post-processing:
   - `canonicalIntervalKey()`
   - `normalizeIntervalsForExactParityCodec()`
   - `buildCanonicalIntervalDayTotalsByLocalDate()`
   - row-by-row comparison against artifact-side canonical totals

Dependency prep before simulation:
- same identity window
- same travel ranges
- same build inputs
- same timezone
- same shared weather loader
- same shared usage-shape ensure path

Exact interval-generation function:
- `simulatePastDay()`

Post-interval transforms before parity verdict:
- interval quantization and interval-summed day-total building are outside the canonical finalized dataset path and can materially change compared values

Assessment:
- Same fresh simulation chain as Past Sim.
- Not the same finalized output path as normal Past display/output consumption.

### D. Artifact rebuild/storage path

There are two active rebuild/storage call sites.

#### D1. Standalone ensure/rebuild helper

Entrypoint:
- `persistRebuiltArtifact()` in `modules/usageSimulator/service.ts`

Ordered path:
1. `persistRebuiltArtifact()`
2. `simulatePastUsageDataset()`
3. `loadWeatherForPastWindow()`
4. `buildPastSimulatedBaselineV1()`
5. `simulatePastDay()`
6. incomplete-day blend
7. `buildCurveFromPatchedIntervals()`
8. `buildSimulatedUsageDatasetFromCurve()`
9. deep-copy of canonical dataset
10. `applyCanonicalCoverageMetadataForNonBaseline()`
11. `attachCanonicalArtifactSimulatedDayTotalsByDate()`
12. `encodeIntervalsV1()`
13. `saveCachedPastDataset()`

#### D2. Inline compare-core rebuild helper

Entrypoint:
- `rebuildSharedArtifactDataset()` in `modules/usageSimulator/service.ts`

Ordered path:
1. `rebuildSharedArtifactDataset()`
2. `getPastSimulatedDatasetForHouse()`
3. `simulatePastUsageDataset()`
4. `loadWeatherForPastWindow()`
5. `buildPastSimulatedBaselineV1()`
6. `simulatePastDay()`
7. incomplete-day blend
8. `buildCurveFromPatchedIntervals()`
9. `buildSimulatedUsageDatasetFromCurve()`
10. `applyCanonicalCoverageMetadataForNonBaseline()`
11. `attachCanonicalArtifactSimulatedDayTotalsByDate()`
12. `encodeIntervalsV1()`
13. `saveCachedPastDataset()`

Dependency prep before simulation:
- same identity window
- same travel ranges
- same build inputs
- same timezone
- same shared weather loader
- same shared usage-shape ensure path

Exact interval-generation function:
- `simulatePastDay()`

Post-interval transforms before storage:
- shared finalized dataset construction is canonical
- `attachCanonicalArtifactSimulatedDayTotalsByDate()` creates an additional persisted reference map outside `buildSimulatedUsageDatasetFromCurve()`
- encoding/storage itself is packaging

Assessment:
- Rebuild now uses the same shared producer chain.
- Persisted canonical day-total sidecar remains a post-sim split.

### E. Artifact restore/read reconciliation path

Entrypoint:
- `restoreCachedArtifactDataset()` in `modules/usageSimulator/service.ts`

Ordered path:
1. `restoreCachedArtifactDataset()`
2. decode intervals with `decodeIntervalsV1()` unless lightweight selected-days artifact read is enabled
3. `reconcileRestoredDatasetFromDecodedIntervals()`
4. `recomputePastAggregatesFromIntervals()` only when canonical fields are missing

Dependency prep before simulation:
- none; this path does not simulate

Exact interval-generation function:
- none

Post-restore transforms before surfacing:
- canonical fields are preserved when already present
- missing `daily`, `monthly`, `usageBucketsByMonth`, `series.daily`, `series.monthly`, `series.annual`, `summary.totalKwh`, and `totals.*` may be backfilled from decoded intervals

Assessment:
- For canonical newer artifacts, this is effectively a read/restore wrapper.
- For legacy/incomplete artifacts, this still reconstructs surfaced outputs outside the canonical finalized build path.

### F. Selected-days wrapper slicing path for intervals + simulatedDayResults

Entrypoint:
- `simulatePastSelectedDaysShared()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`

Ordered path:
1. `simulatePastSelectedDaysShared()`
2. `simulatePastFullWindowShared()`
3. `simulatePastUsageDataset()`
4. canonical shared producer chain completes
5. interval slicing by `dateKeyInTimezone()`
6. `simulatedDayResults` slicing by `simulatedDayResultIntersectsLocalDateKeys()`
7. optional retained-result subset uses the same helper again

Dependency prep before simulation:
- none beyond passing the same shared full-window args

Exact interval-generation function:
- none in this wrapper; generation already happened upstream in `simulatePastDay()`

Post-output transforms:
- interval/date slicing only
- `simulatedDayResultIntersectsLocalDateKeys()` now uses interval timestamps only and no longer relies on a competing `localDate` interpretation

Assessment:
- This wrapper is now a harmless post-output slicer.

## 3) Strict Equivalence Matrix

| Path | Entrypoint | Date source | Execution window source | Usage-shape ensure/load | Weather load | Incomplete/partial-day path | Curve shaping path | Interval generation | Interval post-processing | Day-total generation | Finalized output construction | Final consumer | Harmless orchestration only? | Behavior-changing? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A Past Sim artifact generation | `getPastSimulatedDatasetForHouse()` | full canonical window requested by caller | caller window -> usually canonical shared coverage | `ensureUsageShapeProfileForSharedSimulation()` inside `simulatePastUsageDataset()` | `loadWeatherForPastWindow()` | incomplete-day blend in `buildPastSimulatedBaselineV1()` | `buildCurveFromPatchedIntervals()` | `simulatePastDay()` | none beyond canonical chain | inside `simulatePastDay()` and `buildSimulatedUsageDatasetFromCurve()` display totals | `buildSimulatedUsageDatasetFromCurve()` | store/display | no | yes, canonical by design |
| B scored-day compare fresh sim | `buildGapfillCompareSimShared()` -> `runSelectedDaysFreshExecution()` | selected test dates, but sim executes full identity window then slices | `identityWindowResolved` | same as A | same as A | same as A | same as A | same as A | wrapper slice + compare-service ownership filter | `dailyTotalsByDate` rebuilt in compare service from `simulatedDayResults` | canonical dataset is built, then compare consumes a sliced/derived subset | compare | no | yes |
| C exact travel/vacant fresh proof | `buildGapfillCompareSimShared()` -> `runFullWindowFreshExecution()` | DB travel/vacant date keys, but sim executes full identity window | `identityWindowResolved` | same as A | same as A | same as A | same as A | same as A | codec normalization + interval day-total aggregation | `buildCanonicalIntervalDayTotalsByLocalDate()` | canonical dataset is built, but parity compares interval-derived totals instead | parity | no | yes |
| D artifact rebuild/storage | `persistRebuiltArtifact()` and `rebuildSharedArtifactDataset()` | full identity window | `identityWindowResolved` | same as A | same as A | same as A | same as A | same as A | `attachCanonicalArtifactSimulatedDayTotalsByDate()` + interval encoding | canonical dataset daily plus sidecar day-total map | canonical dataset stored, plus extra sidecar total map | store/cache | no | yes |
| E artifact restore/reconcile | `restoreCachedArtifactDataset()` | stored artifact payload | stored artifact + fallback end date | none | none | none | none | none | decode intervals, optional backfill | `recomputePastAggregatesFromIntervals()` when canonical fields missing | no canonical rebuild; legacy backfill only | read/report/compare input | yes for canonical artifacts, no for legacy backfill cases | yes for legacy/incomplete artifacts |
| F selected-days slicing wrapper | `simulatePastSelectedDaysShared()` | caller selected local date keys | same full shared window as upstream | same as A | same as A | same as A | same as A | same as A | timestamp-based interval/result slicing only | none; no new day math | consumes canonical upstream output only | compare helper | yes | no |

## 4) Split Points

### Split 1

File/function:
- `modules/usageSimulator/service.ts`
- `runSelectedDaysFreshExecution()` inside `buildGapfillCompareSimShared()`

Paths diverging:
- B scored-day Compare fresh simulation vs A canonical Past output consumption

What diverges:
- After canonical shared output exists, compare service derives `dailyTotalsByDate`
- compare service filters simulator-owned intervals using derived simulated-day ownership
- compare service still contains `localDate` fallback when `row.intervals` are absent

Split type:
- behavior-relevant post-output interpretation

Invariant impact:
- violates the strict "one timestamp-to-local-date rule only" requirement
- not a core interval-generation split, but still a strict ownership interpretation split

### Split 2

File/functions:
- `modules/usageSimulator/service.ts`
- `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()`
- `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()`
- `attachCanonicalArtifactSimulatedDayTotalsByDate()`

Paths diverging:
- B scored-day Compare reference building
- C exact parity reference building
- D artifact rebuild/storage
- compared against A canonical finalized dataset path

What diverges:
- canonical artifact simulated-day totals are rebuilt/attached in service code, not emitted by `buildSimulatedUsageDatasetFromCurve()`
- ownership can be widened with `forcedScoredDateKeys`
- interval-pass and daily-pass fallback can choose different bases than the normal finalized display path

Split type:
- behavior-changing post-sim day-total/reference construction

Invariant impact:
- violates the strict "same finalized simulated day out" rule

### Split 3

File/functions:
- `modules/usageSimulator/service.ts`
- `normalizeIntervalsForExactParityCodec()`
- `buildCanonicalIntervalDayTotalsByLocalDate()`
- `buildCanonicalIntervalDayTotalsByLocalDateAbortable()`

Paths diverging:
- C exact travel/vacant fresh parity proof vs A canonical Past finalized output

What diverges:
- exact parity compares codec-normalized interval-summed local-day totals rather than directly consuming canonical finalized shared day outputs

Split type:
- behavior-changing parity-specific post-processing

Invariant impact:
- same fresh calculation chain, but not same finalized output path

### Split 4

File/functions:
- `modules/usageSimulator/service.ts`
- `restoreCachedArtifactDataset()`
- `reconcileRestoredDatasetFromDecodedIntervals()`
- `recomputePastAggregatesFromIntervals()`

Paths diverging:
- E artifact restore/reconcile vs A canonical Past finalized output

What diverges:
- older/incomplete artifacts may have surfaced fields backfilled from decoded intervals rather than from canonical stored finalized outputs

Split type:
- legacy-only behavior-changing backfill

Invariant impact:
- does not overwrite canonical newer artifacts
- still fails strict alignment for legacy incomplete artifacts

### Split 5

File/function:
- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `simulatePastSelectedDaysShared()`

Paths diverging:
- F selected-days wrapper vs A canonical Past output consumption

What diverges:
- only date selection and result slicing after canonical outputs exist

Split type:
- orchestration only

Invariant impact:
- does not violate the invariant in its current form

## 5) Direct Answers

### Are Past Sim and scored-day Compare now using the exact same simulation calculation chain?

Yes.

Code references:
- `modules/usageSimulator/service.ts` -> `getPastSimulatedDatasetForHouse()`
- `modules/usageSimulator/service.ts` -> `buildGapfillCompareSimShared()` -> `runSelectedDaysFreshExecution()`
- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()` -> `simulatePastFullWindowShared()` -> `simulatePastUsageDataset()`
- `modules/simulatedUsage/engine.ts` -> `buildPastSimulatedBaselineV1()`
- `modules/simulatedUsage/pastDaySimulator.ts` -> `simulatePastDay()`
- `modules/usageSimulator/dataset.ts` -> `buildCurveFromPatchedIntervals()` -> `buildSimulatedUsageDatasetFromCurve()`

### Are they using the exact same prepared dependencies at the moment the day is simulated?

Yes.

Why:
- both paths reach `simulatePastUsageDataset()`
- both use the same identity window, build inputs, weather loader, profile loading, usage-shape ensure path, excluded-date preparation, and timezone handling before `buildPastSimulatedBaselineV1()` calls `simulatePastDay()`

### Is exact travel parity using the same calculation chain and same finalized output path as Past Sim?

Same calculation chain: yes.

Same finalized output path: no.

Code references:
- same chain through `runFullWindowFreshExecution()` -> `simulatePastFullWindowShared()` -> `simulatePastUsageDataset()`
- divergent finalized-output consumption in `normalizeIntervalsForExactParityCodec()` and `buildCanonicalIntervalDayTotalsByLocalDate()`

### Is artifact rebuild/storage using the same finalized output path as normal Past Sim?

Mostly yes for the rebuilt dataset itself, but not fully for the additional persisted reference sidecar.

Code references:
- rebuild now takes canonical dataset from `simulatePastUsageDataset()` / `getPastSimulatedDatasetForHouse()`
- divergence remains in `attachCanonicalArtifactSimulatedDayTotalsByDate()`

### Is artifact restore/reconciliation using the same finalized output path as normal Past Sim, or only doing legacy backfill without overwriting canonical outputs?

It is only doing legacy backfill without overwriting canonical outputs.

Code references:
- `restoreCachedArtifactDataset()`
- `reconcileRestoredDatasetFromDecodedIntervals()`
- `recomputePastAggregatesFromIntervals()`

### Does any remaining wrapper still change interval values, day totals, or finalized simulated outputs?

Yes.

Remaining behavior-changing wrappers/helpers:
- `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()`
- `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()`
- `attachCanonicalArtifactSimulatedDayTotalsByDate()`
- `normalizeIntervalsForExactParityCodec()`
- `buildCanonicalIntervalDayTotalsByLocalDate()`
- `buildCanonicalIntervalDayTotalsByLocalDateAbortable()`
- `reconcileRestoredDatasetFromDecodedIntervals()` for legacy incomplete artifacts

### Does any remaining wrapper re-interpret selected dates differently from the canonical timestamp-based local-date logic?

Yes.

Code reference:
- `modules/usageSimulator/service.ts` -> `runSelectedDaysFreshExecution()`

Reason:
- it still computes `fallbackDateKey` from `row.localDate` when `row.intervals` are absent
- that is a second date interpretation rule, even if current canonical producers normally supply intervals

### Are all calculations for all simulated days truly using one shared module/path now?

No.

Strict answer:
- interval generation and core shared simulation math are unified
- post-sim finalized day-total/reference construction is not fully unified

### If not, what exact pieces are still outside the shared path?

Outside the strict shared finalized-output path:
- compare-side simulated-day ownership/day-total derivation in `runSelectedDaysFreshExecution()`
- artifact reference total construction in `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()`
- artifact-side canonical day-total attachment in `attachCanonicalArtifactSimulatedDayTotalsByDate()`
- exact parity interval normalization/day-total aggregation in `normalizeIntervalsForExactParityCodec()` and `buildCanonicalIntervalDayTotalsByLocalDate()`
- legacy restore backfill in `reconcileRestoredDatasetFromDecodedIntervals()`

## 6) Harmless Wrappers vs Forbidden Wrappers

### Harmless orchestration wrappers actually present

- `simulatePastFullWindowShared()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`
  - wraps canonical dataset output and exposes `series.intervals15`
- `simulatePastSelectedDaysShared()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`
  - now slices intervals and `simulatedDayResults` after canonical outputs exist
- `getPastSimulatedDatasetForHouse()` in `modules/usageSimulator/service.ts`
  - delegates to shared producer and adds `dailyWeather`
- route-level truth/report formatting in `app/api/admin/tools/gapfill-lab/route.ts`
  - packages compare results, scored-day truth rows, and reporting labels

### Behavior-changing wrappers/helpers actually present

- `runSelectedDaysFreshExecution()` in `modules/usageSimulator/service.ts`
  - derives ownership/day totals after canonical output and still has `localDate` fallback
- `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()` in `modules/usageSimulator/service.ts`
  - reconstructs canonical artifact reference totals outside shared finalized dataset builder
- `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()` in `modules/usageSimulator/service.ts`
  - same issue for unbounded artifact totals
- `attachCanonicalArtifactSimulatedDayTotalsByDate()` in `modules/usageSimulator/service.ts`
  - persists sidecar day totals built outside the canonical dataset finalizer
- `normalizeIntervalsForExactParityCodec()` in `modules/usageSimulator/service.ts`
  - changes interval values before exact parity comparison
- `buildCanonicalIntervalDayTotalsByLocalDate()` / `buildCanonicalIntervalDayTotalsByLocalDateAbortable()` in `modules/usageSimulator/service.ts`
  - rebuild parity day totals outside shared finalized output path
- `reconcileRestoredDatasetFromDecodedIntervals()` in `modules/usageSimulator/service.ts`
  - legacy backfill path can reconstruct surfaced aggregates when canonical ones are missing

## 7) Ranked Remaining Violations

### Highest priority true violation

File/functions:
- `modules/usageSimulator/service.ts`
- `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()`
- `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()`
- `attachCanonicalArtifactSimulatedDayTotalsByDate()`
- related consumers in `buildGapfillCompareSimShared()`

Why it violates the invariant:
- compare/parity/reference totals are still being constructed in service code after canonical shared output already exists
- that means shared sim output is not the only finalized day-total authority

Can it materially change outputs?
- yes
- it chooses interval-pass vs daily-pass fallback
- it can widen ownership with `forcedScoredDateKeys`
- it becomes the artifact/reference basis used by scored-day parity and rebuild storage

Likely contribution:
- compare drift: yes
- timeout/memory concerns: yes, because it adds additional interval scans, map construction, and sidecar materialization in service code

### Medium-priority violation

File/function:
- `modules/usageSimulator/service.ts`
- `runSelectedDaysFreshExecution()`

Why it violates the invariant:
- selected-day ownership still has a `localDate` fallback when `row.intervals` are absent
- that preserves a second date interpretation rule after the shared wrapper was already tightened to interval timestamps only

Can it materially change outputs?
- yes, in malformed or future-regression cases

Likely contribution:
- compare drift: possible
- timeout/memory concerns: no meaningful impact

### Low-priority / reporting-adjacent violation

File/functions:
- `modules/usageSimulator/service.ts`
- `restoreCachedArtifactDataset()`
- `reconcileRestoredDatasetFromDecodedIntervals()`
- `recomputePastAggregatesFromIntervals()`

Why it violates the invariant:
- legacy incomplete artifacts can still surface recomputed daily/monthly/summary fields instead of only canonical stored finalized outputs

Can it materially change outputs?
- yes, but only when canonical stored fields are absent

Likely contribution:
- compare drift: possible for older artifacts
- timeout/memory concerns: limited

## 8) Single Recommended Next Implementation Pass

Recommended next pass:

- Collapse artifact/reference/parity day-total ownership onto one canonical finalized shared-output source by removing service-level reconstruction helpers as authorities.

Smallest repo-specific pass that moves closest to strict alignment:

- make `buildSimulatedUsageDatasetFromCurve()` or one shared module immediately adjacent to it own the canonical per-day simulated reference totals
- have rebuild, compare, and exact parity read that canonical shared output directly
- remove `forcedScoredDateKeys` authority and remove compare/parity reliance on service-level day-total reconstruction helpers
- in the same pass, delete the `localDate` fallback from `runSelectedDaysFreshExecution()` so selected-day membership remains timestamp-only end to end

Why this is the single best next pass:

- it targets the remaining active behavior-changing split with the biggest effect on compare correctness
- it also naturally absorbs the remaining selected-day membership fallback
- it moves the repo closest to one shared producer plus harmless date-selection/reporting wrappers

## 9) Final Judgment

Current code does **not** fully satisfy the strict invariant.

What is true now:
- one shared fresh simulation producer chain exists and is used by Past Sim, scored-day compare fresh execution, exact travel/vacant fresh execution, and rebuild
- the selected-days wrapper itself is now a pure post-output slicer using timestamp-based local-date membership
- restore/reconcile no longer overwrites canonical newer artifact fields

What is still not true:
- compare/parity/reference day totals are not yet owned solely by the canonical finalized shared output path
- one compare consumer still retains a second `localDate` interpretation fallback

Strict conclusion:
- same date in: mostly yes
- same prepared dependencies in: yes
- same shared sim calculation chain: yes for fresh simulation
- same finalized simulated day out: not fully
