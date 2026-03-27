# Current Branch Shared Sim And Date Logic Audit

Audited branch: `main`
Audited commit: `c32726b5b57d6159f59638269dc34fd959376531`
Working tree at audit start: `clean`

## Superseded Status Note

This document reflects an older branch state and is no longer the current source of truth after commit `67dfead393e3c3f9154e378b05d9f5e6d02ca794`.

Retired findings in this older audit:

- `modules/usageSimulator/service.ts` no longer owns `attachCanonicalArtifactSimulatedDayTotalsByDate()`, `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()`, or `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()`.
- The downstream selected-day `localDate` fallback described here is no longer current; selected-day membership is interval-timestamp-backed only.
- `forcedScoredDateKeys` ownership-widening and canonical merge/backfill are no longer live runtime behavior on the current branch.
- The selected-day compare authority gap described here is no longer current on the working tree; `runSelectedDaysFreshExecution()` now consumes surfaced canonical selected-day totals from `simulatePastSelectedDaysShared()`.
- Exact travel/vacant parity now intentionally treats persisted canonical artifact totals as the saved-artifact authority; decoded intervals remain a legacy restore/backfill input, not a second parity truth source.

Use `docs/FINAL_EXACT_PARITY_AND_SHARED_AUTHORITY_AUDIT.md` for the latest current-branch verdict on parity authority and shared-output alignment.

## Scope

This audit is for the currently checked-out branch/commit only. Older audit docs were not treated as source of truth. The code and docs were re-read directly on this branch.

Primary files/code re-read:
- `modules/usageSimulator/service.ts`
- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `modules/simulatedUsage/engine.ts`
- `modules/simulatedUsage/pastDaySimulator.ts`
- `modules/usageSimulator/metadataWindow.ts`
- `modules/usageSimulator/dataset.ts`
- `modules/usageSimulator/requirements.ts`
- `app/api/admin/tools/gapfill-lab/route.ts`
- `modules/usageSimulator/windowIdentity.ts`
- `.cursor/rules/shared-sim-window-lock.mdc`
- `docs/PROJECT_CONTEXT.md`
- `docs/USAGE_SIMULATION_PLAN.md`
- `docs/PROJECT_PLAN.md`
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`

Requested file status:
- `docs/SHARED_SIM_LOCKDOWN_RULES.md` does not exist on this branch.
- It was not created in this pass because none of the listed docs required it to remain truthful after the updates below.

## Current-Branch Verdict

Current code truth on this branch:

- The fresh shared simulation producer chain is substantially unified.
- Canonical/shared coverage-window ownership is still correct.
- Test/travel scoring does **not** currently change the full-year artifact input hash or `excludedDateKeysFingerprint` ownership scope.
- The repo still does **not** fully satisfy the strict shared-sim invariant end to end because `modules/usageSimulator/service.ts` still reconstructs and backfills canonical simulated-day totals outside the canonical finalized dataset builder.
- One remaining selected-day compare consumer still keeps a fallback `localDate` interpretation after the shared selected-day wrapper was tightened to timestamp-based membership.

## Invariant Being Audited

Non-negotiable rule set:

- same date in
- same prepared dependencies in
- same shared sim calculation chain
- same finalized simulated day out
- only the set of requested dates may differ by caller
- selected-day / travel-day scoring must never change full-year artifact identity or exclusion-scope ownership
- canonical/shared coverage window logic must remain authoritative
- timestamp-to-local-date mapping must stay canonical and consistent

## A) Current Path Audit

### A. Past Sim artifact generation

Entrypoint:
- `getPastSimulatedDatasetForHouse()` in `modules/usageSimulator/service.ts`

Current chain:
- `getPastSimulatedDatasetForHouse()`
- `simulatePastUsageDataset()`
- `loadWeatherForPastWindow()`
- `buildPastSimulatedBaselineV1()`
- `simulatePastDay()`
- incomplete-day blend inside `buildPastSimulatedBaselineV1()`
- `buildCurveFromPatchedIntervals()`
- `buildSimulatedUsageDatasetFromCurve()`

Assessment:
- uses shared sim chain: yes
- wrapper behavior: orchestration only
- finalized outputs from canonical shared dataset path: yes

### B. Scored-day compare fresh sim

Entrypoint:
- `buildGapfillCompareSimShared()` in `modules/usageSimulator/service.ts`

Current chain in selected-days mode:
- `buildGapfillCompareSimShared()`
- `runSelectedDaysFreshExecution()`
- `simulatePastSelectedDaysShared()`
- `simulatePastFullWindowShared()`
- `simulatePastUsageDataset()`
- `loadWeatherForPastWindow()`
- `buildPastSimulatedBaselineV1()`
- `simulatePastDay()`
- incomplete-day blend
- `buildCurveFromPatchedIntervals()`
- `buildSimulatedUsageDatasetFromCurve()`
- post-output interval/result slicing in `simulatePastSelectedDaysShared()`
- post-output ownership/day-total interpretation in `runSelectedDaysFreshExecution()`

Assessment:
- uses shared sim chain: yes
- wrapper behavior:
  - `simulatePastSelectedDaysShared()`: orchestration only on this branch
  - `runSelectedDaysFreshExecution()`: still behavior-changing after canonical outputs exist
- finalized outputs from canonical shared dataset path: not fully; compare still consumes a derived subset/ownership map

### C. Exact travel/vacant parity fresh sim

Entrypoint:
- `buildGapfillCompareSimShared()` in `modules/usageSimulator/service.ts`

Current chain:
- `buildGapfillCompareSimShared()`
- `runFullWindowFreshExecution()`
- `simulatePastFullWindowShared()`
- `simulatePastUsageDataset()`
- `loadWeatherForPastWindow()`
- `buildPastSimulatedBaselineV1()`
- `simulatePastDay()`
- incomplete-day blend
- `buildCurveFromPatchedIntervals()`
- `buildSimulatedUsageDatasetFromCurve()`
- parity-specific day-total reconstruction in service code

Assessment:
- uses shared sim chain: yes
- wrapper behavior: behavior-changing after canonical outputs exist because parity compares interval-derived day totals built in service code
- finalized outputs from canonical shared dataset path: not fully

### D. Artifact rebuild/storage

Entrypoints:
- `persistRebuiltArtifact()` in `modules/usageSimulator/service.ts`
- `rebuildSharedArtifactDataset()` in `modules/usageSimulator/service.ts`

Current chain:
- rebuild calls shared producer chain through `simulatePastUsageDataset()` or `getPastSimulatedDatasetForHouse()`
- shared dataset is copied/persisted
- `attachCanonicalArtifactSimulatedDayTotalsByDate()` still adds a service-owned sidecar total map before storage

Assessment:
- uses shared sim chain: yes
- wrapper behavior: behavior-changing only in the added sidecar day-total authority
- finalized outputs from canonical shared dataset path: mostly yes for `dataset`, not fully for persisted sidecar totals

### E. Artifact restore/reconciliation

Entrypoint:
- `restoreCachedArtifactDataset()` in `modules/usageSimulator/service.ts`

Current chain:
- decode intervals unless lightweight selected-days read is enabled
- `reconcileRestoredDatasetFromDecodedIntervals()`
- `recomputePastAggregatesFromIntervals()` only when canonical fields are missing

Assessment:
- uses shared sim chain: no simulation occurs here
- wrapper behavior:
  - canonical artifacts: orchestration/read restore only
  - legacy incomplete artifacts: behavior-changing backfill still exists
- finalized outputs from canonical shared dataset path: yes for canonical artifacts, legacy backfill only otherwise

### F. Selected-day post-output slicing

Entrypoint:
- `simulatePastSelectedDaysShared()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`

Current chain:
- calls `simulatePastFullWindowShared()`
- receives canonical shared output
- slices intervals by `dateKeyInTimezone()`
- slices `simulatedDayResults` by `simulatedDayResultIntersectsLocalDateKeys()`

Assessment:
- uses shared sim chain: yes
- wrapper behavior: orchestration only
- finalized outputs from canonical shared dataset path: yes

## B) Current Date / Window / Ownership Audit

### Canonical window usage

Current code:
- shared metadata/report coverage window comes from `resolveCanonicalUsage365CoverageWindow()` in `modules/usageSimulator/metadataWindow.ts`
- compare service bounds travel and test keys to `sharedCoverageWindow` from that helper
- artifact verification also checks restored artifact `summary.start/end` and `meta.coverageStart/coverageEnd` against that canonical coverage window

Assessment:
- canonical/shared coverage window logic is still correct
- shared-window ownership source remains authoritative and centralized

### Identity window usage

Current code:
- Past identity window is resolved from `resolveWindowFromBuildInputsForPastIdentity(buildInputs)`
- shared input hash, weather identity, interval fingerprint, rebuild execution, and fresh compare execution all use `identityWindowResolved`

Assessment:
- identity window logic is still correct
- scored-day/travel-day requests do not replace the full artifact identity window

### Travel parity date construction

Current code:
- `boundedTravelDateKeysLocal` = bounded travel/vacant exclusions using `boundDateKeysToCoverageWindow(..., sharedCoverageWindow)`
- `travelVacantParityDateKeysLocal` = bounded travel keys intersected with `chartDateKeysLocal`
- `travelVacantParityDateKeySet` is only a local set wrapper around `travelVacantParityDateKeysLocal` for filtering/parity execution

Assessment:
- parity dates are bounded from canonical travel ownership
- scoring dates do not become new artifact exclusion days

### Requested scoring/parity dates and ownership mutation

Current code:
- `boundedTestDateKeysLocal` is separately bounded to `sharedCoverageWindow`
- `computePastInputHash()` uses `buildTravelRanges` and `identityWindowResolved`, not test dates
- `excludedDateKeysFingerprint` remains travel/vacant-based in shared dataset code

Important caveat:
- `forcedScoredDateKeys` is still active in `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()`
- this does **not** mutate the real artifact input hash or `excludedDateKeysFingerprint`
- it **does** widen compare-side/reference-side simulated-day total ownership when constructing bounded canonical artifact day totals in service code

Assessment:
- full-year artifact identity/exclusion ownership mutation from scoring logic: no
- compare/reference ownership widening outside canonical finalized output path: yes

### Selected-day timestamp-to-local-date mapping

Current code:
- `simulatePastSelectedDaysShared()` uses `dateKeyInTimezone()` for interval slicing
- `simulatedDayResultIntersectsLocalDateKeys()` uses interval timestamps only

Remaining caveat:
- `runSelectedDaysFreshExecution()` in service code still falls back to `row.localDate` if `row.intervals` is absent

Assessment:
- shared selected-day wrapper uses canonical timestamp mapping correctly
- one downstream compare consumer still retains a second date interpretation fallback

### No-travel / no-vacation houses

Current code:
- when `travelVacantParityDateKeysLocal.length === 0`, `travelVacantParityTruth.availability` becomes `not_requested`
- selected-day compare still runs when there are bounded test dates
- parity full-window execution is skipped when `travelVacantParityDateKeySet.size === 0`

Assessment:
- no-travel/no-vacation houses still run Gap-Fill safely on current code

## C) Direct Yes / No Answers

### Does the current code still use any behavior-changing wrapper for sim calculations?

Yes.

Current live examples:
- `runSelectedDaysFreshExecution()` in `modules/usageSimulator/service.ts`
- `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()` in `modules/usageSimulator/service.ts`
- `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()` in `modules/usageSimulator/service.ts`
- `attachCanonicalArtifactSimulatedDayTotalsByDate()` in `modules/usageSimulator/service.ts`
- exact parity day-total helpers in `modules/usageSimulator/service.ts`

### Does any current code path allow scoring logic to change artifact identity or exclusion ownership?

No for the real artifact identity/fingerprint and exclusion ownership.

Why:
- `computePastInputHash()` still keys off `identityWindowResolved` and `buildTravelRanges`
- `excludedDateKeysFingerprint` remains bounded travel/vacant ownership from shared dataset code

Important caveat:
- compare-side canonical day-total construction can still widen reference ownership for scored dates after canonical output exists
- that is a strict shared-output violation, but not an artifact hash / exclusion-scope mutation

### Is `forcedScoredDateKeys` still an active ownership-changing mechanism in the current code, or only legacy/stale text?

It is still active in current code.

Current location:
- `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()` in `modules/usageSimulator/service.ts`

Current role:
- active compare/reference ownership widening helper
- not active artifact identity / excluded-date fingerprint mutation

### Is the canonical window/date logic still correct after the recent changes?

Yes.

Current code references:
- `resolveCanonicalUsage365CoverageWindow()` in `modules/usageSimulator/metadataWindow.ts`
- `boundDateKeysToCoverageWindow()` in `modules/usageSimulator/metadataWindow.ts`
- `resolveWindowFromBuildInputsForPastIdentity()` in `modules/usageSimulator/windowIdentity.ts`
- compare path in `buildGapfillCompareSimShared()`

### Are the current docs accurate about shared-sim path and date logic?

Not fully.

Docs found stale on this branch:
- `docs/PROJECT_CONTEXT.md`
- `docs/PROJECT_PLAN.md`
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`
- `docs/USAGE_SIMULATION_PLAN.md`

### If not, exactly which docs were stale and what was wrong?

- `docs/PROJECT_CONTEXT.md`
  - said shared-artifact alignment was already true and no current Gap-Fill architecture follow-up was needed
  - current branch still has service-level post-sim day-total/reference helpers and one downstream `localDate` fallback
- `docs/PROJECT_PLAN.md`
  - treated active architecture alignment as complete
  - did not reflect the current remaining service-level post-sim ownership caveat
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`
  - correctly described the shared producer chain, but did not state the current remaining strict-alignment caveat in `service.ts`
- `docs/USAGE_SIMULATION_PLAN.md`
  - correctly stated the intended rule, but needed a current-branch caveat so readers do not assume strict finalized-output alignment is already complete

## D) Ranked Current Findings

### 1. Real runtime/code violation still present

Highest priority:
- `modules/usageSimulator/service.ts`
- `buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys()`
- `buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset()`
- `attachCanonicalArtifactSimulatedDayTotalsByDate()`
- merge/backfill block around canonical artifact totals in `buildGapfillCompareSimShared()`

Why it matters:
- canonical artifact simulated-day totals are still being constructed/backfilled in service code after canonical shared output exists
- this is the biggest remaining violation of "same finalized simulated day out"

Impact:
- compare drift risk: yes
- timeout/memory risk: yes

### 2. Real runtime/code violation still present

Medium priority:
- `runSelectedDaysFreshExecution()` in `modules/usageSimulator/service.ts`

Why it matters:
- still falls back to `row.localDate` when `row.intervals` is absent
- keeps a second date interpretation rule alive downstream of the shared wrapper

Impact:
- compare drift risk: possible
- timeout/memory risk: low

### 3. Stale / misleading docs only

Current branch stale-doc issue:
- several project docs still say alignment is already complete or imply no remaining architecture follow-up is needed

Impact:
- reader confusion / stale guidance: yes
- runtime impact: no

### 4. Older findings that should now be retired

These older claims are no longer current on this branch:

- `simulatePastSelectedDaysShared()` still changing engine inputs with `forceSimulateDateKeysLocal`
  - retired; current wrapper no longer passes that option
- `simulatePastSelectedDaysShared()` still changing passthrough behavior with `emitAllIntervals: false`
  - retired; current wrapper no longer passes that option
- `simulatePastSelectedDaysShared()` still slicing `simulatedDayResults` by `row.localDate`
  - retired; current wrapper now uses timestamp-based `simulatedDayResultIntersectsLocalDateKeys()`
- `persistRebuiltArtifact()` still rebuilding storage rows through `recomputePastAggregatesFromIntervals()`
  - retired; current code deep-copies canonical dataset and persists that, then attaches sidecar totals
- `reconcileRestoredDatasetFromDecodedIntervals()` overwriting canonical restored outputs
  - retired; current code backfills only missing fields

## E) Doc Sync Performed In This Pass

Docs updated:
- `docs/PROJECT_CONTEXT.md`
- `docs/USAGE_SIMULATION_PLAN.md`
- `docs/PROJECT_PLAN.md`
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`

Update intent:
- retire stale "alignment complete" wording
- add current-branch caveat that fresh producer-chain alignment is mostly true but strict finalized-output alignment is not complete
- keep date/window ownership lock explicit
- clarify that selected-day scoring must not mutate artifact identity or exclusion ownership

## Final Current-Branch Conclusion

Current branch status:

- shared producer-chain alignment: mostly yes
- canonical/shared coverage-window logic: yes
- artifact identity / exclusion ownership lock: yes
- no-travel house safety: yes
- strict finalized-output alignment: no

The current branch's remaining live gap is no longer the shared simulator entry chain itself. It is the service-level post-sim reference/day-total ownership layer plus one remaining downstream `localDate` fallback.
