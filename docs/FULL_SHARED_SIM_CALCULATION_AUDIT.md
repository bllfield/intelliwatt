# Full Shared Sim Calculation Audit

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
- same shared sim calculation path
- same simulated day out

That must hold regardless of whether the caller is:

- Past Sim vacant/travel fill
- scored-day Compare
- exact travel/vacant parity validation
- artifact rebuild/storage path

Allowed wrapper work:

- selecting which days to request
- slicing outputs only after canonical shared outputs already exist
- packaging/reporting/store-or-compare decisions after shared outputs are finalized

Not allowed in wrappers:

- changing prepared sim inputs
- changing usage-shape handling
- changing weather handling
- changing incomplete-day / partial-day handling
- changing curve shaping
- changing interval generation
- changing day-total generation
- changing output construction for the simulated day

## Files audited

Code:

- `modules/usageSimulator/service.ts`
- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `modules/simulatedUsage/engine.ts`
- `modules/simulatedUsage/pastDaySimulator.ts`
- `modules/usageSimulator/dataset.ts`
- `modules/usageSimulator/requirements.ts`
- `app/api/admin/tools/gapfill-lab/route.ts`

Tests inspected for contract expectations:

- `tests/simulatedUsage/simulatePastUsageDataset.usageShapeEnsure.test.ts`
- `tests/usageSimulator/service.artifactOnly.test.ts`
- `tests/usage/gapfillLab.route.artifactOnly.test.ts`

Docs inspected for stated architecture:

- `docs/USAGE_SIMULATION_PLAN.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`
- `docs/STRICT_SHARED_SIM_EQUIVALENCE_AUDIT.md`

## Bottom line

The repo does **not** fully satisfy the invariant today.

What is already unified:

- all active paths ultimately converge on the same low-level day simulator, `simulatePastDay()`
- weather loading is centralized in `loadWeatherForPastWindow()`
- usage-shape ensuring is centralized in `ensureUsageShapeProfileForSharedSimulation()`
- the main shared Past full output path is centralized in `simulatePastUsageDataset()`

What still breaks the invariant:

- selected-days compare still uses a behavior-changing wrapper, `simulatePastSelectedDaysShared()`, that changes engine inputs and output ownership before results are surfaced
- exact travel/vacant parity and artifact rebuild/storage still bypass the canonical full output-construction path `buildCurveFromPatchedIntervals() -> buildSimulatedUsageDatasetFromCurve()`
- caller-side day-total/output construction still exists in `service.ts` and `route.ts` instead of every consumer reading the same finalized shared simulated-day output

## Calculation-producing path traces

### A. Past Sim vacant/travel artifact generation path

Entrypoint:

1. `modules/usageSimulator/service.ts` -> `getPastSimulatedDatasetForHouse()`

Wrappers/helpers:

2. `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastUsageDataset()`

Dependency prep before day simulation:

3. `getActualIntervalsForRange()`
4. `enumerateDayStartsMsForWindow()`
5. `dateKeysFromCanonicalDayStarts()`
6. `travelRangesToExcludeDateKeys()`
7. `boundDateKeysToCoverageWindow()`
8. `loadWeatherForPastWindow()`
9. `getHomeProfileSimulatedByUserHouse()`
10. `getApplianceProfileSimulatedByUserHouse()`
11. `ensureUsageShapeProfileForSharedSimulation()`
12. local-to-UTC mapping for `forceSimulateDateKeysLocal` / retained result keys when provided

Exact function where interval values for the day are actually produced:

13. `modules/simulatedUsage/engine.ts` -> `buildPastSimulatedBaselineV1()`
14. `modules/simulatedUsage/pastDaySimulator.ts` -> `simulatePastDay()`

Transformations after interval generation:

15. `buildPastSimulatedBaselineV1()` may blend simulated intervals with actual intervals for incomplete days
16. `modules/usageSimulator/dataset.ts` -> `buildCurveFromPatchedIntervals()`
17. `modules/usageSimulator/dataset.ts` -> `buildSimulatedUsageDatasetFromCurve()`
18. `service.ts` `getPastSimulatedDatasetForHouse()` attaches `dailyWeather`

Can post-steps materially change simulated output?

- `buildPastSimulatedBaselineV1()` incomplete-day blend: yes
- `buildCurveFromPatchedIntervals()`: yes, it defines the stitched canonical interval curve consumed downstream
- `buildSimulatedUsageDatasetFromCurve()`: yes, it defines canonical `dataset.daily`, `dataset.monthly`, `series.intervals15`, and display day totals for simulated days
- `dailyWeather` attachment: no

### B. scored-day Compare fresh simulation path

Entrypoint:

1. `modules/usageSimulator/service.ts` -> `buildGapfillCompareSimShared()`

Wrappers/helpers:

2. selected-days branch -> `runSelectedDaysFreshExecution()`
3. `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`
4. inside that wrapper -> `simulatePastUsageDataset()`

Dependency prep before day simulation:

5. same shared prep as `simulatePastUsageDataset()` above
6. additional selected-days-only prep:
   - `forceSimulateDateKeysLocal`
   - `emitAllIntervals: false`
   - selected-day retention filtering for `simulatedDayResults`

Exact function where interval values for the day are actually produced:

7. `buildPastSimulatedBaselineV1()`
8. `simulatePastDay()`

Transformations after interval generation:

9. `buildCurveFromPatchedIntervals()`
10. `buildSimulatedUsageDatasetFromCurve()`
11. `simulatePastSelectedDaysShared()` reads `dataset.series.intervals15`
12. `simulatePastSelectedDaysShared()` filters intervals to selected local days
13. `simulatePastSelectedDaysShared()` filters `simulatedDayResults` by interval/date intersection
14. `service.ts` reconstructs `dailyTotalsByDate` from `simulatedDayResults`, with interval fallback
15. `service.ts` slices `simulatedTestIntervals` to scored dates
16. `route.ts` later rebuilds scored `freshDailyByDate` again by summing `sharedSim.simulatedTestIntervals`

Can post-steps materially change simulated output?

- `forceSimulateDateKeysLocal`: yes
- `emitAllIntervals: false`: yes for output ownership and downstream totals
- selected-day filtering inside `simulatePastSelectedDaysShared()`: yes, because this path no longer surfaces the canonical full shared output
- caller-side `dailyTotalsByDate` reconstruction in `service.ts`: yes
- caller-side `freshDailyByDate` reconstruction in `route.ts`: yes for compare/report outputs

### C. exact travel/vacant fresh parity proof path

Entrypoint:

1. `modules/usageSimulator/service.ts` -> `buildGapfillCompareSimShared()`

Wrappers/helpers:

2. `runFullWindowFreshExecution()`
3. `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastFullWindowShared()`

Dependency prep before day simulation:

4. `getActualIntervalsForRange()`
5. `enumerateDayStartsMsForWindow()`
6. `dateKeysFromCanonicalDayStarts()`
7. `travelRangesToExcludeDateKeys()`
8. `boundDateKeysToCoverageWindow()`
9. `loadWeatherForPastWindow()`
10. `getHomeProfileSimulatedByUserHouse()`
11. `getApplianceProfileSimulatedByUserHouse()`
12. `ensureUsageShapeProfileForSharedSimulation()`

Exact function where interval values for the day are actually produced:

13. `buildPastSimulatedBaselineV1()`
14. `simulatePastDay()`

Transformations after interval generation:

15. `simulatePastFullWindowShared()` returns raw `simulatedIntervals` only; it does not build a stitched dataset
16. `service.ts` normalizes timestamps with `canonicalIntervalKey()`
17. `service.ts` filters to parity local dates with `filterIntervalsToLocalDateKeys()`
18. `service.ts` applies codec normalization with `normalizeIntervalsForExactParityCodec()`
19. `service.ts` builds day totals with `buildCanonicalIntervalDayTotalsByLocalDate()`
20. `service.ts` compares those totals to artifact-side canonical totals to produce `travelVacantParityRows` and `travelVacantParityTruth`

Can post-steps materially change simulated output?

- interval filtering to parity dates: no for the day values themselves, yes for what survives to the proof consumer
- codec normalization before totals: yes for parity basis
- parity day-total construction in `service.ts`: yes
- proof packaging itself: no

### D. artifact rebuild/storage path that persists/rebuilds Past outputs

Entrypoint:

1. `modules/usageSimulator/service.ts` -> `persistRebuiltArtifact()`

Wrappers/helpers:

2. `simulatePastFullWindowShared()`

Dependency prep before day simulation:

3. same prep as path C through `simulatePastFullWindowShared()`

Exact function where interval values for the day are actually produced:

4. `buildPastSimulatedBaselineV1()`
5. `simulatePastDay()`

Transformations after interval generation:

6. `service.ts` manually maps returned intervals into `intervals15`
7. `service.ts` rebuilds aggregates through `recomputePastAggregatesFromIntervals()`
8. `service.ts` manually constructs `rebuiltDataset`
9. `service.ts` applies `applyCanonicalCoverageMetadataForNonBaseline()`
10. `service.ts` computes canonical totals through `attachCanonicalArtifactSimulatedDayTotalsByDate()`
11. `service.ts` empties `series.intervals15` in stored JSON and persists compressed intervals separately with `encodeIntervalsV1()` / `saveCachedPastDataset()`
12. later restore path uses `restoreCachedArtifactDataset()` and may call `reconcileRestoredDatasetFromDecodedIntervals()`, which again calls `recomputePastAggregatesFromIntervals()`

Can post-steps materially change simulated output?

- `recomputePastAggregatesFromIntervals()`: yes
- manual `rebuiltDataset` assembly: yes
- `attachCanonicalArtifactSimulatedDayTotalsByDate()`: yes
- storage/codec split itself: no
- restore reconciliation: yes for surfaced daily/monthly/summary outputs

## Strict equivalence matrix

| Path name | Entrypoint | Date source | Execution window source | Usage-shape ensure/load path | Weather prepare/load path | Incomplete-day/partial-day path | Curve-shaping path | Exact interval-generation function | Interval post-processing path | Day-total generation path | Output construction path | Final consumer | Harmless orchestration only? | Behavior-changing? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Past Sim full artifact path | `getPastSimulatedDatasetForHouse()` -> `simulatePastUsageDataset()` | full Past canonical window | caller `startDate/endDate` | `ensureUsageShapeProfileForSharedSimulation()` inside `simulatePastUsageDataset()` | `loadWeatherForPastWindow()` inside `simulatePastUsageDataset()` | `buildPastSimulatedBaselineV1()` simulates excluded, leading-missing, incomplete; incomplete days blend actual slots | `buildCurveFromPatchedIntervals()` | `simulatePastDay()` | engine blend + sorted stitched intervals | `buildSimulatedUsageDatasetFromCurve()` daily/monthly plus `SimulatedDayResult.displayDayKwh` for simulated rows | canonical shared dataset builder | store / Past UI / artifact readers | no | no within this path family |
| scored-day Compare selected-days fresh path | `buildGapfillCompareSimShared()` -> `simulatePastSelectedDaysShared()` -> `simulatePastUsageDataset()` | selected scored dates, expanded through local/UTC intersection; may also include parity dates | compare identity window | same ensure helper, but selected wrapper also passes `forceSimulateDateKeysLocal` | same weather loader, with route/service weather fallback for scored rows if shared weather map incomplete | same engine branch, but forced dates change which days are simulated and which days remain references | `buildCurveFromPatchedIntervals()` still runs underneath | `simulatePastDay()` | wrapper filters `dataset.series.intervals15` to selected dates only | `service.ts` builds `dailyTotalsByDate`; `route.ts` builds `freshDailyByDate` again from intervals | selected wrapper + caller-side total reconstruction | compare / scored truth / UI | no | yes |
| exact travel/vacant parity fresh proof | `buildGapfillCompareSimShared()` -> `simulatePastFullWindowShared()` | DB travel/vacant parity dates after full-window sim | compare identity window | same ensure helper in `simulatePastFullWindowShared()` | same weather loader in `simulatePastFullWindowShared()` | same full-window engine handling | none after engine; no dataset curve build | `simulatePastDay()` | timestamp canonicalization, parity-date filtering, optional codec normalization | `buildCanonicalIntervalDayTotalsByLocalDate()` in `service.ts` | parity rows/truth built in `service.ts`, not shared dataset builder | parity validation | no | yes |
| artifact rebuild/storage path | `persistRebuiltArtifact()` -> `simulatePastFullWindowShared()` | full identity window | identity window from shared artifact inputs | same ensure helper in `simulatePastFullWindowShared()` | same weather loader in `simulatePastFullWindowShared()` | same full-window engine handling | none after engine; no `buildCurveFromPatchedIntervals()` | `simulatePastDay()` | manual interval mapping in `service.ts` | `recomputePastAggregatesFromIntervals()` + `attachCanonicalArtifactSimulatedDayTotalsByDate()` | manual `rebuiltDataset` assembly + codec persistence + restore reconciliation | artifact storage / restore / display | no | yes |

## Exact split points

### Split 1: selected-days wrapper mutates engine inputs and output ownership

File/function:

- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`
- `modules/simulatedUsage/engine.ts` -> `buildPastSimulatedBaselineV1()`
- `modules/usageSimulator/service.ts` -> `runSelectedDaysFreshExecution()`

Paths diverging:

- scored-day Compare fresh path vs Past Sim full artifact path
- scored-day Compare fresh path vs exact parity full-window fresh path

What diverges:

- `forceSimulateDateKeysLocal`
- `forceSimulateDateKeys`
- `emitAllIntervals: false`
- wrapper-level filtering of `dataset.series.intervals15`
- wrapper-level filtering of `simulatedDayResults`
- caller-side rebuilding of day totals

Is this only orchestration?

- no

Can it change simulated output?

- yes

Does it violate the invariant?

- yes

Why:

- forced simulated UTC days are removed from the reference-day pool in `buildPastSimulatedBaselineV1()`
- that changes `referenceDays`, `finalProfile`, `neighborDayTotals`, `shapeVariants`, and weather-training inputs before `simulatePastDay()` runs
- the wrapper also stops surfacing the canonical shared output and replaces it with selected-only filtered output plus caller-side day-total reconstruction

### Split 2: full-window helper skips canonical dataset construction

File/function:

- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastFullWindowShared()`

Paths diverging:

- exact travel/vacant fresh parity proof path vs Past Sim full artifact path
- artifact rebuild/storage path vs Past Sim full artifact path

What diverges:

- `simulatePastFullWindowShared()` stops after `buildPastSimulatedBaselineV1()`
- it does not call `buildCurveFromPatchedIntervals()`
- it does not call `buildSimulatedUsageDatasetFromCurve()`

Is this only orchestration?

- no

Can it change simulated output?

- yes for surfaced canonical daily/monthly totals and canonical simulated-day outputs

Does it violate the invariant?

- yes

Why:

- the low-level interval calculation core is shared, but the full shared calculation/output chain is not
- exact parity and rebuild/storage both consume raw intervals from this helper and then build their own totals/output artifacts elsewhere

### Split 3: service/route rebuild day totals and final outputs outside the shared dataset builder

File/function:

- `modules/usageSimulator/service.ts` -> `persistRebuiltArtifact()`
- `modules/usageSimulator/service.ts` -> `runSelectedDaysFreshExecution()`
- `modules/usageSimulator/service.ts` -> exact parity totals / `travelVacantParityRows`
- `app/api/admin/tools/gapfill-lab/route.ts` -> `freshDailyByDate`, `scoredDayTruthRows`
- `modules/usageSimulator/service.ts` -> `restoreCachedArtifactDataset()` / `reconcileRestoredDatasetFromDecodedIntervals()`

Paths diverging:

- artifact rebuild/storage path
- selected-days compare path
- exact parity proof path
- route/UI truth packaging

What diverges:

- `recomputePastAggregatesFromIntervals()`
- manual `rebuiltDataset` assembly
- `dailyTotalsByDate` reconstruction from `simulatedDayResults` + interval fallback
- exact parity totals from `buildCanonicalIntervalDayTotalsByLocalDate()`
- route-level `freshDailyByDate` recomputation from intervals

Is this only orchestration?

- no

Can it change simulated output?

- yes, especially daily totals, simulated-day display rows, parity basis, and stored artifact outputs

Does it violate the invariant?

- yes

## Direct yes/no answers

### Are Past Sim and scored-day Compare using the exact same day-simulation calculation chain today?

- No.
- They share `buildPastSimulatedBaselineV1()` and `simulatePastDay()`, but scored-day Compare selected-days mode still goes through `simulatePastSelectedDaysShared()`, which changes engine inputs and rebuilds outputs differently from `simulatePastUsageDataset()`.

### Are they using the exact same prepared dependencies at the moment the day is simulated?

- No.
- `simulatePastSelectedDaysShared()` passes forced selected dates into `simulatePastUsageDataset()`, which becomes `forceSimulateDateKeys` in `buildPastSimulatedBaselineV1()`. Forced days are not allowed to remain reference days, so the training/reference pool and derived context can differ before `simulatePastDay()` runs.

### Is exact travel parity using the same calculation chain as Past Sim, or only the same core at a lower level?

- Only the same core at a lower level.
- Exact parity uses `simulatePastFullWindowShared()`, which shares the full-window prep and engine, but it bypasses `buildCurveFromPatchedIntervals()` and `buildSimulatedUsageDatasetFromCurve()` and instead constructs parity totals directly in `service.ts`.

### Does any wrapper still change output rather than only select days / package results?

- Yes.
- `simulatePastSelectedDaysShared()`, `simulatePastFullWindowShared()`, `persistRebuiltArtifact()`, `runSelectedDaysFreshExecution()`, exact parity day-total construction in `service.ts`, and route-level `freshDailyByDate` generation all do more than pure selection/package work.

### Is the artifact rebuild/storage path using the exact same output-construction chain as normal Past Sim?

- No.
- It uses `simulatePastFullWindowShared()` plus `recomputePastAggregatesFromIntervals()` and manual dataset assembly instead of the normal `simulatePastUsageDataset()` -> `buildCurveFromPatchedIntervals()` -> `buildSimulatedUsageDatasetFromCurve()` chain.

### Are all calculations for all simulated days truly using one shared module/path now?

- No.

### If not, what exact pieces are still outside the shared path?

- selected-days forced-simulation wrapper behavior in `simulatePastSelectedDaysShared()`
- full-window helper output bypass in `simulatePastFullWindowShared()`
- manual rebuild/storage output construction in `persistRebuiltArtifact()`
- restore-time aggregate reconciliation in `restoreCachedArtifactDataset()` / `reconcileRestoredDatasetFromDecodedIntervals()`
- compare/parity/route day-total construction in `service.ts` and `route.ts`

## Harmless orchestration wrappers

- `getPastSimulatedDatasetForHouse()` attaching `dailyWeather`
- compare selecting `boundedTestDateKeysLocal` / `travelVacantParityDateKeysLocal`
- filtering already-produced intervals to a consumer-specific date set after canonical outputs exist
- route/UI packaging of truth envelopes, manifests, and report text that does not recompute values
- compare-run persistence / status / snapshot orchestration

## Behavior-changing wrappers

- `simulatePastSelectedDaysShared()` because it changes engine inputs with `forceSimulateDateKeysLocal`, disables passthrough intervals with `emitAllIntervals: false`, and re-surfaces only filtered selected outputs
- `simulatePastFullWindowShared()` because it stops before canonical dataset/output construction
- `persistRebuiltArtifact()` because it rebuilds daily/monthly/output rows through `recomputePastAggregatesFromIntervals()` and manual dataset assembly
- `restoreCachedArtifactDataset()` / `reconcileRestoredDatasetFromDecodedIntervals()` because they recompute surfaced daily/monthly/summary outputs from decoded intervals
- `buildGapfillCompareSimShared()` selected-days daily-total reconstruction because it rebuilds `dailyTotalsByDate` outside the shared dataset builder
- `buildGapfillCompareSimShared()` exact parity total construction because it builds proof totals outside the shared dataset builder
- `route.ts` scored `freshDailyByDate` generation because it rebuilds compare day totals again from intervals

## Ranked remaining violations

### 1. Highest-priority true violation

File/function:

- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`

Why it violates the invariant:

- it changes which days are simulated and which days are eligible as reference/training inputs before `simulatePastDay()` runs
- it then surfaces a filtered selected-only output instead of the canonical full shared output

Can it materially change outputs?

- yes

Likely contributing to compare drift / timeout concerns?

- yes
- it is the most direct remaining cause of “same date, different caller, different shared output ownership”
- it also creates extra caller-side day-total reconstruction and output slicing work

### 2. Medium-priority violation

File/function:

- `modules/usageSimulator/service.ts` -> `persistRebuiltArtifact()`
- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastFullWindowShared()`

Why it violates the invariant:

- rebuild/storage does not use the same full output-construction chain as normal Past Sim
- it recreates the stored artifact through interval aggregate recompute and manual dataset assembly

Can it materially change outputs?

- yes

Likely contributing to compare drift / timeout concerns?

- yes for drift
- less directly for timeouts, but it keeps storage and compare consumers dependent on different output builders

### 3. Low-priority / reporting-and-output drift

File/function:

- `modules/usageSimulator/service.ts` -> selected-days `dailyTotalsByDate`, exact parity totals
- `app/api/admin/tools/gapfill-lab/route.ts` -> `freshDailyByDate`, `scoredDayTruthRows`

Why it violates the invariant:

- consumers are still rebuilding day totals from intervals or day results outside a single canonical shared simulated-day output artifact

Can it materially change outputs?

- yes, but usually at the surfaced daily-total/report layer rather than interval generation itself

Likely contributing to compare drift / timeout concerns?

- yes for drift and truth mismatch risk
- lower for timeout than the wrapper/output-path splits above

## Single recommended next implementation pass

Collapse `simulatePastFullWindowShared()` and `simulatePastSelectedDaysShared()` onto one canonical full-output shared path that always returns the same finalized shared simulated artifact produced by `simulatePastUsageDataset()` and `buildSimulatedUsageDatasetFromCurve()`, then make every caller do only post-output date slicing or packaging.

Why this is the smallest next pass that moves closest to the invariant:

- it removes the biggest remaining behavior-changing fork, `simulatePastSelectedDaysShared()`
- it gives exact parity and artifact rebuild the same finalized shared output object that Past Sim already uses
- it turns selected-days compare, parity proof, and rebuild/storage into consumers of one canonical output instead of each rebuilding their own totals/output view
