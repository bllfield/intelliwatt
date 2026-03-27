# Usage Simulation Plan (Manual Entry + Partial Usage Backfill)

Phase-specific implementation notes live in `docs/PROJECT_PLAN.md` under "Phase: Manual Entry → Simulated Usage Layer (15-Minute Curve)".

## Purpose
We want **plan cost calculations to always run** even when we do not have a full 12 months of measured usage (SMT / Green Button), by generating **clearly-labeled simulated usage** for missing months.

This is a prerequisite for the next onboarding steps:
- Manual entry (monthly kWh, bills)
- Home details
- Appliances

Those inputs will be used to generate a **15‑minute interval estimate** for the missing period(s), while preserving any real measured usage we do have.

## Core principles / guardrails
- **Never silently fabricate “real” usage**: simulated usage must be tagged and surfaced via a clear disclaimer in the UI.
- **Mode-weighted evidence**: observed-history reconstruction prioritizes measured interval behavior + weather response; home details/appliances act as context/priors/fallback there, and become primary in overlay/synthetic/sparse-data modes.
- **Deterministic + auditable**: given the same inputs, we should regenerate the same simulated series (or store the generated series + an inputs hash).
- **Compatibility with the plan engine**: the generated data must obey the plan engine invariants (e.g., monthly totals match the sum of required period buckets → no `USAGE_BUCKET_SUM_MISMATCH`).

## Canonical Reference Rule

`docs/USAGE_SIMULATION_PLAN.md` is the canonical simulation-logic reference for:
- modeling modes
- home-details weighting by mode
- observed-history priority
- weather-response direction
- fallback hierarchy

Other docs should align to this file and stay shorter unless file-specific detail is required.

## Simulation Modeling Modes (Authoritative)

### 1) Observed-History Reconstruction Mode

Used for Past Sim and Gap-Fill compare scoring/reporting over the shared artifact.

Primary drivers:
- actual interval usage history
- weather/temperature
- weekday vs weekend behavior
- time-of-day behavior
- similar historical day matching

Secondary/supportive drivers:
- home details
- appliance details
- occupancy details
- HVAC/thermostat/pool/EV metadata

Rule: when actual interval history is strong, trust empirical house behavior over declared attributes.

### 2) Overlay / Delta Mode

Used for upgrades and scenario deltas (appliance/HVAC/thermostat/pool/EV/envelope/occupancy changes).

Primary drivers:
- home details
- appliance details
- occupancy details
- HVAC/fuel configuration
- thermostat settings
- pool/EV details
- envelope details

Rule: apply structured add/subtract deltas on top of observed or synthetic baseline behavior.

### 3) Synthetic / Sparse-Data Mode

Used for manual usage simulation, new-build simulation, and sparse-history homes.

Primary drivers:
- declared home/appliance/occupancy details
- HVAC/thermostat/fuel/pool/EV configuration
- weather/temperature
- learned priors from similar homes (when available)

## Home Details Intake and Usage (Authoritative)

Required structured intake includes at minimum:
- home age
- home style
- square feet
- stories
- insulation
- windows
- foundation
- fuel configuration
- HVAC type
- heating type
- thermostat setpoint (summer)
- thermostat setpoint (winter)
- pool presence/details
- EV presence/details
- LED lights
- smart thermostat
- occupants: work, school, home all day, total occupants

Usage weighting by mode:
- Observed-history reconstruction: context/priors/fallback and diagnostics, not primary truth source when interval history is strong.
- Overlay mode: primary modeling inputs for delta construction.
- Synthetic/sparse-data mode: primary modeling inputs for baseline estimation.

### Shared Module Rule

- It is not allowed to implement the same function in two places.
- If logic is needed in multiple places, it must live in one shared module and be consumed from there.
- No duplicate or parallel implementations are allowed for interval derivation, simulated-day generation, daily aggregation, monthly aggregation, summary totals, overlays, bucket generation, or diagnostics transforms.
- If similar code already exists in multiple places, future work must consolidate toward one shared module path and must not add another path.

### Downstream Artifact Boundary Rule

- Do not change current Usage logic as part of Past Sim work.
- Current Usage remains as-is.
- Past Sim Baseline continues to pull from the same saved interval foundation as Usage.
- Past Sim and all downstream stages must treat saved artifacts as stage boundaries.
- Downstream stages must not repeatedly go back to raw usage when a canonical saved artifact already exists for that stage.

### Performance Rule for Past Sim and Beyond

- Optimize for reuse of saved artifacts, not repeated recomputation.
- Every downstream stage should start from the nearest valid saved artifact.
- Avoid rebuilding full prior chains when only later-stage logic changed.
- Bucket generation must consume saved stage artifacts and should not rerun earlier interval pipelines unnecessarily.

### Test Parity and Speed Rule

- Tests are not allowed to recreate alternate logic paths.
- Tests must use the same shared production modules and artifacts.
- No separate test-only business math for intervals, simulated-day generation, daily/monthly aggregation, overlay math, or bucket math.
- Most tests should be stage-local and artifact-based.
- Only a small number of end-to-end tests should run the full chain.
- Past baseline tests should start from saved intervals foundation.
- Overlay tests should start from saved Past Corrected Baseline artifacts.
- Future baseline tests should start from saved Past Corrected Baseline artifacts.
- Bucket tests should start from the saved artifact for that stage.

### Not Allowed

- Same function implemented in multiple files.
- Read-time restitching of Past baseline.
- Second monthly overlay pass after stitched Past baseline is saved.
- Admin-only alternate baseline computation for display.
- Test-only duplicate business logic.
- Recomputing whole upstream chains when a saved artifact already exists for the needed stage.

## Time Alignment Contract (UTC 15-Minute Grid)

- Canonical timebase: UTC, fixed 15-minute slots (96 per UTC day).
- Usage curves (ACTUAL, Past Baseline, Future Baseline) are always represented on this grid.
- Any lookup (weather/solar) must map to these timestamps without shifting or rebucketing usage points.

Weather rules:
- Weather is stored as DAILY rows keyed by `(stationId, dateKey UTC, kind, version)`.
- For a given 15-minute interval timestamp, derive `dateKey = timestamp.slice(0,10)` and lookup that day’s weather row.
- Weather is never used to shift timestamps; it only influences simulated kWh values for intervals that are being synthesized.

Solar rules (future):
- Solar/irradiance is a separate source layer (tile/grid-based), NOT station-based.
- Solar data aligns to the same canonical UTC 15-minute timestamps as usage (or is upsampled deterministically).
- Solar keys will be `tileId/gridId` (or equivalent), not `stationId`, to prevent airport != irradiance mismatch.

Why we chose stations:
- Dedupes DB rows across houses.
- Operationally simple (few stations, deterministic mapping).
- Good enough for temperature-driven usage shaping.
- Solar will be handled separately.

Do Not Do:
- Do not store solar irradiance inside `WeatherDaily`.
- Do not attempt to align solar using county/zip boundaries.
- Do not convert canonical UTC interval timestamps into local time for storage.

## LEGACY / NON-AUTHORITATIVE historical planning notes
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

### Canonical Interval Layer Names

Use canonical layer names from `docs/USAGE_LAYER_MAP.md` and `modules/usageSimulator/kinds.ts`:

- `ACTUAL_USAGE_INTERVALS`
- `BASELINE_INTERVALS`
- `PAST_SIM_BASELINE`
- `FUTURE_SIM_BASELINE`
- `FUTURE_SIM_USAGE`

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

## LEGACY / NON-AUTHORITATIVE historical open questions
- **Annualization semantics**: Do we want “modeled annual kWh” to be a strict 12-month sum, or a “last-365-days” annualized estimate when history is partial?
- **Where do we store the canonical interval series** (master DB vs usage module DB)?
- **How do we pick the calc window** for partial history (still last 365 days ending at latest interval vs “most recent N months” anchored on available data)?
- **How do we explain confidence** (simple label vs numeric score)?

## Finalized Baseline Flow (Authoritative)

### Canonical Past Sim Artifact Rule

- Raw actual usage remains the raw source of truth.
- Past Corrected Baseline is the first canonical derived full-year artifact.
- Past Corrected Baseline is built from:
  - actual SMT intervals for non-travel and non-vacant dates, and
  - shared-core simulated replacement intervals for travel and vacant dates.
- After Past Corrected Baseline is built, it must be saved in the existing Past baseline storage.
- Past page, admin tools, cache restore, diagnostics, and all downstream systems must read that saved stitched artifact.
- No read-time re-stitching.
- No second overlay pass on top of the saved Past baseline artifact.
- No alternate rebuild path for the same Past baseline output.

### GapFill Shared Scoring Rule

- Past Sim and GapFill compare use the same shared artifact identity/fingerprint and the same shared simulator logic path.
- Travel/vacant days are the only excluded ownership days for the shared artifact fingerprint.
- Test days remain included in the shared artifact population and are only selected by GapFill for scoring against actual usage.
- GapFill is a holdout validation workflow, not an artifact-building workflow.
- GapFill may select test days, fetch actual intervals for those days, read matching simulated intervals from shared simulator output for that artifact identity (cached artifact or fresh shared build), and compute metrics/reports.
- GapFill compare default scoring path is shared selected-day fresh calculation (`compareFreshMode=selected_days`) while display/chart rows remain shared artifact-backed.
- Heavy proof mode may explicitly run shared full-window fresh calculation (`compareFreshMode=full_window`) for deeper diagnostics; it is non-default.
- Artifact identity/fingerprint ownership and usage-shape profile contracts remain unchanged in this step; any further identity changes are deferred.
- GapFill must not create a compare artifact, create a compare-mask fingerprint, change artifact identity, or rebuild simulated intervals locally.
- Current branch note: `simulatePastSelectedDaysShared()` is now post-output slicing only, so the older wrapper-level `forceSimulateDateKeysLocal` / `emitAllIntervals` divergence is no longer current runtime behavior.
- Current branch note: canonical simulated-day totals are now finalized in `buildSimulatedUsageDatasetFromCurve()` and consumed by storage/parity through `readCanonicalArtifactSimulatedDayTotalsByDate*()`. Selected-day compare now also consumes surfaced `canonicalSimulatedDayTotalsByDate` from `simulatePastSelectedDaysShared()`, so active compare/parity paths no longer own a second finalized-output day-total authority.
- Current branch note: shared window/date ownership remains locked; compare identity comes from `resolveWindowFromBuildInputsForPastIdentity()`, metadata/report coverage comes from `resolveCanonicalUsage365CoverageWindow()`, and scored/test dates must not mutate artifact fingerprint or travel/vacant exclusion ownership.
- Authoritative shared simulator call chain:
  - `getPastSimulatedDatasetForHouse`
  - `simulatePastUsageDataset`
  - `loadWeatherForPastWindow`
  - `buildPastSimulatedBaselineV1`
  - `buildCurveFromPatchedIntervals`
  - `buildSimulatedUsageDatasetFromCurve`

Alignment note (current runtime state):
- Observed-history reconstruction remains the authoritative Past/GapFill mode.
- Shared weather remains owned by `loadWeatherForPastWindow`, with persisted-weather-first behavior and short-circuit reuse when canonical dates are fully covered by non-stub `ACTUAL_LAST_YEAR` rows.
- Compare snapshot work is runtime orchestration/persistence architecture and does not change simulation modeling authority.

### Stage Boundary Rule

- Usage actual intervals = saved source artifact.
- Past Corrected Baseline = first stitched derived artifact.
- Upgrade Overlay = derived from saved Past Corrected Baseline.
- Future Baseline = derived from saved Past Corrected Baseline plus approved adjustments and overlays.
- Buckets = derived from the saved artifact for that stage, not rebuilt from scratch upstream.

### 1) Usage
Raw actual SMT / GB data.  
Never modified.

### 2) Past Simulated Baseline
Starts from Usage.  
Applies:
- Travel/Vacant replacement (day-level only)
- Leading-missing replacement (day-level only)
- Weather-aware HVAC simulation for those days only
- NEAREST_WEATHER reference-day selection for simulated days when weather-backed candidates exist
- Home Details-gated shaping inputs for SMT baseline:
  - HVAC type + heating type
  - Pool toggle + pool pump seasonal runtime details

Observed-history priority guidance:
- For actual-history reconstruction, empirical behavior (actual intervals + weather + day/time pattern response) is primary.
- Home details and appliance/occupancy fields are supportive context/priors/fallback in this mode.
- Weather influence should come from house-specific historical response and similar-day matching, not just broad monthly averages.

Deterministic simulated-day fallback ladder:
1. `NEAREST_WEATHER` (K-nearest weather reference days from non-excluded, non-leading-missing days; deterministic tie-break by weather distance, temperature distance, then `dateKey`)
2. `MONTH_DOW`
3. `MONTH`
4. `GLOBAL`
5. `UNIFORM`/`ZERO`

Non-simulated days are exact copies.
Occupancy and all other existing Home Details factors remain in the model and are not removed.

### 3) Future Baseline
Starts from Past Simulated Baseline.  
Applies overlay delta logic (upgrades/additions).

### 4) Future Curve
Future Baseline + additional future overlays.

Note:
Weather DB supports:
- ACTUAL_LAST_YEAR
- NORMAL_AVG

Future engine will switch between these depending on scenario.

## Insights / Baseload (Normal-Life V1)

Baseload is computed as a normal-life always-on metric and now excludes low-signal windows that can artificially push it toward zero.

- Excluded days: when excluded date keys are available (for travel/vacant windows), those intervals are removed from baseload sampling.
- Day-quality filter: days below a computed minimum day-kWh floor are excluded from the baseload sample pool to prevent zero-day poisoning.
  - Floor uses `max(minDayKwhFloor, avg(lowest 20% positive day totals) * baseloadDayMultiplier)`.
- Sampling and percentile: remaining interval samples are converted `kWh -> kW` (`kW = kWh * 4`), then baseload is the average of samples at or below p10.
- Fallback safety: if filtering leaves too few samples, the system falls back to prior p10 behavior and marks `baseloadFallbackUsed` (with a debug note) in insights.

This logic is used consistently for Actual and Simulated insight baseloads. It does not modify intervals, totals, or pricing inputs.

