# Final Current-Branch Strict Shared-Sim Audit

> Historical implementation audit only. This file documents point-in-time runtime/code analysis and is not the canonical written architecture contract.
>
> Canonical architecture references:
> - `docs/ONE_PATH_SIM_ARCHITECTURE.md`
> - `docs/USAGE_SIMULATION_PLAN.md`
> - `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`

Audited branch: `main`

Audited commit: `f60a1ddda28348efff5e0abe3e65379c006ffdc4`

Working tree at audit start: clean

## Superseded Status Note

This document reflects an older audited commit and is no longer the current branch verdict after commit `67dfead393e3c3f9154e378b05d9f5e6d02ca794`.

Retired findings in this older audit:

- `modules/usageSimulator/service.ts` no longer owns `attachCanonicalArtifactSimulatedDayTotalsByDate()` / `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()`.
- Exact travel/vacant parity no longer derives its fresh/artifact proof totals through `normalizeIntervalsForExactParityCodec()` / `buildCanonicalIntervalDayTotalsByLocalDate()` in `service.ts`.
- The active `localDate` fallback and `forcedScoredDateKeys` ownership-widening findings in older audits are no longer current runtime behavior.
- The selected-day compare authority split called out here is no longer current on the working tree; selected-day compare now consumes surfaced canonical selected-day totals from the shared selected-days path.
- Current exact parity authority is saved canonical artifact totals vs fresh canonical full-window totals; interval decoding is no longer the parity truth path.

Use `docs/FINAL_EXACT_PARITY_AND_SHARED_AUTHORITY_AUDIT.md` for the latest current-branch parity-authority verdict.

## 1) Invariant

Non-negotiable invariant:

- same date in
- same prepared dependencies in
- same shared sim calculation chain
- same finalized simulated day out

Interpretation for this branch:

- The only allowed caller difference is which dates are requested.
- Wrappers may package, slice, or report after canonical outputs already exist.
- Wrappers may not change prepared inputs, usage-shape handling, weather handling, incomplete-day handling, curve shaping, interval generation, day-total generation, finalized simulated-day outputs, or artifact ownership.
- Selected-day membership must use one timestamp-to-local-date rule.
- Travel/test scoring must not change full-year artifact identity or exclusion ownership.
- Canonical shared coverage-window logic must remain authoritative.

## 2) End-to-End Path Traces

### A. Past Sim vacant/travel artifact generation path

Entrypoint:

- `getPastSimulatedDatasetForHouse()` in `modules/usageSimulator/service.ts`

Current chain:

- `getPastSimulatedDatasetForHouse()`
- `simulatePastUsageDataset()`
- `getActualIntervalsForRange()`
- `loadWeatherForPastWindow()`
- home/appliance snapshot/profile load
- `ensureUsageShapeProfileForSharedSimulation()`
- local-day retain/force key prep inside `simulatePastUsageDataset()`
- `buildPastSimulatedBaselineV1()`
- `simulatePastDay()`
- incomplete-day blend in `buildPastSimulatedBaselineV1()`
- `buildCurveFromPatchedIntervals()`
- `buildSimulatedUsageDatasetFromCurve()`
- metadata attachment inside `simulatePastUsageDataset()`
- service storage path later calls `attachCanonicalArtifactSimulatedDayTotalsByDate()` before cache save

Exact interval-production function:

- `simulatePastDay()`

Post-interval transformations before output/store:

- incomplete-day slot replacement in `buildPastSimulatedBaselineV1()` can materially change simulated day output for incomplete days
- `buildCurveFromPatchedIntervals()` sorts and re-frames stitched intervals
- `buildSimulatedUsageDatasetFromCurve()` builds daily/monthly/summary and uses `SimulatedDayResult.displayDayKwh` for simulated-day daily rows
- `attachCanonicalArtifactSimulatedDayTotalsByDate()` adds a service-owned sidecar total map before storage

Materially changing post-steps:

- yes: incomplete-day blend
- yes: dataset finalization in `buildSimulatedUsageDatasetFromCurve()`
- yes: sidecar canonical total construction in `attachCanonicalArtifactSimulatedDayTotalsByDate()`

### B. Scored-day Compare fresh simulation path

Entrypoint:

- `buildGapfillCompareSimShared()` in `modules/usageSimulator/service.ts`

Current selected-days chain:

- `buildGapfillCompareSimShared()`
- `runSelectedDaysFreshExecution()`
- `simulatePastSelectedDaysShared()`
- `simulatePastFullWindowShared()`
- `simulatePastUsageDataset()`
- `getActualIntervalsForRange()`
- `loadWeatherForPastWindow()`
- profile/appliance/usage-shape prep inside `simulatePastUsageDataset()`
- `buildPastSimulatedBaselineV1()`
- `simulatePastDay()`
- incomplete-day blend
- `buildCurveFromPatchedIntervals()`
- `buildSimulatedUsageDatasetFromCurve()`
- `simulatePastFullWindowShared()` re-exposes `dataset.series.intervals15`
- `simulatePastSelectedDaysShared()` slices intervals and `simulatedDayResults` by timestamp-derived local-date membership
- `runSelectedDaysFreshExecution()` filters simulator-owned intervals to dates present in interval-backed `simulatedDayResults`

Exact interval-production function:

- `simulatePastDay()`

Post-interval transformations before compare:

- wrapper slicing in `simulatePastSelectedDaysShared()` is post-output only
- `runSelectedDaysFreshExecution()` derives fresh selected-day totals from interval-backed `simulatedDayResults`

Materially changing post-steps:

- yes: incomplete-day blend
- yes: canonical dataset finalization
- no: current selected-day wrapper slicing itself
- no: current `runSelectedDaysFreshExecution()` date membership rule is now timestamp-based only

### C. Exact travel/vacant fresh parity proof path

Entrypoint:

- `buildGapfillCompareSimShared()` in `modules/usageSimulator/service.ts`

Current chain:

- `buildGapfillCompareSimShared()`
- `runFullWindowFreshExecution()`
- `simulatePastFullWindowShared()`
- `simulatePastUsageDataset()`
- same shared prep stack as Past Sim
- `buildPastSimulatedBaselineV1()`
- `simulatePastDay()`
- incomplete-day blend
- `buildCurveFromPatchedIntervals()`
- `buildSimulatedUsageDatasetFromCurve()`
- `simulatePastFullWindowShared()` exposes intervals
- service exact-proof path normalizes intervals with `normalizeIntervalsForExactParityCodec()`
- service exact-proof path derives local-day totals with `buildCanonicalIntervalDayTotalsByLocalDate()`

Exact interval-production function:

- `simulatePastDay()`

Post-interval transformations before parity comparison:

- identical shared simulation chain through dataset finalization
- parity path then leaves canonical dataset output and compares interval-derived local-day totals in service code

Materially changing post-steps:

- yes: incomplete-day blend
- yes: dataset finalization
- yes: exact-parity interval normalization and interval-day-total reconstruction in service code

### D. Artifact rebuild/storage path

Entrypoints:

- `persistRebuiltArtifact()` in `modules/usageSimulator/service.ts`
- `rebuildSharedArtifactDataset()` in `modules/usageSimulator/service.ts`

Current chain:

- rebuild calls `simulatePastUsageDataset()` directly or via `getPastSimulatedDatasetForHouse()`
- shared stack runs through `buildSimulatedUsageDatasetFromCurve()`
- service deep-copies canonical dataset
- `applyCanonicalCoverageMetadataForNonBaseline()`
- `attachCanonicalArtifactSimulatedDayTotalsByDate()`
- `encodeIntervalsV1()`
- store canonical dataset JSON with sidecar map and compressed intervals

Exact interval-production function:

- `simulatePastDay()`

Post-interval transformations before store:

- canonical shared dataset builder
- sidecar canonical total map attached in service code

Materially changing post-steps:

- yes: sidecar canonical total construction in service code

### E. Artifact restore/read reconciliation path

Entrypoint:

- `restoreCachedArtifactDataset()` in `modules/usageSimulator/service.ts`

Current chain:

- restore saved dataset JSON
- decode `intervals15` unless lightweight selected-days read is enabled
- `reconcileRestoredDatasetFromDecodedIntervals()`
- `recomputePastAggregatesFromIntervals()` only when canonical daily/monthly/series fields are missing

Exact interval-production function:

- none; no simulation occurs here

Post-interval transformations before surfacing:

- canonical artifacts are returned mostly as stored
- legacy/incomplete artifacts may receive backfilled aggregate fields

Materially changing post-steps:

- no for canonical artifacts with complete canonical fields
- yes for legacy/incomplete artifacts that need aggregate backfill

### F. Selected-days wrapper slicing path for intervals and `simulatedDayResults`

Entrypoint:

- `simulatePastSelectedDaysShared()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`

Current chain:

- `simulatePastSelectedDaysShared()`
- `simulatePastFullWindowShared()`
- canonical shared dataset path
- interval slicing by `dateKeyInTimezone()`
- `simulatedDayResults` slicing by `simulatedDayResultIntersectsLocalDateKeys()`
- optional retained-result narrowing also uses `simulatedDayResultIntersectsLocalDateKeys()`

Exact interval-production function:

- `simulatePastDay()`

Post-interval transformations before return:

- pure post-output slicing only

Materially changing post-steps:

- no; this wrapper does not currently change prepared inputs or output values

### G. Compare-side/service-side post-sim canonical total/reference construction path

Entrypoint:

- `buildGapfillCompareSimShared()` in `modules/usageSimulator/service.ts`

Current scored/reference chain:

- read artifact dataset
- `readCanonicalArtifactSimulatedDayTotalsByDate()` or `readCanonicalArtifactSimulatedDayTotalsByDateForDateKeys()`
- build `artifactSimulatedDayReferenceRows`
- build `canonicalArtifactDailyByDate`
- compare with fresh selected-day totals to build `displayVsFreshParityForScoredDays`

Current exact-parity chain:

- `normalizeIntervalsForExactParityCodec()`
- `buildCanonicalIntervalDayTotalsByLocalDate()`
- build `travelVacantParityRows`
- build `travelVacantParityTruth`

Exact interval-production function:

- none in this path; it consumes shared outputs already produced upstream

Post-interval transformations before compare/report:

- scored/reference compare now reads canonical saved totals directly
- exact parity still re-derives local-day totals from intervals in service code

Materially changing post-steps:

- scored/reference compare path: no material output mutation beyond packaging and comparison
- exact parity path: yes, because parity totals are reconstructed outside the canonical dataset builder

## 3) Strict Equivalence Matrix

| Path | Entrypoint | Date source | Execution window source | Usage-shape path | Weather path | Incomplete/partial-day path | Curve-shaping path | Interval-generation function | Interval post-processing path | Day-total generation path | Finalized output construction path | Final consumer | Harmless orchestration only? | Behavior-changing? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Past Sim artifact generation | `getPastSimulatedDatasetForHouse()` | canonical full window days | caller `startDate/endDate` | `ensureUsageShapeProfileForSharedSimulation()` | `loadWeatherForPastWindow()` | `buildPastSimulatedBaselineV1()` incomplete-day blend | `buildCurveFromPatchedIntervals()` | `simulatePastDay()` | engine stitch + blend | `simulatePastDay()` then `buildSimulatedUsageDatasetFromCurve()` | canonical dataset builder, then service attaches sidecar totals | store/display/cache | no | yes, due to sidecar total attachment |
| Scored-day compare fresh sim | `buildGapfillCompareSimShared()` | `boundedTestDateKeysLocal` plus parity dates | `identityWindowResolved` | same shared ensure path | same shared weather loader | same incomplete-day blend | same shared curve builder | `simulatePastDay()` | wrapper slicing only | fresh selected totals from interval-backed `simulatedDayResults` | canonical dataset upstream, then selected-day packaging | compare/reporting | mostly yes | no in current scored compare path |
| Exact travel/vacant fresh proof | `buildGapfillCompareSimShared()` | `travelVacantParityDateKeysLocal` | `identityWindowResolved` | same shared ensure path | same shared weather loader | same incomplete-day blend | same shared curve builder | `simulatePastDay()` | service exact-proof interval normalization | service interval-day-total reconstruction | canonical dataset upstream, then parity totals rebuilt in service | parity validation | no | yes |
| Artifact rebuild/storage | `persistRebuiltArtifact()` / `rebuildSharedArtifactDataset()` | full identity-window dates | `identityWindowResolved` | same shared ensure path | same shared weather loader | same incomplete-day blend | same shared curve builder | `simulatePastDay()` | deep-copy + codec persistence | `attachCanonicalArtifactSimulatedDayTotalsByDate()` sidecar | canonical dataset plus service-owned sidecar totals | artifact store | no | yes |
| Artifact restore/reconcile | `restoreCachedArtifactDataset()` | stored artifact rows | stored artifact window / fallback end date | none | none | none | none | none | optional decoded-interval restore | legacy-only backfill via `recomputePastAggregatesFromIntervals()` | stored dataset, with missing-field backfill only | read/report/compare input | yes for canonical artifacts | yes for legacy/incomplete artifacts only |
| Selected-days wrapper slicing | `simulatePastSelectedDaysShared()` | `selectedDateKeysLocal` and retained keys | full shared output window | upstream shared ensure path | upstream shared weather path | upstream shared incomplete-day blend | upstream shared curve builder | `simulatePastDay()` | timestamp-based interval/result slicing | none beyond upstream canonical outputs | upstream canonical outputs only | selected-day compare consumer | yes | no |
| Compare-side canonical scored references | `buildGapfillCompareSimShared()` | `boundedTestDateKeysLocal` | artifact dataset + compare request window | none beyond upstream shared output | none beyond upstream shared output | none | none | none | meta read only | canonical totals read from saved meta | packaging/comparison only | scored parity/reporting | yes | no |

## 4) Current Date / Window / Ownership Audit

### `canonicalWindow` usage

Current code:

- route passes `canonicalWindow` into `buildGapfillCompareSimShared()`
- service uses `canonicalWindow` for chart/display date framing through `chartDateKeysLocal`
- service does not use `canonicalWindow` as artifact identity ownership

Assessment:

- correct
- chart/report framing and artifact identity remain separated

### `identityWindowResolved` usage

Current code:

- service resolves `identityWindowResolved` from `resolveWindowFromBuildInputsForPastIdentity(buildInputs)`
- input hash, weather identity, interval fingerprint, artifact rebuild, selected-day fresh simulation, and full-window parity simulation all use `identityWindowResolved`

Assessment:

- correct
- scoring/test dates do not replace the artifact identity window

### `travelVacantParityDateKeySet` and `travelVacantParityDateKeysLocal`

Current code:

- `boundedTravelDateKeysLocal` comes from `travelRangesToExcludeDateKeys(buildTravelRanges)` bounded by `resolveCanonicalUsage365CoverageWindow()`
- `travelVacantParityDateKeysLocal` is `boundedTravelDateKeysLocal ∩ chartDateKeysLocal`
- `travelVacantParityDateKeySet` is just a local set wrapper used for filtering and fresh parity execution

Assessment:

- correct
- travel parity keys remain bounded by canonical travel ownership and report window

### Can requested scoring/parity dates widen or mutate artifact identity or exclusion ownership?

Current code:

- `computePastInputHash()` uses `identityWindowResolved`, `buildTravelRanges`, interval fingerprint, usage-shape identity, and weather identity
- `simulatePastUsageDataset()` still derives `excludedDateKeysFingerprint` from bounded travel/vacant ranges only
- `buildGapfillCompareSimShared()` bounds test dates separately and does not feed them into artifact hash or exclusion ownership

Assessment:

- no
- scoring logic does not currently change artifact identity or exclusion ownership

### Active use of `forcedScoredDateKeys`

Current code:

- `forcedScoredDateKeys` still exists only as an argument/comment inside `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()`
- the helper currently has no live call site on this audited commit

Assessment:

- dead helper drift exists
- no active ownership-changing scoring behavior was found from `forcedScoredDateKeys` on this branch

### Selected-day slicing and timestamp-to-local-date logic

Current code:

- `simulatePastSelectedDaysShared()` slices intervals by `dateKeyInTimezone()`
- `simulatedDayResultIntersectsLocalDateKeys()` admits result membership only from interval timestamps
- `runSelectedDaysFreshExecution()` now ignores `simulatedDayResults` that have no interval-backed local-date membership

Assessment:

- correct
- no second active selected-day date interpretation was found on this branch

### Is scoring logic only post-output packaging now?

Current code:

- scored/reference compare reads `canonicalArtifactSimulatedDayTotalsByDate` directly via `readCanonicalArtifactSimulatedDayTotalsByDate*()`
- missing scored references stay missing
- compare-side merge/backfill widening removed from current active path

Assessment:

- yes for scored/reference compare behavior
- no for exact-parity totals and storage sidecar totals, which are still service-owned post-output constructions

### Do no-travel/no-vacation houses still run Gap-Fill safely?

Current code:

- when `travelVacantParityDateKeysLocal.length === 0`, `travelVacantParityTruth.availability` is `not_requested`
- selected-day compare still runs with scored test dates
- full-window parity execution is skipped when there are no parity dates

Assessment:

- yes

## 5) Split Points

### Split 1

File/function:

- `modules/usageSimulator/service.ts`
- `attachCanonicalArtifactSimulatedDayTotalsByDate()`
- `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()`

Paths diverging here:

- Past Sim storage path
- artifact rebuild/storage path
- general cache persistence path in `getPastSimulatedDatasetForHouse()`

Type:

- behavior-changing

Why:

- service code constructs a sidecar canonical simulated-day-total authority after the canonical dataset builder has already finalized outputs

Invariant status:

- violation

### Split 2

File/function:

- `modules/usageSimulator/service.ts`
- `normalizeIntervalsForExactParityCodec()`
- `buildCanonicalIntervalDayTotalsByLocalDate()`

Paths diverging here:

- exact travel/vacant parity fresh proof path
- artifact exact-parity comparison path

Type:

- behavior-changing

Why:

- exact parity no longer simply validates saved shared finalized outputs against fresh shared finalized outputs; it rebuilds local-day totals from intervals in service code

Invariant status:

- violation

### Split 3

File/function:

- `modules/usageSimulator/service.ts`
- `reconcileRestoredDatasetFromDecodedIntervals()`

Paths diverging here:

- artifact restore/read reconciliation path only

Type:

- behavior-changing for legacy/incomplete artifacts

Why:

- restore path can still backfill missing surfaced aggregates from decoded intervals when canonical fields are absent

Invariant status:

- violation for legacy/incomplete artifacts only

### Split 4

File/function:

- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `simulatePastSelectedDaysShared()`

Paths diverging here:

- selected-day compare wrapper vs full-window shared wrapper

Type:

- orchestration only

Why:

- wrapper slices already-finalized intervals/results by one canonical timestamp-based local-date rule

Invariant status:

- allowed

### Split 5

File/function:

- `modules/usageSimulator/service.ts`
- scored/reference compare read path around `readCanonicalArtifactSimulatedDayTotalsByDate*()` and `artifactSimulatedDayReferenceRows`

Paths diverging here:

- scored/reference compare reporting vs Past Sim display/store

Type:

- orchestration only

Why:

- current scored compare reads canonical saved totals and packages them for parity/reporting without widening ownership

Invariant status:

- allowed

## 6) Direct Yes/No Answers

### Are Past Sim and scored-day Compare now using the exact same simulation calculation chain?

Yes.

Code references:

- `simulatePastUsageDataset()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `buildPastSimulatedBaselineV1()` in `modules/simulatedUsage/engine.ts`
- `simulatePastDay()` in `modules/simulatedUsage/pastDaySimulator.ts`
- `buildCurveFromPatchedIntervals()` and `buildSimulatedUsageDatasetFromCurve()` in `modules/usageSimulator/dataset.ts`

### Are they using the exact same prepared dependencies at the moment the day is simulated?

Yes.

Code references:

- usage-shape ensure in `simulatePastUsageDataset()`
- weather load in `loadWeatherForPastWindow()` via `simulatePastUsageDataset()`
- compare fresh selected-days call passes `identityWindowResolved.startDate/endDate`, `buildInputs`, `travelRanges`, and `timezone` into `simulatePastSelectedDaysShared()`

### Is exact travel parity using the same calculation chain and same finalized output path as Past Sim?

Same calculation chain: yes.

Same finalized output path: no.

Code references:

- same upstream shared chain through `simulatePastUsageDataset()`
- divergence in `normalizeIntervalsForExactParityCodec()` and `buildCanonicalIntervalDayTotalsByLocalDate()` in `modules/usageSimulator/service.ts`

### Is artifact rebuild/storage using the same finalized output path as normal Past Sim?

Not fully.

Code references:

- rebuild/storage uses canonical shared dataset upstream
- then attaches sidecar totals in `attachCanonicalArtifactSimulatedDayTotalsByDate()` before save

### Is artifact restore/reconciliation using the same finalized output path as normal Past Sim, or only doing legacy backfill without overwriting canonical outputs?

Canonical artifacts: yes.

Legacy/incomplete artifacts: legacy backfill only, without overwriting existing canonical outputs.

Code references:

- `restoreCachedArtifactDataset()`
- `reconcileRestoredDatasetFromDecodedIntervals()`

### Does any remaining wrapper still change interval values, day totals, or finalized simulated outputs?

Yes.

Current live examples:

- `attachCanonicalArtifactSimulatedDayTotalsByDate()`
- `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()`
- `normalizeIntervalsForExactParityCodec()`
- `buildCanonicalIntervalDayTotalsByLocalDate()`
- `reconcileRestoredDatasetFromDecodedIntervals()` for legacy/incomplete artifacts

### Does any remaining wrapper re-interpret selected dates differently from the canonical timestamp-based local-date logic?

No.

Code references:

- `simulatePastSelectedDaysShared()`
- `simulatedDayResultIntersectsLocalDateKeys()`
- `runSelectedDaysFreshExecution()` current interval-backed membership logic

### Does any current code path allow scoring logic to change artifact identity or exclusion ownership?

No.

Code references:

- `resolveWindowFromBuildInputsForPastIdentity()`
- `computePastInputHash(...)` usage in `buildGapfillCompareSimShared()`
- `excludedDateKeysFingerprint` generation in `simulatePastUsageDataset()`

### Are all calculations for all simulated days truly using one shared module/path now?

No, not fully.

Why:

- interval generation and shared simulation math do use one shared path
- finalized-output authority is still split by service-owned sidecar day-total construction and exact-parity interval-day-total reconstruction

### If not, what exact pieces are still outside the shared path?

- `attachCanonicalArtifactSimulatedDayTotalsByDate()`
- `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()`
- `normalizeIntervalsForExactParityCodec()`
- `buildCanonicalIntervalDayTotalsByLocalDate()`
- `reconcileRestoredDatasetFromDecodedIntervals()` legacy backfill path

## 7) Harmless vs Forbidden Wrappers

### Harmless orchestration wrappers

- `simulatePastFullWindowShared()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `simulatePastSelectedDaysShared()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`
- scored/reference compare read path using `readCanonicalArtifactSimulatedDayTotalsByDate*()` in `modules/usageSimulator/service.ts`
- route-level compare mode selection and snapshot/report shaping in `app/api/admin/tools/gapfill-lab/route.ts`

Why they are harmless:

- they choose dates
- they slice only after canonical outputs exist
- they package/report already-finalized outputs

### Behavior-changing wrappers/helpers

- `attachCanonicalArtifactSimulatedDayTotalsByDate()` in `modules/usageSimulator/service.ts`
- `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()` in `modules/usageSimulator/service.ts`
- `normalizeIntervalsForExactParityCodec()` in `modules/usageSimulator/service.ts`
- `buildCanonicalIntervalDayTotalsByLocalDate()` in `modules/usageSimulator/service.ts`
- `reconcileRestoredDatasetFromDecodedIntervals()` in `modules/usageSimulator/service.ts` for legacy/incomplete artifacts

Why they are forbidden under the invariant:

- they create alternate day-total/output authority after canonical outputs already exist
- or they backfill surfaced aggregates outside the canonical shared dataset builder

Dead/helper drift found but not active on this commit:

- `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()`
- `forcedScoredDateKeys`

## 8) Ranked Remaining Violations

### Highest priority true violation

File/function:

- `modules/usageSimulator/service.ts`
- `attachCanonicalArtifactSimulatedDayTotalsByDate()`
- `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()`

Why it violates the invariant:

- canonical simulated-day total authority is still being created in service code after `buildSimulatedUsageDatasetFromCurve()` already finalized the shared output

Can it materially change outputs?

- yes

Likely contribution to compare drift or timeout concerns:

- compare drift: yes, because storage/read authority is not owned by the canonical builder
- timeout/memory: moderate, because extra maps and interval scans still exist in service code

### Medium-priority violation

File/function:

- `modules/usageSimulator/service.ts`
- `normalizeIntervalsForExactParityCodec()`
- `buildCanonicalIntervalDayTotalsByLocalDate()`

Why it violates the invariant:

- exact parity reconstructs daily totals from intervals instead of validating one canonical finalized shared output artifact against another

Can it materially change outputs?

- yes

Likely contribution to compare drift or timeout concerns:

- compare drift: yes, especially around parity-only discrepancies
- timeout/memory: yes, because parity still scans interval arrays outside the canonical dataset builder

### Low-priority/reporting-only drift

Files:

- `docs/PROJECT_CONTEXT.md`
- `docs/PROJECT_PLAN.md`
- `docs/USAGE_SIMULATION_PLAN.md`
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`
- `docs/CURRENT_BRANCH_SHARED_SIM_AND_DATE_LOGIC_AUDIT.md`

Why:

- these docs still describe now-retired compare-side ownership widening and `localDate` fallback issues as live current-branch behavior

Can it materially change outputs?

- no

Likely contribution to compare drift or timeout concerns:

- no runtime effect
- high risk of misleading future implementation work

## 9) Docs Truth Check

### `PROJECT_CONTEXT.md`

Status:

- stale

What is stale:

- it says strict finalized-output alignment is incomplete because `service.ts` still reconstructs or backfills canonical simulated-day totals in compare-side helpers including `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()`
- it says the remaining follow-up includes the downstream `runSelectedDaysFreshExecution()` `localDate` fallback

Current code truth:

- compare-side backfill/widening path is no longer active
- `runSelectedDaysFreshExecution()` no longer uses `localDate` fallback
- remaining live service drift is now storage sidecar total authority plus exact-parity interval-day-total reconstruction

### `PROJECT_PLAN.md`

Status:

- stale

What is stale:

- same current-branch caveat as above
- it still frames the live follow-up around retiring service-level post-sim ownership helpers plus the `localDate` fallback

Current code truth:

- `localDate` fallback is already retired
- active remaining violation is narrower and centered on service-owned day-total authority outside the canonical builder

### `USAGE_SIMULATION_PLAN.md`

Status:

- stale

What is stale:

- it says strict finalized-output alignment is incomplete because service still reconstructs/backfills canonical simulated-day totals and exact-parity day totals outside `buildSimulatedUsageDatasetFromCurve()`

Current code truth:

- exact-parity day-total reconstruction remains live
- compare-side scored-reference backfill is no longer live
- the doc needs to distinguish dead helper drift from active call paths

### `PAST_SHARED_CORE_UNIFICATION_PLAN.md`

Status:

- stale

What is stale:

- it still says the next live follow-up includes retiring the downstream `runSelectedDaysFreshExecution()` `localDate` fallback
- it overstates current compare-side helper drift by describing it as still active

Current code truth:

- selected-day downstream `localDate` fallback is already removed
- remaining live issues are service-owned storage sidecar totals and exact-parity day-total reconstruction

### `CURRENT_BRANCH_SHARED_SIM_AND_DATE_LOGIC_AUDIT.md`

Status:

- stale

What is stale:

- says `runSelectedDaysFreshExecution()` still falls back to `row.localDate`
- says `forcedScoredDateKeys` is still an active ownership-changing mechanism in current code
- treats `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()` as a live compare-side violation
- ranks the old compare-side helper path as still active

Current code truth:

- `runSelectedDaysFreshExecution()` now requires interval-backed membership
- `forcedScoredDateKeys` remains only dead/helper drift on this commit
- active scored/reference compare reads canonical saved totals directly

## 10) Single Recommended Next Implementation Pass

Recommend exactly one next pass:

- Move `canonicalArtifactSimulatedDayTotalsByDate` authority into the canonical shared dataset builder/output path itself, then delete service-owned construction via `attachCanonicalArtifactSimulatedDayTotalsByDate()` / `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()` and make exact parity consume that same canonical saved/fresh day-total authority instead of reconstructing local-day totals in `service.ts`.

Why this is the smallest high-value pass:

- it removes the biggest remaining non-shared finalized-output authority
- it keeps the shared sim calculation chain unchanged
- it preserves canonical window logic and artifact identity ownership
- it pushes storage, compare, and parity closer to one shared finalized output

## 11) Final Verdict

Current branch verdict:

- shared simulation calculation chain: yes
- prepared dependency alignment at simulation time: yes
- selected-day timestamp-based membership rule: yes
- canonical window/date logic: yes
- ownership-changing scoring behavior: no active current-path evidence found
- strict finalized simulated output alignment end to end: no

The current branch does not fully satisfy the invariant yet. The remaining live gap is no longer scored compare ownership widening or a selected-day `localDate` fallback. The remaining live gap is service-owned day-total authority outside the canonical shared dataset builder, plus exact-parity day-total reconstruction and legacy restore backfill.
