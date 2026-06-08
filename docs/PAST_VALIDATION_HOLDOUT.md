# Past validation holdout (source-agnostic)

**Status:** Shipped (2026-06-06). **Plan:** `docs/PROJECT_PLAN.md` → PC-2026-10.  
**Applies to:** GREEN_BUTTON Past, SMT / INTERVAL Past, and any future interval-backed source.

## Problem

Production Past validation used `forceModeledOutputKeepReferencePoolDateKeysLocal` (`TEST_MODELED_KEEP_REF`) for scored validation days. That kept the target day’s **actual kWh** and **shape96** in the donor and shape pools, so Validation/Test Compare “WAPE” measured **reconstruction**, not **holdout** accuracy.

## Policy (locked)

| Surface | Validation/test days | Travel/vacant days |
|---------|---------------------|-------------------|
| **Past display (stitch)** | **ACTUAL** meter kWh (`ACTUAL_VALIDATION_TEST_DAY`) via `projectBaselineFromCanonicalDataset` | **SIMULATED** (`SIMULATED_TRAVEL_VACANT`) |
| **Validation/Test Compare** | **Holdout sim only** — no target-day actual in sim path | N/A (not scored) |

**Compare metric naming:**

- Before holdout proof passes: **Reconstruction check**
- After `meta.validationHoldoutProof.ok === true`: **Holdout WAPE**

Gap-Fill lab bounded test-day scoring may still use keep-ref (`forceModeledOutputKeepReferencePoolDateKeysLocal`) — that path is **not** production Past validation.

## Holdout modes

Defined in `lib/usage/pastValidationHoldout.ts`:

| Mode | Donor exclusion for validation target `D` |
|------|-------------------------------------------|
| `leave_one_out` | Exclude `D` only |
| `strict_holdout` (default) | Exclude **all** `validationHoldoutDateKeys` from every validation target’s donor/shape pools |

Production Past recalc uses **`strict_holdout`**.

## Per-target exclusions (shared Past day sim)

For each validation target date, the shared core (`buildPastSimulatedBaselineV1` → `simulatePastDay`) must:

1. Exclude the target from `donorCandidatePool` / reference pool
2. Exclude the target from `selectedDonorLocalDates`
3. Exclude the target from shape pool selection
4. Exclude same-day keep-ref templates (`validation_keep_ref_shared_day_template`)
5. Simulate kWh **without** reading that target day’s actual intervals for scoring totals

**Reason codes (production validation):**

- `simulatedReasonCode`: `VALIDATION_HOLDOUT`
- `templateSelectionKind`: `validation_holdout_day_template`

## Audit row (per validation day)

Stamped on dataset meta as `validationHoldoutAuditRows`; proof summary as `validationHoldoutProof`:

```json
{
  "sourceType": "GREEN_BUTTON | SMT",
  "validationDate": "YYYY-MM-DD",
  "validationHoldoutMode": "strict_holdout",
  "targetDateExcludedFromDonors": true,
  "targetDateExcludedFromShapePool": true,
  "selectedDonorLocalDates": ["..."],
  "selectedDonorContainsTargetDate": false,
  "simulatedReasonCode": "VALIDATION_HOLDOUT",
  "templateSelectionKind": "validation_holdout_day_template"
}
```

## Proof gates (fail closed)

`assertValidationHoldoutProofGates` fails when any row has:

- `selectedDonorContainsTargetDate === true`
- `selectedDonorLocalDates` includes `validationDate`
- Same-day keep-ref template or `TEST_MODELED_KEEP_REF` on validation scoring
- `targetDateExcludedFromDonors` or `targetDateExcludedFromShapePool` not true

Compare UI reads `meta.validationHoldoutProof.ok` via `resolveValidationCompareMetricLabel` in `lib/usage/validationCompareProjection.ts`.

## User-facing compare language (not WAPE)

Customer Past UI uses plain-English **Simulation Accuracy** (`components/usage/simulationAccuracyDisplay.ts`, `SimulationAccuracySummary.tsx`):

- **Pass:** `accuracyPercent = round(100 - wapePercent)` (e.g. WAPE 13.51% → **86%**), subtitle cites hidden-day count, detail shows average miss %
- **Fail proof:** title **Simulation Check**, main metric **Needs review** — no accuracy percent shown
- **Admin/debug only:** `ValidationCompareDebugMetrics` shows Holdout WAPE, MAE, RMSE, `validationHoldoutProof.ok`

## Code owners

| Layer | Owner |
|-------|--------|
| Holdout policy + proof | `lib/usage/pastValidationHoldout.ts` |
| Day sim filtering | `modules/simulatedUsage/pastDaySimulator.ts` (+ `modules/onePathSim/simulatedUsage/` mirror) |
| Reference pool + audit rows | `modules/simulatedUsage/engine.ts` (`buildPastSimulatedBaselineV1`) |
| Dataset meta proof stamp | `modules/simulatedUsage/simulatePastUsageDataset.ts` |
| Production wiring | `modules/usageSimulator/service.ts` → `resolveProducerValidationHoldoutDateKeysFromBuildInputs`, `validationHoldoutDateKeysLocal` + `forceSimulateDateKeysLocal` |
| Display ACTUAL flip | `lib/usage/validationCompareProjection.ts` → `projectBaselineFromCanonicalDataset` |
| Compare metrics label | `components/usage/ValidationComparePanel.tsx` |
| Canonical sim totals for compare | `validationCanonicalSimulatedDayTotalsByDateLocal` + `attachValidationCompareProjection` |

**Not** in source-specific adapters (`greenButton.ts`, SMT loaders) — holdout is entirely in the shared Past sim core.

## Tests

- `tests/usage/pastValidationHoldout.test.ts` — GB + SMT holdout pass; keep-ref leakage fails proof gates
- `tests/simulatedUsage/buildPastSimulatedBaselineV1.resolvedFingerprint.test.ts` — production holdout vs Gap-Fill keep-ref

## Internal naming (audit readability)

`buildInputs.mode` / `baseKind` may still read `SMT_BASELINE` / `SMT_ACTUAL_BASELINE` — that is the **generic interval-baseline simulator enum**, not the meter vendor. For audits, read:

- `meta.actualSource` → `GREEN_BUTTON` | `SMT`
- `meta.intervalBaselineAuditLabel` → `GREEN_BUTTON_BASELINE` | `SMT_BASELINE` | `ACTUAL_INTERVAL_BASELINE`
- `lockboxInput.mode` → `ACTUAL_INTERVAL_BASELINE` when interval-backed Past

## Green Button full close gate (holdout + parity)

Holdout leakage fix alone is **not** sufficient to close GB Past acceptance. All must pass:

- `validationHoldoutProof.ok === true` (holdout behavior)
- `pastWeatherCrossSurfaceParity.ok === true`
- `acceptanceProof.ok === true`
- User Bundle C = Admin Bundle C; visible cards match Bundle C on both surfaces
- Canonical display/weather truth matches (see `lib/usage/pastCrossSurfaceResolvedSimFingerprintPolicy.ts`): `finalizedDailyRowsHash`, `displayTruthRevision`, Bundle C, TOD/monthly read-model parity, `dailyWeatherHash`, `usageShapeProfileIdentity`, profile fingerprints, validation/travel-vacant fingerprints, scorer/calculation versions, GB/SMT interval fingerprint / trusted-date keys
- `resolvedSimFingerprint` may differ between source and lab (house-local) — reported in `acceptanceProof.resolvedSimFingerprint` with `parityRequired: false`; mismatch alone is **not** a fail and match alone is **not** acceptance

**Recovery:** guarded dual recalc then read-only proof (lab home is single-occupancy by source family — always run the matching recalc immediately before proof):

```bash
# Green Button keeper
ALLOW_PROD_PAST_RECALC=1 AUDIT_USER_EMAIL=... AUDIT_SOURCE_HOUSE_ID=... AUDIT_LAB_HOUSE_ID=... \
  npx tsx --require ./scripts/register-server-only-stub.cjs scripts/audit/recalc-gb-dual-past.mjs
AUDIT_PROOF_SOURCE_TYPE=GREEN_BUTTON PROOF_AUDIT_ONLY=1 npx tsx --require ./scripts/register-server-only-stub.cjs scripts/tmp-prod-past-weather-parity-proof.mjs

# SMT keeper (invalidates GB lab artifacts until GB recalc is run again)
ALLOW_PROD_PAST_RECALC=1 AUDIT_USER_EMAIL=... AUDIT_SOURCE_HOUSE_ID=... AUDIT_LAB_HOUSE_ID=... \
  npx tsx --require ./scripts/register-server-only-stub.cjs scripts/audit/recalc-smt-dual-past.mjs
AUDIT_PROOF_SOURCE_TYPE=SMT PROOF_AUDIT_ONLY=1 npx tsx --require ./scripts/register-server-only-stub.cjs scripts/tmp-prod-past-weather-parity-proof.mjs
```

Do **not** tune holdout WAPE down after removing leakage (e.g. ~29% → ~71% Simulation Accuracy is expected).

## Acceptance checklist

- [ ] User/Admin Past parity still passes (display + artifact identity)
- [ ] Bundle C weather parity unchanged (holdout does not alter weather scoring pool rules)
- [ ] Past display: validation days **ACTUAL**; travel/vacant **SIMULATED**
- [ ] Compare: holdout sim values only; metric shows **Holdout WAPE** when proof ok
- [ ] `validationHoldoutAuditRows[].sourceType` is `GREEN_BUTTON` or `SMT` per house source
- [ ] `selectedDonorContainsTargetDate === false` for every validation row

## Doc sync (same pass)

`PROJECT_PLAN.md` (PC-2026-10), `PROJECT_CONTEXT.md`, `USAGE_SIMULATION_PLAN.md`, `USAGE_LAYER_MAP.md`, `SURFACE_PARITY_OWNERS.md`, `PAST_SHARED_CORE_UNIFICATION_PLAN.md`, `CHAT_BOOTSTRAP.txt`.
