# Gap-Fill Admin Stabilization Audit (Post Step B)

## 1) Executive Summary

- **Confirmed stable:** Canonical Gap-Fill admin orchestration is now staged and ordered as `lookup_inputs -> usage365_load -> artifact_ensure -> compare_core -> compare_heavy_manifest -> compare_heavy_parity -> compare_heavy_scored_days`.
- **Confirmed stable:** Snapshot-reader route actions are read-only over persisted compare snapshot state keyed by `compareRunId`; they gate on missing/unknown/failed/not-ready run states and do not invoke fresh shared compare compute.
- **Confirmed stable:** Client-side in-flight guards (`compareInFlightRef`, `rebuildInFlightRef`) prevent overlapping Run Compare / Retry / Rebuild starts in normal user interaction.
- **Likely cleanup opportunity (low risk):** Last Attempt Debug payload capture for snapshot readers is single-slot (`snapshotReaderAction` + one request/response), so earlier reader stage payloads are overwritten by later stages.
- **Likely cleanup opportunity (low risk):** Reader-stage error classification still uses legacy `compare_heavy_*` naming in helper outputs; behavior is correct, but labels are slightly ambiguous in post-Step-B debugging.
- **No-action-needed area:** `heavy_only_compact` compatibility remains reachable at route level but is no longer used by canonical admin flow.
- **No-action-needed area:** No `useEffect`-driven fetch orchestration is present for staged compare flow, reducing rerender-driven duplicate call risk.
- **Recommended next code step:** **narrow admin dedupe/stabilization pass** (debug payload clarity + naming cleanup only), not architecture changes.

## 2) Files Inspected

- `app/admin/tools/gapfill-lab/GapFillLabClient.tsx`
- `app/api/admin/tools/gapfill-lab/route.ts`
- `modules/usageSimulator/compareRunSnapshot.ts`
- `tests/usage/gapfillLab.route.artifactOnly.test.ts`
- `docs/CHAT_BOOTSTRAP.txt`
- `docs/PROJECT_CONTEXT.md`
- `docs/PROJECT_PLAN.md`
- `docs/GAPFILL_COMPARE_SNAPSHOT_PLAN.md`

## 3) Current Admin Flow Truth

- **Canonical staged sequence (confirmed in code):**
  - `lookup_inputs`
  - `usage365_load`
  - `artifact_ensure`
  - `compare_core`
  - `compare_heavy_manifest`
  - `compare_heavy_parity`
  - `compare_heavy_scored_days`
- **Initiation point:** `handleRunCompare()` in `GapFillLabClient` starts the full sequence and drives phase timing/status.
- **compareRunId handoff (confirmed):**
  - `compare_core` response is consumed via `syncCompareRunState()`.
  - `coreCompareRunId` is used to build reader-stage requests (`action` + `compareRunId`).
- **Retry wiring (confirmed):**
  - `handleRetryHeavyDiagnostics()` now replays staged snapshot readers only.
  - Retry body contains compare snapshot identity (`compareRunId` plus identity context fields sent by client body).
- **Route reader truth (confirmed):**
  - `route.ts` handles `action` values `compare_heavy_manifest` / `compare_heavy_parity` / `compare_heavy_scored_days`.
  - Reader branch exits before shared compare execution path.

## 4) Duplicate-Work Risk Review

### `lookup_inputs`
- **Initial trigger path:** `handleRunCompare()` stage 1.
- **Duplicate-fire risk:** **low risk** (manual user repeat clicks blocked by in-flight guards; explicit rerun by user still possible/intended).
- **Retry-overlap risk:** **safe** (retry path does not run this stage).
- **Status:** **safe**.

### `usage365_load`
- **Initial trigger path:** `handleRunCompare()` stage 2.
- **Duplicate-fire risk:** **low risk** (same as above; no effect-driven retrigger).
- **Retry-overlap risk:** **safe**.
- **Status:** **safe**.

### `artifact_ensure`
- **Initial trigger path:** `handleRunCompare()` stage 3 (`rebuildArtifact: true`, `rebuildOnly: true`).
- **Duplicate-fire risk:** **low risk** (only reruns on explicit user rerun/rebuild action).
- **Retry-overlap risk:** **safe** (snapshot retry path does not call `artifact_ensure`).
- **Status:** **safe**.

### `compare_core`
- **Initial trigger path:** `handleRunCompare()` stage 4.
- **Duplicate-fire risk:** **low risk** (single pipeline call guarded by in-flight refs; no useEffect retrigger path).
- **Retry-overlap risk:** **safe** (snapshot retry does not call `compare_core`).
- **Status:** **safe**.

### `compare_heavy_manifest`
- **Initial trigger path:** `handleRunCompare()` stage 5 (via `runReaderStage()`).
- **Duplicate-fire risk:** **low risk** (single sequential await chain; can rerun only by explicit retry/user rerun).
- **Retry-overlap risk:** **safe** (retry entry blocked when in-flight).
- **Status:** **safe**.

### `compare_heavy_parity`
- **Initial trigger path:** `handleRunCompare()` stage 6.
- **Duplicate-fire risk:** **low risk**.
- **Retry-overlap risk:** **safe**.
- **Status:** **safe**.

### `compare_heavy_scored_days`
- **Initial trigger path:** `handleRunCompare()` stage 7.
- **Duplicate-fire risk:** **low risk**.
- **Retry-overlap risk:** **safe**.
- **Status:** **safe**.

### compareRunId state handling
- **Confirmed stable:** reset on new run/house/lookup/rebuild start; repopulated from API via `syncCompareRunState()`.
- **Possible but not proven issue:** some `setLastAttemptDebug(...)` fields can use closure-time `compareRunId`/status values while state updates are async; mostly debug cosmetic, not flow-breaking.
- **Status:** **low risk**.

## 5) Legacy `compare_heavy` Review

- **Normal UI reachability (confirmed):** canonical admin flow does not post legacy heavy recompute requests anymore.
- **Retry reachability (confirmed):** retry path now posts only staged snapshot-reader actions.
- **Compatibility reachability (confirmed):** route still supports `responseMode: "heavy_only_compact"` behavior when requested; this is a compatibility path.
- **Masking risk (possible, not proven in canonical flow):** `mergeSuccessfulResult()` still contains `heavy_only_compact` merge branch. This does not affect canonical staged flow but can affect non-canonical/manual usage.
- **Recommendation timing:** legacy cleanup/deprecation can be deferred; not required for current canonical stability.

## 6) Debug/Timeline Clarity Review

- **Already clear (confirmed):**
  - Orchestrator timeline has explicit stages for manifest/parity/scored-days.
  - Error/failure summary distinguishes core failure vs snapshot-reader-stage failure.
  - Last Attempt Debug includes phase markers for reader stages (`*_done`, `*_error`, retry phases).
- **Ambiguous (confirmed):**
  - Step Request/Response Payloads for snapshot readers are keyed by a single `snapshotReaderAction` field, so only the most recent reader stage payload is shown at a time.
  - Heavy reader error classifier naming remains `compare_heavy_*`, while behavior is snapshot-reader scoped.
- **Worth small cleanup:** yes, but low-priority stabilization polish only.

## 7) Test Coverage Review

- **Covered (confirmed in `gapfillLab.route.artifactOnly.test.ts`):**
  - Reader route actions exist and return snapshot-backed responses.
  - Missing/unknown/not-ready/failed `compareRunId` reader states are tested.
  - Reader actions are asserted not to use shared compare compute paths in route tests.
  - Client source assertions confirm staged reader sequence references and non-canonical `heavy_only_compact` usage pattern.
- **Missing (confirmed):**
  - No direct runtime tests for client no-double-fire behavior (in-flight overlap protections) beyond source-string assertions.
  - No explicit UI-level test proving all three reader payloads are retained simultaneously in debug payload views.
- **Optional additions:**
  - Narrow client test(s) around in-flight guard behavior and retry overlap prevention.
  - Narrow test for debug payload retention semantics (if multi-stage payload history is desired).

## 8) Recommended Next Step

**Pick:** `narrow admin dedupe/stabilization pass`.

**Why this one:**
- Architecture replacement is already in place and stable in canonical flow.
- Remaining items are small correctness/operability polish:
  - preserve per-reader request/response payload history in Last Attempt Debug,
  - optionally rename reader error classification labels for clarity,
  - optionally add narrow tests for overlap/no-double-fire and debug-stage retention.
- No evidence in this audit requires reopening sim-core, artifact identity, weather ownership, or route compute architecture.
