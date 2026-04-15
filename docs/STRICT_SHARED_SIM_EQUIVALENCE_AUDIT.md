# Strict Shared Sim Equivalence Audit

> Historical implementation audit only. This file documents point-in-time runtime/code analysis and is not the canonical written architecture contract.
>
> Canonical architecture references:
> - `docs/ONE_PATH_SIM_ARCHITECTURE.md`
> - `docs/USAGE_SIMULATION_PLAN.md`
> - `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`

## Exact invariant

This audit uses one strict invariant:

- same date in
- same dependencies in
- same sim chain
- same day out

That must hold regardless of whether the caller is:

- Past Sim vacant/travel artifact generation
- scored-day Compare fresh simulation
- exact travel/vacant parity validation

Allowed wrapper work:

- selecting which days to request
- deciding what to compare against
- packaging/reporting results

Not allowed in wrappers:

- changing prepared sim inputs
- changing usage-shape handling
- changing weather handling
- changing incomplete-day or partial-day handling
- changing curve shaping
- changing interval generation
- changing day-total generation
- changing codec/normalization before simulated day output is finalized

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

- `tests/usageSimulator/service.artifactOnly.test.ts`
- `tests/usage/gapfillLab.route.artifactOnly.test.ts`

Docs inspected for stated architecture:

- `docs/USAGE_SIMULATION_PLAN.md`
- `docs/PROJECT_CONTEXT.md`

Requested doc not present in repo:

- `docs/SHARED_SIM_LOCKDOWN_RULES.md`

## Bottom line

The repo is structurally close to the invariant, but it does **not** satisfy it today.

What is already aligned:

- all three paths converge on the same shared engine entry, `buildPastSimulatedBaselineV1`
- simulated days ultimately use the same core function, `simulatePastDay`
- weather loading is centralized in `loadWeatherForPastWindow`
- usage-shape ensure/load is centralized in `ensureUsageShapeProfileForSharedSimulation`
- home/appliance profile loading is shared

What breaks strict equivalence:

- the selected-days wrapper changes engine behavior before day simulation by forcing UTC dates into simulation and excluding those forced dates from the reference-day pool
- one compare-side artifact rebuild path stores/display-packages the same intervals through a different aggregate builder than the standard Past Sim path
- compare still has caller-side day-total packaging outside the shared dataset builder

## Caller traces

### A. Past Sim vacant/travel artifact generation

Primary user-facing Past path:

1. `modules/usageSimulator/service.ts` -> `getPastSimulatedDatasetForHouse()`
2. `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastUsageDataset()`
3. Dependency prep inside `simulatePastUsageDataset()`:
   - `getActualIntervalsForRange()`
   - `enumerateDayStartsMsForWindow()`
   - `travelRangesToExcludeDateKeys()`
   - `boundDateKeysToCoverageWindow()`
   - `loadWeatherForPastWindow()`
   - `getHomeProfileSimulatedByUserHouse()`
   - `getApplianceProfileSimulatedByUserHouse()`
   - `ensureUsageShapeProfileForSharedSimulation()`
4. Shared engine call:
   - `modules/simulatedUsage/engine.ts` -> `buildPastSimulatedBaselineV1()`
5. Actual simulated day generation:
   - `modules/simulatedUsage/pastDaySimulator.ts` -> `simulatePastDay()`
6. Post-day transforms before artifact is surfaced:
   - `modules/usageSimulator/dataset.ts` -> `buildCurveFromPatchedIntervals()`
   - `modules/usageSimulator/dataset.ts` -> `buildSimulatedUsageDatasetFromCurve()`
   - `getPastSimulatedDatasetForHouse()` attaches `dailyWeather`

Important note:

- this path uses `buildSimulatedUsageDatasetFromCurve()`, which prefers `SimulatedDayResult.displayDayKwh` for simulated-day daily display rows

### B. scored-day Compare fresh simulation

Selected-days default compare path:

1. `modules/usageSimulator/service.ts` -> `buildGapfillCompareSimShared()`
2. selected-days branch:
   - `runSelectedDaysFreshExecution()`
   - `simulatePastSelectedDaysShared()`
3. Dependency prep inside `simulatePastSelectedDaysShared()`:
   - `getActualIntervalsForRange()`
   - `enumerateDayStartsMsForWindow()`
   - `travelRangesToExcludeDateKeys()`
   - `boundDateKeysToCoverageWindow()`
   - `loadWeatherForPastWindow()`
   - `getHomeProfileSimulatedByUserHouse()`
   - `getApplianceProfileSimulatedByUserHouse()`
   - `ensureUsageShapeProfileForSharedSimulation()`
   - extra selected-days-only prep: build `forcedUtcDateKeys` by scanning UTC day grids for local-date intersection
4. Shared engine call:
   - `buildPastSimulatedBaselineV1()`
5. Actual simulated day generation:
   - `simulatePastDay()`
6. Selected-days-only post-day transforms before compare:
   - engine is called with `forceSimulateDateKeys`
   - engine is called with `emitAllIntervals: false`
   - `simulatePastSelectedDaysShared()` filters `dayResults` to rows whose intervals intersect selected local dates
   - `simulatePastSelectedDaysShared()` filters interval output to selected local dates only
   - `buildGapfillCompareSimShared()` builds `selectedTestDailyTotalsByDate`
   - that day-total map is built from `intervalSumKwh ?? finalDayKwh`, with interval fallback when local/UTC key handoff misses
7. Compare/report packaging:
   - `buildGapfillCompareSimShared()` compares fresh totals to artifact-side totals / actual
   - `app/api/admin/tools/gapfill-lab/route.ts` packages scored-day truth rows and UI payloads

### C. exact travel/vacant fresh parity simulation

Current exact parity proof path:

1. `modules/usageSimulator/service.ts` -> `buildGapfillCompareSimShared()`
2. exact travel parity branch:
   - `runFullWindowFreshExecution()`
   - `simulatePastFullWindowShared()`
3. Dependency prep inside `simulatePastFullWindowShared()`:
   - `getActualIntervalsForRange()`
   - `enumerateDayStartsMsForWindow()`
   - `travelRangesToExcludeDateKeys()`
   - `boundDateKeysToCoverageWindow()`
   - `loadWeatherForPastWindow()`
   - `getHomeProfileSimulatedByUserHouse()`
   - `getApplianceProfileSimulatedByUserHouse()`
   - `ensureUsageShapeProfileForSharedSimulation()`
4. Shared engine call:
   - `buildPastSimulatedBaselineV1()`
5. Actual simulated day generation:
   - `simulatePastDay()`
6. Post-day transforms before proof:
   - interval normalization through `canonicalIntervalKey()`
   - travel-date filtering through `filterIntervalsToLocalDateKeys()`
   - codec-precision normalization through `normalizeIntervalsForExactParityCodec()`
   - day totals through `buildCanonicalIntervalDayTotalsByLocalDate()`
   - compared against artifact totals built from the same canonical interval-day-total builder when exact interval-backed proof is required
7. Proof/report packaging:
   - `travelVacantParityRows`
   - `travelVacantParityTruth`

## Strict equivalence table

| Path | Entrypoint | Date source | Execution window source | Usage-shape ensure/load path | Weather load/scaling path | Incomplete-day / partial-day path | Curve-shaping path | Exact day-simulation function | Interval post-processing | Day-total post-processing | Comparison / report packaging | Can this path change simulated output vs the others? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Past Sim artifact | `getPastSimulatedDatasetForHouse()` -> `simulatePastUsageDataset()` | canonical Past window days | caller `startDate/endDate` | `ensureUsageShapeProfileForSharedSimulation()` | `loadWeatherForPastWindow()` + `simulatePastDay()` weather adjustment | `buildPastSimulatedBaselineV1()` simulates excluded, leading-missing, incomplete | `simulatePastDay()` selects shape from shared context | `simulatePastDay()` | `buildCurveFromPatchedIntervals()` | `buildSimulatedUsageDatasetFromCurve()`; simulated daily display comes from `displayDayKwh` | dataset/storage only | `No` within the full-window family |
| scored-day Compare fresh | `buildGapfillCompareSimShared()` -> `simulatePastSelectedDaysShared()` | selected local test dates, then expanded to intersecting UTC days | compare identity window | same ensure helper, but then selected-days-only `forcedUtcDateKeys` | same weather loader and same core weather math | same engine, but forced UTC days become simulated and are excluded from reference-day pool | same core curve shaping, but context can differ because forced days no longer count as references | `simulatePastDay()` | selected-days filter only; engine called with `emitAllIntervals: false` | compare-side `selectedTestDailyTotalsByDate` built in `service.ts`, not by `buildSimulatedUsageDatasetFromCurve()` | compare truth / scoring / route payload | `Yes` |
| exact travel parity fresh | `buildGapfillCompareSimShared()` -> `simulatePastFullWindowShared()` | DB travel/vacant parity local dates after full-window sim | compare identity window | same ensure helper | same weather loader and same core weather math | same engine behavior as full-window Past path | same core curve shaping | `simulatePastDay()` | normalize/filter intervals for parity scope | `buildCanonicalIntervalDayTotalsByLocalDate()` after codec normalization | parity proof rows/truth only | `No` against full-window Past path; `Yes` relative to selected-days compare because selected-days wrapper is not equivalent |

## Exact split points

### Split 1: selected-days wrapper mutates engine inputs

Location:

- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`
- `modules/simulatedUsage/engine.ts` -> `buildPastSimulatedBaselineV1()`

Paths diverging:

- scored-day Compare fresh simulation diverges from Past Sim artifact generation and exact parity fresh proof

What changes:

- `simulatePastSelectedDaysShared()` computes `forcedUtcDateKeys`
- it passes `forceSimulateDateKeys: forcedUtcDateKeys`
- it passes `emitAllIntervals: false`
- `buildPastSimulatedBaselineV1()` then treats those days as `dayIsForcedSimulate`
- forced days become `shouldSimulateDay`
- forced days are also excluded from `isReferenceDay`

Why this matters:

- this is not just selecting which output rows to keep
- it changes which UTC days are simulated
- it changes which days are allowed to train the reference context
- that changes `referenceDays`, `finalProfile`, `neighborDayTotals`, `shapeVariants`, and `trainingWeatherStatsPast`
- those are prepared dependencies consumed by `simulatePastDay()`

Classification:

- can change simulated output: `Yes`
- acceptable under invariant: `No`
- true violation: `Yes`

### Split 2: compare exact proof uses a different wrapper than scored-day compare

Location:

- `modules/usageSimulator/service.ts` -> `buildGapfillCompareSimShared()`

Paths diverging:

- scored-day Compare fresh simulation uses `simulatePastSelectedDaysShared()`
- exact travel/vacant parity uses `simulatePastFullWindowShared()` when exact proof is required

What changes:

- the exact proof branch intentionally bypasses the selected-days wrapper and reuses the full-window wrapper

Why this matters:

- if both wrappers were strictly equivalent, this would be orchestration-only
- today it is not orchestration-only, because Split 1 means the selected-days wrapper changes prepared inputs before `simulatePastDay()`
- exact proof therefore proves full-window equivalence, not selected-days equivalence

Classification:

- can change simulated output: `Yes`, in practice
- acceptable under invariant: `No`, until selected-days becomes wrapper-only
- true violation: `Yes`

### Split 3: compare-side artifact rebuild uses a different post-sim aggregate chain

Location:

- `modules/usageSimulator/service.ts` -> `rebuildGapfillSharedPastArtifact()` / `persistRebuiltArtifact()`

Paths diverging:

- standard Past Sim artifact path uses `simulatePastUsageDataset()` -> `buildCurveFromPatchedIntervals()` -> `buildSimulatedUsageDatasetFromCurve()`
- compare-side artifact ensure path uses `simulatePastFullWindowShared()` -> `recomputePastAggregatesFromIntervals()`

What changes:

- both paths start from the same shared simulated intervals
- they do **not** build the surfaced/stored dataset through the same aggregate path
- standard Past path uses `SimulatedDayResult.displayDayKwh` for simulated daily display rows
- compare-side rebuild path recomputes daily rows from interval sums through `buildDailyFromIntervals()`

Why this matters:

- this is after `simulatePastDay()`, but it still changes what gets stored/displayed as the artifact
- it can change surfaced daily totals and simulated-vs-actual row labeling for the same underlying intervals
- that is exactly the sort of "Past days look different from compare days" drift the invariant is trying to remove

Classification:

- can change simulated output as surfaced/stored artifact rows: `Yes`
- acceptable under invariant: `No`
- true violation: `Yes`

### Split 4: compare builds scored-day totals outside the shared dataset builder

Location:

- `modules/usageSimulator/service.ts` -> `runSelectedDaysFreshExecution()`

Paths diverging:

- Past Sim full-window dataset uses `buildSimulatedUsageDatasetFromCurve()`
- selected-days compare builds `selectedTestDailyTotalsByDate` directly in the service

What changes:

- selected-days compare prefers `intervalSumKwh ?? finalDayKwh`, then falls back to interval rebucketing
- standard Past Sim daily display uses `displayDayKwh`

Classification:

- can change surfaced day totals: `Yes`
- acceptable under invariant: `No`
- true violation: `Yes`, but lower impact than Splits 1-3

## Direct yes/no answers

### Are Past Sim vacant/travel and scored-day Compare using the exact same day-simulation function chain today?

No.

They share `buildPastSimulatedBaselineV1()` and `simulatePastDay()`, but the full chain is not the same because `simulatePastSelectedDaysShared()` injects `forceSimulateDateKeys` and `emitAllIntervals: false`, which the Past Sim path does not.

Code references:

- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastUsageDataset()`
- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`
- `modules/simulatedUsage/engine.ts` -> `buildPastSimulatedBaselineV1()`

### Are they using the exact same prepared dependencies at the moment the day is simulated?

No.

The selected-days wrapper changes the reference-day pool before `simulatePastDay()` runs. That changes the context consumed by the day simulator.

Code references:

- `modules/simulatedUsage/engine.ts` -> `analyzeDay()`, `referenceDays`, `finalProfile`, `neighborDayTotals`, `shapeVariants`, `trainingWeatherStatsPast`
- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `forcedUtcDateKeys`

### Is exact travel parity still sourcing fresh proof from a different wrapper/path than scored-day Compare?

Yes.

Code references:

- `modules/usageSimulator/service.ts` -> `runSelectedDaysFreshExecution()`
- `modules/usageSimulator/service.ts` -> `runFullWindowFreshExecution()`

### If yes, is that only orchestration or does it prove a behavior-changing split?

It proves a behavior-changing split today.

If the selected-days wrapper were wrapper-only, this would be harmless orchestration. It is not wrapper-only today.

### Is there any wrapper today that changes simulated output rather than only selecting days / packaging results?

Yes.

Primary offender:

- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`

Secondary offender at stored/display artifact layer:

- `modules/usageSimulator/service.ts` -> `rebuildGapfillSharedPastArtifact()`

### How close is the current code to the required invariant?

Moderately close structurally, not close enough behaviorally.

The shared core pieces are already centralized. The remaining problem is that one caller wrapper still changes engine inputs, and one artifact wrapper still rebuilds surfaced aggregates through a different post-sim chain.

## Ranked true violations

### 1. Highest priority violation

File / function:

- `modules/simulatedUsage/simulatePastUsageDataset.ts` -> `simulatePastSelectedDaysShared()`
- `modules/simulatedUsage/engine.ts` -> `buildPastSimulatedBaselineV1()`

Why it violates the invariant:

- the caller wrapper changes which UTC days are simulated and which days qualify as references before the shared day simulator runs

Can it materially change sim output?

- Yes

Does it explain the concern that Compare days seem more accurate / different than Past Sim days?

- Yes, directly

### 2. Medium priority violation

File / function:

- `modules/usageSimulator/service.ts` -> `rebuildGapfillSharedPastArtifact()`

Why it violates the invariant:

- the compare-side artifact rebuild stores the shared intervals through `recomputePastAggregatesFromIntervals()` instead of the standard Past dataset path

Can it materially change sim output?

- Yes, at stored/display day totals and source labeling

Does it explain the concern that Compare days seem more accurate / different than Past Sim days?

- Yes, especially when compare-triggered artifact ensure persists rows that do not exactly match the standard Past display builder

### 3. Low priority violation

File / function:

- `modules/usageSimulator/service.ts` -> `buildGapfillCompareSimShared()`

Why it violates the invariant:

- compare still computes selected-day daily totals in service-layer packaging instead of consuming one canonical shared day-result/dataset output

Can it materially change sim output?

- Yes, but usually at day-total/reporting level rather than interval-generation level

Does it explain the concern that Compare days seem more accurate / different than Past Sim days?

- Possibly, but less strongly than violations 1 and 2

## Doc and reporting drift found during audit

- `docs/USAGE_SIMULATION_PLAN.md` still describes shared alignment as complete, but current code still has a behavior-changing selected-days wrapper split
- `docs/USAGE_SIMULATION_PLAN.md` also mentions `NEAREST_WEATHER` selection in the Past baseline ladder, but current `buildPastSimulatedBaselineV1()` defines `nearestWeatherProfileForDay()` and does not use it in the simulation loop
- `docs/PROJECT_CONTEXT.md` states shared-artifact alignment is already true in runtime; that is too strong for the current code
- requested audit target `docs/SHARED_SIM_LOCKDOWN_RULES.md` does not exist

These are real drift signals, but they are secondary to the runtime wrapper violations above.

## Single recommended next implementation pass

One pass only:

**Collapse `simulatePastSelectedDaysShared()` onto the same full-window shared engine/output path as Past Sim, then slice selected local dates only after canonical day results are produced.**

Why this is the best next pass:

- it removes the highest-priority violation at the source
- it forces scored-day Compare and exact parity back onto one prepared dependency chain
- it makes the exact-parity full-window branch and selected-days compare branch wrapper-equivalent instead of behaviorally different
- once that is done, the remaining post-sim aggregate drift becomes much easier to eliminate surgically

## Final judgment

Current status against the invariant:

- `same date in`: `No` for selected-days compare, because local-date selection is expanded into forced UTC simulation
- `same dependencies in`: `No` for selected-days compare, because the reference/training pool changes
- `same sim chain`: `No` across all callers end-to-end
- `same day out`: `No` guaranteed today

Strict equivalence verdict:

- **Fail**
