# Admin Tools Contract

_Last updated: 2026-06-06_

This document defines requirements for admin tooling that configures simulation outputs, costs, catalogs, and operations. It does **not** refactor or re-specify existing tools; it establishes the contract that new and existing admin capabilities should satisfy.

**Related:** Test Dates and overlay semantics are defined in [SIM_PLATFORM_CONTRACT.md](./SIM_PLATFORM_CONTRACT.md). How to call admin APIs (token, script) is in [ADMIN_API.md](./ADMIN_API.md).

---

## 1) Scope

- **Must be editable via admin tools:** Anything that affects sim outputs, recommendations, pricing, or user-facing assumptions (e.g. upgrade costs, financing assumptions, overlay parameters, plan rules, feature flags). These should be DB-configurable and editable without code deploy where they impact user-facing or financial outcomes.
- **May remain code constants:** Purely static, non-business constants (e.g. interval cadence, timestamp formats) may stay in code. Seed or default values are allowed for configurable items.

---

## 2) No hardcoded production costs/assumptions

Production costs and business assumptions **must** be configurable (e.g. via DB or admin UI). Hardcoding production cost or assumption values in application code is not permitted. Seed/default values for development or migration are allowed.

---

## 3) Required capabilities buckets

Admin tooling must support (or plan to support) these capability areas:

1. **Tests** — Per-simulator-stage testing utilities (baseline, overlays, projection, rate/ROI) so each stage can be validated independently.
2. **Overlays** — Manage overlay definitions and parameters (aligned with SIM_PLATFORM_CONTRACT.md).
3. **Catalogs** — Upgrades, components (solar, battery, etc.), and plan/rate data editable without deploy.
4. **Load-shift / plan rules** — Rules that affect TOU, load-shift, or plan costing must be editable.
5. **Ops and feature flags** — Feature flags and kill switches for safety where changes can affect production behavior.

---

## 4) Data objects (conceptual only)

The following are **conceptual** data objects. No Prisma/TypeScript schema is implied; this is a doc-only contract for what admin tooling should be able to manage.

| Object | Purpose |
|--------|---------|
| UpgradeItem | Upgrade catalog entry (e.g. HVAC, insulation) affecting overlays or ROI |
| CostModel | Cost/assumption model used for pricing or ROI |
| FinancingAssumption | Financing terms/defaults used in recommendations |
| SolarComponent | Solar system component/catalog entry |
| BatteryComponent | Battery component/catalog entry |
| PlanRule | Plan/pricing rule (e.g. TOU windows, tiers) |
| FeatureFlag | Ops/feature flag or kill switch |
| TestSetDefinition | Definition of test dates / scoring set (see SIM_PLATFORM_CONTRACT.md) |
| OverlayDefinition | Overlay type and default parameters |

---

## 5) Versioning and audit logging

Admin-driven changes to config, catalogs, or assumptions **must** be versioned and auditable (who, what, when). Implementation details are out of scope for this contract; the requirement is conceptual.

---

## 6) Permissions

- Access to admin tools is **admin-only**.
- Enforcement **must** be server-side (e.g. `x-admin-token` as in ADMIN_API.md). Client-side checks alone are insufficient.

---

## 7) Admin home lookup by email (required)

When an admin tool needs a user home for preview, compare, or simulation:

- **Always** resolve identity with **user email** via `lookupAdminHousesByEmail` / `GET /api/admin/houses/by-email`.
- **Do not** require operators to paste raw `houseId` or `userId` in the UI for primary flows.
- House selection after lookup may use a dropdown of houses returned for that email (primary house default).
- Shared helper: `lib/admin/adminHouseLookup.ts`.

This rule applies to Compare Day Policy preview, Manual GapFill, One Path Sim, and new admin tools.

---

## 8) Global compare-day policy (MG-2)

**Canonical doc:** `docs/GLOBAL_COMPARE_DAY_POLICY.md`

- **Owner:** `lib/usage/validationDayPolicy.ts` + admin page `/admin/tools/validation-day-policy`.
- **Persist:** admin saves to FeatureFlag key `validation_day_policy.v1` (confirmation keyword `APPLY`).
- **Precedence:** deploy env `VALIDATION_DAY_POLICY_OVERRIDE_JSON` > admin-saved policy > code defaults in `pastValidationPolicy.ts`.
- **Preview:** user **email** via `/api/admin/houses/by-email` — not raw houseId/userId.
- **Wired surfaces:** One Path, Manual GapFill, GapFill Lab (non source-copy parity), user-site Past reconciliation.
- **Guardrails:** canonical 365-day window bounding, travel exclusion, shared `selectValidationDayKeys` selector.
- **Separate contract:** day *selection* (this policy) vs holdout *scoring* (`docs/PAST_VALIDATION_HOLDOUT.md`).
- **Source-copy refresh:** `EXACT_INTERVALS` source-copy parity refreshes stale/missing source policy stamps via `ensureSourceCopyValidationPolicyFresh()` before copying keys; failures return `source_validation_policy_refresh_failed` / `source_validation_policy_refreshing` / `source_validation_policy_refresh_missing_keys` (not stale key copy). See `docs/GLOBAL_COMPARE_DAY_POLICY.md`.

---

## Existing Admin Tools (Detected)

Inventory derived from the admin dashboard and codebase scan. Purpose is one-line only; no guarantee of completeness.

### Pages

| Path | Purpose |
|------|---------|
| `/admin` | Admin dashboard; links to all tools below |
| `/admin/efl/fact-cards` | Fact Card Parsing Ops: batch parse, review queue, templates, manual loader |
| `/admin/efl-review?source=current_plan_efl` | Current Plan EFL Quarantine: review/resolve unparsed EFLs |
| `/admin/tools/hitthejackwatt-ads` | HitTheJackWatt Social Ads: SVG creatives and captions |
| `/admin/tools/prisma-studio` | Prisma Studio shortcuts (DB/ports) |
| `/admin/plan-engine` | Plan Engine Lab: estimate-set, TOU/Free Weekends, backfill |
| `/admin/tools/bot-messages` | IntelliWattBot copy per dashboard page |
| `/admin/tools/gapfill-lab` | Gap-Fill Lab: compare gap-fill vs actual on masked (travel/vacant) intervals |
| `/admin/tools/usage-shape-profile` | Usage Shape Profile: derive/save shape from 15-min intervals |
| `/admin/helpdesk/impersonate` | Help desk: impersonate user dashboard (audited) |
| `/admin/wattbuy/inspector` | WattBuy Inspector: electricity, retail rates, offers |
| `/admin/wattbuy/templates` | Templated Plans: cached rateStructure, sort for best deals |
| `/admin/tdsp-tariffs` | TDSP Tariff Viewer: delivery tariffs, components, lookup by code/date |
| `/admin/smt/inspector` | SMT Inspector: ingest, upload, health |
| `/admin/usage` | Usage Test Suite: SMT + Green Button pipelines, debug feeds |
| `/admin/weather` | Station Weather Inspector: rows by house/date, STUB vs REAL_API |
| `/admin/simulation-engines` | Simulation Engines: Past/Future/New Build debug by email |
| `/admin/retail-rates` | Retail Rates: explore and manage rate data |
| `/admin/modules` | Modules: view available system modules |
| `/admin/site-map` | Site Map & Routes: inventory of pages and admin tools |
| `/admin/database` | Database Explorer: read-only viewer, search, CSV export |
| `/admin/openai/usage` | OpenAI Usage: tokens and cost by module |
| `/admin/current-plan/bill-parser` | Bill Parser Harness: current-plan parsing, templates |
| `/admin/puct/reps` | PUCT REP Directory: upload REP CSV |
| `/admin/efl/tests` | EFL Fact Card Engine: PlanRules smoke tests |
| `/admin/efl/manual-upload` | Manual Fact Card Loader: EFL PDF upload, PlanRules prompt |
| `/admin/efl-review` | EFL Manual Review Queue: AI-flagged Fact Cards |
| `/admin/efl/links` | EFL Link Runner: fetch EFL PDF URL, fingerprint, open in tab |

### Representative API areas

- `/api/admin/tools/gapfill-lab` — Gap-Fill Lab
- `/api/admin/tools/manual-gapfill/source-context` — Manual GapFill read-only source context (MG-1)
- `/api/admin/tools/manual-gapfill/prepare-seed` — Manual GapFill seed preparation from MG-1 source context (MG-3; dry-run default; optional lab-home persist only; no Past Sim/compare)
- `/api/admin/tools/manual-gapfill/run-readback` — Manual GapFill run/readback from prepared lab seed (MG-4; canonical Past Sim on lab home; no source-vs-sim compare; no inline seed derivation)
- `/api/admin/tools/manual-gapfill/compare` — Manual GapFill source actual vs lab simulated compare (MG-5; admin diagnostic only; no Past Sim/seed writes; no production WAPE/scoring changes)
- `/admin/tools/manual-gapfill` — Manual GapFill admin UI (MG-6 shipped `ae380115`; wires MG-1–MG-5 endpoints client-side; see `docs/MANUAL_GAPFILL_CLOSEOUT.md`)
- `/api/admin/tools/validation-day-policy` — Global compare-day policy control (MG-2): snapshot, save, reset, email-based preview
- `/admin/tools/validation-day-policy` — Compare Day Policy admin UI (global policy + guardrails + preview by email)
- `/api/admin/usage/normalize` — Usage normalization
- `/api/admin/smt/*` — SMT agreements, pull, normalize, billing, etc.
- `/api/admin/efl-review/*` — EFL review queue, process, stats
- `/api/admin/tdsp-tariffs`, `/api/admin/tdsp/rates/*` — TDSP tariffs and refresh
- `/api/admin/flags` — Feature flags
- `/api/admin/tools/prime-past-cache` — Prime past cache
- `/api/admin/tools/usage-shape-profile/rebuild` — Rebuild usage shape profile
