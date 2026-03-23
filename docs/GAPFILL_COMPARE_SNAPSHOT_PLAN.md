# Gap-Fill Compare Snapshot Plan

## Current audited runtime state

- `artifact_ensure` succeeds as an explicit rebuild-only step in the current orchestrator flow.
- `compare_core` succeeds and returns the primary compare truth/report payload.
- Staged heavy snapshot readers now exist in the same route:
  - `compare_heavy_manifest`
  - `compare_heavy_parity`
  - `compare_heavy_scored_days`
- Canonical admin heavy follow-up is now snapshot-read-only over `compareRunId`.
- Legacy `compare_heavy` compatibility can still exist in runtime, but it is no longer the canonical admin heavy path.

## Implemented current state (Step A + Step B)

- A durable DB-backed compare-run model exists: `GapfillCompareRunSnapshot`.
- `compare_core` now creates a compare-run record at execution start and marks compare-run lifecycle status (`started`, `running`, `succeeded`, `failed`).
- `compareRunId` now exists and is handed off by `compare_core`.
- `compare_core` response now includes:
  - `compareRunId`
  - `compareRunStatus`
  - `compareRunSnapshotReady`
- Successful `compare_core` now finalizes a compact compare snapshot on that compare-run record.
- If final compare snapshot persistence fails after core compute, route returns explicit failure instead of claiming success.
- `compare_heavy_manifest`, `compare_heavy_parity`, and `compare_heavy_scored_days` now exist.
- These reader actions require `compareRunId` and read only from persisted compare snapshot state.
- Reader actions do not invoke fresh shared compare compute, artifact ensure, or weather loading/backfill.
- GapFillLabClient canonical admin flow now runs:
  - `lookup_inputs`
  - `usage365_load`
  - `artifact_ensure`
  - `compare_core`
  - `compare_heavy_manifest`
  - `compare_heavy_parity`
  - `compare_heavy_scored_days`
- Canonical heavy retry now retries snapshot readers instead of `compare_heavy` recompute.
- Shared sim-core ownership, shared weather truth ownership, and exact artifact identity enforcement remain unchanged.

## Remaining problem statement

Major architecture replacement is complete through Step B. Remaining work is stabilization/cleanup (for example, optional admin dedupe polish, optional legacy `compare_heavy` deprecation when safe, and optional observability/perf cleanup).

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
  - `compare_heavy_manifest`
  - `compare_heavy_parity`
  - `compare_heavy_scored_days`
- UI must avoid duplicate fetches from rerender/useEffect/state churn.
- Heavy retry buttons must call snapshot-read-only endpoints (not `compare_heavy` recompute).
- UI dedupe must prevent double-submit duplicate work while preserving explicit retry behavior.

## Execution order

### Step A: compare snapshot persistence + `compareRunId` handoff in `compare_core`
- Implemented:
  - compare-run persistence created at `compare_core` start.
  - final compact compare snapshot persisted on successful `compare_core`.
  - `compareRunId`, `compareRunStatus`, and `compareRunSnapshotReady` surfaced in `compare_core` responses.

### Step B: staged heavy snapshot readers
- Implemented:
  - `compare_heavy_manifest`, `compare_heavy_parity`, `compare_heavy_scored_days` added.
  - handlers are read-only over persisted compare snapshot data keyed by `compareRunId`.
  - canonical admin heavy flow now uses reader stages and retries reader stages.
  - canonical heavy follow-up is no longer recompute-based.

### Step C: stabilization follow-up (only if still needed)
- Admin dedupe/cleanup polish if duplicate calls remain under rerender/user-repeat pressure.
- Optional legacy `compare_heavy` deprecation/removal when compatibility risk is low and coverage is sufficient.

### Step D: narrow incremental cleanup (only if still needed)
- Add any missing focused tests for no-recompute guarantees and edge read-state handling.
- Add optional observability/perf cleanup around staged reader timings and diagnostics.

## Explicit remaining stabilization items

The following are remaining optional cleanup items, not architecture gaps:

- additional admin dedupe polish if needed
- optional legacy `compare_heavy` compatibility cleanup/deprecation if safe
- optional observability/perf cleanup
