# Read-only audit: Green Button Past sim — One Path vs user site

**Date:** 2026-05-20  
**Goal:** `docs/ONE_PATH_DUAL_RUN_GOAL.md`  
**SMT reference:** `docs/ONE_PATH_DUAL_RUN_SMT_PAST_AUDIT.md` (shipped)

---

## How GB differs from SMT (product)

| | SMT Past | Green Button Past |
|--|----------|-------------------|
| Upstream truth updates | `ensureSmtCoverage` / backfill on **source** meter (ongoing) | New **file upload** on user home (episodic) |
| Test home usage | Reads **source** ESIID / intervals via `actualContextHouseId` | **Cloned** GB intervals on **test** home (`cloneOnePathGreenButtonUsageFromSource` on replace) |
| When artifact identity changes | Interval fingerprint shifts after backfill | Fingerprint shifts when GB file/intervals on **actual context house** change |
| Admin run rebuild policy | **Always recalc** on One Path Past run (fresh intervals may have landed) | **Recalc only when** no cache row at current `inputHash` (same file → skip sim) |

---

## Audit findings (before GB fix)

| Finding | Severity |
|---------|----------|
| SMT Past admin run recalcs on test home (shipped `3038bece`) | Fixed for SMT |
| GB Past admin run (`mode: GREEN_BUTTON` + `scenarioId`) still **readback-only** | **Blocker** |
| Test-home replace clones GB usage + mirrors Past build (no artifact copy) | Correct |
| `actualContextHouseId` for GB run uses test home when GB persisted there | Correct (`resolveOnePathGreenButtonActualContextForUsage`) |
| User Past recalc uses `dispatchPastSimRecalc` + `SMT_BASELINE` + `preferredActualSource` from build | Correct |
| Stale test-home GB after **new upload on source only** | Operational — re-replace test home or upload on test home |

---

## Target behavior (GB Past admin run)

1. Resolve current Past `inputHash` on **test** home (GB preferred source, `actualContextHouseId` from GB context).
2. If `PastSimulatedDatasetCache` hit at that hash → **skip recalc**, `artifact_only` readback (same file / unchanged inputs).
3. Else → `dispatchPastSimRecalc` on test home (`preferredActualSource: GREEN_BUTTON`, `callerLabel: one_path_admin_gb_past_run`) — **dual-run**, not user artifact copy.
4. Admin edits travel/validation on test home → dirty parity lock → recalc on next run (existing `clearOnePathUserSiteParityFromBuildInputs`).

---

## Implementation (this pass)

| File | Change |
|------|--------|
| `lib/usage/onePathGbPastArtifactRun.ts` | Cache probe via `resolvePastArtifactIdentity` + `getCachedPastDataset` |
| `app/api/admin/tools/one-path-sim/route.ts` | `GREEN_BUTTON` + Past `scenarioId`: cache-first, else recalc |
| Docs | GB section in `ONE_PATH_DUAL_RUN_GOAL.md`, `SURFACE_PARITY_OWNERS.md` |

**Not in scope:** Auto re-clone when source GB upload is newer than test clone (operator: replace test home or re-upload on lab home).
