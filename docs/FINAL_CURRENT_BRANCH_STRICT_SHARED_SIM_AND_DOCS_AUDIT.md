# Final Current-Branch Strict Shared Sim And Docs Audit

> Historical implementation audit only. This file documents point-in-time runtime/code analysis and is not the canonical written architecture contract.
>
> Canonical architecture references:
> - `docs/ONE_PATH_SIM_ARCHITECTURE.md`
> - `docs/USAGE_SIMULATION_PLAN.md`
> - `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`

Audited branch: `main`

Audited commit: `67dfead393e3c3f9154e378b05d9f5e6d02ca794`

Working tree at audit start: `dirty`

Audit-start dirty state:

- `docs/FINAL_CURRENT_BRANCH_STRICT_SHARED_SIM_AUDIT.md` was untracked at audit start.

## Superseded Status Note

This document reflects the prior current-branch doc-sync verdict before the latest selected-day authority fix and final exact-parity authority re-audit.

Retired findings in this older audit:

- The selected-day compare authority gap described here is no longer current on the working tree; `runSelectedDaysFreshExecution()` now consumes surfaced canonical selected-day totals from `simulatePastSelectedDaysShared()`.
- Exact parity authority is now explicitly documented as saved canonical artifact totals vs fresh canonical full-window totals from the same shared finalized-output authority.

Use `docs/FINAL_EXACT_PARITY_AND_SHARED_AUTHORITY_AUDIT.md` for the latest parity-authority and shared-output verdict.

## 1) Invariant

Non-negotiable invariant:

- same date in
- same prepared dependencies in
- same shared sim calculation chain
- same finalized simulated day out

Interpretation on this branch:

- The only allowed caller difference is which dates are requested and what the caller does with the finished shared output afterward.
- Caller wrappers may select dates, slice already-finalized canonical outputs, or package/report results.
- Caller wrappers may not change prepared dependencies, usage-shape behavior, weather behavior, incomplete-day handling, curve shaping, interval generation, day-total generation, finalized simulated-day construction, artifact identity, or exclusion ownership.
- Selected-day membership must use one timestamp-to-local-date rule.
- Travel/test scoring must not widen artifact identity or exclusion ownership.
- Canonical/shared coverage-window logic must remain authoritative.

## Scope Re-Read

Primary code re-read in this pass:

- `modules/usageSimulator/service.ts`
- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `modules/simulatedUsage/engine.ts`
- `modules/simulatedUsage/pastDaySimulator.ts`
- `modules/usageSimulator/dataset.ts`
- `modules/usageSimulator/requirements.ts`
- `modules/usageSimulator/metadataWindow.ts`
- `app/api/admin/tools/gapfill-lab/route.ts`
- `modules/usageSimulator/windowIdentity.ts`
- `.cursor/rules/shared-sim-window-lock.mdc`

Docs re-read and synced in this pass:

- `docs/PROJECT_CONTEXT.md`
- `docs/PROJECT_PLAN.md`
- `docs/USAGE_SIMULATION_PLAN.md`
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`
- `docs/CURRENT_BRANCH_SHARED_SIM_AND_DATE_LOGIC_AUDIT.md`
- `docs/FINAL_CURRENT_BRANCH_STRICT_SHARED_SIM_AUDIT.md`

## 2) End-to-End Path Traces

### A. Past Sim vacant/travel artifact generation path

Entrypoint:

- `getPastSimulatedDatasetForHouse()` in `modules/usageSimulator/service.ts`

Wrappers/helpers called:

- `simulatePastUsageDataset()`
- `loadWeatherForPastWindow()`
- `buildPastSimulatedBaselineV1()`
- `buildCurveFromPatchedIntervals()`
- `buildSimulatedUsageDatasetFromCurve()`

Dependency prep before simulation:

- `resolveWindowFromBuildInputsForPastIdentity()` picks the Past identity window in `service.ts`
- `travelRangesFromBuildInputs()` provides the travel/vacant exclusions
- `simulatePastUsageDataset()` bounds excluded date keys to the requested sim window
- `ensureUsageShapeProfileForSharedSimulation()` / usage-shape load runs before day simulation
- `loadWeatherForPastWindow()` prepares actual + normal weather and provenance before day simulation

Exact function where interval values are produced:

- `simulatePastDay()` in `modules/simulatedUsage/pastDaySimulator.ts`

Transformations after interval generation:

- `buildPastSimulatedBaselineV1()` applies incomplete-day / excluded-day / leading-missing-day behavior and returns patched intervals plus `dayResults`
- `buildCurveFromPatchedIntervals()` stitches/sorts the interval curve
- `buildSimulatedUsageDatasetFromCurve()` finalizes intervals, daily rows, monthly rows, summary, and `canonicalArtifactSimulatedDayTotalsByDate`
- `applyCanonicalCoverageMetadataForNonBaseline()` overwrites metadata/report coverage window only; it does not rebuild sim math
- storage writes `readCanonicalArtifactSimulatedDayTotalsByDate(rebuiltDataset)` without rebuilding totals

Whether post-steps can materially change simulated output:

- `buildPastSimulatedBaselineV1()`: yes
- `buildCurveFromPatchedIntervals()`: yes
- `buildSimulatedUsageDatasetFromCurve()`: yes
- `applyCanonicalCoverageMetadataForNonBaseline()`: no for sim values, yes for metadata framing only
- storage write/read of canonical totals: no

### B. Scored-day Compare fresh simulation path

Entrypoint:

- `buildGapfillCompareSimShared()` in `modules/usageSimulator/service.ts`

Wrappers/helpers called:

- selected-days mode:
  - `runSelectedDaysFreshExecution()`
  - `simulatePastSelectedDaysShared()`
  - `simulatePastFullWindowShared()`
  - `simulatePastUsageDataset()`
- full-window mode:
  - `runFullWindowFreshExecution()`
  - `simulatePastFullWindowShared()`
  - `simulatePastUsageDataset()`

Dependency prep before simulation:

- `identityWindowResolved` from `resolveWindowFromBuildInputsForPastIdentity()`
- `buildTravelRanges` from `travelRangesFromBuildInputs()`
- same shared usage-shape ensure/load path in `simulatePastUsageDataset()`
- same shared weather load path in `loadWeatherForPastWindow()`

Exact function where interval values are produced:

- `simulatePastDay()`

Transformations after interval generation:

- shared path through `buildPastSimulatedBaselineV1()`
- shared path through `buildCurveFromPatchedIntervals()`
- shared path through `buildSimulatedUsageDatasetFromCurve()`
- `simulatePastFullWindowShared()` surfaces `series.intervals15` plus canonical totals
- `simulatePastSelectedDaysShared()` slices intervals and `simulatedDayResults` by timestamp-derived local date
- `runSelectedDaysFreshExecution()` filters simulator-owned intervals to dates represented by interval-backed `simulatedDayResults` and derives selected-day `dailyTotalsByDate`

Whether post-steps can materially change simulated output:

- shared simulation steps: yes
- `simulatePastSelectedDaysShared()` slicing: no, post-output only
- `runSelectedDaysFreshExecution()` interval ownership/date packaging: no interval math change, but yes for compare-side daily-total authority packaging

### C. Exact travel/vacant fresh parity proof path

Entrypoint:

- `buildGapfillCompareSimShared()` in `modules/usageSimulator/service.ts`

Wrappers/helpers called:

- `runFullWindowFreshExecution()`
- `simulatePastFullWindowShared()`
- `simulatePastUsageDataset()`
- `readCanonicalArtifactSimulatedDayTotalsByDate*()`

Dependency prep before simulation:

- same `identityWindowResolved`
- same `buildTravelRanges`
- same shared usage-shape and weather prep stack as Past Sim

Exact function where interval values are produced:

- `simulatePastDay()`

Transformations after interval generation:

- same shared chain through dataset finalization
- fresh parity reads `freshResult.canonicalSimulatedDayTotalsByDate`
- artifact side reads `readCanonicalArtifactSimulatedDayTotalsByDate()` / `readCanonicalArtifactSimulatedDayTotalsByDateForDateKeys()`
- parity rows compare canonical artifact day totals vs fresh canonical full-window day totals

Whether post-steps can materially change simulated output:

- shared simulation steps: yes
- parity read/package steps: no

### D. Artifact rebuild/storage path

Entrypoint:

- `rebuildGapfillSharedPastArtifact()` in `modules/usageSimulator/service.ts`
- `rebuildSharedArtifactDataset()` inside `buildGapfillCompareSimShared()`

Wrappers/helpers called:

- `simulatePastUsageDataset()` or `getPastSimulatedDatasetForHouse()`
- `applyCanonicalCoverageMetadataForNonBaseline()`
- `readCanonicalArtifactSimulatedDayTotalsByDate()`
- `encodeIntervalsV1()`
- `saveCachedPastDataset()`

Dependency prep before simulation:

- same Past identity window resolution
- same shared travel exclusion set
- same shared usage-shape/weather prep because rebuild goes through the normal Past simulator

Exact function where interval values are produced:

- `simulatePastDay()`

Transformations after interval generation:

- normal shared chain through `buildSimulatedUsageDatasetFromCurve()`
- coverage metadata overlay for non-baseline framing
- storage strips `series.intervals15` from `datasetJson` and persists codec bytes separately
- stored canonical day totals are read from the dataset; not rebuilt in service

Whether post-steps can materially change simulated output:

- shared simulation steps: yes
- storage packaging: no

### E. Artifact restore/read reconciliation path

Entrypoint:

- `restoreCachedArtifactDataset()` in `modules/usageSimulator/service.ts`

Wrappers/helpers called:

- `decodeIntervalsV1()`
- `reconcileRestoredDatasetFromDecodedIntervals()`
- `recomputePastAggregatesFromIntervals()`

Dependency prep before simulation:

- none; this is a restore/read path, not a fresh simulation path

Exact function where interval values are produced:

- none in this path; intervals are decoded, not simulated

Transformations after interval generation:

- restore merges stored `datasetJson` with decoded `series.intervals15`
- `reconcileRestoredDatasetFromDecodedIntervals()` only fills missing daily/monthly/usage-bucket/summary fields
- canonical existing rows are preserved when present

Whether post-steps can materially change simulated output:

- no for canonical existing outputs
- yes for legacy/incomplete artifacts missing canonical aggregates

### F. Selected-days wrapper slicing path for intervals + simulatedDayResults

Entrypoint:

- `simulatePastSelectedDaysShared()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`

Wrappers/helpers called:

- `simulatePastFullWindowShared()`
- `simulatedDayResultIntersectsLocalDateKeys()`
- `dateKeyInTimezone()`

Dependency prep before simulation:

- none beyond the same full-window shared simulation arguments

Exact function where interval values are produced:

- `simulatePastDay()` via the shared full-window path

Transformations after interval generation:

- interval slicing uses `dateKeyInTimezone(timestamp, timezoneResolved)`
- `simulatedDayResults` slicing uses interval timestamps only through `simulatedDayResultIntersectsLocalDateKeys()`
- retained day results are optionally narrowed by `retainSimulatedDayResultDateKeysLocal`

Whether post-steps can materially change simulated output:

- no; this is post-output slicing only

### G. Compare-side/service-side post-sim canonical total/reference construction path

Entrypoint:

- `buildGapfillCompareSimShared()` in `modules/usageSimulator/service.ts`

Wrappers/helpers called:

- `readCanonicalArtifactSimulatedDayTotalsByDate()`
- `readCanonicalArtifactSimulatedDayTotalsByDateForDateKeys()`
- `runSelectedDaysFreshExecution()`
- `filterIntervalsToLocalDateKeys()`

Dependency prep before simulation:

- none; this is post-sim consumption/packaging

Exact function where interval values are produced:

- none in this path

Transformations after interval generation:

- display/reference rows read artifact canonical totals from stored dataset meta/top-level fields
- scored compare parity builds `freshDailyTotalsByDate` from selected-day `dailyTotalsByDate` or filtered full-window intervals
- travel parity builds `freshParityDailyByDate` from fresh canonical full-window totals

Whether post-steps can materially change simulated output:

- no interval math changes
- yes for compare-side daily-total authority packaging in selected-days mode because `runSelectedDaysFreshExecution()` still derives selected-day compare totals from retained `simulatedDayResults`

## 3) Strict Equivalence Matrix

| Path | Entrypoint | Date source | Execution window source | Usage-shape path | Weather path | Incomplete/partial-day path | Curve-shaping path | Interval generation | Interval post-processing | Day-total generation | Finalized output construction | Final consumer | Harmless orchestration only? | Behavior-changing? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Past Sim artifact generation | `getPastSimulatedDatasetForHouse()` | travel exclusions from build inputs | `resolveWindowFromBuildInputsForPastIdentity()` | shared ensure/load in `simulatePastUsageDataset()` | `loadWeatherForPastWindow()` | `buildPastSimulatedBaselineV1()` | `buildCurveFromPatchedIntervals()` | `simulatePastDay()` | none beyond shared builder | `buildSimulatedUsageDatasetFromCurve()` | `buildSimulatedUsageDatasetFromCurve()` | store/display | no | yes |
| Scored compare fresh selected-days | `buildGapfillCompareSimShared()` | bounded test dates plus travel parity union | `identityWindowResolved` | shared ensure/load | `loadWeatherForPastWindow()` | shared engine | shared builder | `simulatePastDay()` | selected-day slicing in `simulatePastSelectedDaysShared()` and `runSelectedDaysFreshExecution()` | shared dataset builder, then selected-day compare derives `dailyTotalsByDate` from retained day results | shared dataset builder, then post-output slicing | compare/report | no | yes, but only in post-output selected-day total packaging |
| Scored compare fresh full-window | `buildGapfillCompareSimShared()` | bounded test dates | `identityWindowResolved` | shared ensure/load | `loadWeatherForPastWindow()` | shared engine | shared builder | `simulatePastDay()` | filter fresh intervals to scored dates | shared dataset builder; compare totals then rebucket filtered intervals | shared dataset builder | compare/report | no | yes |
| Exact travel/vacant fresh parity | `buildGapfillCompareSimShared()` | bounded travel parity dates | `identityWindowResolved` | shared ensure/load | `loadWeatherForPastWindow()` | shared engine | shared builder | `simulatePastDay()` | parity filters fresh canonical totals to parity date set | artifact canonical totals read from saved dataset; fresh canonical totals read from full-window shared result | shared dataset builder on both artifact and fresh sides | parity proof | no | yes |
| Artifact rebuild/storage | `rebuildGapfillSharedPastArtifact()` / `rebuildSharedArtifactDataset()` | travel exclusions from build inputs | `identityWindowResolved` | shared ensure/load | shared weather loader | shared engine | shared builder | `simulatePastDay()` | none beyond codec/storage packaging | shared dataset builder | shared dataset builder | cache storage | no | yes |
| Artifact restore/read reconciliation | `restoreCachedArtifactDataset()` | saved artifact contents | saved artifact + fallback end date | none | none | none | none | none | decode + optional legacy aggregate fill | legacy backfill only when canonical aggregates missing | preserved saved dataset unless missing fields | cache restore/read | no | yes for legacy incomplete artifacts only |
| Selected-days wrapper slicing | `simulatePastSelectedDaysShared()` | explicit selected local dates | full-window shared result | inherited shared prep | inherited shared prep | inherited shared engine | inherited shared builder | `simulatePastDay()` | timestamp-based slicing only | inherited | inherited then sliced | compare caller | yes | no |
| Compare-side canonical reference construction | `buildGapfillCompareSimShared()` | display/scored/parity date subsets | artifact restore + canonical coverage window | none | reporting weather fallback only | none | none | none | reads canonical totals via `readCanonicalArtifactSimulatedDayTotalsByDate*()` | artifact side: canonical map; fresh selected-days side: derived from retained day results; fresh parity side: fresh canonical map | none; consumes existing outputs | compare/report/parity | no | yes, due to selected-day compare total derivation |

## 4) Current Date/Window/Ownership Logic

Current code verification:

- `canonicalWindow` in the route comes from `getSharedPastCoverageWindowForHouse()` which delegates to `resolveCanonicalUsage365CoverageWindow()` in `modules/usageSimulator/service.ts`.
- `identityWindowResolved` in `buildGapfillCompareSimShared()` comes from `resolveWindowFromBuildInputsForPastIdentity()` and is used for artifact identity reads and fresh shared simulation execution.
- `travelVacantParityDateKeysLocal` is built from `travelRangesFromBuildInputs(buildInputs)`, bounded by `resolveCanonicalUsage365CoverageWindow()`, then intersected with `chartDateKeysLocal`.
- Requested scoring/parity dates do not widen or mutate artifact hash ownership or exclusion ownership. `boundedTravelDateKeysLocal` alone drives `travelFingerprint`, while test dates are separately bounded/scored.
- `forcedScoredDateKeys` is not an active runtime ownership-changing mechanism on this branch.
- Selected-day slicing uses one timestamp-to-local-date rule:
  - `simulatePastSelectedDaysShared()` slices intervals with `dateKeyInTimezone()`
  - `simulatedDayResultIntersectsLocalDateKeys()` checks interval timestamps only
  - `runSelectedDaysFreshExecution()` ignores rows whose interval-backed date membership is empty
- Historical note from this older audit: the selected-day compare authority gap described here has been retired on the current working tree; selected-day compare now consumes surfaced canonical selected-day totals from `simulatePastSelectedDaysShared()`.
- No-travel/no-vacation houses still run Gap-Fill safely. `travelVacantParityTruth` becomes `not_requested` when `travelVacantParityDateKeysLocal.length === 0`.

Verdict on date/window/ownership logic:

- Canonical window/date logic is still correct.
- Ownership-changing scoring behavior is not present on the current branch.

## 5) Split Points

### Split 1: selected-days wrapper vs full-window wrapper

- File/function: `modules/simulatedUsage/simulatePastUsageDataset.ts` / `simulatePastSelectedDaysShared()`
- Paths diverging: scored compare selected-days vs Past Sim/full-window compare/parity
- Nature: orchestration only
- Can change simulated output: no
- Invariant violation: no

### Split 2: selected-day compare total packaging

- File/function: `modules/usageSimulator/service.ts` / `runSelectedDaysFreshExecution()`
- Paths diverging: selected-days scored compare vs full-window compare/parity consumers
- Nature: post-output compare packaging
- Can change simulated output: no interval/value generation change, but it maintains a second compare-side selected-day day-total authority
- Invariant violation: yes, narrowly, because selected-day compare totals are not consumed from one surfaced canonical finalized day-total map

### Split 3: legacy artifact restore backfill

- File/function: `modules/usageSimulator/service.ts` / `reconcileRestoredDatasetFromDecodedIntervals()`
- Paths diverging: artifact restore/read vs fresh Past/compare builds
- Nature: legacy restore compatibility
- Can change simulated output: only for incomplete/legacy artifacts missing canonical aggregates
- Invariant violation: narrow, legacy-only; it does not overwrite canonical outputs when they exist

### Split 4: route/reporting weather top-up

- File/function: `modules/usageSimulator/service.ts` / selected-days weather completion path after `runSelectedDaysFreshExecution()`
- Paths diverging: selected-days compare reporting vs full-window compare reporting
- Nature: orchestration/reporting only
- Can change simulated output: no
- Invariant violation: no

### Split 5: exact travel parity lightweight-read override

- File/function: `modules/usageSimulator/service.ts` / `exactTravelParityRequiresIntervalBackedArtifactTruth`
- Paths diverging: selected-days lightweight artifact read vs exact parity request
- Nature: artifact-read/orchestration guard
- Can change simulated output: no
- Invariant violation: no; this preserves artifact identity ownership rather than changing it

## 6) Direct Yes/No Answers

- Are Past Sim and scored-day Compare now using the exact same simulation calculation chain? Yes. Both fresh paths resolve into `simulatePastUsageDataset()` -> `buildPastSimulatedBaselineV1()` -> `simulatePastDay()` -> `buildCurveFromPatchedIntervals()` -> `buildSimulatedUsageDatasetFromCurve()`.
- Are they using the exact same prepared dependencies at the moment the day is simulated? Yes. Both use the same build inputs, same identity window, same usage-shape ensure/load path, same weather loader, and the same engine inputs when a given date is simulated.
- Is exact travel parity using the same calculation chain and same finalized output path as Past Sim? Yes for current artifact/fresh parity authority. Both sides consume canonical day totals finalized by the shared dataset path; parity no longer rebuilds day totals in `service.ts`.
- Is artifact rebuild/storage using the same finalized output path as normal Past Sim? Yes. Rebuild/storage reads canonical totals from the rebuilt shared dataset and persists them without rebuilding them in service.
- Is artifact restore/reconciliation using the same finalized output path as normal Past Sim, or only doing legacy backfill without overwriting canonical outputs? No, not the same finalized output path in the legacy fallback case; it only performs legacy backfill for missing aggregates and does not overwrite canonical existing outputs.
- Does any remaining wrapper still change interval values, day totals, or finalized simulated outputs? No wrapper changes interval values or finalized simulated outputs after the shared builder runs. One narrow compare-side helper still derives selected-day compare totals from retained `simulatedDayResults` instead of a surfaced canonical selected-day total map.
- Does any remaining wrapper re-interpret selected dates differently from the canonical timestamp-based local-date logic? No.
- Does any current code path allow scoring logic to change artifact identity or exclusion ownership? No.
- Are all calculations for all simulated days truly using one shared module/path now? No, not fully. The simulation calculation chain is unified, but selected-day compare still keeps a second post-output selected-day day-total consumption path in `runSelectedDaysFreshExecution()`.
- If not, what exact pieces are still outside the shared path? `modules/usageSimulator/service.ts` / `runSelectedDaysFreshExecution()` still derives selected-day compare `dailyTotalsByDate` from retained `simulatedDayResults` instead of consuming one surfaced canonical selected-day day-total map from the shared finalized output.

## 7) Harmless Wrappers vs Behavior-Changing Wrappers

### Harmless orchestration wrappers

- `simulatePastSelectedDaysShared()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`
  - date selection only
  - slicing only after canonical outputs exist
- `readCanonicalArtifactSimulatedDayTotalsByDate()` and `readCanonicalArtifactSimulatedDayTotalsByDateForDateKeys()` in `modules/usageSimulator/service.ts`
  - packaging/reference reads only
- route-level `canonicalWindow` wiring in `app/api/admin/tools/gapfill-lab/route.ts`
  - canonical window selection/report framing only
- selected-days scored weather top-up in `buildGapfillCompareSimShared()`
  - reporting/weather completeness only
- compare-run persistence/snapshot/report-phase helpers in `service.ts` and the route
  - packaging/reporting/observability only

### Behavior-changing wrappers

- `buildPastSimulatedBaselineV1()` in `modules/simulatedUsage/engine.ts`
  - incomplete-day / excluded-day / leading-missing-day handling changes output intervals and day results
- `buildCurveFromPatchedIntervals()` in `modules/usageSimulator/dataset.ts`
  - canonical stitched interval curve finalization
- `buildSimulatedUsageDatasetFromCurve()` in `modules/usageSimulator/dataset.ts`
  - canonical finalized daily/monthly/summary/day-total authority construction
- `runSelectedDaysFreshExecution()` in `modules/usageSimulator/service.ts`
  - still derives selected-day compare day totals post-output instead of consuming one surfaced canonical selected-day total map
- `reconcileRestoredDatasetFromDecodedIntervals()` in `modules/usageSimulator/service.ts`
  - legacy-only aggregate backfill for incomplete artifacts

## 8) Ranked Remaining Violations

### Highest-priority true violation

- File/function: `modules/usageSimulator/service.ts` / `runSelectedDaysFreshExecution()`
- Why it violates the invariant:
  - selected-day compare still builds `dailyTotalsByDate` from retained `simulatedDayResults` instead of consuming one surfaced canonical selected-day day-total authority from the shared finalized output path
- Can materially change outputs:
  - potentially yes at the compare packaging layer if retained day-result day totals ever diverge from the canonical builder-owned day-total map
- Likely contribution:
  - low-to-moderate compare drift risk
  - low timeout risk

### Medium-priority violation

- File/function: `modules/usageSimulator/service.ts` / `reconcileRestoredDatasetFromDecodedIntervals()`
- Why it violates the invariant:
  - restore/read still has a second aggregate-construction path for legacy artifacts missing canonical daily/monthly rows
- Can materially change outputs:
  - yes, but only for incomplete legacy artifacts
- Likely contribution:
  - low compare drift risk on current exact artifacts
  - moderate memory/latency risk when legacy decode + recompute runs

### Low-priority/reporting-only drift

- File/function: docs only
- Why it violates the invariant:
  - multiple docs still described deleted service-owned canonical total helpers, retired `localDate` fallback behavior, or older audited commits as current truth
- Can materially change outputs:
  - no runtime effect
- Likely contribution:
  - no timeout impact
  - high future-maintenance confusion risk

## 9) Docs Truth Sync

Docs updated in this pass to reflect current code:

- `docs/PROJECT_CONTEXT.md`
  - removed the stale claim that `service.ts` still owns canonical simulated-day total builders/attachers
  - retired the stale `localDate` fallback follow-up wording
  - recorded the current remaining gap as selected-day compare total packaging, not service-side canonical total construction
- `docs/PROJECT_PLAN.md`
  - removed the stale claim that strict finalized-output alignment is blocked by service-owned canonical total reconstruction
  - updated the current branch caveat to the narrower selected-day compare total packaging gap
- `docs/USAGE_SIMULATION_PLAN.md`
  - synced the current-branch note so canonical totals are described as builder-owned
  - preserved the locked window/date/ownership rule
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`
  - retired the old service-side canonical total helper follow-up
  - at the time of this older audit, replaced it with the narrower selected-day day-total authority follow-up; that follow-up has now been retired by the latest audit
- `docs/CURRENT_BRANCH_SHARED_SIM_AND_DATE_LOGIC_AUDIT.md`
  - marked as superseded/historical
  - retired stale claims about deleted service helpers, `forcedScoredDateKeys`, and the selected-day `localDate` fallback
- `docs/FINAL_CURRENT_BRANCH_STRICT_SHARED_SIM_AUDIT.md`
  - marked as superseded/historical
  - retired stale claims about deleted service helpers and deleted exact-parity interval-day-total helpers

Current docs truth after sync:

- The docs now preserve the locked rule that scoring must not change artifact identity or exclusion ownership.
- The docs now correctly state that canonical simulated-day total authority lives in `buildSimulatedUsageDatasetFromCurve()`.
- The docs now correctly describe the remaining real gap as a narrow selected-day compare post-output authority split, not a service-owned canonical total builder.

## 10) Single Recommended Next Implementation Pass

Expose a canonical selected-day day-total map from the shared selected-days path and make `runSelectedDaysFreshExecution()` consume that map directly instead of deriving `dailyTotalsByDate` from retained `simulatedDayResults`.

Why this is the smallest next step:

- it does not retune simulation math
- it keeps one shared simulation calculation path
- it keeps one shared finalized day-total authority
- it touches only the remaining selected-day compare post-output authority split
- it does not change artifact identity, exclusion ownership, or canonical window logic

## 11) Final Verdict

Current branch verdict:

- The repo now has one shared simulation calculation chain for Past Sim, compare fresh sim, exact travel parity fresh sim, and artifact rebuild/storage.
- Date/window/ownership logic is still correct on the current branch.
- Ownership-changing scoring behavior is not present on the current branch.
- The branch still does not fully satisfy the invariant because one narrow selected-day compare consumer keeps a second post-output day-total authority in `runSelectedDaysFreshExecution()`.
