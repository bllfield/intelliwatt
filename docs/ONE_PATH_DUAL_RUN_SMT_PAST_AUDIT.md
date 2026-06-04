# Read-only audit: SMT Past sim — One Path vs user site

**Date:** 2026-05-20  
**Goal reference:** `docs/ONE_PATH_DUAL_RUN_GOAL.md`  
**Scope:** INTERVAL / SMT **Past (Corrected)** on pinned One Path lab test home

---

## Executive summary

| Finding | Severity |
|---------|----------|
| Admin **Run** with Past `scenarioId` does **not** call `recalcSimulatorBuild` — only `buildPastSimRunReadbackResponse` (cache read) | **Blocker** |
| `ensureOnePathPastParityBeforeRead` copies user artifact before read | **Blocker** |
| `recalcSimulatorBuild` short-circuits on `unchangedParity` → `syncOnePathPastUserSiteParityFromSource` (copy) | **Blocker** |
| `allow_rebuild` pins cache to `parityLock.parityInputHash` + copy heal — skips fresh sim when fingerprint moves | **Blocker** |
| `parityLockRebuild` blocks test-home `getPastSimulatedDatasetForHouse` | **Blocker** |
| SMT heal on lookup targets **source** house (`resolveOnePathAdminSmtHealTarget`) | **Correct** |
| User Past uses `dispatchPastSimRecalc` → `recalcSimulatorBuild` (`callerLabel: user_recalc`) | **Correct** |
| Shared engine: `simulatePastUsageDataset` / `buildPastSimulatedBaselineV1` in `modules/onePathSim` | **Correct** |

---

## User site SMT Past run (reference pipeline)

| Step | Owner |
|------|--------|
| POST `/api/user/simulator/recalc` | `app/api/user/simulator/recalc/route.ts` |
| Dispatch | `modules/usageSimulator/pastSimRecalcDispatch.ts` → `runOnePathSimulatorBuild` |
| Recalc | `modules/onePathSim/usageSimulator/service.ts` `recalcSimulatorBuild` |
| Caller | `user_recalc` → `actualContextHouseId = houseId`, `userSiteIsolation` on persist |
| Persist | `PastSimulatedDatasetCache` on **user** `houseId` |
| Read | `/api/user/usage/simulated/house` → `readOnePathSimulatedUsageScenario` + `userSiteIsolation: true` |

SMT refresh: user **Refresh usage** / orchestrate → `ensureSmtCoverageForHouse` (not bundled into every recalc POST).

---

## One Path SMT Past run (before fix)

| Step | Actual behavior | Expected (dual-run) |
|------|-----------------|---------------------|
| Lookup | `ensureOnePathSmtOnLookup` → source house, `ensureSmtCoverage`, `force: true` | Same |
| UI **Run** (`action: run`, `mode: INTERVAL`, `scenarioId` set, debug off) | `buildPastSimRunReadbackResponse` only | `dispatchPastSimRecalc` on **test** home, then read artifact |
| Pre-read | `ensureOnePathPastParityBeforeRead` → copy user cache if miss | **Remove** |
| Read | `readOnePathSimulatedUsageScenario` → `artifact_only` → fallback `allow_rebuild` | `artifact_only` at hash from **test** recalc |
| `allow_rebuild` cache key | `parityLock.parityInputHash` preferred over live `pastArtifactIdentity.inputHash` | Always **live** identity hash |
| Cache miss + lock | `maybeHeal` copy; or `ARTIFACT_MISSING` / block sim | `getPastSimulatedDatasetForHouse` on test home |
| Admin recalc API (if used) | `unchangedParity` → copy from user | Full recalc on test home |

**File:** `app/api/admin/tools/one-path-sim/route.ts` lines ~1864–1892 branch to readback; ~644–671 parity copy before read.

---

## Copy / parity modules (drift)

| Symbol | File | Role today | Target |
|--------|------|------------|--------|
| `syncOnePathPastUserSiteParityFromSource` | `lib/usage/onePathPastUserSiteParity.ts` | Copy cache + build | Deprecated; mirror build only |
| `mirrorOnePathPastBuildInputsFromSource` | same (new) | — | Replace on test-home replace |
| `ensureOnePathPastParityBeforeRead` | same | Copy if cache miss | No-op / remove |
| `maybeHealOnePathPastParityForRead` | same | Copy heal | Remove call sites |
| `unchangedParity` branch | `service.ts` ~4417–4442 | Copy on recalc | Delete |
| `parityLockRebuild` | `service.ts` ~8104–8112 | Block sim | Delete |

---

## Implementation order (SMT Past) — completed 2026-05-20

1. **`app/api/admin/tools/one-path-sim/route.ts`** — INTERVAL + Past `run`: `dispatchPastSimRecalc` then readback with `exactArtifactInputHash`; removed pre-read copy.
2. **`modules/onePathSim/usageSimulator/service.ts`** — Removed copy short-circuits; live `inputHash` only; test-home sim on cache miss.
3. **`lib/usage/onePathPastUserSiteParity.ts`** — `mirrorOnePathPastBuildInputsFromSource`; no-op heal/read copy.
4. **`modules/usageSimulator/labTestHome.ts`** — Replace → mirror build inputs only.

**Out of scope (follow-up):** Green Button Past admin run (readback-first); droplet-async admin UX; optional source-house recalc when only test home runs.

---

## Verification after fix

1. Lookup → `smtRefreshCheck.healed` or `window_ready` on **source** house.
2. One Path INTERVAL Past **Run** → logs `recalc` / `getPastSimulatedDatasetForHouse` on **test** `houseId`; new `PastSimulatedDatasetCache` row on test home.
3. User Past recalc on source → second row on user home.
4. Same inputs + post-backfill data → same `inputHash` and matching totals (optional `verifyPastDatasetParity`).
5. Admin edits travel on test home → dirty lock cleared → different `inputHash` / results.
