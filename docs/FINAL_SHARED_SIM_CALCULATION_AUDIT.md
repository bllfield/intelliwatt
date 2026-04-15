# Final Shared Sim Calculation Audit

> Historical implementation audit only. This file documents point-in-time runtime/code analysis and is not the canonical written architecture contract.
>
> Canonical architecture references:
> - `docs/ONE_PATH_SIM_ARCHITECTURE.md`
> - `docs/USAGE_SIMULATION_PLAN.md`
> - `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`

## Exact invariant

This audit uses one strict invariant:

- same date in
- same prepared dependencies in
- same shared sim calculation chain
- same finalized simulated day out

Allowed differences:

- which days a caller asks to simulate
- slicing only after canonical outputs already exist
- packaging, storage, comparison, and reporting after canonical outputs already exist

Not allowed in wrappers:

- changing prepared sim inputs
- changing usage-shape handling
- changing weather handling
- changing incomplete-day / partial-day handling
- changing curve shaping
- changing interval generation
- changing day-total generation
- changing finalized simulated-day output construction

## Files audited

Code:

- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `modules/simulatedUsage/engine.ts`
- `modules/simulatedUsage/pastDaySimulator.ts`
- `modules/usageSimulator/service.ts`
- `modules/usageSimulator/dataset.ts`
- `modules/usageSimulator/requirements.ts`
- `app/api/admin/tools/gapfill-lab/route.ts`

Tests inspected for contract expectations:

- `tests/simulatedUsage/simulatePastUsageDataset.usageShapeEnsure.test.ts`
- `tests/usageSimulator/service.artifactOnly.test.ts`
- `tests/usage/gapfillLab.route.artifactOnly.test.ts`

Docs inspected for stated architecture only:

- `docs/USAGE_SIMULATION_PLAN.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`
- `docs/FULL_SHARED_SIM_CALCULATION_AUDIT.md`

## Bottom line

The repo still does **not** fully satisfy the invariant.

What is unified now:

- `simulatePastUsageDataset()` is the canonical full shared Past build path.
- `simulatePastFullWindowShared()` now delegates into `simulatePastUsageDataset()` instead of maintaining a second simulation-prep stack.
- All active sim-producing flows still converge on the same low-level day generator:
  - `buildPastSimulatedBaselineV1()`
  - `simulatePastDay()`
- Usage-shape ensure/load is still centralized in `ensureUsageShapeProfileForSharedSimulation()`.
- Weather load is still centralized in `loadWeatherForPastWindow()`.

What still violates the invariant:

- `simulatePastSelectedDaysShared()` still changes engine inputs with `forceSimulateDateKeysLocal` and `emitAllIntervals: false`, then slices outputs in wrapper code.
- `simulatePastSelectedDaysShared()` still reinterprets selected day-results with `row.localDate` while intervals are sliced with `dateKeyInTimezone(...)`, so even wrapper-only slicing is not using one canonical date rule.
- Exact parity still does not consume the same finalized output object as Past Sim. It re-aggregates intervals inside `service.ts`.
- One artifact rebuild/storage path still bypasses `buildCurveFromPatchedIntervals()` -> `buildSimulatedUsageDatasetFromCurve()` and rebuilds dataset rows with `recomputePastAggregatesFromIntervals()`.
- Cache restore also rewrites surfaced `dataset.daily` / `monthly` / summary from decoded intervals through `recomputePastAggregatesFromIntervals()`.
- Compare and route truth/reporting still rebuild daily totals after shared sim returns instead of reading one finalized shared simulated-day output object.

## Sim-producing path traces

### A. Past Sim vacant/travel artifact generation path

Entrypoint:

1. `modules/usageSimulator/service.ts` -> `getPastSimulatedDatasetForHouse()`

Wrappers/helpers called:

2. `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastUsageDataset()`

Dependency prep before simulation:

3. `getActualIntervalsForRange()`
4. `enumerateDayStartsMsForWindow()`
5. `dateKeysFromCanonicalDayStarts()`
6. `travelRangesToExcludeDateKeys()`
7. `boundDateKeysToCoverageWindow()`
8. `loadWeatherForPastWindow()`
9. `getHomeProfileSimulatedByUserHouse()`
10. `getApplianceProfileSimulatedByUserHouse()`
11. `ensureUsageShapeProfileForSharedSimulation()`
12. optional local-to-UTC mapping for `forceSimulateDateKeysLocal` and retained result keys

Exact function where interval values are produced:

13. `modules/simulatedUsage/engine.ts` -> `buildPastSimulatedBaselineV1()`
14. `modules/simulatedUsage/pastDaySimulator.ts` -> `simulatePastDay()`

Post-interval transformations:

15. `buildPastSimulatedBaselineV1()` blends incomplete days by replacing simulated slots with actual slots that exist
16. `modules/usageSimulator/dataset.ts` -> `buildCurveFromPatchedIntervals()`
17. `modules/usageSimulator/dataset.ts` -> `buildSimulatedUsageDatasetFromCurve()`
18. `getPastSimulatedDatasetForHouse()` attaches `dailyWeather`

Can the post-steps materially change simulated output?

- incomplete-day blend: yes
- `buildCurveFromPatchedIntervals()`: yes
- `buildSimulatedUsageDatasetFromCurve()`: yes
- `dailyWeather` attachment: no

### B. scored-day Compare fresh simulation path

There are two active scored-day fresh paths.

#### B1. Selected-days compare path

Entrypoint:

1. `modules/usageSimulator/service.ts` -> `buildGapfillCompareSimShared()`

Wrappers/helpers called:

2. selected-days branch -> `runSelectedDaysFreshExecution()`
3. `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`
4. `simulatePastSelectedDaysShared()` -> `simulatePastFullWindowShared()`
5. `simulatePastFullWindowShared()` -> `simulatePastUsageDataset()`

Dependency prep before simulation:

6. same shared prep as path A inside `simulatePastUsageDataset()`
7. selected-days wrapper adds:
   - `forceSimulateDateKeysLocal`
   - `emitAllIntervals: false`
   - `retainSimulatedDayResultDateKeysLocal`

Exact function where interval values are produced:

8. `buildPastSimulatedBaselineV1()`
9. `simulatePastDay()`

Post-interval transformations:

10. incomplete-day blend in `buildPastSimulatedBaselineV1()`
11. `buildCurveFromPatchedIntervals()`
12. `buildSimulatedUsageDatasetFromCurve()`
13. `simulatePastFullWindowShared()` re-exposes `dataset.series.intervals15`
14. `simulatePastSelectedDaysShared()` filters `simulatedIntervals` to selected local dates with `dateKeyInTimezone(...)`
15. `simulatePastSelectedDaysShared()` filters `simulatedDayResults` by `row.localDate`
16. `service.ts` rebuilds `dailyTotalsByDate` from `simulatedDayResults`, with interval fallback
17. `service.ts` filters `simulatedTestIntervals` again to scored dates
18. `app/api/admin/tools/gapfill-lab/route.ts` rebuilds `freshDailyByDate` again from `sharedSim.simulatedTestIntervals`

Can the post-steps materially change simulated output?

- `forceSimulateDateKeysLocal`: yes
- `emitAllIntervals: false`: yes
- selected-days wrapper slicing: yes for surfaced outputs
- `dailyTotalsByDate` reconstruction in `service.ts`: yes for compare outputs
- `freshDailyByDate` reconstruction in `route.ts`: yes for reporting outputs

#### B2. Full-window compare path

Entrypoint:

1. `modules/usageSimulator/service.ts` -> `buildGapfillCompareSimShared()`

Wrappers/helpers called:

2. full-window branch -> `runFullWindowFreshExecution()`
3. `simulatePastFullWindowShared()`
4. `simulatePastUsageDataset()`

Dependency prep before simulation:

5. same shared prep as path A

Exact function where interval values are produced:

6. `buildPastSimulatedBaselineV1()`
7. `simulatePastDay()`

Post-interval transformations:

8. incomplete-day blend in `buildPastSimulatedBaselineV1()`
9. `buildCurveFromPatchedIntervals()`
10. `buildSimulatedUsageDatasetFromCurve()`
11. `simulatePastFullWindowShared()` re-exposes `dataset.series.intervals15`
12. `service.ts` filters those intervals to scored local days
13. `route.ts` later re-sums the scored interval stream into `freshCompareSimDayKwh`

Can the post-steps materially change simulated output?

- full-window interval filtering to scored dates: no for the raw interval values themselves, yes for what survives to the consumer
- route-side re-summing: yes for reporting output construction

### C. exact travel/vacant fresh parity proof path

Entrypoint:

1. `modules/usageSimulator/service.ts` -> `buildGapfillCompareSimShared()`

Wrappers/helpers called:

2. selected-days compare mode may run `simulatePastSelectedDaysShared()` for scored dates, then separately run `runFullWindowFreshExecution()` for exact parity dates
3. exact parity fresh proof itself uses `simulatePastFullWindowShared()`
4. `simulatePastFullWindowShared()` -> `simulatePastUsageDataset()`

Dependency prep before simulation:

5. same shared prep as path A

Exact function where interval values are produced:

6. `buildPastSimulatedBaselineV1()`
7. `simulatePastDay()`

Post-interval transformations:

8. incomplete-day blend in `buildPastSimulatedBaselineV1()`
9. `buildCurveFromPatchedIntervals()`
10. `buildSimulatedUsageDatasetFromCurve()`
11. `simulatePastFullWindowShared()` re-exposes `dataset.series.intervals15`
12. `service.ts` normalizes timestamps with `canonicalIntervalKey()`
13. `service.ts` filters fresh parity intervals to DB travel/vacant local dates
14. `service.ts` builds parity-side daily totals with `buildCanonicalIntervalDayTotalsByLocalDate()` or `buildCanonicalIntervalDayTotalsByLocalDateAbortable()`
15. `service.ts` compares those totals against artifact-side canonical totals to produce `travelVacantParityRows` and `travelVacantParityTruth`

Can the post-steps materially change simulated output?

- parity date filtering: no for the raw interval values, yes for what survives to the proof
- canonical parity day-total rebuild in `service.ts`: yes
- proof packaging: no

### D. artifact rebuild/storage path

There are two active artifact rebuild/storage flows.

#### D1. canonical rebuild/storage path

Entrypoint:

1. `modules/usageSimulator/service.ts` -> `rebuildSharedArtifactDataset()`

Wrappers/helpers called:

2. `getPastSimulatedDatasetForHouse()`
3. `simulatePastUsageDataset()`

Dependency prep before simulation:

4. same shared prep as path A

Exact function where interval values are produced:

5. `buildPastSimulatedBaselineV1()`
6. `simulatePastDay()`

Post-interval transformations:

7. incomplete-day blend
8. `buildCurveFromPatchedIntervals()`
9. `buildSimulatedUsageDatasetFromCurve()`
10. `service.ts` applies `applyCanonicalCoverageMetadataForNonBaseline()`
11. `service.ts` computes canonical totals with `attachCanonicalArtifactSimulatedDayTotalsByDate()`
12. `service.ts` strips inline `series.intervals15` from stored JSON and saves compressed intervals separately

Can the post-steps materially change simulated output?

- shared dataset construction: yes, but this is the canonical output path
- coverage metadata attach: no for simulated values
- canonical totals attach: yes for persisted parity metadata
- storage codec split: no

#### D2. exact ensure / persist helper path

Entrypoint:

1. `modules/usageSimulator/service.ts` -> `persistRebuiltArtifact()`

Wrappers/helpers called:

2. `simulatePastFullWindowShared()`
3. `simulatePastUsageDataset()`

Dependency prep before simulation:

4. same shared prep as path A

Exact function where interval values are produced:

5. `buildPastSimulatedBaselineV1()`
6. `simulatePastDay()`

Post-interval transformations:

7. incomplete-day blend
8. `buildCurveFromPatchedIntervals()`
9. `buildSimulatedUsageDatasetFromCurve()`
10. `simulatePastFullWindowShared()` throws away the canonical dataset and exposes only `simulatedIntervals`
11. `service.ts` rebuilds `daily` / `monthly` / totals through `recomputePastAggregatesFromIntervals()`
12. `service.ts` manually assembles `rebuiltDataset`
13. `service.ts` computes canonical totals with `attachCanonicalArtifactSimulatedDayTotalsByDate()`
14. restore path may later call `reconcileRestoredDatasetFromDecodedIntervals()` and rewrite the same fields again through `recomputePastAggregatesFromIntervals()`

Can the post-steps materially change simulated output?

- `simulatePastFullWindowShared()` dropping the canonical dataset: yes for finalized output ownership
- `recomputePastAggregatesFromIntervals()`: yes
- manual `rebuiltDataset` construction: yes
- restore reconciliation: yes

### E. selected-days wrapper slicing path that can affect returned simulated outputs

Entrypoint:

1. `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`

Wrapper-only work after canonical shared output exists:

2. receives full-window shared result from `simulatePastFullWindowShared()`
3. filters `simulatedIntervals` by `dateKeyInTimezone(timestamp, timezoneResolved)`
4. filters `simulatedDayResults` by `String(row.localDate).slice(0, 10)`

Why this path matters:

- `row.localDate` is populated in `engine.ts` from `dateKey` and passed into `simulatePastDay()` as `localDate: dateKey`
- interval slicing uses explicit timestamp-to-local-date conversion
- result slicing uses direct string comparison against `localDate`

Can this wrapper materially change surfaced outputs?

- yes
- it can return a different set of retained day-result rows than the interval filter returns
- it is not just packaging because the retained canonical outputs themselves differ

## Strict equivalence matrix

| Path name | Entrypoint | Date source | Execution window source | Usage-shape ensure/load path | Weather prepare/load path | Incomplete-day / partial-day path | Curve-shaping path | Exact interval-generation function | Interval post-processing path | Day-total generation path | Finalized output construction path | Final consumer | Harmless orchestration only? | Behavior-changing? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Past Sim full artifact path | `getPastSimulatedDatasetForHouse()` | full Past window | caller `startDate/endDate` | `ensureUsageShapeProfileForSharedSimulation()` inside `simulatePastUsageDataset()` | `loadWeatherForPastWindow()` inside `simulatePastUsageDataset()` | `buildPastSimulatedBaselineV1()` simulates excluded, leading-missing, incomplete; incomplete days blend actual slots | `buildCurveFromPatchedIntervals()` | `simulatePastDay()` | engine blend + stitched interval stream | `buildSimulatedUsageDatasetFromCurve()` daily construction with `SimulatedDayResult.displayDayKwh` override for simulated days | canonical shared dataset builder | Past store/display | no | no within this path |
| Compare fresh path, `selected_days` mode | `buildGapfillCompareSimShared()` | scored local dates plus parity dates | compare identity window | same shared ensure path, but selected wrapper also passes `forceSimulateDateKeysLocal` | same shared weather loader, plus selected-days weather fallback load for scored reporting if needed | same engine branch, but forced dates change simulation/reference ownership | `buildCurveFromPatchedIntervals()` | `simulatePastDay()` | selected wrapper filters `series.intervals15`; `emitAllIntervals: false` drops passthrough actual days | `service.ts` rebuilds `dailyTotalsByDate`; `route.ts` rebuilds `freshDailyByDate` | selected wrapper + caller-side daily-total reconstruction | compare / scored truth / UI | no | yes |
| Compare fresh path, `full_window` mode | `buildGapfillCompareSimShared()` | full compare identity window, then scored-day filter | compare identity window | same shared ensure path | same shared weather loader | same engine handling | `buildCurveFromPatchedIntervals()` | `simulatePastDay()` | full-window intervals filtered to scored dates after shared build | `route.ts` re-sums fresh scored daily totals from intervals | full shared dataset first, then filtered interval consumer outputs | compare / scored truth / UI | mostly, but still caller-side reporting rebuild | yes |
| Exact travel/vacant fresh parity proof | `buildGapfillCompareSimShared()` | DB travel/vacant bounded local dates | compare identity window | same shared ensure path | same shared weather loader | same engine handling | `buildCurveFromPatchedIntervals()` underneath full-window shared build | `simulatePastDay()` | timestamp normalization + parity-date filtering + optional compact decode/bounding | `service.ts` builds parity day totals from intervals with `buildCanonicalIntervalDayTotalsByLocalDate()` | parity rows/truth built outside canonical dataset builder | exact proof / compare gate | no | yes |
| Artifact rebuild/storage canonical path | `rebuildSharedArtifactDataset()` | full identity window | shared artifact identity window | same shared ensure path | same shared weather loader | same engine handling | `buildCurveFromPatchedIntervals()` | `simulatePastDay()` | no extra interval reinterpretation before storage | `buildSimulatedUsageDatasetFromCurve()` + `attachCanonicalArtifactSimulatedDayTotalsByDate()` | canonical shared dataset persisted | artifact store / later reads | mostly | no for sim output, yes for attached parity metadata |
| Artifact rebuild/storage exact ensure path | `persistRebuiltArtifact()` | full identity window | shared artifact identity window | same shared ensure path | same shared weather loader | same engine handling | shared curve build happens upstream, then is discarded | `simulatePastDay()` | throws away dataset and keeps only intervals | `recomputePastAggregatesFromIntervals()` + manual dataset assembly | manual `rebuiltDataset` in `service.ts` | artifact store / verify / restore | no | yes |
| Selected-days wrapper slicing path | `simulatePastSelectedDaysShared()` | selected local dates | inherited from full-window shared result | inherited | inherited | inherited | inherited | inherited | intervals filtered with `dateKeyInTimezone`, day-results filtered by `localDate` string | none | wrapper chooses which canonical rows survive | compare selected-day payload | no | yes |

## Exact split points

### Split 1: selected-days wrapper changes engine inputs before simulation

File/function:

- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`
- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastUsageDataset()`
- `modules/simulatedUsage/engine.ts` -> `buildPastSimulatedBaselineV1()`

Paths diverging:

- Past Sim full artifact path
- Compare `selected_days` fresh path
- selected-days wrapper slicing path

Exact divergence:

- selected-days path passes `forceSimulateDateKeysLocal`
- `simulatePastUsageDataset()` maps those local keys to `forcedUtcDateKeys`
- `buildPastSimulatedBaselineV1()` treats forced dates as `dayIsForcedSimulate`
- forced dates are excluded from reference-day selection and forced into simulation ownership

Orchestration only?

- no

Can it materially change simulated output?

- yes

Violates invariant?

- yes

### Split 2: selected-days wrapper changes surfaced interval ownership

File/function:

- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`
- `modules/simulatedUsage/engine.ts` -> `buildPastSimulatedBaselineV1()`

Paths diverging:

- Past Sim full artifact path
- Compare `selected_days` fresh path

Exact divergence:

- selected-days path passes `emitAllIntervals: false`
- engine therefore omits passthrough actual intervals for non-simulated days
- wrapper then slices only the reduced interval payload forward

Orchestration only?

- no

Can it materially change simulated output?

- yes

Violates invariant?

- yes

### Split 3: selected-days wrapper still uses two date-selection rules

File/function:

- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`

Paths diverging:

- selected-days wrapper interval filter
- selected-days wrapper day-result filter

Exact divergence:

- intervals are filtered by `dateKeyInTimezone(timestamp, timezoneResolved)`
- day-results are filtered by `String(row.localDate).slice(0, 10)`

Orchestration only?

- no

Can it materially change simulated output?

- yes

Violates invariant?

- yes

### Split 4: artifact exact ensure path rebuilds finalized output outside the canonical dataset builder

File/function:

- `modules/usageSimulator/service.ts` -> `persistRebuiltArtifact()`
- `modules/usageSimulator/dataset.ts` -> `recomputePastAggregatesFromIntervals()`

Paths diverging:

- Past Sim full artifact path
- artifact exact ensure / persist helper path

Exact divergence:

- helper calls `simulatePastFullWindowShared()`
- discards canonical dataset output
- rebuilds `daily`, `monthly`, totals, and storage payload manually through `recomputePastAggregatesFromIntervals()`

Orchestration only?

- no

Can it materially change simulated output?

- yes

Violates invariant?

- yes

### Split 5: cache restore rewrites surfaced daily/monthly outputs from decoded intervals

File/function:

- `modules/usageSimulator/service.ts` -> `restoreCachedArtifactDataset()`
- `modules/usageSimulator/service.ts` -> `reconcileRestoredDatasetFromDecodedIntervals()`
- `modules/usageSimulator/dataset.ts` -> `recomputePastAggregatesFromIntervals()`

Paths diverging:

- stored canonical dataset output
- restored dataset output used by compare

Exact divergence:

- decoded `series.intervals15` are used to overwrite `dataset.daily`, `monthly`, `usageBucketsByMonth`, summary totals, and totals

Orchestration only?

- no

Can it materially change simulated output?

- yes

Violates invariant?

- yes

### Split 6: exact parity rebuilds day totals outside the shared finalized output path

File/function:

- `modules/usageSimulator/service.ts` -> `buildGapfillCompareSimShared()`
- `buildCanonicalIntervalDayTotalsByLocalDate()`
- `buildCanonicalIntervalDayTotalsByLocalDateAbortable()`

Paths diverging:

- Past Sim full artifact path
- exact travel/vacant fresh parity proof path

Exact divergence:

- parity proof consumes full-window fresh intervals and artifact intervals
- then rebuilds local-day totals in `service.ts`
- proof compares those rebuilt totals, not the same finalized shared dataset object that Past Sim stores/displays

Orchestration only?

- no

Can it materially change simulated output?

- yes

Violates invariant?

- yes

### Split 7: compare and route rebuild day totals after shared sim returns

File/function:

- `modules/usageSimulator/service.ts` -> selected-days `dailyTotalsByDate`, `freshDailyTotalsByDate`
- `app/api/admin/tools/gapfill-lab/route.ts` -> `freshDailyByDate`, `scoredDayTruthRows`

Paths diverging:

- canonical shared dataset output
- compare/report consumers

Exact divergence:

- service reconstructs scored-day totals from `simulatedDayResults` and interval fallback
- route reconstructs `freshCompareSimDayKwh` again from interval sums

Orchestration only?

- partly, but not purely

Can it materially change simulated output?

- yes for surfaced compare/report values

Violates invariant?

- yes

### Split 8: route-level mode selection still changes which fresh sim path runs

File/function:

- `app/api/admin/tools/gapfill-lab/route.ts` -> `compareFreshMode`

Paths diverging:

- compare lightweight path
- compare diagnostics/full-report path

Exact divergence:

- route selects `selected_days` when compact
- route selects `full_window` when diagnostics or full report text is requested

Orchestration only?

- no

Can it materially change simulated output?

- yes, because it chooses between behavior-changing selected-days wrapper semantics and full-window semantics

Violates invariant?

- yes

## Direct yes/no answers

### Are Past Sim and scored-day Compare now using the exact same simulation calculation chain?

- **No.**
- Past Sim uses `getPastSimulatedDatasetForHouse()` -> `simulatePastUsageDataset()` -> `buildPastSimulatedBaselineV1()` -> `simulatePastDay()` -> `buildCurveFromPatchedIntervals()` -> `buildSimulatedUsageDatasetFromCurve()`.
- Default scored-day compare uses `simulatePastSelectedDaysShared()`, which still injects `forceSimulateDateKeysLocal`, `emitAllIntervals: false`, and wrapper slicing before caller-side day-total reconstruction.

### Are they using the exact same prepared dependencies at the moment the day is simulated?

- **No.**
- Weather ensure/load and usage-shape ensure/load are shared.
- The selected-days compare wrapper still changes prepared simulation inputs by forcing selected UTC dates into simulation ownership and removing them from reference-day eligibility.

### Is exact travel parity using the same calculation chain and same finalized output path as Past Sim?

- **No.**
- It uses the same low-level simulator chain up through interval generation.
- It does **not** use the same finalized output path afterward. `service.ts` rebuilds parity day totals from intervals with `buildCanonicalIntervalDayTotalsByLocalDate()` and compares those rebuilt totals.

### Is artifact rebuild/storage using the same finalized output path as normal Past Sim?

- **No.**
- `rebuildSharedArtifactDataset()` does use the canonical shared dataset output path.
- `persistRebuiltArtifact()` still does not. It discards the canonical dataset and rebuilds storage rows through `recomputePastAggregatesFromIntervals()`.
- Restore also rewrites the restored dataset through `recomputePastAggregatesFromIntervals()`.

### Does any remaining wrapper still change interval values, day totals, or finalized simulated outputs?

- **Yes.**
- `simulatePastSelectedDaysShared()` changes ownership inputs and output retention.
- `persistRebuiltArtifact()` and restore/reconcile rebuild finalized dataset rows outside the canonical builder.
- compare/parity code rebuilds day totals after shared sim returns.

### Does any remaining wrapper re-interpret selected dates differently from the canonical timestamp-based local-date logic?

- **Yes.**
- `simulatePastSelectedDaysShared()` filters intervals by `dateKeyInTimezone(timestamp, timezoneResolved)` but filters `simulatedDayResults` by `row.localDate`.
- In current code, `engine.ts` sets `localDate: dateKey`, so that wrapper is still not using one universal timestamp-based local-date rule.

### Are all calculations for all simulated days truly using one shared module/path now?

- **No.**
- The low-level simulator is shared.
- Finalized output construction and post-output day-total construction are still split across wrappers and service/route code.

### If not, what exact pieces are still outside the shared path?

- `simulatePastSelectedDaysShared()` selected-days ownership and slicing
- `persistRebuiltArtifact()` manual rebuild path
- `restoreCachedArtifactDataset()` / `reconcileRestoredDatasetFromDecodedIntervals()`
- `buildGapfillCompareSimShared()` parity day-total reconstruction and compare-side daily-total reconstruction
- `app/api/admin/tools/gapfill-lab/route.ts` scored-day daily re-summing and truth-row output shaping

## Harmless orchestration wrappers

Only wrappers actually found in current code that are harmless under this invariant:

- `simulatePastFullWindowShared()` as a delegating wrapper over `simulatePastUsageDataset()` that re-exposes `dataset.series.intervals15` and meta fields
- `getPastSimulatedDatasetForHouse()` attaching `dailyWeather`
- `applyCanonicalCoverageMetadataForNonBaseline()` for coverage metadata
- `attachCanonicalArtifactSimulatedDayTotalsByDate()` when used only to persist/read parity metadata on top of an already-canonical dataset
- compare-run phase reporting and snapshot persistence in `route.ts` and `service.ts`

## Behavior-changing wrappers

Only wrappers actually found in current code that change values, ownership, or finalized outputs:

- `simulatePastSelectedDaysShared()` because it passes `forceSimulateDateKeysLocal`
- `simulatePastSelectedDaysShared()` because it passes `emitAllIntervals: false`
- `simulatePastSelectedDaysShared()` because it slices `simulatedDayResults` with a different date rule than interval slicing
- `persistRebuiltArtifact()` because it rebuilds `daily` / `monthly` / totals with `recomputePastAggregatesFromIntervals()`
- `restoreCachedArtifactDataset()` / `reconcileRestoredDatasetFromDecodedIntervals()` because restore rewrites surfaced aggregate outputs
- `buildGapfillCompareSimShared()` because it rebuilds scored-day totals and exact parity day totals outside the canonical shared finalized output object
- `app/api/admin/tools/gapfill-lab/route.ts` because it rebuilds `freshCompareSimDayKwh` and row-level display/parity payloads from interval streams after shared sim returns
- `route.ts` compare mode selection because it chooses between `selected_days` and `full_window`, which are not behavior-equivalent today

## Ranked remaining violations

### 1. Highest-priority true violation

File/function:

- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`

Why it violates the invariant:

- It still changes pre-sim ownership inputs with `forceSimulateDateKeysLocal`.
- It still changes surfaced interval ownership with `emitAllIntervals: false`.
- It still applies non-universal selected-date slicing logic to day-results vs intervals.

Can it materially change outputs?

- yes

Likely contributes to compare drift or timeout concerns?

- yes
- compare drift: because selected-days compare is not the same request as Past Sim anymore
- timeout/memory: because this wrapper exists specifically to reduce payload size and therefore keeps a second output contract alive

### 2. Medium-priority violation

File/function:

- `modules/usageSimulator/service.ts` -> `persistRebuiltArtifact()`
- `modules/usageSimulator/service.ts` -> `restoreCachedArtifactDataset()` / `reconcileRestoredDatasetFromDecodedIntervals()`
- `modules/usageSimulator/dataset.ts` -> `recomputePastAggregatesFromIntervals()`

Why it violates the invariant:

- One artifact path still throws away the canonical dataset builder output and rebuilds stored rows separately.
- Restore then rewrites the same surfaced aggregate fields again from intervals.

Can it materially change outputs?

- yes

Likely contributes to compare drift or timeout concerns?

- yes
- compare drift: because compare reads restored artifact rows and canonical totals
- timeout/memory: because restore/rebuild performs extra aggregation work outside the canonical builder

### 3. Low-priority / reporting-heavy drift

File/function:

- `modules/usageSimulator/service.ts` -> selected-day `dailyTotalsByDate`, `freshDailyTotalsByDate`, exact parity row/truth assembly
- `app/api/admin/tools/gapfill-lab/route.ts` -> `freshDailyByDate`, `scoredDayTruthRows`, `displayedPastStyleSimDayKwh`, `freshCompareSimDayKwh`

Why it violates the invariant:

- Shared sim returns intervals and optional `simulatedDayResults`, but compare/report code still recomputes day totals and row truth outside one finalized shared output object.

Can it materially change outputs?

- yes, but mostly in compare/report surfaces rather than the low-level interval generator

Likely contributes to compare drift or timeout concerns?

- yes, mostly compare drift and payload/CPU overhead rather than low-level sim divergence

## Single recommended next implementation pass

Implement exactly one pass:

- Collapse `simulatePastSelectedDaysShared()` into a pure post-output slicer over the canonical `simulatePastUsageDataset()` result, with **no** `forceSimulateDateKeysLocal`, **no** `emitAllIntervals: false`, and one shared timestamp-to-local-date selection rule for both intervals and `simulatedDayResults`.

Why this is the single smallest next pass:

- it removes the highest-priority behavior-changing wrapper
- it moves scored-day compare closer to “same date in, same dependencies in, same chain, same finalized day out”
- it also removes the current selected-result date-rule drift without requiring a broader artifact-storage refactor

## Final judgement

Current code does **not** fully satisfy the invariant.

The repo is closer than the prior audit because full-window shared execution now delegates into `simulatePastUsageDataset()`, but all simulated days are still **not** using one fully shared calculation-and-finalization path end to end. The biggest remaining divergence is still the selected-days wrapper family, followed by the rebuild/restore aggregate rewrite path and the compare/parity/reporting day-total rebuilds in `service.ts` and `route.ts`.
