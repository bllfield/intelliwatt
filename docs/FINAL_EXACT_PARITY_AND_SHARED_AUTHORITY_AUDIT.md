# Final Exact Parity And Shared Authority Audit

Audited branch: `main`

Audited commit: `67dfead393e3c3f9154e378b05d9f5e6d02ca794`

Working tree at audit start: `dirty`

Audit-start dirty state:

- Modified: `modules/simulatedUsage/simulatePastUsageDataset.ts`
- Modified: `modules/usageSimulator/service.ts`
- Modified: `tests/simulatedUsage/simulatePastUsageDataset.usageShapeEnsure.test.ts`
- Modified: `tests/usageSimulator/service.artifactOnly.test.ts`
- Modified: `docs/PROJECT_CONTEXT.md`
- Modified: `docs/PROJECT_PLAN.md`
- Modified: `docs/USAGE_SIMULATION_PLAN.md`
- Modified: `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`
- Modified: `docs/CURRENT_BRANCH_SHARED_SIM_AND_DATE_LOGIC_AUDIT.md`
- Untracked: `docs/FINAL_CURRENT_BRANCH_STRICT_SHARED_SIM_AUDIT.md`
- Untracked: `docs/FINAL_CURRENT_BRANCH_STRICT_SHARED_SIM_AND_DOCS_AUDIT.md`

## 1) Exact Invariant

Non-negotiable invariant on this branch:

- same date in
- same prepared dependencies in
- same shared sim calculation chain
- same finalized simulated day out
- exact parity is allowed to compare saved canonical totals vs fresh canonical totals only if saved canonical totals come from the same shared finalized output authority and are protected from stale/non-canonical drift

Interpretation for the current code:

- `simulatePastUsageDataset()` is the one shared producer chain for Past artifact generation and fresh compare/parity simulation.
- `buildSimulatedUsageDatasetFromCurve()` is the current finalized-output authority for canonical simulated-day totals.
- `simulatePastFullWindowShared()` and `simulatePastSelectedDaysShared()` may expose or slice those finalized outputs, but they must not invent a second authority.
- Exact parity is correct only when the saved artifact side and the fresh full-window side are both reading totals produced by that same finalized builder-owned authority.

## 2) Current Exact Parity Authority Path

### A. Where canonical saved artifact day totals are created

Entrypoint:

- `simulatePastUsageDataset()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`

Authority path:

- `simulatePastUsageDataset()` runs `buildPastSimulatedBaselineV1()`
- the patched interval stream is converted by `buildCurveFromPatchedIntervals()`
- finalized dataset output is produced by `buildSimulatedUsageDatasetFromCurve()` in `modules/usageSimulator/dataset.ts`

Current behavior:

- `buildSimulatedUsageDatasetFromCurve()` derives `daily` rows from the finalized interval curve
- simulated-day display ownership comes from `simulatedDayResults`
- canonical artifact day totals are then emitted as `canonicalArtifactSimulatedDayTotalsByDate` on both `dataset.meta` and the dataset top level

Audit verdict:

- uses canonical shared finalized output: yes
- can materially change totals: yes, but this is the intended canonical builder
- classification: canonical

### B. Where canonical saved artifact day totals are persisted

Entrypoint:

- `persistRebuiltArtifact()` in `modules/usageSimulator/service.ts`

Authority path:

- `persistRebuiltArtifact()` calls `simulatePastUsageDataset()`
- it keeps the rebuilt dataset object
- it reads canonical totals via `readCanonicalArtifactSimulatedDayTotalsByDate(rebuiltDataset)`
- it writes those totals back into both `datasetJson.canonicalArtifactSimulatedDayTotalsByDate` and `datasetJson.meta.canonicalArtifactSimulatedDayTotalsByDate`

Current behavior:

- persistence is reading the builder-owned field, not recomputing totals from intervals in service code
- storage does not run a second day-total builder

Audit verdict:

- uses canonical shared finalized output: yes
- can materially change totals: no, beyond copying/sanitizing the existing canonical map
- classification: canonical persistence

### C. Where canonical saved artifact day totals are restored/read

Entrypoint:

- `restoreCachedArtifactDataset()` in `modules/usageSimulator/service.ts`

Authority path:

- restore clones stored `daily`, `monthly`, and dataset metadata from `cached.datasetJson`
- `readCanonicalArtifactSimulatedDayTotalsByDate()` later reads the stored canonical totals directly from that restored dataset

Current behavior:

- `restoreCachedArtifactDataset()` does not recalculate canonical artifact simulated-day totals
- `reconcileRestoredDatasetFromDecodedIntervals()` may backfill missing `daily`, `monthly`, `usageBucketsByMonth`, and some summary/series fields from decoded intervals
- that backfill path does not overwrite `canonicalArtifactSimulatedDayTotalsByDate`

Audit verdict:

- uses canonical shared finalized output: yes for canonical totals
- can materially change totals: not the canonical parity totals; only legacy non-authoritative aggregate rows
- classification: canonical read plus harmless-for-parity legacy backfill

### D. Where parity reads saved canonical totals

Entrypoint:

- `buildGapfillCompareSimShared()` in `modules/usageSimulator/service.ts`

Authority path:

- exact/lightweight compare reads artifact data through `restoreCachedArtifactDataset()`
- saved parity totals come from `readCanonicalArtifactSimulatedDayTotalsByDate()` or `readCanonicalArtifactSimulatedDayTotalsByDateForDateKeys()`
- `travelVacantParityRows` compare `artifactCanonicalSimDayKwh` against fresh shared totals

Current behavior:

- parity does not rebuild artifact truth from decoded intervals
- parity treats the persisted canonical artifact totals as the saved-artifact authority

Audit verdict:

- uses canonical shared finalized output: yes
- can materially change totals: no, aside from rounded read normalization
- classification: canonical parity read

### E. Where fresh canonical full-window totals are created for parity

Entrypoint:

- `runFullWindowFreshExecution()` inside `buildGapfillCompareSimShared()`

Authority path:

- `runFullWindowFreshExecution()` calls `simulatePastFullWindowShared()`
- `simulatePastFullWindowShared()` calls `simulatePastUsageDataset()`
- `simulatePastUsageDataset()` finishes in `buildSimulatedUsageDatasetFromCurve()`
- `simulatePastFullWindowShared()` exposes `canonicalSimulatedDayTotalsByDate`
- parity filters that map down to bounded DB travel/vacant dates before building `freshParityDailyByDate`

Current behavior:

- fresh exact parity totals come from the same finalized builder-owned authority as the saved artifact path

Audit verdict:

- uses canonical shared finalized output: yes
- can materially change totals: no, beyond date-key filtering and rounding
- classification: canonical fresh parity authority

### F. Remaining legacy/decode/backfill paths that can still affect these totals

Relevant code:

- `restoreCachedArtifactDataset()` / `reconcileRestoredDatasetFromDecodedIntervals()` in `modules/usageSimulator/service.ts`
- `sharedPastArtifactMetaFailsCurveShapingStaleGuard()` in `modules/usageSimulator/service.ts`

Current behavior:

- decoded intervals are still used for non-lightweight artifact restore and legacy aggregate backfill
- decoded intervals are no longer the exact parity truth source
- stale-guard enforcement is currently tied to `curveShapingVersion === "shared_curve_v2"`
- missing canonical artifact totals yield `missing_artifact_reference` parity truth; exact-identity-sensitive runs fail instead of silently recomputing parity truth from intervals

Audit verdict:

- uses canonical shared finalized output: no, this is legacy restore/backfill only
- can materially change totals: only non-canonical restored display aggregates
- classification: behavior-changing for legacy aggregate restoration, but not for the canonical parity totals

## 3) Is Removing Interval-Decoding Parity Correct?

### Are saved canonical artifact totals now produced by the shared finalized dataset builder?

Yes.

- `buildSimulatedUsageDatasetFromCurve()` in `modules/usageSimulator/dataset.ts` now emits `canonicalArtifactSimulatedDayTotalsByDate`
- `simulatePastUsageDataset()` always passes `dayResults` into that builder

### Are they preserved in storage without later non-canonical recomputation?

Yes for current persistence and read paths.

- `persistRebuiltArtifact()` copies the builder-owned canonical map into storage
- `readCanonicalArtifactSimulatedDayTotalsByDate*()` later reads that stored map directly
- no service-level day-total rebuild function is reintroduced on the artifact/parity side

### Can restore/reconciliation still overwrite or drift canonical outputs?

Not the canonical parity totals.

- `reconcileRestoredDatasetFromDecodedIntervals()` backfills missing legacy aggregate rows only
- it does not overwrite `canonicalArtifactSimulatedDayTotalsByDate`

### Can stale/legacy artifacts still reach exact parity without rebuild/rejection/backfill safeguards?

Partially yes.

- missing canonical totals are rejected by parity truth as `missing_artifact_reference`
- stale curve-version artifacts are blocked by `sharedPastArtifactMetaFailsCurveShapingStaleGuard()`
- but an already-persisted artifact row with `shared_curve_v2` and incorrect stored canonical totals can still be read and trusted as the saved authority

### Is exact parity now correctly comparing canonical saved artifact totals vs canonical fresh shared totals?

Yes.

- saved side: `readCanonicalArtifactSimulatedDayTotalsByDate*()`
- fresh side: `runFullWindowFreshExecution()` -> `simulatePastFullWindowShared()` -> `canonicalSimulatedDayTotalsByDate`
- comparison: `travelVacantParityRows` / `travelVacantParityTruth`

### Is the old interval-decoding parity path still necessary for correctness, or is its removal now expected?

Its removal is now expected for the canonical architecture.

- decoded-interval parity is no longer required for current-builder artifacts because both sides already have one shared finalized-output authority
- decoded intervals remain useful only for legacy restore/backfill, not as a competing parity truth source
- the remaining caveat is historical-data provenance, not an active need for a second parity calculator

## 4) Full Shared-Sim Alignment Status

### Past Sim artifact generation

- `getPastSimulatedDatasetForHouse()` -> `simulatePastUsageDataset()` -> `buildPastSimulatedBaselineV1()` -> `buildCurveFromPatchedIntervals()` -> `buildSimulatedUsageDatasetFromCurve()`
- shared calculation chain: yes
- finalized output authority: yes

### Scored-day compare fresh sim

- selected-days mode runs `simulatePastSelectedDaysShared()` -> `simulatePastFullWindowShared()` -> `simulatePastUsageDataset()`
- selected-day compare totals now come from surfaced `canonicalSimulatedDayTotalsByDate`, not locally rebuilt `simulatedDayResults` totals
- shared calculation chain: yes
- finalized output authority: yes

### Exact travel/vacant fresh parity proof

- full-window proof runs `runFullWindowFreshExecution()` -> `simulatePastFullWindowShared()` -> `simulatePastUsageDataset()`
- shared calculation chain: yes
- finalized output authority: yes

### Artifact rebuild/storage

- `persistRebuiltArtifact()` persists canonical totals read from the rebuilt shared dataset
- shared calculation chain: yes
- finalized output authority: yes

### Artifact restore/reconciliation

- restore preserves stored canonical totals and only backfills missing legacy aggregates
- shared calculation chain: n/a for restore
- finalized output authority for parity totals: yes
- narrow caveat: legacy aggregate backfill still exists for incomplete historical artifacts

### Selected-days wrapper slicing

- `simulatePastSelectedDaysShared()` slices full-window shared intervals, day results, and canonical totals by timestamp/local-date selection
- shared calculation chain: yes
- finalized output authority: yes

### Selected-day compare authority consumption

- `runSelectedDaysFreshExecution()` now consumes the surfaced canonical selected-day map and uses it to scope selected-day ownership
- shared calculation chain: yes
- finalized output authority: yes

Overall status:

- one shared sim calculation chain: yes
- one shared finalized output authority for active compare/parity paths: yes
- remaining narrow caveat: legacy restore/backfill still repairs missing display aggregates for incomplete historical artifacts, but exact parity no longer uses that path as truth

## 5) Date / Window / Ownership Audit

- `canonicalWindow` remains report/display coverage input in `buildGapfillCompareSimShared()` and the route layer
- `identityWindowResolved` still drives artifact identity, artifact rebuild, and fresh shared simulation windows
- `travelVacantParityDateKeysLocal` are still bounded from build-input travel ranges through `resolveCanonicalUsage365CoverageWindow()` and intersected with the requested chart window
- no active `forcedScoredDateKeys` runtime use was found; only stale historical audit text remains
- selected-day slicing still uses `dateKeyInTimezone()` plus `simulatedDayResultIntersectsLocalDateKeys()` for one timestamp-to-local-date rule
- no-travel / no-vacation houses still run safely because parity initializes to `not_requested` when bounded DB travel/vacant dates are absent
- no ownership-changing scoring behavior was found; scored/test dates do not mutate artifact hash or exclusion ownership

## 6) Direct Yes / No Answers

### Is the removal of interval-decoding parity now correct/expected on this branch?

Yes, for the current shared authority design.

### Are saved canonical totals now the real parity authority?

Yes.

### Is there any remaining path where stale/non-canonical stored metadata can cause false parity mismatches?

Yes, narrowly for historical artifact rows that already store incorrect canonical totals yet still pass current coarse guards such as `curveShapingVersion`.

### Are all sim-day calculations truly using one shared simulation calculation path now?

Yes.

### Are all finalized simulated outputs truly using one shared authority now?

Yes for active artifact generation, selected-day compare, and exact parity.

### Is date logic still correct?

Yes.

### Does any ownership-changing scoring behavior still exist?

No.

## 7) Ranked Remaining Issues

### 1. Historical artifact canonical-total provenance is still only coarsely guarded

- Exact file/function: `modules/usageSimulator/service.ts` -> `readCanonicalArtifactSimulatedDayTotalsByDate*()` plus `sharedPastArtifactMetaFailsCurveShapingStaleGuard()`
- Why it matters: exact parity intentionally trusts stored canonical totals; if an older stored row already contains wrong canonical totals under an otherwise accepted artifact record, parity can report mismatch until rebuild
- Material output risk: yes, but limited to legacy/historical persisted rows
- Classification: narrow legacy/runtime caveat

### 2. Legacy restore backfill still owns non-canonical aggregate repair

- Exact file/function: `modules/usageSimulator/service.ts` -> `reconcileRestoredDatasetFromDecodedIntervals()`
- Why it matters: restored artifacts missing `daily`/`monthly`/series rows still get behavior-changing aggregate repair outside the shared builder
- Material output risk: yes for legacy display/read aggregates, not for canonical parity totals
- Classification: narrow legacy backfill caveat

### 3. Multiple docs still described the now-retired selected-day compare gap or old parity-trust assumptions

- Exact files: `docs/PROJECT_CONTEXT.md`, `docs/PROJECT_PLAN.md`, `docs/USAGE_SIMULATION_PLAN.md`, `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`, and older audit docs
- Why it matters: they still described a no-longer-current selected-day authority split or older audit state as present truth
- Material output risk: none at runtime
- Classification: docs-only drift

## 8) Docs Truth Sync For This Pass

This pass updates the listed docs narrowly to reflect the current code:

- the selected-day compare authority gap is retired on the current working tree
- exact parity authority is the saved canonical artifact totals vs fresh canonical full-window totals
- decoded intervals are no longer the parity truth path
- the remaining real caveat is historical artifact provenance / legacy backfill, not active shared-sim divergence

## 9) Final Verdict

- Removing interval-decoding parity is correct and expected for the current shared-authority architecture.
- Saved canonical artifact totals are now the intended parity authority because they originate in `buildSimulatedUsageDatasetFromCurve()` and are persisted/read without later parity-side recomputation.
- Active Past Sim, selected-day compare, and exact parity calculations are now on one shared calculation path and one finalized-output authority.
- The remaining caveat is historical: exact parity will intentionally trust stored canonical totals, so an older artifact row with incorrect saved canonical totals can still produce mismatch until rebuild, and legacy restore backfill still repairs missing display aggregates outside the builder.
