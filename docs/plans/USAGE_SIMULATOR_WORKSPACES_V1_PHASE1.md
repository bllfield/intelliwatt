# Usage Simulator Workspaces (V1) — Phase 1 Build Spec

## Overview (Phase 1)

Phase 1 implements an **intent-driven** simulator that:
- Always shows **Actual usage first** when it exists (SMT or Green Button), with whatever coverage is available.
- Builds **simulated baselines** only when needed (manual, new build, or partial-actual gap-fill).
- Supports **scenario-backed workspaces** (Simulated Past / Simulated Future) without ever modifying Actual usage.

This file is the **canonical Phase‑1 spec**. If `docs/PROJECT_PLAN.md` conflicts with this document, this document wins for Simulator Phase‑1.

**Month granularity only (V1):**
- Scenarios/events are month-level (no day/time scheduling in Phase 1).
- Manual “months” are **billing-period slices** (12 billing periods ending at `anchorEndDate`), even if UI labels them as “months”.

## Definitions

### Actual Baseline
- **Source**: the usage module’s saved dataset (SMT or Green Button), served by `GET /api/user/usage` (same dataset used by `/dashboard/usage`).
- **Immutability**: the simulator **NEVER modifies** actual usage months or intervals.
- **Full coverage**: if actual coverage is **full 12 months**, the baseline is **complete** without needing a simulator build.

### Simulated Baseline
- **Source**: one of:
  - Manual totals (monthly/annual) when there are **no actual intervals**, or
  - New build (no actual intervals), or
  - **Gap-fill only** when SMT/GB actual coverage is **partial (< 12 months)**.
- **Inputs**: Home + Appliances + Occupancy (and Manual totals when applicable).
- **Persistence**: persisted as `UsageSimulatorBuild` with `scenarioKey="BASELINE"`.

### Hybrid Baseline (conceptual)
- A “baseline for simulation purposes” may be **Hybrid** (actual months + simulated months).
- **Critical**: hybrid is conceptual; it does **not** imply rewriting actual data. Only missing months are generated.

### Simulated Past
- A scenario-backed workspace (“Past corrections”) that produces **simulated outputs** via `UsageSimulatorScenario + events`.
- Actual baseline remains untouched.

### Simulated Future
- A scenario-backed workspace (“Future what-if”) that produces **simulated outputs** via `UsageSimulatorScenario + events`.
- Actual baseline remains untouched.

## Entry Flow (Usage Entry owns source selection)

### Rule: Step 1 is NOT a simulator UI step
Source selection happens on the **Usage Entry** page:
- SMT connect
- Green Button upload
- Manual
- New Build

The simulator does **not** show “choose source” cards/buttons. It is entered by redirect with an **intent**, or by partial actual coverage needing gap-fill.

### Simulator entry intents (authoritative)

The simulator is entered only via the following contexts:

- **`intent=MANUAL`**
  - Trigger: user selected Manual on Usage Entry.
  - Simulator behavior: focus Manual totals + Step‑2 checklist.

- **`intent=NEW_BUILD`**
  - Trigger: user selected New Build on Usage Entry.
  - Simulator behavior: focus Step‑2 checklist (no manual totals required).

- **`intent=GAP_FILL_ACTUAL`**
  - Trigger: user connected SMT or uploaded Green Button, but actual coverage is **partial (< 12 months)**.
  - Simulator behavior:
    - show Actual baseline (from `GET /api/user/usage`) immediately
    - require Step‑2 inputs
    - generate a simulated baseline build that fills **missing months only** (gap-fill rule)

- **Full SMT/GB (actual coverage is full 12 months)**
  - Trigger: user has full actual coverage.
  - Behavior: no redirect required to “choose source”. Simulator is optional only for scenarios once baseline is established.

## Baseline Rules (must match exactly)

### A) Baselines

#### ACTUAL BASELINE
- Source: usage module’s saved SMT or Green Button dataset (same as `/dashboard/usage`; served by `/api/user/usage`).
- Simulator NEVER modifies actual usage months or intervals.
- If actual coverage is full 12 months, baseline is complete without needing a simulator build.

#### SIMULATED BASELINE
- Used when:
  - Manual totals (no actual intervals), OR
  - New Build (no actual intervals), OR
  - GAP-FILL ONLY when SMT/GB partial (< 12 months).
- Uses Home + Appliances + Occupancy (and Manual totals when applicable).
- Persists as `UsageSimulatorBuild` with `scenarioKey="BASELINE"`.

#### GAP-FILL RULE (critical)
- For partial SMT/GB, simulate ONLY missing months deterministically.
- Do NOT rescale, reshape, or modify actual months in any way.
- The “baseline for simulation purposes” can be HYBRID (actual months + simulated months), but only missing months are generated.

### B) Manual totals immutability
- Never modify user-entered monthly or annual kWh totals.
- Simulator only generates a 15-minute curve that exactly sums to those totals within each billing period bucket.
- Annual entry:
  - annual is authoritative
  - a deterministic monthly split may be generated once for that build, then treated as anchored monthly totals

### C) Manual anchor date (billing-cycle)
- Manual usage requires a FULL DATE `anchorEndDate` (meter read end date `YYYY-MM-DD`) in America/Chicago.
- Manual canonical window = 12 BILLING PERIODS ending at `anchorEndDate` (not calendar months).
- UI may label as “months” in V1, but engine buckets are billing-period slices.

## Step 2 Requirements (inputs for simulation)

### Required (Phase 1)
- Home details: required fields needed by the estimator (e.g., home size) + HVAC/fuel configuration where applicable.
- Appliances: required fields needed by the estimator (major loads and fuel configuration).
- Occupancy: the values used by the estimator.

### Conditional
- `intent=MANUAL`: Manual totals (monthly or annual) must be present and valid.
- `intent=NEW_BUILD`: Manual totals are not required.
- `intent=GAP_FILL_ACTUAL`: Manual totals are not required.

## Gating / Unlock Rules

Scenario tools (Simulated Past/Future) are unlocked only after baseline is established.

### What “baseline established” means
- **Full SMT/GB**: baseline established when actual usage exists (usage module). Step‑2 inputs may still be required before scenario simulation can run.
- **Manual / New Build / Partial SMT/GB**: baseline established when a simulated baseline build exists (`UsageSimulatorBuild` with `scenarioKey="BASELINE"`).

## Workspaces UI (Actual / Past / Future)

### Actual
- Dataset: `GET /api/user/usage`
- Notes: read-only display; never modified by simulator.

### Simulated Past (workspace)
- Dataset: simulator scenario-backed build for the Past workspace scenario.
- Events: stored as `UsageSimulatorScenarioEvent` month-granular events.

### Simulated Future (workspace)
- Dataset: simulator scenario-backed build for the Future workspace scenario.
- Events: stored as `UsageSimulatorScenarioEvent` month-granular events.

## Adjustment Catalog (V1)

Phase‑1 adjustments must compile to existing overlay semantics:
- Scenario events remain `kind="MONTHLY_ADJUSTMENT"`.
- Payload compiles to:
  - `multiplier?: number`
  - `adderKwh?: number`

The catalog’s purpose is UX structure (dropdown + required fields), not new physics. Detailed impact math is out of scope in Phase 1.

## Weather Normalization (stub)

Phase 1 shows a UI option and stores a preference, but behavior is identity:
- Identity behavior: does not change totals or intervals in Phase 1.
- Version hook exists so future math can be introduced without ambiguity.
- Storage: store preference in buildInputs or scenario event payload; do NOT require new scenario metadata schema in Phase 1.

## Out of Scope (Phase 1 non-goals)

- No plan engine integration changes.
- No detailed physics/engineering logic (HVAC specs, solar export, pool schedules, weather normalization math).

## Acceptance Tests / Verification (Phase 1)

1) **No usage data**
- Usage Entry selection:
  - Manual → redirects to simulator with `intent=MANUAL`
  - New Build → redirects to simulator with `intent=NEW_BUILD`
- Simulator:
  - generates simulated baseline for full 12 billing periods
  - persists as `scenarioKey="BASELINE"`

2) **Green Button only, full 12 months**
- Simulator shows Actual baseline (from `/api/user/usage`)
- Baseline is complete without requiring a simulator build
- Scenarios are optional once baseline is established (and Step‑2 details are complete for simulation)

3) **Green Button partial (< 12 months)**
- Simulator shows Actual baseline immediately
- After Step‑2 inputs, simulator generates simulated baseline that fills ONLY missing months
- Confirm actual months are unchanged; only missing months/intervals are simulated

4) **SMT partial (< 12 months)**
- Same as Green Button partial

5) **Manual monthly/annual with anchorEndDate mid‑month**
- Example anchor: `anchorEndDate=2026-02-18` (America/Chicago)
- Canonical window is 12 billing periods ending at that date (not calendar months)
- Totals immutability:
  - monthly totals unchanged
  - annual total unchanged (if annual mode)
  - generated 15‑minute curve sums correctly per billing period

6) **Global immutability assertions**
- Actual months unchanged (no rewrite of SMT/GB)
- Manual totals unchanged (no rescale/overwrite)
- Only simulated intervals are generated beneath fixed totals

