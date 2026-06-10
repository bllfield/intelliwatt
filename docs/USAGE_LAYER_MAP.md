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

- `POST /api/green-button/upload` (and Droplet `green-button-upload-server`)
  - **Ingest only:** `runGreenButtonUsagePipeline` → writes repaired/normalized rows to `GreenButtonInterval`.
  - Target layer: writes `ACTUAL_USAGE_INTERVALS` (persisted truth — see `docs/USAGE_INTERVAL_SOURCE_OF_TRUTH.md`).
  - Shifted Green Button actuals remain part of this actual layer. When prior-year data is shifted into a target coverage window, trusted shifted source days (90 intervals, DST-bounded by `expectedIntervalsForDateISO()`) stay actual-backed, preserve `sourceDateByTargetDate`, disclose source-day weather use, and must not be reclassified by simulation as `SIMULATED_INCOMPLETE_METER` unless the shifted source day is below the trusted threshold.

- `POST /api/internal/smt/ingest-normalize` (and admin normalize/raw-upload/backfill/analysis normalize-smt routes)
  - Current meaning: ingests or normalizes SMT intervals.
  - Target layer: writes `ACTUAL_USAGE_INTERVALS`.

- Repository/functions mapped to this layer:
  - **Read (GB):** `lib/usage/loadPersistedGreenButtonIntervals.ts` + `lib/usage/greenButtonIntervalReadiness.ts` via `lib/usage/actualDatasetForHouse.ts`
  - **Read (SMT):** `lib/usage/actualDatasetForHouse.ts` → `convertSmtPersistedRowsToHome`
  - **Ingest (GB):** `lib/usage/greenButtonUsagePipeline.ts` only
  - **Ingest (SMT):** `lib/usage/normalizeSmtIntervals.ts` (+ admin ingest routes)
  - `modules/realUsageAdapter/greenButton.ts` — year-shift/trusted-pool on ingest-trusted DB rows only (not second normalize)
  - `lib/usage/dualWriteUsageIntervals.ts` (SMT replication to usage DB mirror)

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

**Validation holdout (PC-2026-10):** Production Past recalc wires `validationHoldoutDateKeysLocal` from `buildInputs.validationOnlyDateKeysLocal` into shared `simulatePastUsageDataset` / `buildPastSimulatedBaselineV1`. Display stitch flips validation days to ACTUAL (`projectBaselineFromCanonicalDataset`); compare sidecar uses holdout sim totals (`validationCanonicalSimulatedDayTotalsByDateLocal`, `meta.validationHoldoutProof`). Owners: `lib/usage/pastValidationHoldout.ts`, `modules/usageSimulator/service.ts`. Contract: `docs/PAST_VALIDATION_HOLDOUT.md`.

**Global compare-day selection (MG-2):** Which dates populate `buildInputs.validationOnlyDateKeysLocal` before holdout wiring. Owner: `lib/usage/validationDayPolicy.ts` → `selectValidationDayKeys`; admin control: `/admin/tools/validation-day-policy`; persist: FeatureFlag `validation_day_policy.v1`. Guardrails: canonical 365-day window (`boundDateKeysToCoverageWindow`), travel exclusion, email-based admin preview. Contract: `docs/GLOBAL_COMPARE_DAY_POLICY.md`.

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

## SMT interval coverage (shipped — PC-2026-05)

**Record:** `docs/SMT_UNIFICATION_COMPLETE.md` · **Permanent rules:** `.cursor/rules/smt-unification-lock.mdc`

| Concern | Owner |
|---------|--------|
| Canonical 365-day window (lag 2 Chicago) | `lib/usage/canonicalCoverageConfig.ts` + `lib/usage/canonicalMetadataWindow.ts` |
| Chicago date key + 15-min slot index | `lib/time/chicago.ts` |
| Per-day complete / missing in window | `lib/usage/smtWindowStatus.ts` (96/96 strict) |
| User-facing SMT backfill eligibility | `lib/usage/smtBackfillEligibility.ts` (`isUserFacingSmtBackfillAllowed`, `isSmtBackfillBlockedForGreenButtonHome`) |
| Pull, backfill, wait, session throttle | `lib/usage/ensureSmtCoverage.ts` |
| Targeted incomplete-day backfill | `lib/usage/smtIncompleteMeterBackfill.ts` (called only from ensure) |
| Ledger labels | `lib/usage/smtDayCoverageLedger.ts` |
| Persisted intervals read | `lib/usage/actualDatasetForHouse.ts`, `resolveIntervalsLayer` |

**Rules (ongoing):**

- **Green Button** (`modules/realUsageAdapter/greenButton.ts`) is **not** part of SMT coverage fixes; GB keeps its own looser/trusted-day rules.
- **User-facing SMT orchestration (PC-2026-12):** pull/heal/refresh only when `isUserFacingSmtBackfillAllowed` — stored or legacy-inferred **SMT** homes. Green Button and manual/uncommitted homes no-op at refresh, user-facing ensure profiles, and upstream seed. One Path admin **`admin_sim`** bypass unchanged.
- **One Path** may **trigger** `ensureSmtCoverage` only; no parallel SMT pull/backfill/wait in `one-path-sim/route.ts`.
- **Usage dashboard** displays partial SMT days; **Past Sim** (INTERVAL) does not trust days with fewer than 96 Chicago slots.
- `/api/user/smt/orchestrate` and `/api/user/usage/status` delegate to `smtWindowStatus` + `ensureSmtCoverage` — do not add a second completeness derivation.

## Usage interval source of truth (shipped — PC-2026-08)

**Record:** `docs/USAGE_INTERVAL_SOURCE_OF_TRUTH.md` · **Lock:** `.cursor/rules/usage-interval-ingest-lock.mdc`

| Source | Ingest owner | Persisted table | Read owner |
|--------|--------------|-----------------|------------|
| Green Button | `runGreenButtonUsagePipeline` | `GreenButtonInterval` | `loadPersistedGreenButtonIntervals` + `convertGreenButtonPersistedRowsToHome` |
| SMT | `normalizeSmtIntervals` / admin routes | `SmtInterval` | `convertSmtPersistedRowsToHome` via `actualDatasetForHouse` |

**Rules:** no read-time GB slot repair; no serving stale GB (`intervalIngestVersion` gate); raw vendor files for re-ingest only.

## Actionable Standardization Step

- Keep this map as the shared contract reference.
- Use a single enum for interval layer kinds in code (`modules/usageSimulator/kinds.ts`).
