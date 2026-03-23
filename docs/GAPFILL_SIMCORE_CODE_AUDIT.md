# GAPFILL Sim-Core Code Audit

## 1) Executive Summary

- **Confirmed current code truth:** Past Sim and Gap-Fill compare both run through shared service/simulator modules (`buildGapfillCompareSimShared`, `simulatePast*Shared`, `loadWeatherForPastWindow`) rather than separate route-level simulation math.
- **Confirmed current code truth:** Shared weather ownership is centralized in `loadWeatherForPastWindow`; it reuses persisted non-stub `ACTUAL_LAST_YEAR` weather when full canonical coverage exists, and only backfills/repairs missing or `STUB_V1` dates.
- **Confirmed current code truth:** Exact artifact identity lock is enforced end-to-end in service/route contract fields (`requestedInputHash`, `artifactScenarioId`, `requireExactArtifactMatch`, `artifactIdentitySource`) with explicit early failures.
- **Confirmed current code truth:** Compare Heavy Report is client-staged (`compare_heavy`) but still executes through the same monolithic route and can rerun expensive full-window shared compare work.
- **Unclear/partial area:** Some runtime behavior depends on toggles/combinations; current implementation is clear for default staged flow, but not all edge combinations are deeply covered by route-level integration tests.
- **Unclear/partial area:** There is no durable compare snapshot layer in runtime code today, so no snapshot-source telemetry can be validated.
- **Doc misalignment risk:** `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md` states implemented weather-loader wiring using unconditional backfill wording that no longer matches current short-circuit reuse behavior.
- **Doc misalignment risk:** Multiple docs describe desired “heavy merge-only compact behavior” accurately, but none capture that heavy still reruns shared compare execution in the same route.
- **Doc misalignment risk:** Target architecture concepts (`compareRunId`, staged `compare_heavy_manifest/parity/scored_days`) are not implemented in runtime code yet; leaving this implicit can cause assumption drift.
- **Recommended next runtime step:** Implement durable compare snapshot persistence keyed by `compareRunId` in `compare_core`, then make heavy follow-ups read-only against that snapshot.

## 2) Files Inspected

### Runtime
- `modules/usageSimulator/service.ts`
- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `app/api/admin/tools/gapfill-lab/route.ts`
- `modules/weather/identity.ts`
- `modules/weather/backfill.ts`
- `modules/weather/repo.ts`

### Admin UI
- `app/admin/tools/gapfill-lab/GapFillLabClient.tsx`
- `app/admin/tools/gapfill-lab/page.tsx`

### Tests
- `tests/usageSimulator/service.artifactOnly.test.ts`
- `tests/usage/gapfillLab.route.artifactOnly.test.ts`
- `tests/simulatedUsage/loadWeatherForPastWindow.test.ts`

### Docs
- `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`
- `docs/PROJECT_PLAN.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/USAGE_SIMULATION_PLAN.md`
- `docs/ADMIN_TOOLS_EXTENSION_PLAN.md`
- `docs/CHAT_BOOTSTRAP.txt`

### Search-target runtime/admin files found by string audit
- `app/admin/tools/gapfill-lab/GapFillLabClient.tsx` (contains `Gap-Fill Lab`, `Compare Heavy Report`, `Last Attempt Debug`, `lookup_inputs`, `artifact_ensure`, `compare_core`, `compare_heavy`)
- `app/api/admin/tools/gapfill-lab/route.ts` (contains `artifact_ensure`, `compare_core`, `responseMode: "heavy_only_compact"`, `artifactIdentitySource`, `requireExactArtifactMatch`, `requestedInputHash`, `artifactScenarioId`)
- `modules/usageSimulator/service.ts` (contains `compareFreshMode`, identity fields and exact-match enforcement)
- `modules/simulatedUsage/simulatePastUsageDataset.ts` (contains `loadWeatherForPastWindow`, `ACTUAL_LAST_YEAR`, `STUB_V1` via `WEATHER_STUB_SOURCE`)

### Search targets not found in runtime code
- `compare_heavy_manifest`
- `compare_heavy_parity`
- `compare_heavy_scored_days`
- `compareRunId`

## 3) Confirmed Current Code Truth

### Shared sim-core / artifact identity

**Confirmed**
- `buildGapfillCompareSimShared` in `modules/usageSimulator/service.ts` is the shared compare core and owns artifact lookup/rebuild decisions, parity metadata, and compare mode execution.
- `route.ts` delegates compare execution to `buildGapfillCompareSimShared` and passes identity inputs (`requestedInputHash`, `artifactScenarioId`, `requireExactArtifactMatch`, `artifactIdentitySource`).
- Service enforces exact handoff invariants for `same_run_artifact_ensure`; unresolved exact handoff returns `artifact_exact_identity_unresolved` with `reasonCode: ARTIFACT_ENSURE_EXACT_HANDOFF_FAILED`.
- Travel/vacant ownership is preserved as shared artifact ownership scope (`excludedDateKeysFingerprint`, `excludedDateKeysCount` from bounded travel keys) and test days are not artifact ownership keys.
- For exact travel parity, selected-days lightweight artifact read is explicitly disabled to preserve full-year artifact identity ownership.

**Partial / inferred**
- Some identity behavior is split across route and service checks; route correctly forwards/validates request truth, while service remains the final invariant owner.

**Not found**
- No separate compare artifact identity system outside shared service path.
- No route-level fingerprint builder that replaces service identity logic.

### Shared weather ownership

**Confirmed**
- `loadWeatherForPastWindow` in `modules/simulatedUsage/simulatePastUsageDataset.ts` is the shared weather loader used by shared simulation paths.
- Loader first reads persisted `ACTUAL_LAST_YEAR` + `NORMAL_AVG` rows with `getHouseWeatherDays`.
- If canonical window is fully covered by non-stub actual rows, loader returns early and skips backfill/stub operations.
- If coverage is missing or stubbed, loader runs `ensureHouseWeatherBackfill`, fills residual gaps via `ensureHouseWeatherStubbed`, and re-reads weather.
- `summarizePastWindowWeatherProvenance` preserves truthful weather provenance categories: `actual_only`, `mixed_actual_and_stub`, `stub_only`, plus counts and fallback reason.
- Weather identity hashing for artifact identity is separate and explicit in `computePastWeatherIdentity` (`modules/weather/identity.ts`) using persisted weather rows.

**Partial / inferred**
- Gap-Fill selected-days compare path attaches compact scored-day weather via both fresh full-window results and selected-days weather lookup; exact per-toggle path depends on compare mode.

**Not found**
- No route-only reconstruction path for scored-day weather in `route.ts`; route asserts/uses shared/service weather outputs.

### Gap-Fill compare execution flow

**Confirmed**
- UI orchestrator in `GapFillLabClient.tsx` runs sequential phases: `lookup_inputs -> usage365_load -> artifact_ensure -> compare_core -> compare_heavy`.
- `compare_core` and `compare_heavy` both call the same API route (`/api/admin/tools/gapfill-lab`) with different request flags.
- Route derives `compareFreshMode` as `selected_days` unless diagnostics/full report are requested; diagnostics/full report force `full_window`.
- Route `responseMode: "heavy_only_compact"` changes output shape for heavy response but still executes the same compare route pipeline.
- Route uses timeout wrappers for rebuild and compare phases (`withTimeout` around rebuild/shared compare and full-report generation), returning explicit timeout reason codes.

**Partial / inferred**
- “Heavy-only compact” avoids re-serializing full core payload but does not inherently avoid re-executing shared compare computations.

**Not found**
- No separate runtime endpoints for `compare_heavy_manifest`, `compare_heavy_parity`, `compare_heavy_scored_days`.
- No runtime `compareRunId`.

### Admin orchestration behavior

**Confirmed**
- `compareInFlightRef` and `rebuildInFlightRef` prevent overlapping compare/rebuild actions from primary compare/retry/rebuild buttons.
- Heavy retry (`handleRetryHeavyDiagnostics`) reuses stored heavy request body and reissues heavy call only.
- Manual rebuild retry (`handleRebuildAndRetry`) runs `rebuildOnly` and intentionally does not auto-run compare.
- “Last Attempt Debug” captures phase/request/response context and timeline updates.

**Partial / inferred**
- Separate lookup/usage button actions are not globally deduped against all other operations; they are independent controls and can add additional requests.

**Not found**
- No single-flight dedupe keyed by request identity across separate user actions.
- No compare snapshot handoff in UI state (`compareRunId` not present).

### Existing persistence / compare snapshot behavior

**Confirmed**
- Shared Past artifacts are persisted/read via existing cache paths (`PastSimulatedDatasetCache` flow in service/past cache helpers).
- Exact artifact identity metadata is carried through model assumptions and route truth envelopes.

**Partial / inferred**
- Heavy-only compact response contains `heavyTruth` summary fields useful for merge, but this is response shaping, not persisted compare snapshot state.

**Not found**
- No durable compare snapshot persistence keyed by compare execution.
- No `compareRunId`.
- No `snapshotSource` telemetry field in Gap-Fill route.

## 4) Doc-to-Code Alignment Review

### `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md`

**Matches code**
- Shared core call chain and single shared module ownership framing.
- Gap-Fill as scoring/reporting-only and shared-path parity architecture.

**Ahead of code but acceptable as target architecture**
- Remaining verification checklist entries are framed as open checks, not claimed complete.

**Conflicts with code and should be corrected**
- “Implemented wiring” line for `loadWeatherForPastWindow` describes unconditional backfill/stub path; current code now short-circuits when full non-stub actual coverage already exists.

**Missing from doc but already true in code**
- Explicit fast-path behavior: no backfill and no lat/lng lookup when persisted non-stub coverage is complete.

### `docs/PROJECT_PLAN.md`

**Matches code**
- Shared artifact ownership rules, selected-days default vs full-window heavy proof mode.
- Shared weather ownership/reuse/provenance assertions now align with runtime behavior.

**Ahead of code but acceptable as target architecture**
- None significant in inspected section.

**Conflicts with code and should be corrected**
- None found in inspected shared Gap-Fill sections.

**Missing from doc but already true in code**
- Heavy compact response still recomputes compare pipeline in same route (doc does not currently spell this out).

### `docs/PROJECT_CONTEXT.md`

**Matches code**
- Shared weather ownership (`loadWeatherForPastWindow` reuse/repair rule).
- Exact artifact identity requirements for same-run artifact ensure.
- Selected-days lightweight core and heavy diagnostics as explicit mode split.

**Ahead of code but acceptable as target architecture**
- None significant in inspected section.

**Conflicts with code and should be corrected**
- None found in inspected shared Gap-Fill sections.

**Missing from doc but already true in code**
- Heavy-only compact is response shaping over same route execution, not staged snapshot readers.

### `docs/USAGE_SIMULATION_PLAN.md`

**Matches code**
- Gap-Fill shared scoring rule and selected-days/full-window mode framing.

**Ahead of code but acceptable as target architecture**
- None significant in inspected section.

**Conflicts with code and should be corrected**
- None found.

**Missing from doc but already true in code**
- Explicit shared weather reuse/provenance details (`ACTUAL_LAST_YEAR` reuse + `STUB_V1` repair path) are less explicit here than in other docs.

### `docs/ADMIN_TOOLS_EXTENSION_PLAN.md`

**Matches code**
- Additive roadmap framing and “shared module rule” align with current runtime architecture.

**Ahead of code but acceptable as target architecture**
- Proposed admin extensions are future-state and clearly marked “implementation not started.”

**Conflicts with code and should be corrected**
- None found.

**Missing from doc but already true in code**
- Current compare-heavy implementation is client-staged but still monolithic route execution; could be captured explicitly as baseline state.

### `docs/CHAT_BOOTSTRAP.txt`

**Matches code**
- Shared simulation architecture authority, selected-days/default + full-window heavy split.
- Shared weather ownership and reuse/provenance bullets align with current loader behavior.

**Ahead of code but acceptable as target architecture**
- None significant in inspected section.

**Conflicts with code and should be corrected**
- None found.

**Missing from doc but already true in code**
- No mention that heavy compact response still reruns compare build path (not snapshot-backed yet).

## 5) Timeout / Duplicate-Work Audit

### What likely causes the live compare-heavy stall now?
- Heavy step requests (`includeDiagnostics=true`, `includeFullReportText=true`) force `compareFreshMode=full_window` in route and trigger full-window shared compare work again.
- Heavy step is executed as a separate request after core in staged UI flow, so expensive shared compare work can run twice in one user operation (core + heavy).
- Heavy report build also has its own timeout window and can fail after shared compare compute has already occurred.

### What work is duplicated today?
- Shared compare execution can duplicate between `compare_core` and `compare_heavy` requests.
- Selected-days core may execute selected-day shared simulation, then heavy executes full-window shared simulation.
- Heavy retries explicitly repeat heavy request execution.
- Separate pre-steps (`lookup_inputs`, `usage365_load`, `artifact_ensure`) add additional calls per run by design.

### What work should be frozen behind `compare_core` only?
- Expensive compare computation artifacts needed by heavy views:
  - resolved artifact identity truth
  - scored-day truth rows and compact weather truth
  - travel/vacant parity result set
  - compare timing/diagnostic primitives
  - full-window derived compare values when requested for heavy use

### What should become snapshot-read-only later?
- Heavy follow-up payload builders (manifest/parity/scored-day weather expansions/report text) should read from persisted compare snapshot by `compareRunId`.
- UI retries for heavy should target snapshot readers only, not rerun shared compare compute.
- Route heavy compact response should become projection/formatting over snapshot state rather than recomputation.

## 6) Recommended Next Runtime Step

Implement **compare snapshot persistence + compareRunId handoff** first.

Narrow step:
1. Extend `compare_core` response contract to include `compareRunId`.
2. Persist a compact compare snapshot at end of successful core build (identity truth, parity/weather truth, required heavy inputs).
3. Keep existing route behavior initially, but add read path guards so follow-up heavy actions can consume snapshot without recomputation.

Why this first:
- No `compareRunId` or snapshot layer exists today.
- Without this prerequisite, staged heavy readers cannot be truly read-only and duplicate-work risk remains.

## 7) Proposed Doc Changes AFTER audit

Do not apply in this step; apply in a follow-up doc update pass:

1. Update `docs/PAST_SHARED_CORE_UNIFICATION_PLAN.md` implemented-wiring bullet for `loadWeatherForPastWindow` to include current non-stub coverage short-circuit behavior.
2. Add a “current heavy behavior” note to `docs/PROJECT_CONTEXT.md` and/or `docs/PROJECT_PLAN.md` clarifying that `heavy_only_compact` is currently response shaping on the same route and can still recompute compare work.
3. Add a “not implemented yet” note in docs where future staged heavy architecture is discussed: `compareRunId`, `compare_heavy_manifest`, `compare_heavy_parity`, `compare_heavy_scored_days` are target-state, not runtime-present.
4. After runtime snapshot implementation, update all three canonical docs (`CHAT_BOOTSTRAP`, `PROJECT_CONTEXT`, `PROJECT_PLAN`) together with:
   - snapshot ownership source
   - compareRunId contract
   - heavy endpoints/read-only behavior
   - no-recompute guarantee language.
