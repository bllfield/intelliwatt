# Manual Monthly GREEN Closeout (2026-06-08)

**Status:** Accepted GREEN — production readback verified after display copy + source label fixes and Usage Simulator source-state copy closeout.

**Supersedes:** Older MG-0 / pre-closeout audit notes for manual-monthly **readiness** only. MG-0 remains planning context for Manual GapFill; it does not override this GREEN closeout for shipped Manual Monthly behavior.

---

## Accepted production readback (keeper house)

| Field | Value |
|-------|--------|
| Source house | `4da5d9d3-f139-4d3a-a602-3250d933c71c` |
| Test / admin house | `29a3d820-2593-4673-9dd6-cd161bbd7f6f` |
| Statement window (Stage 1 / Usage) | 2025-03-17 → 2026-03-15 |
| Entered manual bill total | 34,590.00 kWh |
| Bill Match | **Pass** |
| Period match | **12 / 12** eligible bill periods matched |
| Eligible simulated total | ≈ 34,589.98 kWh |
| Total delta | ≈ −0.02 kWh |
| April row | +0.07 kWh visible; reconciles under ±0.10 kWh absolute tolerance |
| Canonical Past display window | 2025-06-08 → 2026-06-07 |
| Daily rows | **365** |
| Manual Past daily source labels | `SIMULATED` / `SIMULATED_MANUAL_CONSTRAINED` |
| Interval shape (manual-only) | **estimated** |
| Manual Past weather copy | estimated / manual-bill based (not measured interval behavior) |
| Baseload (15-min) | populated as **kWh / 15 min** |

---

## Two truths (do not collapse)

1. **Bill-period usage truth** — Usage dashboard, Baseline, Stage 1 statement table, Bill Match Verification. Uses original statement ranges and entered totals only.
2. **Canonical Past display truth** — Past Sim curve, Future/plan comparison, canonical 365-day window, weather card on Past workspace. Uses shared Past artifact after normalization; not summed against statement dates for Bill Match.

---

## Bill Match Verification

- Hard reconciliation against **original statement ranges** (pre-projection bill-period sim totals / sidecar).
- Does **not** sum canonical display daily rows against statement dates.
- Tolerance: **`MANUAL_BILL_MATCH_TOLERANCE_KWH = 0.10`** absolute per eligible period (`modules/manualUsage/readModel.ts`).
- Deltas remain visible (including April +0.07 kWh).
- No-travel accepted case: **12/12** pass at ≈ −0.02 kWh total delta.
- **Simulation Confidence** is separate copy (`modules/manualUsage/manualValidationSummary.ts`); Bill Match pass does not imply measured-interval confidence.

---

## Travel / vacant policy

- Any travel/vacant overlap **excludes the entire bill period** from exact-match pass/fail.
- Excluded periods stay visible with reason; excluded totals are transparent.
- Sidecar does **not** force excluded periods to reconcile.

---

## Manual Simulation Confidence

- Separate from Bill Match.
- Manual-only interval shape is **estimated / inferred** from manual bills + home details.
- Measured-interval confidence requires actual SMT/GB interval truth and actual-vs-sim comparison.
- WAPE / admin scoring metrics are **not** user-facing on the Usage Simulator.

---

## Canonical manual Past display

- Accepted coverage (current keeper house): **2025-06-08 → 2026-06-07**, **365** daily rows.
- Source labels: **`SIMULATED` / `SIMULATED_MANUAL_CONSTRAINED`**.
- Manual Past weather card: estimated / manual-bill language (`lib/usage/manualPastDisplayPolicy.ts` read-time copy override).
- Manual Past is **guarded** from stale/actual display-truth overlay contamination (`pastSimStaleIncompleteMeter.ts` skip for manual-only Past). No general overlay behavior changed.

---

## Baseload (15-min)

- Display unit is **kWh per 15-minute interval** (not kW).
- Derived from `baseloadDailyKwh / 96` when daily baseload exists (`lib/usage/baseloadDerivedFields.ts`).
- Do not show blank when daily/monthly baseload exists on manual Past readback.

---

## Usage Simulator source-state copy

When manual monthly totals are the active saved usage source:

- **Do not** show “Your Usage is Actual usage (read-only)” or “Actual coverage: ACTUAL · ? → ? · 0 intervals” as primary status.
- **Do** show manual totals / bill-period based status (`lib/usage/usageSimulatorSourceStatusCopy.ts`).
- SMT/GB users with real intervals keep existing actual coverage wording.
- Admin actual-context metadata must not leak into user-facing “Actual connected” when intervals count is 0.

---

## Env / ops

| Variable | Where | Notes |
|----------|--------|--------|
| `MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST=1` | Vercel **Production** (server-only, not `NEXT_PUBLIC`) | Required for canonical artifact stamp at persist. Redeploy after add/change. |
| `ALLOW_PROD_MANUAL_RECALC=1` | Audit/fixture scripts only | Not a product runtime requirement. |

- Production manual artifacts may need recalc/readback if not yet stamped with `manual_canonical_artifact_v1`.
- Legacy unversioned artifacts retain fallback read remap (`legacyManualDisplayRemapApplied`).

---

## Manual GapFill status (future — not started)

**Authoritative shipped Manual Monthly truth:** this closeout doc (`docs/MANUAL_MONTHLY_GREEN_CLOSEOUT.md`). Any pre-audit MG-0 wording that described manual monthly as only “green for planning,” production env uncertainty, or artifact rollout caveats is **superseded here** for shipped user/admin Manual Monthly behavior.

### MG-0 Audit (planning context only)

- The uploaded **MG-0 Audit** remains useful for **Manual GapFill redesign planning**.
- MG-0 is **not** authoritative for shipped Manual Monthly product truth, Bill Match, canonical Past display, or Usage Simulator source-state copy.
- Do **not** use MG-0 readiness/planning language to reopen Manual Monthly architecture or sim/reconciliation work.

### Manual GapFill — not started

- **Manual GapFill full overhaul has not started.**
- Current Manual GapFill may consume shared validation objects from `manualValidationSummary` / bill-period read model.
- **Legacy GapFill and `EXACT_INTERVALS` remain in place** until explicitly retired.
- Future Manual GapFill must use **shared validation objects and global validation-day policy**, not GapFill-only validation math.

### MG-1 — read-only source context resolver (shipped)

- **Shipped:** `resolveManualGapfillSmtSourceContext()` + admin `POST /api/admin/tools/manual-gapfill/source-context` (commit `814e0839`).
- Read-only source-house actual usage context only; no seed/recalc/compare.

### MG-2 — global validation-day policy / admin preview (local — pending commit approval)

- Shared module: `lib/usage/validationDayPolicy.ts`
- Admin API: `GET|POST /api/admin/tools/validation-day-policy`
- Admin UI: `/admin/tools/validation-day-policy`
- Future Manual GapFill must consume this global policy read-only; legacy GapFill local selectors remain until explicit retirement.

### MG-3 — seed preparation from MG-1 source context (not started)

- Proposed `resolveManualGapfillSeedFromSourceContext` / prepare-seed route belongs here, not MG-2.

### Manual GapFill — full overhaul not started

---

## Key code owners (copy / read model — no sim math)

| Area | Owner |
|------|--------|
| Bill Match read model | `modules/manualUsage/readModel.ts` |
| Validation summary copy | `modules/manualUsage/manualValidationSummary.ts` |
| Canonical read window | `lib/usage/persistManualPastArtifactCanonicalWindow.ts` |
| Manual Past display policy | `lib/usage/manualPastDisplayPolicy.ts` |
| Usage Simulator source status | `lib/usage/usageSimulatorSourceStatusCopy.ts` |
| Usage Simulator UI | `components/usage/UsageSimulatorClient.tsx` |

---

## Protected (unchanged by closeout)

Manual sim math, bill-period reconciliation, tolerance, SMT/GB sim math, `EXACT_INTERVALS`, validation holdout/scoring/WAPE, general overlay behavior, Manual GapFill architecture.
