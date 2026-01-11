# Usage Simulation Plan (Manual Entry + Partial Usage Backfill)

## Purpose
We want **plan cost calculations to always run** even when we do not have a full 12 months of measured usage (SMT / Green Button), by generating **clearly-labeled simulated usage** for missing months.

This is a prerequisite for the next onboarding steps:
- Manual entry (monthly kWh, bills)
- Home details
- Appliances

Those inputs will be used to generate a **15‑minute interval estimate** for the missing period(s), while preserving any real measured usage we do have.

## Core principles / guardrails
- **Never silently fabricate “real” usage**: simulated usage must be tagged and surfaced via a clear disclaimer in the UI.
- **Use all available evidence**: measured usage (even partial), plus home details + appliances, should dominate the simulation.
- **Deterministic + auditable**: given the same inputs, we should regenerate the same simulated series (or store the generated series + an inputs hash).
- **Compatibility with the plan engine**: the generated data must obey the plan engine invariants (e.g., monthly totals match the sum of required period buckets → no `USAGE_BUCKET_SUM_MISMATCH`).

## What I understand the task to be
- Build new UI flows for:
  - **Manual usage entry** (months of kWh, optional bill amounts)
  - **Home details** (sqft, occupants, insulation level, HVAC type, pool, EV, etc.)
  - **Appliances** (presence + rough usage patterns)
- From those inputs, generate:
  - A **12‑month usage model** (monthly totals)
  - A **15‑minute interval time series** for the missing months (and optionally for all months for a consistent full-year series)
- Apply the same approach to cases where SMT/Green Button has **< 12 months**:
  - Use measured months as the anchor
  - Simulate only the missing months
- Add prominent user-facing disclosure:
  - “Some usage is simulated” + high-level explanation + confidence indicator

## Terminology
- **Observed usage**: usage derived directly from interval data (SMT/Green Button) or a validated bill import.
- **Manual usage**: user-entered monthly kWh (optionally with bill totals for calibration).
- **Simulated usage**: machine-generated usage for months with missing observed data.

## Target outputs (contract)
For each home, we need a “calculation-ready” annual profile with:
- **12 months of monthly totals** (`kwh.m.all.total` per month)
- Optional additional monthly buckets needed by templates (TOU windows, weekday/weekend splits)
- A **15‑minute interval series** that can be re-aggregated into those monthly buckets deterministically

## High-level approach
### 1) Determine missing-month shape
Identify which months in the last-12-month calc window are missing observed coverage.

We will produce two parallel year-summaries:
- **Observed total**: sum over observed months only (for transparency)
- **Modeled total**: observed months + simulated months (used for plan cost ranking)

### 2) Build a monthly kWh model
Inputs (in priority order):
- **Observed months** (if present): establish baseline, seasonality, weekday/weekend split hints, TOU split hints (if daily buckets exist)
- **Manual monthly kWh entries** (if present): override/anchor missing months
- **Home details**: baseline load + HVAC sensitivity
- **Appliances**: additive loads (pool pump, EV, electric water heater, etc.)

Modeling strategy (v1):
- Fit a simple decomposition:
  - \(kWh_{month} = base + hvac(season) + appliance\_loads\)
- Calibrate so that modeled months with observed data match observed totals (least-squares / bounded scaling).
- Use a conservative fallback if data is sparse (e.g., 1–2 observed months):
  - Favor home-details + appliances more heavily
  - Expand with a Texas seasonality template curve

### 3) Disaggregate monthly totals into 15‑minute intervals
Goal: create a realistic daily load curve that sums to the monthly target.

Strategy (v1):
- Use day-type templates (weekday/weekend) + intra-day shape (morning/evening peaks).
- Apply appliance-specific signatures:
  - EV charging: evening blocks
  - Pool pump: midday steady block
  - HVAC: correlated with seasonality / temperature proxy
- If we have observed intervals for some months, “learn” a shape template from them and reuse it for missing months.

### 4) Ensure plan-engine invariants
Before persisting simulated usage:
- Aggregate generated intervals into monthly buckets and verify:
  - `kwh.m.all.total` matches sum of intervals for that month
  - For any required period buckets we materialize (TOU windows), enforce:
    - `sum(periodBuckets) == kwh.m.all.total` within epsilon
- Store an **inputs hash** for the simulation so we can:
  - detect when the user edits home/appliances/manual usage and we need to regenerate
  - audit exactly which inputs produced a given simulated series

## Data model (planning)
We should avoid mixing simulated usage into raw SMT tables directly.

Proposed storage (conceptual):
- `ManualUsageEntry` (monthly): per-home month rows entered by user
- `HomeDetails` + `ApplianceProfile` (already planned/exists in some form)
- `ModeledIntervalUsage` (15-min): per-home, per-ts, kWh, with:
  - `source = SIMULATED | MANUAL_DERIVED | OBSERVED_MERGED`
  - `inputsSha256`
  - `confidence` / `notes`

We then extend the bucket builder to read from a canonical “interval usage” view that can merge:
- observed SMT intervals (highest priority)
- observed Green Button intervals
- simulated intervals for missing months

## UX / disclosure requirements
- Plans page (and compare/detail) must show a clear note when simulation is used:
  - “Some of your usage is simulated (X of 12 months).”
  - Link to a short explainer (what we used, how to improve accuracy).
- Provide “Improve accuracy” CTA:
  - connect SMT / upload Green Button / enter more months / add appliance details

## Rollout plan (incremental)
- Phase A: Manual monthly kWh entry only → generate monthly buckets (no intervals yet), compute plans with a disclaimer.
- Phase B: Add 15‑minute simulation for missing months, validate aggregation invariants.
- Phase C: Use home details + appliances to improve simulation quality + confidence scoring.
- Phase D: Merge logic for partial SMT/Green Button so every home has a stable 12‑month calc window.

## Open questions to resolve before coding
- **Annualization semantics**: Do we want “modeled annual kWh” to be a strict 12-month sum, or a “last-365-days” annualized estimate when history is partial?
- **Where do we store the canonical interval series** (master DB vs usage module DB)?
- **How do we pick the calc window** for partial history (still last 365 days ending at latest interval vs “most recent N months” anchored on available data)?
- **How do we explain confidence** (simple label vs numeric score)?

