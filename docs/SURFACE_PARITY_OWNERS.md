# Usage / Baseline / Past Sim — surface parity owners

**Purpose:** When you fix SMT on Usage + One Path Baseline + Past Sim, use this map so the same correction applies to **Green Button** and both code paths (admin One Path + user `usageSimulator`) without triple work.

**One Path Past lab goal (read first):** `docs/ONE_PATH_DUAL_RUN_GOAL.md` — two runs, one pipeline; **do not** treat artifact copy as the product model.

**Master data truth:** `getActualUsageDatasetForHouse` in `lib/usage/actualDatasetForHouse.ts` (via `lib/usage/userUsageHouseContract.ts` for dashboard/baseline).

**Interval ingest/read contract (shipped PC-2026-08):** `docs/USAGE_INTERVAL_SOURCE_OF_TRUTH.md` · `.cursor/rules/usage-interval-ingest-lock.mdc` — one persist path per source; no read-time GB repair; no serving stale GB rows.

---

## Surfaces (same contract, different read models)

| Surface | Route / entry | Dataset truth |
|---------|----------------|---------------|
| **Usage dashboard** | User Usage API → `buildUserUsageHouseContract` | `getActualUsageDatasetForHouse` |
| **One Path Baseline** | Baseline passthrough / `BASELINE` scenario | Same contract as Usage |
| **Past Sim (admin)** | One Path harness → `modules/onePathSim/usageSimulator/service.ts` | Stitched Past artifact + sage overlay on read |
| **Past Sim (user)** | `/api/user/usage/simulated/*` → `modules/usageSimulator/service.ts` | Same producer contract as admin (must stay in sync) |

---

## Concern → single owner (all modes)

| Concern | Owner module | SMT | Green Button |
|---------|--------------|-----|--------------|
| **Ingest (normalize/repair)** | `lib/usage/greenButtonUsagePipeline.ts` / `normalizeSmtIntervals.ts` | Admin ingest routes → `SmtInterval` | App upload + Droplet → `GreenButtonInterval` |
| **Read (product paths)** | `actualDatasetForHouse.ts` | `convertSmtPersistedRowsToHome` | `loadPersistedGreenButtonIntervals` + `greenButtonIntervalReadiness` |
| 365-day window | `lib/usage/canonicalMetadataWindow.ts` | Chicago bounds | GB file-anchored via `greenButtonCoverage.ts` |
| Per-home timezone | `lib/time/resolveHomeTimezone.ts` | Default Central | Address/state |
| Interval calendar | `lib/time/homeIntervalCalendar.ts` + `actualIntervalCalendar.ts` | 96/96 slots | DST wall 92/96/100; trusted pool completeness via `greenButtonTrustedCompletenessThreshold` (96 cap on fall-back, same as SMT) |
| Day completeness (SMT) | `lib/usage/smtWindowStatus.ts` | 96 distinct Chicago slots | N/A |
| SMT ledger (Past) | `lib/usage/pastSimSmtLedgerPrep.ts` → `smtDayCoverageLedger.ts` | Pending + incomplete-meter keys | N/A |
| Heal / backfill | `lib/usage/ensureSmtCoverage.ts` | Only | N/A |
| Actual daily kWh (display) | `lib/usage/sageActualDailyTruth.ts` | Sage dataset daily | Same |
| Baseload (15-min) | `lib/usage/computeHomeBaseloadKw.ts` | Actual intervals only | Actual intervals only |
| Past producer | `simulatePastUsageDataset` in **both** trees (see below) | + ledger prep | + `trustedActualDateKeys` from GB fetch |
| Past engine | `buildPastSimulatedBaselineV1` in **both** `engine.ts` trees | Pending/incomplete/forced simulate | `intervalTrustedSource: GREEN_BUTTON` |
| Validation compare | `compareProjection.ts` (keep admin + user copies aligned) | `forceSimulateDateKeysLocal` | Same |
| One Path Past (SMT + GB) ↔ user Past | **Target:** same `recalcSimulatorBuild` / `simulatePastUsageDataset` on test `houseId`. **SMT:** always recalc on admin Past run. **GB:** recalc when cache miss at current GB `inputHash` (`onePathGbPastArtifactRun.ts`). **Support:** `resolvePastSimEsiidForHouse.ts`, `pastArtifactIdentity.ts` | Dual-run; SMT heal on **source**; GB clone on test-home replace | No artifact copy |
| Past cross-surface weather acceptance | `pastWeatherCrossSurfaceParity.server.ts`, `pastWeatherInputParity.ts`, `pastCrossSurfaceResolvedSimFingerprintPolicy.ts` | `acceptanceProof.ok` + canonical truth hashes; `resolvedSimFingerprint` house-local (informational) | Same rule |

**Do not edit** `modules/realUsageAdapter/greenButton.ts` for SMT-only fixes (workspace lock).

---

## Dual Past stacks (must stay aligned)

Two parallel module trees exist for historical reasons. **Any Past Sim parity fix must touch both** until consolidated:

| Piece | Admin One Path | User / Gap-Fill |
|-------|----------------|-----------------|
| Past producer | `modules/onePathSim/simulatedUsage/simulatePastUsageDataset.ts` | `modules/simulatedUsage/simulatePastUsageDataset.ts` |
| Past engine | `modules/onePathSim/simulatedUsage/engine.ts` | `modules/simulatedUsage/engine.ts` |
| Dataset / baseload | `modules/onePathSim/usageSimulator/dataset.ts` | `modules/usageSimulator/dataset.ts` |
| Service | `modules/onePathSim/usageSimulator/service.ts` | `modules/usageSimulator/service.ts` |

**Shared lib extractions (prefer these for new work):**

- `lib/usage/pastSimSmtLedgerPrep.ts` — SMT ledger + slot-complete filter for Past producers
- `lib/usage/computeHomeBaseloadKw.ts` — baseload for Usage, baseline, and Past insights
- `lib/usage/onePathPastUserSiteParity.ts` — input mirror on replace; no artifact copy
- `lib/usage/onePathGbPastArtifactRun.ts` — GB Past cache probe (skip recalc when upload unchanged)
- `lib/usage/resolvePastSimEsiidForHouse.ts` — resolve meter ESIID for lab-home Past recalc/backfill when `houseAddress.esiid` is unset
- `lib/usage/onePathPastUserSiteParityLock.ts` — parity lock read/dirty/clear + dataset verify (pure; no DB)

---

## Checklist when you find an SMT bug

1. **Reproduce on Usage** — confirm `getActualUsageDatasetForHouse` / sage daily truth.
2. **Baseline** — should match Usage via `userUsageHouseContract` (see `baselineParityAudit.ts`).
3. **Past Sim admin** — rebuild artifact; check `runReadOnlyView` + sage overlay.
4. **Past Sim user** — same rebuild via `usageSimulator/service.ts`; confirm `simulatedUsage/simulatePastUsageDataset.ts` has the same lib owner call.
5. **Green Button house** — repeat steps 1–4 with `actualSource: GREEN_BUTTON`; trust rules differ (DST slot counts), not separate dashboard math.
6. **Update this doc** if you add a new shared owner in `lib/usage/`.

---

## Mode-specific rules (do not unify blindly)

- **SMT trusted pool / Past Sim:** 96/96 Chicago slots (`smtWindowStatus`). Incomplete-meter ledger days filtered by slot completeness (DST fall-back).
- **Green Button trusted pool:** `trustedIntervalThresholdForDateKey` (92/96/100). `trustedActualDateKeys` from GB coverage fetch passed into Past engine.
- **Validation days (production Past):** `validationHoldoutDateKeysLocal` + `strict_holdout` in shared Past sim — target validation date excluded from donor/shape pools; compare uses holdout sim (`VALIDATION_HOLDOUT`). Display stays **ACTUAL** via `projectBaselineFromCanonicalDataset`. Metric: **Holdout WAPE** only when `meta.validationHoldoutProof.ok`. **Contract:** `docs/PAST_VALIDATION_HOLDOUT.md` (PC-2026-10).
- **Gap-Fill lab test days only:** `forceModeledOutputKeepReferencePoolDateKeysLocal` (keep-ref) may remain for bounded lab scoring — not production Past validation.
- **Past 15-minute load curve (display):** `lib/usage/pastSimDisplayFromDataset.ts` → `resolvePastSimFifteenMinuteCurveFromDataset()` — User Usage and One Path must both call this; no sage upstream or local rebuilds.

---

## Past Sim visible weather (bundle ownership)

**Matrix owner:** `lib/usage/weatherScoringOwnership.ts` · **Shared resolver:** `lib/usage/resolvePastVisibleWeatherScore.ts`

| Bundle | Meta field | Owner | Used for Past visible cards? |
|--------|------------|-------|------------------------------|
| **A** | actual baseline contract | `actual_usage_weather_score` | No |
| **B** | `meta.weatherSensitivityScore` | `simulation_build_diagnostic` | **No** — diagnostic only |
| **C** | `meta.pastDisplayWeatherSensitivityScore` | `past_artifact_build` | **Yes** — post-finalize display truth |

**Finalize owner:** `lib/usage/finalizePastDatasetDisplayReadModel.ts` → `attachPastSimDisplayWeatherToDataset` recomputes C from finalized display daily rows.

| Surface | API route | Client guard |
|---------|-----------|--------------|
| User Past | `app/api/user/usage/simulated/house/route.ts` | `UsageSimulatorClient.tsx` → `resolvePastWeatherScoreFromHouseApiBody` |
| Admin Past | `app/api/admin/tools/one-path-sim/route.ts` | `OnePathRunReadOnlyView.tsx` |

**OPEN (PC-2026-09):** GB keeper User UI shows **50/97/73** (B cooling/heating); Admin shows **50/93/76** (C). Sim totals match. **User proof = browser Network only** — see `docs/PAST_WEATHER_PARITY_AGENT_BOOTSTRAP.md`.

**False green:** `auditUserAdminPastReadModelParity` in `intervalReadModelInvariants.ts` does not call live User API.

---

## Related docs

- `docs/ONE_PATH_DUAL_RUN_GOAL.md` — **canonical** One Path vs user Past lab model
- `.cursor/rules/one-path-dual-run-lock.mdc` — agent constraint
- `docs/SMT_UNIFICATION_COMPLETE.md` — SMT owners (shipped)
- `docs/USAGE_INTERVAL_SOURCE_OF_TRUTH.md` — GB + SMT ingest/read SoT (shipped PC-2026-08)
- `docs/SMT_UNIFICATION_AGENT_BOOTSTRAP.md` — maintenance bootstrap
- `docs/PAST_WEATHER_PARITY_AGENT_BOOTSTRAP.md` — GB Past weather parity (**COMPLETE** — regression proof only)
- `docs/PROJECT_PLAN.md` → PC-2026-09 — Past visible weather parity (**COMPLETE**)
- `.cursor/rules/smt-unification-lock.mdc` — permanent constraints
- `.cursor/rules/usage-interval-ingest-lock.mdc` — GB/SMT ingest/read constraints
