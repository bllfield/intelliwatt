# Global Compare-Day Policy (MG-2)

**Status:** Shipped — admin control plane + wired surfaces (`5021453f` on `main`, builds on `d9542e06`).

**Authoritative for:** which calendar days are selected when simulated usage is compared against actual interval usage (validation / test compare days).

**Related (separate contracts):**

- **Holdout scoring after selection:** `docs/PAST_VALIDATION_HOLDOUT.md` (PC-2026-10) — how selected days are simulated and scored (display ACTUAL, compare holdout sim).
- **Canonical code defaults / reconciliation revision:** `lib/usage/pastValidationPolicy.ts`.
- **Selector algorithm:** `modules/usageSimulator/validationSelection.ts` → `selectValidationDayKeys`.
- **Admin tools contract:** `docs/ADMIN_TOOLS_CONTRACT.md` §7–§8.

---

## What this policy controls

Global compare-day policy answers:

> **Which local calendar dates (`validationOnlyDateKeysLocal`) should be used as scored compare / validation days?**

It sets:

| Field | Meaning |
|-------|---------|
| `selectionMode` | Auto-pick algorithm (`stratified_weather_balanced`, `customer_style_seasonal_mix`, `random_simple`) |
| `validationDayCount` | Target number of compare days (1–365) |
| `surface` | Policy owner label: `admin_lab` or `user_site` (metadata; both surfaces share the same selector) |

It does **not** change:

- Holdout sim math (`validationHoldoutDateKeysLocal`, `VALIDATION_HOLDOUT`, Holdout WAPE)
- Production WAPE / Simulation Accuracy product scoring
- Travel/vacant stitch behavior
- Interval ingest or read-time repair
- GapFill keep-ref lab scoring paths (separate from production validation)

---

## Architecture

```
Admin UI (/admin/tools/validation-day-policy)
    ↓ save (APPLY) / reset
FeatureFlag validation_day_policy.v1          ← admin persisted policy
    ↓ precedence below env
VALIDATION_DAY_POLICY_OVERRIDE_JSON (env)       ← deploy override (optional)
    ↓ fallback
pastValidationPolicy.ts code defaults           ← stratified_weather_balanced · 14
    ↓
lib/usage/validationDayPolicy.ts
    resolveActiveValidationDayPolicyLive()
    previewGlobalValidationDaySelection()
    resolveGlobalValidationDayKeysForPastSim()   ← preview + window bounding guard
    ↓
modules/usageSimulator/validationSelection.ts
    selectValidationDayKeys()
    ↓
buildInputs.validationOnlyDateKeysLocal → Past recalc / compare surfaces
```

### Module owners

| Concern | Owner |
|---------|--------|
| Policy layer + live resolver + preview + window guard | `lib/usage/validationDayPolicy.ts` |
| Admin persist (FeatureFlag) | `lib/usage/validationDayPolicyStore.ts` |
| Mode catalog + guardrail copy (UI/docs) | `lib/usage/validationDayPolicyCatalog.ts` |
| Admin client helpers | `lib/admin/validationDayPolicyClient.ts` |
| Code defaults + reconciliation revision | `lib/usage/pastValidationPolicy.ts` |
| Selection algorithm | `modules/usageSimulator/validationSelection.ts` |
| Canonical 365-day window | `lib/usage/canonicalMetadataWindow.ts` → `resolveCanonicalUsage365CoverageWindow()`, `boundDateKeysToCoverageWindow()` |
| Admin API | `app/api/admin/tools/validation-day-policy/route.ts` |
| Admin UI | `components/admin/ValidationDayPolicyAdmin.tsx` |
| Auth gate | `app/api/admin/tools/manual-gapfill/_helpers.ts` → `gateManualGapfillAdmin` |

**Policy revision stamp:** `PAST_VALIDATION_POLICY_REVISION` in `pastValidationPolicy.ts` (currently `unified_past_validation_stratified_14_v4`). Bumped when canonical code defaults change; stored builds reconcile when revision drifts.

**Policy hash:** `computeValidationDayPolicyHash()` — stable digest of active mode, count, surface, layer, revision.

---

## Selection modes

| Mode | Summary | Production use |
|------|---------|----------------|
| `stratified_weather_balanced` | **Default.** Round-robin across winter/summer/shoulder and weekday/weekend buckets; explicit fallback diagnostics when buckets run short. | Yes — canonical default |
| `customer_style_seasonal_mix` | Seeded random with month + weekday/weekend stratification; less strict bucket balance. | Admin tuning only |
| `random_simple` | Uniform random sample from clean candidates. | Spot checks only |
| `manual` | Uses explicit `validationOnlyDateKeysLocal` passed by caller. | **Not** used for global admin auto-pick; legacy explicit-key callers only |

Global admin save **rejects** `manual` as the saved mode (auto modes only).

---

## Guardrails (always applied on wired paths)

1. **Canonical 365-day coverage window** — Candidates and final keys are bounded to `resolveCanonicalUsage365CoverageWindow()` (America/Chicago, lag-aware). Keys outside the window are dropped before Past Sim dispatch (`boundDateKeysToCoverageWindow` in `resolveGlobalValidationDayKeysForPastSim`).

2. **Travel / vacant exclusion** — Travel ranges from the latest `usageSimulatorBuild.buildInputs.travelRanges` exclude candidate days before selection.

3. **Actual-usage candidates** — When daily actual usage exists for the house, candidate days come from those dates inside the window; otherwise calendar days in the window are used.

4. **Single selector owner** — Wired surfaces call `validationDayPolicy.ts` → `selectValidationDayKeys`. Per-run UI overrides on One Path / Manual GapFill are **removed**; GapFill Lab local compare-day selectors are **retired** on the main compare path.

5. **Admin home lookup by email** — Preview and admin tooling resolve houses via user **email** (`GET /api/admin/houses/by-email` → `lookupAdminHousesByEmail`). Operators must not paste raw `houseId` / `userId` for primary preview flows.

6. **No local GapFill selector on wired paths** — Diagnostics expose `localGapFillSelectorUsed: false` and `sharedPolicySelectorOwner: selectValidationDayKeys`.

---

## Policy precedence

Highest wins:

1. **`VALIDATION_DAY_POLICY_OVERRIDE_JSON`** (deploy env) — emergency / staging override
2. **Admin saved policy** — FeatureFlag `validation_day_policy.v1`
3. **Code defaults** — `CANONICAL_PAST_VALIDATION_SELECTION_MODE` + `CANONICAL_PAST_VALIDATION_DAY_COUNT` in `pastValidationPolicy.ts`

**Preview-only:** Admin UI “preview with draft” sends `request_preview` overrides to the API; these do **not** persist and do not affect production until saved.

**Per-run overrides removed:** One Path admin UI, Manual GapFill MG-4, and GapFill Lab no longer accept per-run validation mode/count as the source of truth (except GapFill source-copy parity — see below).

---

## Persistence

| Key | Store | Format |
|-----|-------|--------|
| `validation_day_policy.v1` | `FeatureFlag` table via `lib/flags` | JSON |

**Saved JSON shape:**

```json
{
  "selectionMode": "stratified_weather_balanced",
  "validationDayCount": 14,
  "surface": "admin_lab",
  "updatedAt": "2026-06-06T12:00:00.000Z",
  "updatedBy": "admin@example.com"
}
```

**Save confirmation keyword:** `APPLY` (constant `VALIDATION_DAY_POLICY_SAVE_CONFIRMATION`).

**Reset:** Clears FeatureFlag value; active policy reverts to code defaults unless env override is set.

---

## Environment override

**Variable:** `VALIDATION_DAY_POLICY_OVERRIDE_JSON`

**Example:**

```json
{
  "selectionMode": "stratified_weather_balanced",
  "validationDayCount": 14,
  "surface": "admin_lab"
}
```

Documented in `docs/ENV_VARS.md`. Takes precedence over admin-saved policy. Use for staging/emergency only; prefer admin UI for routine changes.

---

## Admin API

**Base:** `/api/admin/tools/validation-day-policy`  
**Auth:** Same as Manual GapFill admin (`gateManualGapfillAdmin` — admin cookie or `x-admin-token`).

### `GET ?surface=admin_lab|user_site`

Returns live snapshot:

- `activePolicy`, `defaults`, `storedPolicy`, `policyHash`, `policyRevision`
- `modeCatalog`, `guardrails`, `wiredSurfaces`
- `confirmationKeyword`

### `POST` actions

| `action` | Body | Behavior |
|----------|------|----------|
| `preview` (default) | `email` (required), optional `houseId`, optional draft `mode` / `validationDayCount` | Resolves house by email; runs `previewGlobalValidationDaySelection`; returns selected keys + diagnostics |
| `save` | `selectionMode`, `validationDayCount`, `surface?`, `confirmation: "APPLY"` | Persists to FeatureFlag; returns updated snapshot |
| `reset` | `confirmation: "APPLY"`, optional `surface` | Clears admin-saved policy |

**Preview requires email.** Raw `houseId`+`userId` without email returns `400 email_required`.

---

## Admin UI

**Page:** `/admin/tools/validation-day-policy`  
**Component:** `components/admin/ValidationDayPolicyAdmin.tsx`

Sections:

1. Current active policy (mode, count, hash, override source, admin-saved record)
2. Wired surfaces list
3. Selection mode reference (how each mode picks days)
4. Guardrails reference
5. **Change global policy** — mode, count, surface, `APPLY` confirmation, Save / Reset
6. **Preview on real home** — user email → load houses → preview selected days (optional draft preview before save)

Nav: Admin dashboard → **Compare Day Policy** (`components/admin/AdminToolsGrid.tsx`).

---

## Wired surfaces

These paths call `resolveGlobalValidationDayKeysForPastSim()` or `resolveActiveValidationDayPolicyLive()` + shared preview:

| Surface | Entry | Notes |
|---------|-------|-------|
| **One Path admin** | `app/api/admin/tools/one-path-sim/route.ts` | All run modes; per-run validation UI overrides removed; keys bounded to canonical window |
| **Manual GapFill MG-4** | `modules/manualUsage/manualGapfillRunReadback.ts` | Past Sim dispatch on lab home |
| **Manual GapFill MG-1/MG-5** | `manualGapfillSourceContext.ts`, `manualGapfillCompare.ts` | Policy hash / alignment checks |
| **GapFill Lab compare** | `app/api/admin/tools/gapfill-lab/route.ts` | Main compare path uses global policy |
| **User-site Past recalc** | `modules/usageSimulator/service.ts` | When `shouldReconcilePastValidationSelection` triggers re-pick |

**One Path UI:** `components/admin/OnePathSimAdmin.tsx` — read-only policy display; loads snapshot from validation-day-policy API; does not send per-run overrides.

---

## GapFill Lab: source-copy parity exception

When GapFill Lab runs **`EXACT_INTERVALS`** with **no** manual test ranges, **no** `testDays` override, and **no** explicit admin validation mode, it enters **source-copy parity**:

- Copies `validationOnlyDateKeysLocal` (and travel ranges) from the **source house Past (Corrected) build inputs**
- Does **not** re-run global policy selection
- **Requires** persisted validation keys on the source build; otherwise `409 canonical_parity_inputs_missing`
- **Hard gate:** source build must carry `validationDayPolicyRevision` + `validationDayPolicyHash` matching the **current active global policy** (`user_site` surface for source-house artifacts). Missing or stale stamps → `409 source_validation_policy_stale` with current/source hashes and refresh instruction. **No silent stale key copy.**
- After gate passes, copied keys are still bounded to the canonical coverage window (`boundDateKeysToCoverageWindow`).

**Intent:** Prove lab matches the source’s **current-policy** Past Sim artifact — not a historical build under an old compare-day policy.

**Operational rule:** Refresh/re-run **source** Past Sim under the active global compare-day policy before source-copy parity. Old artifacts without policy stamps are historical only and must not feed active compare/recalc.

All other GapFill Lab compare paths use **fresh global policy** via `resolveGlobalValidationDayKeysForPastSim`.

## Stale policy rule (active paths)

| Rule | Behavior |
|------|----------|
| Active compare/recalc | Must use current active global policy via `resolveGlobalValidationDayKeysForPastSim` (or source-copy only after policy gate passes) |
| Historical artifacts | May exist in DB without policy stamps; treated as **stale** for source-copy input |
| Source-copy | `gateSourceCopyValidationPolicyMatch()` in `validationDayPolicy.ts` — both revision and hash must match |
| Past recalc stamp | `usageSimulatorBuild.buildInputs` receives `validationDayPolicyRevision` + `validationDayPolicyHash` on recalc (MG-2 metadata only) |
| Auto-refresh | **Not implemented** — hard gate only; admin must explicitly refresh source Past Sim |

---

## Relationship to validation holdout (PC-2026-10)

| Stage | Owner | Question |
|-------|-------|------------|
| **Day selection** (this doc) | `validationDayPolicy.ts` | *Which* days are compare days? |
| **Holdout sim + scoring** | `pastValidationHoldout.ts` | *How* are those days simulated and scored? |

Selected keys become `buildInputs.validationOnlyDateKeysLocal` → `validationHoldoutDateKeysLocal` in the Past producer. Display stitch shows **ACTUAL** on validation days; compare sidecar uses holdout sim totals.

---

## Reconciliation and stale builds

`shouldReconcilePastValidationSelection()` in `pastValidationPolicy.ts` re-picks validation days when:

- Key count is zero or drifted from canonical count
- Stored mode is legacy (`random_simple`) or not canonical
- Policy revision stamp differs from `PAST_VALIDATION_POLICY_REVISION`
- Stored keys look like legacy tail clusters, season-month edge clusters, or lack canonical spread

Manual explicit picks (`storedSelectionMode === manual`) are reconciled only on count mismatch.

After admin policy change, user/admin Past recalc may reconcile on next run when stored build inputs drift.

---

## Tests

| Test file | Covers |
|-----------|--------|
| `tests/usage/validationDayPolicy.test.ts` | Live snapshot, selector wiring, window bounding |
| `tests/usage/validationDayPolicyStore.test.ts` | FeatureFlag persist |
| `tests/usage/pastValidationPolicy.test.ts` | Code defaults; per-request overrides ignored |
| `tests/admin/validationDayPolicy.route.test.ts` | GET snapshot, email preview, save |
| `tests/usage/admin.onePathSim.route.test.ts` | One Path uses global keys |
| `tests/manualUsage/manualGapfillRunReadback.test.ts` | MG-4 global keys |
| `tests/manualUsage/manualGapfillSourceContext.test.ts` | MG-1 policy hash |
| `tests/usageSimulator/service.artifactOnly.test.ts` | Policy helper alignment |

---

## Commit map

| Commit | What |
|--------|------|
| `d9542e06` | MG-2 module + preview API/UI (read-only preview) |
| `5021453f` | Admin persist, full control UI, email preview, wire One Path + Manual GapFill + GapFill Lab, remove per-run overrides |

---

## Doc sync checklist

When changing compare-day policy behavior, update in the same pass:

- This file (`docs/GLOBAL_COMPARE_DAY_POLICY.md`)
- `docs/ADMIN_TOOLS_CONTRACT.md` §7–§8
- `docs/PROJECT_PLAN.md` MG-2 line
- `docs/PROJECT_CONTEXT.md`
- `docs/USAGE_LAYER_MAP.md`
- `docs/SURFACE_PARITY_OWNERS.md`
- `docs/MANUAL_GAPFILL_CLOSEOUT.md`
- `docs/ENV_VARS.md` (if env shape changes)
- `docs/CHAT_BOOTSTRAP.txt`
- `lib/usage/validationDayPolicyCatalog.ts` (UI guardrail copy)
- Bump `PAST_VALIDATION_POLICY_REVISION` when code defaults change
