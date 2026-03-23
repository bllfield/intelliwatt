# Gap-Fill Compare Snapshot Plan

## Current audited runtime state

- `artifact_ensure` succeeds as an explicit rebuild-only step in the current orchestrator flow.
- `compare_core` succeeds and returns the primary compare truth/report payload.
- `compare_heavy` is currently client-staged but still route-monolithic:
  - `compare_core` and `compare_heavy` hit the same route (`/api/admin/tools/gapfill-lab`).
  - `responseMode: "heavy_only_compact"` changes response shaping only.
  - heavy can still rerun expensive full-window shared compare work.
- No durable compare snapshot exists yet in runtime code.
- No `compareRunId` exists yet in runtime code.

## Problem statement

Compare-heavy timeout/duplicate-work risk remains because heavy follow-ups are not snapshot-backed. Even with compact heavy response shaping, the heavy step can recompute shared compare work instead of reading already-produced core truth.

## Non-negotiable rules

- `compare_core` remains the only execution step allowed to perform fresh compare work once snapshot architecture is added.
- Heavy follow-ups must become snapshot-read-only.
- No hidden recompute in heavy follow-up handlers.
- Gap-Fill must not own separate simulation math, artifact identity logic, or weather logic.
- Shared module ownership remains authoritative:
  - shared sim-core/service path
  - shared artifact identity path
  - shared weather truth path

## Target-state API shape

### `compare_core` (execution step)
- Performs fresh compare execution (selected-days or full-window as requested).
- Persists a compact compare snapshot.
- Returns `compareRunId` plus current core response fields.

### `compare_heavy_manifest` (snapshot-read-only)
- Reads snapshot by `compareRunId`.
- Returns heavy-step manifest/status and required references for parity/weather/report reads.

### `compare_heavy_parity` (snapshot-read-only)
- Reads snapshot by `compareRunId`.
- Returns parity-focused diagnostics derived from persisted core snapshot truth.

### `compare_heavy_scored_days` (snapshot-read-only)
- Reads snapshot by `compareRunId`.
- Returns scored-day focused heavy diagnostics, including compact scored-day weather truth expansion.

### Optional narrative/raw endpoint (on demand only)
- Reads snapshot by `compareRunId`.
- Builds larger narrative/report payload only when explicitly requested.

## Snapshot contents

Persist enough snapshot data so heavy readers never rediscover identity or rebuild weather truth:

- `compareRunId` (primary lookup key).
- Exact artifact identity fields:
  - `requestedInputHash`
  - `artifactInputHashUsed`
  - `artifactHashMatch`
  - `artifactScenarioId`
  - `requireExactArtifactMatch`
  - `artifactIdentitySource`
  - exact-identity resolved/fallback truth fields already exposed by core.
- Compare mode truth:
  - `compareFreshModeUsed`
  - compare calculation scope/source fields used in current truth envelopes.
- Selected/scored date set:
  - selected/scored local date list used by compare scoring.
- Compact scored-day references:
  - compact actual/sim references needed by heavy follow-ups.
- Compact scored-day weather truth:
  - scored-day weather rows/truth envelope from shared compare path.
- Parity inputs/results:
  - travel/vacant parity rows/truth and supporting parity metadata already produced by core.
- Timing/request metadata needed for troubleshooting heavy follow-ups without rerunning compare.

## Admin UI contract

- One canonical click sequence remains:
  - lookup inputs
  - usage load
  - artifact ensure
  - compare core
  - heavy follow-ups
- UI must avoid duplicate fetches from rerender/useEffect/state churn.
- Heavy retry buttons must call snapshot-read-only endpoints only after snapshot architecture exists.
- UI dedupe must prevent double-submit duplicate work while preserving explicit retry behavior.

## Execution order

### Step A: compare snapshot persistence + `compareRunId` handoff in `compare_core`
- Add snapshot write at end of successful core compare build.
- Return `compareRunId` in core responses.

### Step B: staged heavy snapshot readers
- Add `compare_heavy_manifest`, `compare_heavy_parity`, `compare_heavy_scored_days`.
- Ensure handlers are read-only over persisted snapshot data.

### Step C: admin dedupe/retry-safe orchestration
- Wire heavy follow-up buttons/steps to snapshot readers.
- Keep one canonical path and explicit retry semantics.

### Step D: narrow tests for snapshot-read-only and no-recompute guarantees
- Add focused tests that prove heavy readers do not rerun `compare_core` logic.
- Add tests for compareRunId handoff and missing/invalid snapshot handling.

## Explicit not implemented yet

The following are target-state and are not present in runtime code today:

- `compareRunId`
- durable compare snapshot persistence
- `compare_heavy_manifest`
- `compare_heavy_parity`
- `compare_heavy_scored_days`
- snapshot-read-only heavy endpoints
