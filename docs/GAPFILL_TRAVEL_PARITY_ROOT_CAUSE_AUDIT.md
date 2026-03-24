# Gap-Fill Travel Parity Root Cause Audit

## Scope
This audit covers the remaining exact travel/vacant parity mismatch that now returns a clean `409` with:

- `reasonCode = TRAVEL_VACANT_PARITY_MISMATCH`
- `requestedDateCount = 76`
- `validatedDateCount = 50`
- `mismatchCount = 26`
- `missingArtifactReferenceCount = 0`
- `missingFreshCompareCount = 0`

The live run now reaches:

- `compact_post_scored_rows_parity_rows_ready`
- `compact_post_scored_rows_parity_truth_ready`
- `compact_post_scored_rows_parity_done`
- `build_shared_compare_parity_ready`
- `build_shared_compare_metrics_ready`

So the active problem is no longer timeout/abort behavior. It is now a numeric parity mismatch inside the exact travel/vacant proof path.

## Files Audited
- `modules/usageSimulator/service.ts`
- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `modules/simulatedUsage/engine.ts`
- `modules/simulatedUsage/pastDaySimulator.ts`
- `app/api/admin/tools/gapfill-lab/route.ts`
- `modules/usageSimulator/metadataWindow.ts`
- `tests/usageSimulator/service.artifactOnly.test.ts`
- `tests/usage/gapfillLab.route.artifactOnly.test.ts`

## End-to-End Parity Pipeline

### Artifact side: `artifactCanonicalSimDayKwh`
Live exact travel parity now uses the exact-interval path, not the cached meta/daily path, when both of these are true in `buildGapfillCompareSimShared()`:

- `exactTravelParityRequiresIntervalBackedArtifactTruth === true`
- `exactParityArtifactIntervals.length > 0`

The artifact-side pipeline is:

1. The compare service resolves the artifact dataset and exact artifact identity in `modules/usageSimulator/service.ts`.
2. For exact parity, it materializes `exactParityArtifactIntervals` from one of:
   - `dataset.series.intervals15`
   - `decodeIntervalsV1(cached.intervalsCompressed)`
3. On compact compare_core, it shrinks that array with `filterExactParityArtifactIntervalsToCompactDateKeys()` to only scored dates plus travel/vacant parity dates.
4. It separately builds `canonicalArtifactSimulatedDayTotalsByDate` through:
   - `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()` on compact exact path
   - `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()` on non-compact exact path
   - `readCanonicalArtifactSimulatedDayTotalsByDate*()` on non-exact paths
5. For the live travel/vacant parity rows themselves, it does not read `canonicalArtifactSimulatedDayTotalsByDate` when `useIntervalBackedTravelVacantParityTotals === true`.
6. Instead it builds `artifactExactParityDayRawByDate` with `buildDayRawKwhTotalsByDateFromIntervals15(exactParityArtifactIntervals, timezone)`.
7. Each row uses:
   - `artifactCanonicalSimDayKwh = round2Local(rawDaySum)` if that day exists in `artifactExactParityDayRawByDate`
   - otherwise `null`
8. `parityMatch` compares that rounded value directly against the fresh rounded value.

Important consequence:

- In the current live exact path, the travel/vacant artifact row values are based on decoded artifact intervals, aggregated by local day, then rounded with `round2Local`.
- The separately-built canonical totals map is still important for scored-row/reference behavior, but it is not the direct numeric source for `artifactCanonicalSimDayKwh` once exact interval-backed travel parity is active.

### Fresh side: `freshSharedDayCalcKwh`
The fresh-side pipeline depends on `compareFreshModeUsed`.

For the current live path (`selected_days`):

1. `buildGapfillCompareSimShared()` runs `simulatePastSelectedDaysShared()` twice:
   - once for scored test dates
   - once for `travelVacantParityDateKeysLocal`
2. `simulatePastSelectedDaysShared()` calls `buildPastSimulatedBaselineV1()` using:
   - the same identity window start/end as the artifact path
   - the same weather/profile preparation path as the full-window shared simulator
   - `forceSimulateDateKeys`
   - `emitAllIntervals: false`
3. `simulatePastSelectedDaysShared()` does two final filters:
   - `selectedResults = dayResults.filter(...)` by local-date intersection
   - `selectedIntervals = simulatedIntervalsRaw.filter(...)` by local date
4. It returns `simulatedIntervals: selectedIntervals` and `simulatedDayResults: selectedResults`.
5. Back in `runSelectedDaysFreshExecution()`, the compare service normalizes `simulatedIntervals` with `canonicalIntervalKey()`.
6. It also builds `dailyTotalsByDate` from `simulatedDayResults`, preferring:
   - `intervalSumKwh`
   - falling back to `finalDayKwh`
   - then `round2Local`
7. That `dailyTotalsByDate` is used for scored-day display/parity work only.
8. Travel/vacant parity rows do not use `dailyTotalsByDate`.
9. Instead the live parity block builds `freshParityDailyByDate` directly from `freshParityIntervals`, summing raw interval `kwh` by `dateKeyInTimezone(timestamp, timezone)`.
10. Each row uses:
    - `freshSharedDayCalcKwh = round2Local(freshParityDailyByDate.get(dk))`
    - otherwise `null`

Important consequence:

- Travel/vacant parity compares artifact interval-day sums to fresh interval-day sums.
- It does not compare cached meta totals to selected-day `simulatedDayResults`.
- The fresh selected-day path does produce day-level totals, but those are not the values used for travel parity rows.

### Route layer
`app/api/admin/tools/gapfill-lab/route.ts` does not recompute parity values. It forwards:

- `travelVacantParityRows`
- `travelVacantParityTruth`
- `comparisonBasis`
- `travelVacantParityAvailability`

The route is not the source of the numeric drift.

## Rounding, Normalization, and Precision

### Artifact side
- Raw input: `exactParityArtifactIntervals[].kwh`
- Aggregation: raw float sum in `buildDayRawKwhTotalsByDateFromIntervals15()`
- Day grouping: `dateKeyInTimezone(timestamp, timezone)`
- Finalization: `round2Local(sum)` at row construction

### Fresh side
- Raw input: `freshParityIntervals[].kwh`
- Aggregation: raw float sum in the inline `freshParityDailyByDate` map
- Day grouping: `dateKeyInTimezone(timestamp, timezone)`
- Finalization: `round2Local(sum)` at row construction

### Simulator day results
The fresh selected-day simulator also exposes:

- `intervalSumKwh`
- `finalDayKwh`
- `displayDayKwh`

From `modules/simulatedUsage/pastDaySimulator.ts` and `modules/simulatedUsage/engine.ts`:

- `intervalSumKwh` is a raw sum of interval `kwh`
- `displayDayKwh` is rounded to 2 decimals (`roundDayKwhDisplay()` or `toFixed(2)`)
- `finalDayKwh` can remain the raw blended sum

This matters because the simulator carries more than one day-total representation, even though the current travel/vacant parity rows only use interval sums.

## Where The Two Sides Can Diverge

### 1. Different execution paths can generate different interval vectors
Artifact parity uses persisted artifact intervals from the shared artifact cache. Fresh parity uses a new selected-day simulation run from `simulatePastSelectedDaysShared()`. Those are not the same array, even under exact hash identity.

Why that matters:

- Exact identity guarantees the same input fingerprint set, not that the selected-day path and full-window artifact path emit bit-identical interval vectors.
- The selected-day path uses `forceSimulateDateKeys` and `emitAllIntervals: false`.
- The artifact path used to persist the cached artifact comes from the full-window shared path and then stores intervals in the artifact cache.

Why it matches the live symptom:

- Small 0.01 to 0.02 kWh drifts are exactly what you would expect from two valid-but-not-identical floating interval constructions that are later rounded at the day level.
- It also explains why only some dates mismatch instead of all dates.

### 2. Selected-day fresh simulation uses a path-specific UTC-day forcing model
`simulatePastSelectedDaysShared()` converts selected local dates into `forcedUtcDateKeys` by checking whether a UTC 96-slot grid intersects the selected local day. Then `buildPastSimulatedBaselineV1()` simulates those forced UTC dates. Only after that does `simulatePastSelectedDaysShared()` filter intervals back down by local date.

Why that matters:

- The selected-day path reasons in both UTC-day space and local-day space.
- Travel/vacant parity later groups by local date again.
- A selected local day can intersect two UTC dates.
- This creates a path-specific opportunity for edge intervals near midnight or DST boundaries to be simulated/filtered differently than the full-window artifact path.

Why it matches the live symptom:

- A 0.01 to 0.02 daily difference can come from only one or two quarter-hour slots near a day edge.
- It would affect only some dates, especially dates near DST or dates whose selected local day spans two UTC dates.

### 3. Incomplete-day blending can differ subtly between persisted artifact execution and fresh selected-day execution
In `buildPastSimulatedBaselineV1()`, incomplete days are blended: actual slot values are kept where present, and simulated slot values fill the rest. The result sets:

- `intervalSumKwh = blendedSum`
- `displayDayKwh = Number(blendedSum.toFixed(2))`
- `finalDayKwh = blendedSum`

Why that matters:

- Any difference in which UTC day is marked incomplete, or which exact slots are retained as actual, changes the final raw interval sum slightly.
- The selected-day path uses `forceSimulateDateKeys`; the artifact path comes from the stored full-window artifact.

Why it matches the live symptom:

- Small daily drifts strongly resemble incomplete-day slot blending differences.
- Only a subset of travel dates would be affected.

### 4. Canonical totals helpers do not fully determine the live parity rows, but they still change surrounding exact-path state
The current exact parity rows bypass `canonicalArtifactSimulatedDayTotalsByDate` and read interval-derived artifact sums directly. Even so, the compare service still builds:

- `preservedMetaCanonicalTotals`
- `canonicalArtifactSimulatedDayTotalsByDate`
- compact merge backfill for scored days

Why that matters:

- This is unlikely to be the direct cause of the live travel parity drift.
- But it proves the code still has multiple artifact-total representations in memory at once.
- Any future debugging that only inspects canonical totals or stored meta can misdiagnose the live row mismatch, because the row values are sourced from the exact intervals instead.

Why it does not fit the live symptom well:

- The live exact path has `missingArtifactReferenceCount = 0` and uses interval-backed artifact truth.
- Tests explicitly cover stale stored metadata and expect interval-derived correction.
- That makes cached meta leakage into the live parity row values low likelihood.

### 5. Compact mode changes the numeric path shape, even if it should be mathematically neutral
Compact mode does change the implementation path:

- artifact exact intervals are filtered to compact date keys
- bounded canonical totals are built
- meta is re-written for bounded canonical coverage
- parity block uses the compact exact arrays

Why that matters:

- The intended math for included dates should stay the same.
- But compact mode is still not just a memory optimization; it changes which helper path runs.

Why it only partially matches the symptom:

- A bad compact filter would more likely create missing rows or larger differences.
- The live symptom is zero missing counts and small drifts, so compact mode alone is not the best explanation.

### 6. Local-day grouping is shared, but ownership filters are not
Artifact canonical totals helpers rely on:

- `simulatedOwnershipDates`
- `excludedDateKeysFingerprint`
- `forcedScoredDateKeys`

Travel/vacant parity row generation in the exact live path does not use those ownership filters directly once it has `exactParityArtifactIntervals`.

Why that matters:

- Ownership logic can still affect scored-day/reference outputs and bounded canonical totals.
- It is unlikely to be the direct cause of the live travel parity row mismatches.

Why it does not fit the live symptom well:

- Ownership problems usually produce missing or wrong whole-day inclusion, not widespread 0.01 to 0.02 drifts with zero missing counts.

### 7. Curve version and stale-meta interactions are now guarded, but not impossible to confuse during debugging
Artifacts are guarded by:

- `curveShapingVersion === "shared_curve_v2"`
- exact identity hash checks
- tests proving stale canonical totals are recomputed from exact decoded intervals

Why that matters:

- It reduces the odds that the mismatch is simply stale stored metadata.
- But the repo still has multiple canonical sources:
  - stored meta totals
  - stored daily rows
  - decoded intervals
  - bounded canonical rebuilds

Why it is low likelihood:

- The current exact parity row values use interval-derived totals when exact proof is active.
- That makes stale meta much more likely to confuse observation than to be the actual mismatch source.

## Direct Answers To Audit Questions

### Are artifact parity totals and fresh parity totals finalized through the exact same helper?
No.

Artifact parity totals are finalized through `buildDayRawKwhTotalsByDateFromIntervals15()` plus `round2Local()` inside the parity row build. Fresh parity totals are finalized through the inline `freshParityDailyByDate` reduction plus `round2Local()`.

They are logically parallel, but not literally the same helper.

### Are both sides compared at the same numeric precision?
Yes.

`parityMatch` compares `artifactCanonicalSimDayKwh` and `freshSharedDayCalcKwh`, and both are already day-level rounded via `round2Local()` before comparison.

### Are both sides based on the same interval set?
No.

Artifact side uses cached artifact intervals (`dataset.series.intervals15` or decoded codec payload). Fresh side uses a new selected-day or full-window shared simulation output. Exact identity makes them comparable, but not identical objects from the same source.

### Can one side use cached canonical totals while the other uses newly indexed interval sums?
Yes in the broad compare service, but not on the current live exact travel parity row path.

For the current live path with exact interval-backed parity active:

- artifact travel parity rows use exact intervals
- fresh travel parity rows use fresh intervals

Cached canonical totals still exist elsewhere in the same build, but they are not the direct numeric source for the current mismatch rows.

### Can missing ownership or forced scored-date logic affect travel/vacant parity dates?
Partly.

- `forcedScoredDateKeys` only targets scored test dates in bounded canonical construction.
- `simulatedOwnershipDates` affects canonical artifact totals building.
- Neither is the direct row-value source once exact interval-backed travel parity is active.

So: no for the direct live parity row math, yes for nearby canonical/reference structures.

### Can compact mode still change the numeric path relative to non-compact mode?
Yes.

Compact mode filters exact artifact intervals, uses bounded canonical helpers, performs merge-backfill, and writes bounded canonical meta. The intended parity math should be equivalent for included dates, but the code path is still materially different.

### Is there any code path where displayed rounded values look equal or different but `parityMatch` is computed on a different representation?
For the current travel/vacant parity rows, no.

The displayed `artifactCanonicalSimDayKwh` and `freshSharedDayCalcKwh` are the same rounded numbers used to compute `parityMatch`.

For other compare surfaces, yes, because the repo also carries `intervalSumKwh`, `finalDayKwh`, `displayDayKwh`, canonical meta totals, and daily rows. But the current travel parity row table is not hiding an extra precision layer.

## Ranked Root Causes

## Most Likely

### 1. Selected-day fresh simulation is not numerically identical to the persisted full-window artifact interval construction
Code locations:

- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `modules/simulatedUsage/engine.ts`
- `modules/usageSimulator/service.ts`

Why this is most likely:

- The live mismatch is small: mostly 0.01 to 0.02 kWh.
- Missing counts are zero on both sides.
- Exact identity is already enforced, so a stale-input explanation is weakened.
- The remaining difference is most consistent with path-specific interval generation, not missing rows.

Why it explains only some dates:

- Only some travel days will hit the exact combination of forced UTC-day simulation, incomplete-day blending, or edge-slot grouping needed to produce a small drift.

### 2. UTC-day forcing plus local-day filtering in `simulatePastSelectedDaysShared()` is causing edge-slot day assignment differences
Code locations:

- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `modules/simulatedUsage/engine.ts`

Why it matches the symptom:

- The selected-day path explicitly forces UTC dates and later filters by local date.
- Travel parity later groups by local day again.
- Near-midnight or DST-adjacent slots can move one quarter-hour from one local day total to the next.

Why it explains only some dates:

- Only dates near local/UTC boundaries or DST transitions would drift.
- That naturally creates a partial mismatch pattern like 26 out of 76.

### 3. Incomplete-day blending is producing slightly different raw sums between artifact and fresh selected-day executions
Code locations:

- `modules/simulatedUsage/engine.ts`
- `modules/simulatedUsage/pastDaySimulator.ts`

Why it matches the symptom:

- Incomplete-day blending keeps actual slots and fills missing slots with simulated ones.
- A one-slot or two-slot difference can easily create a 0.01 to 0.02 daily delta.

Why it explains only some dates:

- Only travel days with incomplete actual interval coverage, or days adjacent to incomplete days, would be affected.

## Plausible

### 4. Compact exact parity filtering changes which interval rows are carried into day aggregation for the artifact side
Code locations:

- `modules/usageSimulator/service.ts`

Why it is plausible:

- Compact mode filters exact intervals to `compactCanonicalDateKeys` before aggregation.
- The live path is compact selected-days compare_core.

Why it is not higher:

- The filter is by local date and should be neutral for retained dates.
- It would more often create missing references than tiny drifts.

### 5. Multiple day-total representations in the simulator are causing accidental path inconsistency
Code locations:

- `modules/simulatedUsage/pastDaySimulator.ts`
- `modules/simulatedUsage/engine.ts`
- `modules/usageSimulator/service.ts`

Why it is plausible:

- The simulator emits `intervalSumKwh`, `finalDayKwh`, and `displayDayKwh`.
- The compare service uses interval-derived fresh travel parity totals, but scored-day paths use day-result totals when present.

Why it is not higher:

- The live travel parity block currently uses interval sums on both sides.
- So this is more of a structural fragility than the most direct current cause.

## Low Likelihood

### 6. Cached canonical meta totals or stale daily rows are directly causing the live mismatch rows
Code locations:

- `modules/usageSimulator/service.ts`
- `tests/usageSimulator/service.artifactOnly.test.ts`

Why low likelihood:

- Exact travel parity rows now bypass canonical meta/daily values and use exact artifact intervals directly.
- There is an explicit test proving stale stored canonical totals are recomputed from decoded artifact intervals.

### 7. Coverage-window ownership or `resolveCanonicalUsage365CoverageWindow()` is the current numeric root cause
Code locations:

- `modules/usageSimulator/metadataWindow.ts`
- `modules/usageSimulator/service.ts`

Why low likelihood:

- The live issue is small numeric drift on matched dates, not wrong coverage scope or missing dates.
- Window framing is still important system-wide, but it does not fit the current symptom well.

## Single Best Next Fix Pass
The highest-probability next implementation pass is:

**Make exact travel/vacant parity use one shared day-total builder for both sides, sourced directly from interval arrays only, and instrument one temporary mismatch diagnostic that logs the raw pre-round day sums plus the first/last local timestamps for mismatched dates.**

Why this is the best next pass:

- It targets the most likely remaining cause: path-specific interval-to-day finalization drift.
- It does not change architecture, snapshot-reader design, weather ownership, or artifact identity rules.
- It narrows the comparison to one explicit shared interval-day aggregation contract for artifact and fresh travel parity rows.
- The extra mismatch diagnostic is the fastest way to prove whether the remaining 0.01 to 0.02 deltas come from:
  - raw sum differences
  - local-date bucket differences
  - edge-slot inclusion differences

This should be done only inside the exact travel/vacant parity proof path, not as a broader sim-core refactor.
