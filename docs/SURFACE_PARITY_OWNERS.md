# Usage / Baseline / Past Sim — surface parity owners

**Purpose:** When you fix SMT on Usage + One Path Baseline + Past Sim, use this map so the same correction applies to **Green Button** and both code paths (admin One Path + user `usageSimulator`) without triple work.

**Master data truth:** `getActualUsageDatasetForHouse` in `lib/usage/actualDatasetForHouse.ts` (via `lib/usage/userUsageHouseContract.ts` for dashboard/baseline).

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
| One Path Past (SMT + GB) ↔ user Past | `lib/usage/onePathPastUserSiteParity.ts` + `resolvePastSimEsiidForHouse.ts` | Copy source artifact + build; lab home keeps source ESIID; parity heal before read/rebuild | `parityInputHash` + `userSiteIsolation` on admin readback |

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
- `lib/usage/onePathPastUserSiteParity.ts` — Past (SMT + GB) load parity: sync source user-site Past artifact to One Path test home; heal before admin readback
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
- **Validation days:** `forceModeledOutputKeepReferencePoolDateKeysLocal` (keep-ref) — scored validation actuals stay in the donor pool; output is still modeled for compare.
- **Past 15-minute load curve (display):** `lib/usage/pastSimDisplayFromDataset.ts` → `resolvePastSimFifteenMinuteCurveFromDataset()` — User Usage and One Path must both call this; no sage upstream or local rebuilds.

---

## Related docs

- `docs/SMT_UNIFICATION_COMPLETE.md` — SMT owners (shipped)
- `docs/SMT_UNIFICATION_AGENT_BOOTSTRAP.md` — maintenance bootstrap
- `.cursor/rules/smt-unification-lock.mdc` — permanent constraints
