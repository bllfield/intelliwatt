# Admin Tools Contract

_Last updated: 2026-03-05_

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
- `/api/admin/usage/normalize` — Usage normalization
- `/api/admin/smt/*` — SMT agreements, pull, normalize, billing, etc.
- `/api/admin/efl-review/*` — EFL review queue, process, stats
- `/api/admin/tdsp-tariffs`, `/api/admin/tdsp/rates/*` — TDSP tariffs and refresh
- `/api/admin/flags` — Feature flags
- `/api/admin/tools/prime-past-cache` — Prime past cache
- `/api/admin/tools/usage-shape-profile/rebuild` — Rebuild usage shape profile
