# Manual GapFill Closeout (MG-1 → MG-6)

**Status:** Accepted closeout — admin pipeline shipped MG-1 through MG-6. Legacy GapFill and `EXACT_INTERVALS` remain in place.

**Supersedes:** Pre-MG-6 wording that described Manual GapFill as “not started” or “MG-6 local only.” MG-0 Audit remains planning context for future GapFill retirement; it does not override this closeout for shipped MG-1–MG-6 behavior.

**Related (separate GREEN):** `docs/MANUAL_MONTHLY_GREEN_CLOSEOUT.md` — production Manual Monthly user/admin truth. Manual GapFill admin pipeline is lab/diagnostic only and does not change Manual Monthly production behavior.

---

## Keeper houses (admin pipeline defaults)

| Role | Value |
|------|--------|
| Source user email | `bllfield32@icloud.com` |
| Source (source actual usage) | `4da5d9d3-f139-4d3a-a602-3250d933c71c` |
| Lab (lab simulated usage) | `29a3d820-2593-4673-9dd6-cd161bbd7f6f` |

Default mode: `MONTHLY_FROM_SOURCE_INTERVALS`.

---

## Shipped phases (commit map)

| Phase | Commit | What shipped |
|-------|--------|--------------|
| **MG-1** | `814e0839` | Read-only source context resolver + `POST /api/admin/tools/manual-gapfill/source-context` |
| **MG-2** | `d9542e06` / `5021453f` | Global compare-day policy — **canonical doc `docs/GLOBAL_COMPARE_DAY_POLICY.md`**. FeatureFlag persist (`validation_day_policy.v1`), email-based preview, wired to One Path / Manual GapFill / GapFill Lab (non source-copy) |
| **MG-3** | `f1159ef5` | Seed preparation + `POST /api/admin/tools/manual-gapfill/prepare-seed` (dry-run default; optional lab persist) |
| **MG-4** | `be2ff2cf` | Run/readback + `POST /api/admin/tools/manual-gapfill/run-readback` (canonical Past Sim on lab home) |
| **MG-5** | `8205fa1e` | Compare envelope + `POST /api/admin/tools/manual-gapfill/compare` (+ build hotfixes `5b90d4e5`, `41f5c1ea`) |
| **MG-6** | `ae380115` | Admin UI `/admin/tools/manual-gapfill` wiring MG-1–MG-5 client-side |

**MG-7:** this closeout doc + docs sync (no new product behavior).

---

## Admin pipeline (MG-6)

**Page:** `/admin/tools/manual-gapfill`  
**Component:** `components/admin/ManualGapfillAdmin.tsx`  
**Client:** `lib/admin/manualGapfillClient.ts`

### Steps (each independently runnable)

1. **Source Context** — MG-1 `source-context`
2. **Validation Policy** — MG-2 snapshot + preview (link to `/admin/tools/validation-day-policy`; contract `docs/GLOBAL_COMPARE_DAY_POLICY.md`)
3. **Prepare Seed** — MG-3 `prepare-seed`
4. **Run / Readback** — MG-4 `run-readback`
5. **Compare** — MG-5 `compare` (`compareScope: source_actual_vs_lab_simulated`)

Optional **Run pipeline** button chains existing endpoints from the browser; stops on first failure. **No** backend orchestration route.

### Safety contracts

| Control | Behavior |
|---------|----------|
| Dry-run seed | Default primary path; `persistToLabHome: false` |
| Persist seed | Explicit checkbox + separate red persist button; `persistToLabHome: true` |
| Pipeline button | Dry-run seed only; persist never implicit |
| Same-house | Source house ID must differ from lab house ID (UI + API) |
| Hash forwarding | Interval fingerprint (MG-1), policy hash (MG-2), seed hash (MG-3), artifact input hash (MG-4) forwarded to later steps when available |
| Identity change | Clearing downstream step results + stale banner when userId/source/lab/mode changes |
| `includeDailyRows` | Default `false` on MG-5 compare |

### Labeling (admin UI)

- **Source actual usage** — persisted actual on source home only.
- **Lab simulated usage** — Past Sim artifact on lab home only; never labeled “actual.”
- MG-5 compare is **admin diagnostic only**; does not change production Simulation Accuracy or validation scoring.

---

## Module / route owners

| Phase | Module | Route |
|-------|--------|-------|
| MG-1 | `modules/manualUsage/manualGapfillSourceContext.ts` | `.../manual-gapfill/source-context` |
| MG-2 | `lib/usage/validationDayPolicy.ts` | `.../validation-day-policy` |
| MG-3 | `modules/manualUsage/manualGapfillSeed.ts` | `.../manual-gapfill/prepare-seed` |
| MG-4 | `modules/manualUsage/manualGapfillRunReadback.ts` | `.../manual-gapfill/run-readback` |
| MG-5 | `modules/manualUsage/manualGapfillCompare.ts` | `.../manual-gapfill/compare` |
| MG-6 | `components/admin/ManualGapfillAdmin.tsx` | `/admin/tools/manual-gapfill` |

Auth gate: `app/api/admin/tools/manual-gapfill/_helpers.ts` (`gateManualGapfillAdmin`).

---

## Two truths (Manual GapFill admin — do not collapse)

1. **Source actual usage** — `getActualUsageDatasetForHouse(sourceHouseId)` for MG-1 context and MG-5 compare actual side.
2. **Lab simulated usage** — lab home Past Sim artifact readback (`buildOnePathManualUsagePastSimReadResult`) for MG-4/MG-5 simulated side.

MG-5 compare scope is always `source_actual_vs_lab_simulated`. Bill Match (MG-4) is separate from MG-5 compare.

---

## Hard boundaries (unchanged by MG-1–MG-7)

- **No** legacy GapFill route deletion. GapFill Lab **compare-day selection** uses global MG-2 policy on the main compare path; **`EXACT_INTERVALS` source-copy parity** copies source build validation keys only when source `validationDayPolicyHash` + `validationDayPolicyRevision` match the active global policy (else `409 source_validation_policy_stale`). See `docs/GLOBAL_COMPARE_DAY_POLICY.md`.
- **No** `EXACT_INTERVALS` scoring/keep-ref behavior changes beyond global compare-day wiring.
- **No** Manual Monthly GREEN production changes (`docs/MANUAL_MONTHLY_GREEN_CLOSEOUT.md` authoritative).
- **No** source-house writes from Manual GapFill admin pipeline.
- **No** lab writes except MG-3 explicit persist and MG-4 explicit Past Sim run when admin triggers those endpoints.
- **No** new seed derivation, Past Sim dispatch, or compare outside MG-3/MG-4/MG-5 routes.
- **No** SMT/GB sim math, validation holdout/scoring/WAPE, overlay, or plan ranking changes.
- **`localGapFillSelectorUsed: false`** — global validation-day policy from MG-2 only.

---

## Tests (regression suite)

Targeted MG regression (representative):

- `tests/manualUsage/manualGapfillSourceContext.test.ts`
- `tests/usage/validationDayPolicy.test.ts`
- `tests/admin/validationDayPolicy.route.test.ts`
- `tests/manualUsage/manualGapfillSeed.test.ts`
- `tests/admin/manualGapfillPrepareSeed.route.test.ts`
- `tests/manualUsage/manualGapfillRunReadback.test.ts`
- `tests/admin/manualGapfillRunReadback.route.test.ts`
- `tests/manualUsage/manualGapfillCompare.test.ts`
- `tests/admin/manualGapfillCompare.route.test.ts`
- `tests/components/manualGapfillAdmin.test.ts`
- `tests/admin/manualGapfillUiContract.test.ts`

Manual Monthly GREEN tests remain separate and unchanged.

---

## Future work (not started — separate approval)

- Legacy GapFill retirement / `EXACT_INTERVALS` migration (explicit scope only).
- Production Manual GapFill user-facing surfaces beyond admin lab pipeline.
- Phase 5 dispatch convergence / shared `runSharedSimulation` replacement.
