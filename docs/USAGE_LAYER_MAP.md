# Usage Layer Map

This document defines the canonical interval-series layers and maps current endpoints/functions to those layers.

## Canonical Layers

- `ACTUAL_USAGE_INTERVALS`
- `BASELINE_INTERVALS`
- `PAST_SIM_BASELINE`
- `FUTURE_SIM_BASELINE`
- `FUTURE_SIM_USAGE`

## Current Mapping

### `ACTUAL_USAGE_INTERVALS`

- `GET /api/user/usage`
  - Current meaning: actual usage intervals, source selected by recency (SMT or Green Button).
  - Target layer: `ACTUAL_USAGE_INTERVALS`.

- `POST /api/green-button/upload` (and admin variant)
  - Current meaning: ingests Green Button intervals.
  - Target layer: writes `ACTUAL_USAGE_INTERVALS`.

- `POST /api/internal/smt/ingest-normalize` (and admin normalize/raw-upload/backfill/analysis normalize-smt routes)
  - Current meaning: ingests or normalizes SMT intervals.
  - Target layer: writes `ACTUAL_USAGE_INTERVALS`.

- Repository/functions mapped to this layer:
  - `lib/usage/actualDatasetForHouse.ts`
  - `modules/realUsageAdapter/*`
  - `lib/usage/dualWriteUsageIntervals.ts` (replication from main DB to usage DB mirror)

### `BASELINE_INTERVALS`

Current behavior is overloaded:

- actual-backed baseline (`SMT_BASELINE` / `SMT_ACTUAL_BASELINE`)
- manual baseline
- simulated baseline build

Canonical definition:

- `BASELINE_INTERVALS` is an alias/view layer by default and resolves to `ACTUAL_USAGE_INTERVALS` unless a derived baseline override is explicitly available.
- `BASELINE_INTERVALS` should not be persisted as its own first-class interval-series store.
- Corrected/derived baseline curves must be persisted under derived kinds (for example `PAST_SIM_BASELINE`), not as `BASELINE_INTERVALS`.

Current route with baseline semantics:

- `GET /api/user/usage/simulated/house` with `scenarioId=null`
  - Target layer: `BASELINE_INTERVALS`
  - Note: baseline should resolve through the same underlying actual loader as `/api/user/usage` unless a derived baseline override is explicitly selected.

Current function mapped to this behavior:

- `modules/usageSimulator/service.ts:getSimulatedUsageForHouseScenario()` (`scenarioId=null` branch)

### `PAST_SIM_BASELINE`

- `GET /api/admin/simulation-engines` when scenario is `Past (Corrected)`
  - Target layer: inspect/debug view of `PAST_SIM_BASELINE`.

Persistence status today:

- `/api/user/simulator/recalc` persists `UsageSimulatorBuild` and
  `usagePrisma.HomeSimulatedUsageBucket` for non-baseline scenarios.
- Corrected baseline persistence belongs to this derived layer (`PAST_SIM_BASELINE`) when enabled, not to `BASELINE_INTERVALS`.

### `FUTURE_SIM_BASELINE`

- Concept exists (past overlays applied to future starting curve).
- Not yet persisted as a first-class interval layer.

### `FUTURE_SIM_USAGE`

- Concept exists (future baseline plus future upgrades/additions).
- Currently represented as scenario builds/buckets, not a named persisted interval layer.

## Keep / Deprecate (No code changes)

### Keep (Phase 1 public)

- `/api/user/usage` (actual)
- `/api/user/usage/simulated/house` (baseline + scenarios), with future requirement to explicitly declare layer

### Ops/Admin only (must remain gated)

- `/api/admin/simulation-engines` (remove side-effectful recalc from `GET` later)
- SMT normalize/backfill/admin analysis routes (do not expose as client contracts)

### Deprecate eventually

- `/api/user/usage/simulated` (all-houses baseline aggregate), because it becomes ambiguous with five persisted layers

## Actionable Standardization Step

- Keep this map as the shared contract reference.
- Use a single enum for interval layer kinds in code (`modules/usageSimulator/kinds.ts`).
