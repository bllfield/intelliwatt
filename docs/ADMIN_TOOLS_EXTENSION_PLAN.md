# Admin Tools Extension Plan (additive only)

_Generated from audit; implementation not started. Do not redesign existing admin IA; add sections/buttons/forms only where capabilities are missing._

---

## Step A — Existing admin tools inventory

| Route | Purpose | Data source | What it edits | What it is missing |
|-------|---------|-------------|---------------|--------------------|
| `/admin` | Dashboard; links to all tools | — | — | — |
| `/admin/efl/fact-cards` | Fact Card Parsing Ops: batch parse, review queue, templates, manual loader | Current-plan DB, EFL storage, RatePlan | Templates, batch queue, manual URL/upload | — |
| `/admin/efl-review` | Current Plan EFL Quarantine; AI-flagged Fact Cards | EFL review queue (DB) | Resolve/open, queue reason | — |
| `/admin/tools/gapfill-lab` | Compare gap-fill vs actual on Test Dates / masked intervals | Usage DB, getPastSimulatedDatasetForHouse, UsageShapeProfile | None (read-only compare + prime cache trigger) | Explicit “baseline build” step test; overlay-application check |
| `/admin/tools/usage-shape-profile` | Derive/save usage shape from 15-min intervals | Usage DB, intervals | UsageShapeProfile (save) | — |
| `/admin/tools/prime-past-cache` (via `/admin/usage`) | Prime Past cache for gapfill-lab (scenarioId gapfill_lab) | getPastSimulatedDatasetForHouse, pastCache | PastSimulatedDatasetCache | — |
| `/admin/simulation-engines` | Debug Past/Future/New Build by email; payloads, profile, weather, curves | Build inputs, service, simulatedUsage engine | None (debug output only) | Structured “baseline build” test runner; overlay application check |
| `/admin/plan-engine` | Plan Engine Lab: estimate-set, TOU/Free Weekends, backfill | Plan engine, materialized estimates | Backfill/materialize (offers) | Editable TOU/heuristics not exposed here |
| `/admin/plan-analyzer/tests` | PlanRules/Plan Analyzer smoke tests | Synthetic PlanRules | None | — |
| `/admin/efl/tests` | EFL Fact Card Engine smoke tests | Deterministic + AI extraction | None | — |
| `/admin/retail-rates` | Explore and manage retail rate data | RatePlan, WattBuy, rates | Seed/sync retail rates | Not a “cost catalog” for upgrades/financing |
| `/admin/tdsp-tariffs` | TDSP Tariff Viewer; delivery tariffs, lookup by code/date | TDSP ingest, TdspTariff* | Tariff ingest/refresh (separate flows) | — |
| `/admin/current-plan/bill-parser` | Bill parsing harness, templates | Current-plan, EFL | Templates, parse results | — |
| `/admin/wattbuy/inspector` | WattBuy electricity, retail rates, offers | WattBuy API, RatePlan | None (probe only) | — |
| `/admin/wattbuy/templates` | Templated Plans with cached rateStructure | RatePlan, OfferIdRatePlanMap | View/sort only | — |
| `/admin/database` | Read-only DB viewer, search, CSV export | Master/usage/other DBs | None | — |
| `/admin/openai/usage` | OpenAI usage/tokens/cost by module | Log store | None | — |
| `/admin/tools/bot-messages` | IntelliWattBot copy per dashboard page | DB/store | Bot message copy | — |
| `/admin/flags` (API) | Feature flags GET/POST | lib/flags (e.g. env or store) | Flag key/value | — |
| `/admin/smt/inspector`, `/admin/usage`, `/admin/weather` | SMT ingest, usage pipelines, weather rows | SMT, usage DB, weather | Normalize, inspect; weather STUB/REAL | — |
| `/admin/puct/reps` | PUCT REP Directory: upload REP CSV | PuctRep (code or DB) | REP list | — |
| `/admin/helpdesk/impersonate` | Impersonate user dashboard | Auth/session | Session (audited) | — |
| Upgrade ledger (user-facing) | Scenario upgrades: add/edit ledger entries (upgradeType, costUsd, etc.) | Upgrades DB (UpgradeLedger) | Ledger rows per user/scenario | No **admin** catalog for default upgrade costs or financing assumptions |

**Cost tables / product specs:** Upgrade costs today are per-row in `UpgradeLedger` (costUsd, costJson). There is no admin-editable “upgrade cost catalog” or global product specs. Rate plan inputs and TDSP/retail data are edited via retail-rates, TDSP ingest, and EFL/templates—not a single “plan rules” or “cost assumption” admin surface.

**Simulation test tooling:** Gap-Fill Lab and Simulation Engines provide diagnostics and compare outputs; they do not expose a dedicated “run baseline build only” or “run overlay application check” step. Prime-past-cache is additive and used by gapfill-lab.

---

## Step B — Admin Tools Extension Plan (additive only)

**Constraints:** Reuse existing admin patterns and components. Do not replace existing pages. Add new sections/buttons/forms only. Each new capability: name, route (or where it lives), DB model touched (if any), fields editable, validations.

### Shared Module Rule

- It is not allowed to implement the same function in two places.
- If logic is needed in multiple places, it must live in one shared module and be consumed from there.
- Admin tools may orchestrate shared modules but may not create duplicate or parallel implementations of interval derivation, simulated-day generation, daily/monthly aggregation, summary totals, overlays, bucket generation, or diagnostics transforms.

### Canonical Past Sim Artifact Rule

- Raw actual usage remains the raw source of truth.
- Past Corrected Baseline is the first canonical derived full-year artifact.
- After Past Corrected Baseline is built, it must be saved in existing Past baseline storage.
- Admin reads and inspections must use the saved stitched artifact and must not perform read-time re-stitching.

### Admin Tool Consistency Rule

For `/admin/simulation-engines`, `/admin/tools/gapfill-lab`, and related tooling:

- Tools must inspect the same saved artifacts production uses.
- Tools are not allowed to compute alternate versions of the same baseline for display.
- Tools must clearly show:
  - raw actual source,
  - simulated replacement source,
  - saved stitched Past baseline artifact.
- Admin rebuild actions may regenerate and resave the canonical artifact.
- Admin read and inspect actions must use the saved artifact.

### Performance Rule for Past Sim and Beyond

- Optimize admin tooling for reuse of saved artifacts, not repeated recomputation.
- Downstream admin checks should start from the nearest valid saved artifact for that stage.
- Avoid rebuilding full upstream chains when validating only a later stage.

### Test Parity and Speed Rule

- Admin tool tests must use the same shared production modules and artifacts.
- No test-only duplicate business logic for interval, simulation, aggregation, overlay, or bucket math.
- Prefer stage-local artifact-based tests and keep only a small set of full-chain end-to-end checks.

### Not Allowed

- Same function implemented in multiple files.
- Read-time restitching of Past baseline.
- Second monthly overlay pass after stitched Past baseline is saved.
- Admin-only alternate baseline computation for display.
- Test-only duplicate business logic.
- Recomputing whole upstream chains when a saved artifact already exists for the needed stage.

---

### Category 1) Test runners / diagnostics: baseline build, gapfill scoring, overlay application checks

| Capability | Already exists? | If no, add where | DB/model | Fields / behavior | Validations |
|------------|-----------------|-------------------|----------|--------------------|-------------|
| Baseline build test (run past_baseline_raw → baseline_corrected only) | **No** | Add section or link on `/admin/simulation-engines` or `/admin/tools/gapfill-lab`: “Run baseline build only” (same inputs as Past, return contract IntervalDataset or summary). | None (read-only) | Email/houseId, window; output: point count, kind, window, coveragePct (from contract). | Window required; email/houseId required. |
| Gapfill scoring (Test Dates vs actual) | **Yes** | `/admin/tools/gapfill-lab` — “Run Compare” already runs getPastSimulatedDatasetForHouse (or test-days profile) and computeGapFillMetrics. | None | — | — |
| Overlay application check (apply OverlayResult to IntervalDataset, verify clamp/composition) | **No** | New small section on `/admin/simulation-engines` or new page `/admin/tools/overlay-check`: upload or pick base dataset + overlay JSON; call lib/sim/contract applyOverlays; show result + clamp diagnostics. | None | Input: base (or ref to cached), overlays JSON. Output: dataset + clampedCount, clampedSample. | Schema validate OverlayResult; window match. |

---

### Category 2) Editable costs: upgrade cost catalog + financing parameters + assumptions

| Capability | Already exists? | If no, add where | DB/model | Fields editable | Validations |
|------------|-----------------|-------------------|----------|------------------|-------------|
| Upgrade cost catalog (default/typical costs per upgrade type) | **No** | New admin page or section: e.g. `/admin/catalogs/upgrade-costs` or section under `/admin/retail-rates` or new “Catalogs” area. | New or existing: e.g. `UpgradeCostCatalog` (upgradeType, region?, costUsd, effectiveFrom, effectiveTo, source). Or extend a config table. | upgradeType, costUsd, optional region, effective range, notes. | upgradeType required; costUsd >= 0; effective range valid. |
| Financing parameters / assumptions | **No** | Same catalogs area or “Assumptions” page: e.g. `/admin/catalogs/financing` or `/admin/assumptions`. | New or existing: e.g. `FinancingAssumption` (key, valueJson, effectiveFrom, effectiveTo). | Interest rate, term, rebate defaults, etc. | Key required; valueJson valid. |
| Global “assumptions” (e.g. escalation, discount rate) | **No** | Same as above or single “Assumptions” admin page. | Config or key-value table. | Keys as per product (e.g. escalationPct, discountRate). | Numeric ranges as needed. |

---

### Category 3) Editable recommendation knobs: TOU shift heuristics, appliance schedule assumptions, solar/battery assumptions

| Capability | Already exists? | If no, add where | DB/model | Fields editable | Validations |
|------------|-----------------|-------------------|----------|------------------|-------------|
| TOU shift heuristics (e.g. shift % by period) | **No** | New section on existing plan-engine or simulation page, or `/admin/knobs/tou`. | Config/key-value or new table. | Period labels, default shift %, on-peak/off-peak rules. | Valid period keys; percentages in range. |
| Appliance schedule assumptions | **No** | Same knobs area or `/admin/knobs/appliances`. | Config or table. | Default schedules, duty cycles, etc. | Schema per engine. |
| Solar/battery assumptions (defaults for ROI or simulation) | **No** | Same knobs area or `/admin/knobs/solar-battery`. | Config or table. | Default efficiency, degradation, inverter ratio, battery round-trip, etc. | Numeric ranges; required fields. |

---

### Category 4) Data entry for overlays: past/future upgrades producing 15-min delta curves (contract invariant)

| Capability | Already exists? | If no, add where | DB/model | Fields editable | Validations |
|------------|-----------------|-------------------|----------|------------------|-------------|
| Overlay definitions (type, default params, 15-min delta generator config) | **No** | New admin page: e.g. `/admin/catalogs/overlays` or section under simulation. | New: e.g. `OverlayDefinition` (overlayType, overlayClass, defaultInputsJson, version). | overlayType, overlayClass (applied/scenario), defaultInputsJson, version. | overlayType required; overlayClass enum; defaultInputsJson valid. |
| Past/future upgrade ledger → 15-min deltas | **Partial** | User-facing ScenarioUpgradesEditor + UpgradeLedger already drive computePastOverlay/computeFutureOverlay (month-level). Contract expects interval-level OverlayResult. | UpgradeLedger (existing); overlay engine (code) | No new admin CRUD for ledger; add engine support to produce OverlayResult (deltas) from ledger + baseline. | — |
| Admin CRUD for “test” overlay definitions (to drive overlay check tool) | **No** | With overlay check (Category 1): allow picking stored OverlayDefinition or pasting OverlayResult JSON. | OverlayDefinition if added. | As above. | Schema validate. |

---

## Minimal additive implementation sequence

1. **Baseline build test (read-only)**  
   Add a small section or button on `/admin/simulation-engines` or gapfill-lab that runs the same Past build path and returns (or displays) contract-shaped summary (e.g. point count, kind, window) using the new `lib/sim/baselineAdapter` without changing any route response shape. No new API route required if done client-side with existing simulation-engines API.

2. **Overlay application check (read-only)**  
   Add page or section that accepts base dataset (e.g. JSON or reference) + overlay(s) JSON, calls `applyOverlays` from `lib/sim/contract/overlay`, displays result and clamp diagnostics. No DB until OverlayDefinition is added.

3. **Upgrade cost catalog (new table + admin UI)**  
   Add DB model for default/typical upgrade costs (e.g. UpgradeCostCatalog); add one admin page or section to list/edit by upgradeType (and optional region). Wire to recommendation/ROI code so it can read defaults when ledger row has no costUsd.

4. **Financing / assumptions (config or table + admin UI)**  
   Add key-value or structured table for financing parameters and global assumptions; add admin form to edit. Keep seed defaults in code for dev; production reads from DB.

5. **TOU / appliance / solar-battery knobs (config or table + admin UI)**  
   Same pattern: config table or key-value; admin form; engine reads from DB with code defaults as fallback.

6. **OverlayDefinition table + admin CRUD**  
   Add table for overlay type definitions (overlayClass, defaultInputsJson, version); admin list/add/edit. Optionally wire overlay-check tool to list stored definitions.

7. **Interval-level overlay from ledger (engine change, not admin)**  
   When implementing Phase 3/4 of sim platform, add code path that produces OverlayResult (deltas) from UpgradeLedger + baseline; no new admin CRUD for ledger.

---

**Already exists: summary**

- **Test runners / diagnostics:** Gapfill scoring and simulation-engines debug exist; baseline-build-only and overlay-application-check do not.
- **Editable costs:** No upgrade cost catalog or financing/assumptions admin.
- **Recommendation knobs:** No admin for TOU heuristics, appliance schedules, or solar/battery assumptions.
- **Overlay data entry:** Ledger exists for user upgrades (month-level); no admin OverlayDefinition catalog and no interval-level OverlayResult CRUD.
