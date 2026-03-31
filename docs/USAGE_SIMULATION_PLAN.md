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
- **Compare / sim integrity (GapFill & shared Past)**: No hidden fallbacks in compare or fresh shared simulation. Missing canonical simulated values stay missing (null / explicit reason codes). **Actual usage must never be copied into simulated-side fields** for scoring or parity. **Invariant violations** (e.g. simulated-day `localDate` vs interval-derived local dates) must surface explicitly; compare fails with `SIMULATED_DAY_LOCAL_DATE_INTERVAL_INVARIANT_VIOLATION` rather than preferring one authority silently.
- **Serverless memory (diagnostics only)**: `simulatePastUsageDataset` clears the engine patched-interval buffer after `buildCurveFromPatchedIntervals` (the curve owns a copy). Any `lab_validation` tagging is diagnostics-only and must not create a separate pre-DB producer truth path.
- **Async droplet execution (optional):** Past sim **recalc** may still enqueue through `SimDropletJob` (`reason: "past_sim_recalc"`). Gap-Fill compare is no longer a queued compare-core pipeline; it stays on the inline canonical launcher/read path and reads persisted lockbox truth only. Staged Gap-Fill readers (`compare_heavy_*`) stay snapshot-read-only by `compareRunId`. **Do not** fork a second simulator or compare engine outside `modules/usageSimulator/service.ts` and the shared Past pipeline.
- **Gap-Fill target pool semantics (product intent)**: The **reference / good-data pool** for the shared Past sim **excludes only** travel/vacant (and similar “bad at-home” exclusions). **Test compare days are good data**: their **actual** intervals **do** contribute to that pool. Travel/vacant days **do not** contribute as reference; they are **filled** by simulation using the rest of the window. **Simulated output** used to **grade** test days must still come from the **same** sim module as travel fills—not meter presented as “sim.”
- **Past stitch vs compare (user Past / shared artifact reads):** The producer (`buildSimulatedUsageDatasetFromCurve`) records **canonical simulated-day totals** for both TEST and TRAVEL_VACANT modeled days and may tag pre-projection daily rows with `SIMULATED_TEST_DAY` vs `SIMULATED_TRAVEL_VACANT`. **User-facing stitched Past** applies **`projectBaselineFromCanonicalDataset`** so **validation-only** dates show **meter-backed ACTUAL** in daily/series (`ACTUAL_VALIDATION_TEST_DAY`), while **TRAVEL_VACANT** days stay **simulated** in the stitch. **`rehydrateValidationCompareMetaFromBuildInputsForRead`** merges `validationOnlyDateKeysLocal` from persisted `buildInputs` when cached artifact JSON omitted keys (fixes empty compare + TEST labels). **`attachValidationCompareProjection`** still reads canonical simulated totals from meta for compare rows—no second simulator. For validation days with actual totals, **`series.intervals15`** is **scaled** to match meter daily total so 15‑minute stitch energy matches the displayed actual day.
- **Past Sim compare UI (user page):** The **Validation / Test Day Compare** block is **collapsed by default**; users expand inline to see the scored-day table and per-day detail. **`attachValidationCompareProjection`** adds optional **day-level weather context** on each compare row by reading the same-date entry from **`dataset.dailyWeather`** (Avg/Min/Max °F, HDD65, CDD65) when present—**display-only**, same basis as the Past daily table; **not** used for scoring and **not** a second weather fetch path. Missing `dailyWeather` for a date is shown explicitly (no fabricated values).
- **Past daily Source column + chart/table parity (display only):** Non-travel simulated days expose the engine reason in the daily table when available (`simulatedReasonCode` → `PastSimulatedDaySourceDetail` in **`buildSimulatedUsageDatasetFromCurve`**, mirrored in **`meta.simulatedSourceDetailByDate`**): e.g. incomplete meter vs leading missing vs generic OTHER—without inventing labels. **`projectBaselineFromCanonicalDataset`** is still the only baseline display flip for validation keys (meter-backed **ACTUAL** / **`ACTUAL_VALIDATION_TEST_DAY`**). After projection, **`dataset.daily`** and **`series.daily`** carry matching **`source`/`sourceDetail`** so the Past chart and daily table agree; the Usage dashboard fallback from **`series.daily`** preserves those fields when top-level **`daily`** is absent.
- **Interval hash vs travel exclusion:** `intervalDataFingerprint` (Past input hash) is a **full-window** checksum of stored actual intervals for identity. **`excludedDateKeysFingerprint`** / travel ranges describe **which calendar days are travel/vacant modeled**, not a second stripped interval hash; TEST-day actual usage remains inside the interval stream and therefore in that fingerprint.
- **Canonical lab actual context (shared parameter):** when calibration uses a reusable test home, recalc/read may specify `actualContextHouseId` (defaulting to `houseId`) so simulated truth still comes from the same shared simulator chain and artifact family without route-side math forks.
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
- **Cache restore / decoded intervals:** On read, `reconcileRestoredPastDatasetFromDecodedIntervals` (in `modules/usageSimulator/dataset.ts`) rebuilds `daily`, `series.daily`, monthly aggregates, and related insights from **decoded `intervals15`** so persisted `datasetJson.daily` cannot retain stale plain `SIMULATED` rows or ghost dates from an older run. Simulated-day membership is taken from **meta** when `simulatedTravelVacantDateKeysLocal`, `simulatedTestModeledDateKeysLocal`, or `simulatedSourceDetailByDate` is present on the artifact; otherwise the prior legacy scan of stored `daily` rows applies. Per-day `sourceDetail` prefers meta; for legacy artifacts with empty `meta`, TRAVEL/TEST labels may still be recovered from the pre-reconcile daily row for that date.
- No read-time re-stitching.
- No second overlay pass on top of the saved Past baseline artifact.
- No alternate rebuild path for the same Past baseline output.

### Gap-Fill Lab: Target architecture (launcher + persisted-truth analysis)

**Purpose:** Tighten the **one** shared Past producer path and validate it without giving Gap-Fill any compare-side simulator ownership.

1. **Canonical window**  
   One identity/coverage window (e.g. full Past year). Gap-Fill launches the same shared Past recalc for that window, then reads the persisted artifact family.

2. **Good-data pool (producer-owned)**  
   - Includes **all** days that represent trustworthy at-home usage, including selected validation/test dates.
   - **Excludes only** **travel/vacant** (and any other explicitly “bad occupancy” exclusions).
   - Gap-Fill does not recompute or override this pool; it only chooses which persisted validation dates to inspect.

3. **Shared producer ownership**  
   Gap-Fill launches `recalcSimulatorBuild` for the canonical Past scenario with the selected validation date keys, then reads the same persisted artifact family through `getSimulatedUsageForHouseScenario`.

4. **Read-only compare truth**  
   Test-day compare truth comes from persisted canonical fields (`canonicalArtifactSimulatedDayTotalsByDate`, `validationCompareRows`, `validationCompareMetrics`, lockbox trace metadata). Gap-Fill may add post-persist metrics/report formatting, but it must not run a Gap-Fill-only pre-DB compare sim. Phase4-gapfill-thin is complete only when the canonical lab path follows this rule.

5. **What “sim” means for test scoring**  
   The simulated kWh shown for test days is the persisted output of the shared Past lockbox run. Actuals on test days are fetched only for scoring/reporting; they never replace the simulated side.

6. **Diagnostics boundary**  
   Gap-Fill trace/debug views are artifact readers. Heavy readers remain snapshot/read-only. After variable collection and normalization, both actual-house and test-house GapFill runs enter the same shared Past Sim recalc/persist chain used by the normal user flow. There is no special GapFill truth path, and compare reads persisted actual-house and test-house artifacts only.

7. **Shared presentation boundary**  
   Gap-Fill actual-house and test-house result panels must reuse the same shared Past presentation module family as the user page for persisted chart/table/compare display. Gap-Fill may add read-only admin wrappers (trace, levers, diagnostics), but it must not fork a second display-truth path or a second chart logic path for Past results.

### GapFill Shared Scoring Rule

- Past Sim and GapFill compare use the same shared artifact identity/fingerprint and the same shared simulator logic path.
- Travel/vacant days are the only excluded ownership days for the shared artifact fingerprint.
- Test days remain included in the shared artifact population and are only selected by GapFill for scoring against actual usage.
- GapFill is a holdout validation workflow, not an artifact-building workflow.
- GapFill may select test days, fetch actual intervals for those days, read matching simulated intervals from the persisted shared artifact identity, and compute metrics/reports.
- GapFill compare truth is artifact-backed: compare rows are read from canonical stored simulated-day outputs (same stored family used by user-facing Past) via `validationCompareRows` / `validationCompareMetrics`.
- After variable collection, GapFill actual-house and test-house runs use the same shared Past Sim recalc entry, simulator modules, dataset build, and artifact persistence path as the normal user flow.
- GapFill compare reads persisted actual-house and test-house artifacts only. It does not simulate, rebuild, or own a second truth path.
- GapFill actual-house and test-house panels are read-only consumers of persisted Past truth. They must surface lockbox flow, fixed inputs, adjustable-vs-forbidden controls, and mode explanations without expanding normal admin write power beyond the existing allowed controls.
- Artifact identity/fingerprint ownership and usage-shape profile contracts remain unchanged in this step; any further identity changes are deferred.
- GapFill must not create a compare artifact, create a compare-mask fingerprint, change artifact identity, or rebuild simulated intervals locally.
- Current branch note: canonical simulated-day totals are finalized in `buildSimulatedUsageDatasetFromCurve()` and consumed from persisted artifact fields (`readCanonicalArtifactSimulatedDayTotalsByDate*()`, compare sidecar meta, lockbox traces). Active Gap-Fill compare/parity paths do not own a second finalized-output day-total authority.
- Gap-Fill analysis is launcher/read-only: it may trigger shared recalc, then consume persisted raw/baseline projections and compare sidecars. Any parity/report slicing happens **after persistence**.
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

## Canonical Validation-Day Selection (2026-03-28)

- One canonical pre-DB producer path remains unchanged: after input normalization, both user Past and GapFill producer writes flow through `simulatePastUsageDataset` on the shared recalc producer settings, then into shared artifact persistence/read (`getSimulatedUsageForHouseScenario`).
- Validation-day selection is now mode-based and shared (`manual`, `random_simple`, `customer_style_seasonal_mix`, `stratified_weather_balanced`), with diagnostics captured on artifact/build metadata.
- Admin has two selectors:
  - System-wide default for user-facing future recalcs.
  - Admin-lab run mode for the current lab execution.
- Future-recalcs-only rule is explicit: changing system default does not rewrite existing artifacts.
- Baseline contract: validation/test days remain ACTUAL in baseline stitch/display outputs; modeled test-day values are surfaced through compare projection sidecar from the same stored simulated-day ownership used by both Past and GapFill.

Where earlier sections in this file conflict with the following, the following section takes precedence.

## AUTHORITATIVE SIMULATOR ARCHITECTURE OVERRIDE

This section overrides any older contradictory guidance in this file.

This override applies to every simulator execution mode and entrypoint, without exception, including:
- initial run
- cold start
- cold build
- cache miss rebuild
- allow_rebuild
- refresh
- explicit recalc
- admin canonical recalc
- user-triggered rebuild
- artifact refresh
- artifact ensure
- snapshot-producing rebuilds
- any future renamed equivalent of these modes

No execution mode is exempt from the rules below.

### 1) One shared simulator producer path only

User Past Sim and GapFill may begin with different user inputs, but after input normalization they must enter the exact same shared simulator producer path.

There must not be:
- a separate user producer path
- a separate admin producer path
- a separate GapFill producer truth path
- a separate "cold_build truth" path for stored simulator outputs
- a separate "recalc truth" path for stored simulator outputs
- a separate "refresh truth" path for stored simulator outputs
- a separate "allow_rebuild truth" path for stored simulator outputs
- a separate "artifact ensure truth" path for stored simulator outputs

Input values may differ. Producer code path may not differ.

### 2) Shared producer output types

The shared simulator producer path must derive and label simulated day outputs before downstream consumers use them.

The labeled simulated day output categories are:

- `TRAVEL_VACANT`
- `TEST`

These labels are producer-owned truth, not UI-only annotations.

### 3) Fingerprint ownership rule

Fingerprint ownership must follow this exact rule:

- exclude only `TRAVEL_VACANT` days from the usage fingerprint
- keep actual usage for `TEST` days included in the usage fingerprint

`TEST` days are not excluded from the usage fingerprint.

This fingerprint rule applies in every simulator execution mode listed above.

### 4) Storage rule

After the shared simulator producer derives simulated day outputs, those outputs become the stored simulator truth used by downstream consumers.

Downstream consumers must not replace this with a separate admin-only simulated truth source.

This storage rule applies regardless of whether the run began as a cold start, refresh, allow_rebuild, explicit recalc, artifact ensure, or any other execution mode.

### 5) Downstream split of responsibilities

After simulated day outputs are produced and stored:

- `stitch` consumes `ACTUAL` days plus `TRAVEL_VACANT` simulated days only to build the stitched Past chart
- `compare` consumes `TEST` simulated days only and compares them against actual interval data for those same test days

`TEST` simulated days do not belong in the stitched Past chart.

`TRAVEL_VACANT` simulated days do not belong in the test-day compare set.

This downstream split applies in every simulator execution mode listed above.

### 6) User page and GapFill truth source

User Past Sim and GapFill must both read the same stored simulation truth and the same stored compare truth when available.

GapFill may add deeper analytics, diagnostics, and tuning surfaces on top of that shared truth, but GapFill must not own a separate simulator truth source or a separate compare truth source.

This is true for cold starts, refreshes, rebuilds, recalc runs, artifact refreshes, and all other simulator entrypoints.

### 7) Compare ownership rule

Compare truth must remain artifact-backed or stored-output-backed. Fresh admin calculations may exist only as diagnostics and must never replace compare truth.

If fresh diagnostics are shown, they must be clearly treated as diagnostics only.

This compare ownership rule applies in every simulator execution mode listed above.

### 8) Selected-days fresh diagnostics rule

In `selected_days` fresh diagnostics mode, scored day totals must come from canonical simulator-owned day totals.

They must not be re-derived by summing intervals in selected-days mode.

Canonical simulator-owned scored day totals are the source of truth for selected-days fresh diagnostics.

### 9) No pre-DB branch divergence

Any divergence between User Past Sim and GapFill before simulated day outputs are written to storage is a bug.

Differences are allowed only in:
- input values
- downstream presentation
- downstream analytics depth

Differences are not allowed in the pre-DB producer path.

This prohibition applies to all execution modes, including cold start, cold build, refresh, allow_rebuild, explicit recalc, admin canonical recalc, artifact ensure, snapshot-producing rebuilds, and future renamed equivalents.

### 10) No execution-mode loophole

A different execution mode name does not create a valid architecture exception.

It is invalid to claim that any of the following may use a different pre-DB producer truth path:
- cold start
- cold build
- refresh
- allow_rebuild
- recalc
- admin canonical recalc
- artifact ensure
- artifact refresh
- cache miss rebuild
- snapshot-producing rebuild
- any future renamed equivalent

If the simulator is producing simulated day outputs before storage, it must be using the same shared producer path.

### 11) No stale simulated data rule

Whenever a simulator run produces new simulated outputs for the same scope and identity, stale simulated data from prior runs must not remain mixed into the new stored results.

This rule applies to both `TRAVEL_VACANT` simulated days and `TEST` simulated days.

For the same scope and identity, a new run must clear, replace, or fully overwrite prior stored simulated-day outputs so the resulting stored truth contains only the outputs from the current run.

Old simulated days from prior test-day selections, prior travel/vacant ranges, prior tuning parameters, prior calculation versions, or prior execution modes must not remain included in the new stored result set.

This no-stale-data rule applies in every simulator execution mode listed above, including refresh, allow_rebuild, explicit recalc, admin canonical recalc, artifact ensure, and any future renamed equivalent.

### 12) Practical interpretation rule for future chats

If a future chat or edit proposal implies any of the following, it is off-plan and must be rejected:

- user Past Sim and GapFill produce stored simulator outputs through different code paths
- a specific execution mode such as cold build, refresh, or recalc is exempt from the shared producer rule
- `TEST` simulated days are not part of shared simulator outputs
- `TEST` days should be excluded from the usage fingerprint
- `TEST` simulated days belong in the stitched Past chart
- GapFill owns a separate simulator truth path
- compare truth should come from a fresh admin-only path instead of stored simulator outputs
- selected-days fresh diagnostics may re-derive scored day totals from interval sums
- stale simulated days from prior runs may remain mixed into the current stored output set

This project must be treated as having one shared simulator producer path, one stored simulator truth, one compare truth source, one stitch ownership rule, and one no-stale-data replacement rule.

## AUTHORITATIVE FAIL-CLOSED TRUTH OVERRIDE

This section overrides any older contradictory guidance in this file.

This fail-closed rule applies to every simulator, artifact, compare, stitch, snapshot, cache-read, cache-write, refresh, rebuild, recalc, allow_rebuild, artifact ensure, artifact refresh, user-facing route, admin route, and any future renamed equivalent of those paths.

### 1) Truth-preserving fallbacks are allowed

A fallback is allowed only if it preserves the same truth and cannot change the meaning of the result.

Allowed examples:
- reading valid cached weather from the database, then falling back to a fresh weather API for the same weather truth
- using a backup weather provider when the primary weather provider is unavailable, if the backup still returns correct weather truth for the same request
- reading equivalent stored source data from a different trusted storage layer when it represents the same identity and same truth

These are allowed because they are source fallbacks, not truth substitutions.

### 2) Truth-substituting fallbacks are forbidden

If the correct simulator truth, compare truth, artifact truth, or stored-output truth cannot be proven correct for the requested surface, the system must fail with an explicit failure state.

It must not silently fall back to:
- latest compatible artifact when exact or correct identity is not proven
- latest by scenario when that may return stale or different truth
- stale data from a prior run
- mixed old and new simulated outputs
- synthetic substitute data
- empty success payloads
- zero-filled compare values
- artifact data substituted for fresh diagnostics truth
- fresh diagnostics substituted for compare truth
- partial data presented as complete truth
- any other substitute source that can change the meaning or correctness of the result

### 3) Fail closed when truth cannot be proven

If correctness cannot be proven, the system must:
- return an explicit failure status
- return an explicit failure code
- return an explicit failure message

The system must not silently degrade into a different truth source.

### 4) Exact identity rule

When a surface requires exact simulator or artifact identity, failure to resolve that exact identity must return an explicit failure.

It must not fall back to:
- latest artifact
- latest by scenario
- nearby identity
- compatible identity
- prior cached identity
- user-page truth substituted into snapshot/admin truth
- admin truth substituted into user-page truth

### 5) Compare rule

Compare truth must remain stored-output-backed or artifact-backed.

If compare truth is missing, incomplete, stale, mixed, or unproven, the compare result must fail explicitly.

Missing compare simulator totals must not be silently converted into numeric `0` values and presented as valid compare output.

### 6) Fresh diagnostics rule

Fresh diagnostics are diagnostics only.

Fresh diagnostics must never replace compare truth.

If canonical simulator-owned fresh scored day totals are required and are missing or incomplete, fresh diagnostics must fail explicitly.

They must not fall back to interval re-sums, artifact totals, zero values, or any substitute source that can change correctness.

### 7) Snapshot rule

If a snapshot surface cannot prove the requested truth, it must return explicit failure.

It must not silently substitute:
- user-facing Past truth
- admin GapFill truth
- another projection
- another artifact
- another scenario
- another identity
- empty success output

### 8) Stale and mixed data rule

Whenever a new simulator run produces new simulated outputs for the same scope and identity, stale simulated data from prior runs must not remain mixed into the new stored results.

This applies to both:
- `TRAVEL_VACANT` simulated days
- `TEST` simulated days

For the same scope and identity, a new run must clear, replace, or fully overwrite prior stored simulated-day outputs so the resulting stored truth contains only the outputs from the current run.

Old simulated days from prior test-day selections, prior travel/vacant ranges, prior tuning parameters, prior calculation versions, prior execution modes, or prior rebuild paths must not remain included in the new stored result set.

### 9) Practical interpretation rule

Future chats and edits must apply this distinction:

- a fallback that preserves the same truth is allowed
- a fallback that can change, dilute, substitute, guess, merge, or misrepresent truth is forbidden

If there is any real risk that a fallback can produce bad data, misleading data, stale data, mixed data, substitute data, or falsely successful data, that fallback must not be used.

### 10) Past lockbox contract alignment

Past simulation now runs through a lockbox split:
- `PastSimLockboxInput` = truth-only engine input
- `PastSimRunContext` = orchestration metadata
- `PastSimReadContext` = post-persist consumer metadata

Weather identity and weather loading for normal graded Past flows are tied to `sourceHouseId`.

`MANUAL_MONTHLY` and `MANUAL_ANNUAL` are distinct internal curve-construction branches even though persistence remains backward-compatible with `SimulatorBuildInputsV1.mode = MANUAL_TOTALS`.

Lockbox stages end at persistence. Artifact reads, baseline/raw projection, compare sidecars, and UI rendering are downstream consumer stages outside the lockbox engine.
