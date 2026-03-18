# IntelliPath Phase 1 Launch Checklist

**Mark each item complete only after implementation + testing are both done.**

---

## Phase 1 goal and scope

- **Goal:** Get the site live and launched with a working path from usage source to plan recommendation and switch.
- **Launch objective:** User enters usage source (or simulation path), system builds current-state baseline, runs plan engine, displays best plans, and user can click through to switch.
- Phase 1 must support both competitive-market users and regulated/co-op users.
- Competitive-market users must receive best-plan recommendations.
- Regulated/co-op users must still receive value by seeing how solar and upgrades affect their current plan, even when no alternate plan recommendation is available.
- Phase 1 must support side-by-side comparison of plan results with and without solar.
- **Rule:** Phase 1 is NOT upgrades/solar ROI; it is the core pipeline only.
- **Core pipeline:**  
  `usage source → baseline/simulation → overlays → final grid behavior → canonical dataset → plan engine → best plan`

---

## Implementation order

1. Simulator validation fixes
2. Baseline pipeline lock
3. Applied overlays
4. Manual monthly simulation
5. Manual annual simulation
6. New home simulation
7. Solar + battery simulation
8. Canonical dataset standardization
9. Plan engine integration
10. Launch UI path
11. Minimum Phase 1 admin tools

---

## Plan blocks (build one at a time)

Each block is a unit of work: plan it, then build and test it, then move to the next. Do not start the next block until the current block’s checklist items and success criteria are satisfied.

**Plan Block 1 — Foundation (weather + simulator validation)**

- **Steps:** Step 0 (real weather API), Step 1 (fast simulator validation path)
- **Scope:** Hook up real weather API; fix random-day training selection; stabilize profile generation.
- **Outcome:** Weather available for simulation; gapfill validation path stable; no zero-sim/join regressions.
- **Checklist refs:** Step 0, Step 1.1, Step 1.2

---

**Plan Block 2 — Baseline pipeline lock**

- **Steps:** Step 2 (lock baseline pipeline)
- **Scope:** Keep existing corrected baseline canonical; expose past_baseline_raw and baseline_corrected via adapters; define current-state baseline builder (corrected + applied overlays).
- **Outcome:** Baseline layers explicit; current-state baseline can be produced from corrected + overlays; plan engine can consume once wired.
- **Checklist refs:** Step 2.1, Step 2.2, Step 2.3

---

**Plan Block 3 — Applied overlays**

- **Steps:** Step 3 (applied overlay engine)
- **Scope:** Build overlay engine for thermostat, pool, EV, existing solar, existing battery, declared appliances; every overlay produces 15-minute delta curve.
- **Outcome:** Current-state baseline reflects existing home conditions; same timestamp set; clamp diagnostics.
- **Checklist refs:** Step 3

---

**Plan Block 4 — Manual and new-home simulation**

- **Steps:** Step 4 (manual monthly), Step 5 (manual annual), Step 6 (new home simulation)
- **Scope:** Manual monthly and annual (monthly/annual totals → 15-min canonical dataset); new home simulation (profile + priors → 15-min dataset). All output current-state baseline.
- **Outcome:** Three usage-source paths produce canonical 15-minute datasets; plan engine can accept them without special casing.
- **Checklist refs:** Step 4, Step 5, Step 6

---

**Plan Block 5 — Solar + battery simulation**

- **Steps:** Step 6.5 (solar + battery simulation engine)
- **Scope:** Solar as 15-minute production curve; battery as 15-minute dispatch layer; solar before battery; battery before plan pricing; grid_import_kwh and grid_export_kwh streams. Respect hard architectural rules.
- **Outcome:** Solar and battery modeled as physical layers; net grid import/export dataset at 15-minute resolution; no collapse to monthly before pricing.
- **Checklist refs:** Step 6.5 (solar + battery subsections)

---

**Plan Block 6 — Standardization and plan engine**

- **Steps:** Step 7 (standardize all sources), Step 8 (connect to plan engine + solar plan modeling)
- **Scope:** One canonical output standard for all sources (including solar/battery); plan engine consumes final net grid behavior only; TOU, free-night, fees; solar buyback schema and validation; battery validation.
- **Outcome:** All sources produce ranked plans; import/export separate streams; no source-specific crashes; solar and battery pricing correct.
- **Checklist refs:** Step 7, Step 8, Step 8 Solar plan modeling

---

**Plan Block 7 — Launch UI and admin tools**

- **Steps:** Step 9 (launch UI path), Step 10 (minimum Phase 1 admin tools)
- **Scope:** End-to-end launch journey (source → baseline → plan engine → best plans → switch); required UI outputs; Gap-Fill Lab, Vacant/Travel, profile inspect; Phase 1 cost/knob admin (profile, seasonality, appliance/solar/battery assumptions, solar override, battery dispatch knobs).
- **Outcome:** Complete path for all supported sources; affiliate flow trackable; minimum admin tools for launch behavior.
- **Checklist refs:** Step 9, Step 10

---

## What is already complete

### Complete enough to reuse

- [x] Smart Meter Texas / Green Button actual usage ingestion
- [x] Past corrected baseline path
- [x] Gap-Fill Lab and test framework
- [x] Sim contract layer
- [x] Baseline adapters
- [x] Existing plan engine
- [x] Existing plan ranking
- [ ] Existing affiliate/switching direction

### Not complete

- Past/applied overlay path is not finished at 15-minute level
- Future/scenario overlay path is not finished at 15-minute level
- Manual monthly simulation has not really been built
- Manual annual simulation has not really been built
- New home simulation has not really been built
- Admin tooling for simulation tuning / costs / assumptions is incomplete
- Solar simulation engine has not been built
- Solar buyback plan modeling has not been implemented
- Solar credit logic is not yet integrated into the plan engine
- EFL reader does not yet extract solar addendum / buyback terms
- Battery simulation engine has not been built
- Battery dispatch logic is not yet integrated into the plan engine
- Battery charging/discharging policy is not yet modeled for TOU / free-night plans
- Weather integration quality still needs hardening for all launch paths (while retaining truthful fallback behavior where data is unavailable)
- Competitive-market vs regulated/co-op plan handling is not fully implemented
- Current-plan impact modeling for regulated/co-op users is not yet integrated into the simulation + pricing flow
- Side-by-side comparison of with-solar vs without-solar plan results is not yet implemented

---

## Canonical dataset stack for Phase 1

| Layer | Label | Definition |
|-------|--------|------------|
| 1 | Usage | Actual or simulated raw usage (e.g. SMT/GB intervals) |
| 2 | Past Baseline Raw | Reconstructed/gap-filled past before corrections |
| 3 | Corrected Baseline | Past baseline after corrections (travel, missing data, etc.) |
| 4 | Current-State Baseline | Corrected Baseline + applied (past) overlays |
| 5 | Projected Usage | Current-State Baseline + scenario (future) overlays |

- **Current-State Baseline** = Corrected Baseline + applied overlays. This is the main input to the plan engine for Phase 1.
- **Projected Usage** = Current-State Baseline + scenario overlays. Not required for launch unless needed by launch UI.

### Simulation modeling modes (alignment summary)

- Canonical simulation-logic reference is `docs/USAGE_SIMULATION_PLAN.md`.
- Observed-history reconstruction (Past Sim + GapFill compare) should prioritize empirical interval + weather/day-time behavior.
- Overlay mode should apply structured home/appliance/occupancy/HVAC/thermostat/pool/EV/envelope deltas.
- Synthetic/sparse-data mode (manual/new-build/low-history) should prioritize declared details + weather + learned priors.

---

## Hard architectural rules for solar + battery

These are non-negotiable implementation rules for Phase 1:

- Solar must be modeled as a physical 15-minute production curve, not as a monthly bill credit adjustment.
- Battery must be modeled as a 15-minute dispatch layer, not as a pricing adjustment inside the plan engine.
- Solar production must be applied before battery dispatch.
- Battery dispatch must be applied before plan pricing.
- Plan engine must price final net grid behavior only.
- Import and export must remain separate streams before pricing.
- Solar buyback terms must be modeled separately from the base energy plan because EFL parsing alone will not reliably capture solar addenda.
- No implementation in Phase 1 may collapse solar or battery behavior into monthly net usage before pricing.
- Solar production and battery dispatch must be implemented as overlays in the simulation stack.
- Simulation order must always be: baseline usage + applied overlays + solar generation overlay + battery dispatch overlay = final net grid behavior.
- This ensures all simulation paths share a single canonical pipeline and prevents duplicate solar/non-solar execution paths.
- Battery dispatch policies must be plan-agnostic in Phase 1.
- Battery behavior must be simulated before the plan engine runs.
- The plan engine may only price the resulting grid imports and exports and must never influence battery dispatch decisions.
- Solar production must never be applied as a monthly billing adjustment.
- Solar production must always be represented as a 15-minute generation curve that modifies usage before pricing.
- Monthly net usage calculations are forbidden in the pricing pipeline.
- Regulated/co-op users must not be forced through a best-plan recommendation flow when no alternate market plans apply.
- For regulated/co-op users, the pricing engine must be able to evaluate solar and battery impacts against the user's current plan only.
- Competitive-market and regulated/co-op pricing flows may share the same simulation pipeline, but the recommendation/output layer must allow different plan-selection behavior.

---

## Overlay model for Phase 1

### Applied overlays

Changes already true today (e.g. thermostat settings, pool schedule, EV schedule, existing solar, existing battery, declared appliance changes). Every overlay must produce a **15-minute delta curve**.

### Scenario overlays

What-if changes the user is considering. Same rule: every overlay must produce a 15-minute delta curve.

---

## Phase 1 critical path

**Work on first:** Step 0 — Hook up real weather API.

### Step 0 — Hook up real weather API (first priority)

Real historical weather is required for solar production adjustments, manual monthly/annual distribution, and new home simulation. Weather quality should be improved for these paths while preserving explicit fallback provenance when weather data is unavailable.

- [ ] Integrate real weather API for simulation use
- [ ] Use real weather for solar production daily adjustments (Step 6.5)
- [ ] Use real weather for manual/annual seasonality and distribution where applicable
- [ ] Keep fallback weather path explicit and truthful (stub/mixed/actual provenance), not silent
- [ ] Document API usage, rate limits, and fallback behavior

**Success criteria:**

- Real weather data is available to simulation pipelines
- Solar and other weather-dependent simulations use live weather (or validated historical) instead of stub
- No silent blocking on stub/missing weather for launch-critical paths; fallback provenance remains explicit

**Notes / test results:**

- 

---

### Step 1 — Finish the fast simulator validation path

#### 1.1 Fix random-day training selection

- [ ] random_days mode trains from all candidate-window eligible days
- [ ] Excludes test dates
- [ ] Excludes travel dates
- [ ] Excludes low-coverage days

**Note:** Implemented: random_days now trains from candidate window minus test/travel/low-coverage; check after validation.

**Success criteria:**

- Training coverage is materially higher
- Repeated flat simulated daily totals disappear
- WAPE improves materially

**Notes / test results:**

- 

#### 1.2 Stabilize profile generation

- [ ] Household shape profile works with full eligible training pool
- [ ] Weekday/weekend split works
- [ ] Pool/no-pool homes are not collapsing to simplistic day totals
- [ ] Diagnostics clearly show exclusions and training pool composition
- [ ] Add benchmark comparison summary to Gap-Fill Lab showing current run vs prior best/fixed benchmark
- [ ] Track at minimum: WAPE, MAE, total simulated kWh bias, worst-day error, and monthly WAPE by test mode
- [ ] Run multiple random-seed Gap-Fill Lab passes and review average, median, and worst-case accuracy
- [ ] Confirm simulator is not overfit to one fixed-seed test set
- [ ] Gap-Fill Lab benchmark / regression summary added
- [ ] Current run can be compared against a fixed benchmark run
- [ ] Monthly WAPE regression comparison is available
- [ ] Worst-day regression comparison is available

**Success criteria:**

- Gapfill tests across multiple houses are reasonably stable
- No zero-sim issues, no join mismatch issues, no silent fallback without diagnostics

**Notes / test results:**

- 

---

### Step 2 — Lock the baseline pipeline

#### 2.1 Keep existing corrected baseline path as canonical

- [ ] Do not rebuild this path
- [ ] Use actual intervals, gap fill / corrections, existing stitched corrected output

#### 2.2 Expose baseline layers via contract adapters

- [ ] past_baseline_raw
- [ ] baseline_corrected

**Note:** Started: adapters exist in `lib/sim/baselineAdapter.ts`; wire/validate as needed.

#### 2.3 Define current-state baseline builder

- [ ] baseline_corrected + applied overlays = baseline_current_state
- [ ] Composition using corrected baseline + applied 15-min delta overlays (not a new simulator)

**Success criteria:**

- Current-state baseline can be generated from corrected baseline plus past changes
- No routes/UI have to change yet; plan engine can consume it once wired

**Notes / test results:**

- 

### 2.4 Validate shared simulator core usage

- [ ] Validate that user-facing Past baseline uses the shared past-day simulation core
- [ ] Validate that Gap-Fill Lab scoring and user Past use the same shared artifact identity/fingerprint and same simulator core/version metadata
- [ ] Confirm full-year stitched baseline behavior remains correct after simulator-core unification
- [ ] Confirm Past cache behavior and returned dataset shape remain unchanged after simulator-core unification
- [ ] Add lightweight simulator core/version metadata to production Past outputs for validation and debugging
- [ ] LEGACY / NON-AUTHORITATIVE labels (for example `gapfill_test_days_profile`) are treated as historical naming only, not separate artifact ownership

---

### Step 3 — Build applied overlay engine for Phase 1

Phase 1 Step 3 is applied overlays only. Scenario/future overlays are not required for launch unless they are explicitly needed by the launch UI.

- [ ] Thermostat / occupancy settings
- [ ] Pool pump schedule
- [ ] EV charging schedule if present
- [ ] Existing solar
- [ ] Existing battery
- [ ] Existing major appliance changes already declared by user

**Rule:** Every overlay must produce a 15-minute delta curve.

**Success criteria:**

- Current-state baseline reflects already-existing home conditions
- Same timestamp set as baseline; no negative usage after composition; clamp diagnostics available

**Notes / test results:**

- 

---

### Step 4 — Build manual monthly simulation

- [ ] Input: monthly kWh values, home details, occupancy, appliance/home profile if present
- [ ] Output: canonical 15-minute dataset
- [ ] Build path: monthly totals → month/day targets → shape profiles → 15-min intervals → applied overlays → current-state baseline dataset
- [ ] Assumptions: seasonality, weekday/weekend, pool, HVAC shape, occupancy

**Success criteria:**

- Monthly totals preserved; output is full 15-minute dataset; plan engine accepts it without special casing

**Notes / test results:**

- 

---

### Step 5 — Build manual annual simulation

- [ ] Input: annual kWh, home details, occupancy, appliance profile if present
- [ ] Output: canonical 15-minute dataset
- [ ] Build path: annual total → months (seasonality) → days → intervals (shape) → applied overlays → current-state baseline
- [ ] Reuse same underlying builder logic as manual monthly

**Success criteria:**

- Annual total preserved; sensible monthly distribution; plan engine accepts it like every other source

**Notes / test results:**

- 

---

### Step 6 — Build new home simulation

- [ ] Input: home details, location, occupancy, appliance data if available, thermostat, pool/EV/HVAC details
- [ ] Output: canonical 15-minute dataset
- [ ] Build path: estimate monthly/yearly from profile and priors → monthly targets → day totals → interval shape → applied overlays → current-state baseline
- [ ] Good enough to rank plans; does not need to be perfect for launch

**Success criteria:**

- Believable load shape; monthly/seasonal behavior makes sense; plan engine can use it; no special casing downstream

**Notes / test results:**

- 

---

### Step 6.5 — Build solar + battery simulation engine

**Purpose:** Allow users who either HAVE solar or are CONSIDERING solar to simulate solar production and evaluate electricity plans that include solar buyback. This must be included in Phase 1 because solar customers receive the greatest benefit from selecting the correct electricity plan.

**Inputs:**

- location / zip code
- system size (kW)
- solar production data (Solargraph monthly/hourly baseline)
- actual historical weather adjustments
- inverter clipping if applicable
- battery presence if applicable

**Required capabilities:**

- [ ] Simulate 15-minute solar production curves
- [ ] Apply solar generation overlay to baseline usage dataset
- [ ] Produce net grid usage intervals
- [ ] Allow negative export intervals

**Implementation approach:**

1. Start with Solargraph monthly/hourly production baseline
2. Adjust daily production using real historical weather
3. Convert hourly solar production into 15-minute intervals
4. Generate solar production dataset
5. Subtract solar production from baseline usage dataset
6. Output net grid import/export dataset

Architectural rule: Solar is a generation overlay, not a pricing adjustment.

**Success criteria:**

- Solar production curves are realistic
- Exported energy intervals appear where solar exceeds load
- System works with and without battery
- Plan engine can consume resulting net usage dataset
- Net grid behavior produces two streams:
  - grid_import_kwh
  - grid_export_kwh
- Export intervals are separated from imports before plan pricing logic

**Notes / test results:**

- 

#### Battery storage simulation

**Purpose:** Allow the simulator to model how home batteries change imports, exports, self-consumption, and plan costs. This is required for Phase 1 because solar + battery users may have very different best-plan results than solar-only or non-solar homes.

**Inputs:**

- battery model
- total capacity (kWh)
- usable capacity
- round-trip efficiency
- max charge rate
- max discharge rate
- backup reserve percentage
- battery operating mode / dispatch policy

**Required behaviors:**

- charge from excess solar
- discharge to serve home load
- optionally charge from grid during low-rate / free-night periods
- respect reserve level
- enforce charge/discharge rate limits
- prevent impossible simultaneous charge/discharge behavior

**Dispatch policy examples:**

- self-consumption
- free-night charging
- TOU arbitrage
- backup reserve only

Default Phase 1 dispatch policy: self-consumption with optional free-night charging when plan allows.

**Simulation flow:**

- baseline usage → subtract solar production → battery absorbs excess solar or charges from grid when policy allows → battery discharges according to policy → output final net grid import/export dataset

Architectural rule: Battery dispatch is part of the physical simulation stack and must be completed before the plan engine calculates charges or credits.

**Success criteria:**

- exports are reduced when battery absorbs excess solar
- battery discharges reduce imports during high-cost windows
- free-night charging behavior is modeled correctly
- final output is a 15-minute net grid import/export dataset

**Notes / test results:**

- 

---

### Step 7 — Standardize all usage sources to one canonical output

**Sources:**

- Actual SMT/GB
- Manual monthly
- Manual annual
- New home simulation
- solar-adjusted usage
- solar + battery adjusted usage

The canonical output for solar/battery paths must represent final net grid import/export behavior at 15-minute resolution.

Required representation for solar/battery pricing:

- grid_import_kwh stream
- grid_export_kwh stream

Do not collapse these into a single signed value before the plan engine. Solar/battery pricing must use separate import/export streams and must never collapse them into a single signed monthly net value before pricing.

**Required output standard:**

- [ ] Consistent timestamps; 15-minute resolution; no negative values (except export where allowed); timezone-correct; complete enough for plan costing
- [ ] No source-specific plan engine logic

**Success criteria:**

- Same pricing engine works for all usage sources; all sources can be bucketed/priced without branching logic

**Notes / test results:**

- 

---

### Step 8 — Connect current-state baseline to the plan engine

Do not rebuild the plan engine in Phase 1. Only adapt canonical dataset outputs into the current engine inputs.

Phase 1 must support side-by-side pricing comparisons for the same user/profile: without solar; with solar; with solar + battery.

Critical pricing rule: The plan engine must consume final 15-minute net grid behavior only. The plan engine must not simulate solar production. The plan engine must not simulate battery dispatch. Those must already be resolved before pricing begins.

- [ ] Transform canonical dataset into the bucket structure the plan engine uses
- [ ] Preserve TOU windows, free-night logic, fixed fees / delivery fees correctly

**Validation matrix:** actual usage; corrected baseline; current-state baseline from applied overlays; manual monthly; manual annual; new home simulation; solar-adjusted usage; usage + solar simulation; usage + solar + battery simulation.

Battery dispatch must be applied before plan pricing so TOU/free-night plans are evaluated on the true net grid behavior.

**Success criteria:**

- All sources produce ranked plans; no source-specific crashes; no mismatched bucket assumptions
- [ ] Same usage source can be priced in multiple variants for comparison: current-state baseline without solar; current-state baseline with solar; current-state baseline with solar + battery
- [ ] Comparison output clearly shows bill difference between without-solar and with-solar cases

#### Solar plan modeling

The plan engine must understand solar buyback structures. Standard EFL parsing will not capture these terms because solar buyback programs are often separate plan addendums.

**Required implementation:**

- [ ] Extend plan schema to support solar buyback parameters
- [ ] Allow plans to exist in two variants:
  - base electricity plan
  - electricity plan with solar buyback addendum
- [ ] Allow manual entry of solar buyback parameters in admin tools when EFL does not contain the information

**Required solar plan attributes:**

- buyback rate ($/kWh)
- export credit type (net metering / capped buyback / wholesale indexed)
- export credit cap
- rollover policy
- monthly credit expiration
- solar enrollment fee if applicable

**Validation:**

- [ ] Run plan engine using: usage only; usage + solar export
- [ ] Run plan engine using: usage + solar where annual export exceeds annual import
- [ ] Confirm: solar credits reduce bills correctly; caps are enforced; rollover logic works
- [ ] Run plan engine using: usage + solar simulation; usage + solar + battery simulation
- [ ] Confirm: battery charging cost is calculated correctly; battery discharge reduces imports correctly; export credits are calculated correctly after battery behavior is applied; plan ranking changes appropriately when battery exists

**Regulated / co-op current-plan modeling**

For regulated or co-op users, the system must support pricing solar and battery effects against the current plan even when no alternative plan recommendation is available.

**Required implementation:**

- [ ] Detect when a user is in a regulated / co-op territory or otherwise not eligible for competitive switching
- [ ] Allow current-plan-only pricing flow for those users
- [ ] Show how solar changes bill outcome on the current plan
- [ ] Show how solar + battery changes bill outcome on the current plan
- [ ] Preserve separate import/export treatment where applicable even when the current plan is not switchable

**Validation:**

- [ ] Run current-plan pricing for regulated/co-op users without solar
- [ ] Run current-plan pricing for regulated/co-op users with solar
- [ ] Run current-plan pricing for regulated/co-op users with solar + battery
- [ ] Confirm output shows bill impact on current plan instead of recommending a different plan

**Notes / test results:**

- 

---

### Step 9 — Finish the launch UI path

**Minimum launch journey:** user enters usage source → system builds current-state baseline → system runs plan engine → system displays best plans → user clicks through to switch.

**Required UI outputs:**

- [ ] Top plan; top few alternatives; estimated annual/monthly cost; plan details; switch CTA
- [ ] Competitive-market users can see recommended plans
- [ ] Regulated/co-op users can see current-plan impact with: no solar; solar; solar + battery
- [ ] Solar comparison view shows side-by-side results: without solar; with solar; with solar + battery

**Success criteria:**

- Complete path works for all supported usage sources; affiliate flow is trackable; no blocking errors

**Notes / test results:**

- 

---

### Step 10 — Add the minimum required Phase 1 admin tools

**Rule:** Do not rebuild admin tools; only add what is missing and required for launch behavior.

- [ ] **Simulation / validation:** Gap-Fill Lab; random test day selection; profile diagnostics; current-state baseline test runner; benchmark regression runner / summary; multi-seed random validation runner
- [ ] **Inputs / corrections:** Vacant/Travel editing; test set generation; ability to inspect household shape profiles
- [ ] **Costs / knobs (Phase 1):** profile tuning / fallback selection; seasonality weighting; appliance schedule assumptions for current-state baseline; solar/battery assumptions for existing systems if part of current-state baseline
- [ ] **Battery admin knobs (Phase 1):** battery dispatch policy selection; default reserve percentage; default charge/discharge assumptions; free-night / TOU battery charging rules; battery efficiency assumptions
- [ ] **Solar admin knobs (Phase 1):** solar production override for testing (system size and/or kWh/month); manual entry of solar buyback parameters when EFL/addendum parsing does not provide them
- [ ] **Regulated/co-op and comparison (Phase 1):** regulated/co-op territory or current-plan-only pricing toggle for testing; current-plan pricing test runner; with-solar vs without-solar comparison test runner; ability to override whether a user is treated as competitive-market or regulated/co-op for validation

Full upgrade catalogs are NOT Phase 1 blockers unless needed by current-state baseline.

**Notes / test results:**

- 

---

## Phase 1 acceptance criteria

### Simulator

- [ ] Real weather API hooked up and used for simulation
- [ ] Random test training fix completed
- [ ] Shape/profile generation stable enough for launch
- [ ] Applied overlay engine works for current-state baseline
- [ ] No zero-sim / join / timeout regressions
- [ ] Gap-Fill Lab benchmark/regression comparison is available and used for simulator tuning decisions
- [ ] Multi-seed random validation shows the simulator is not overfit to one fixed-seed test set
- [ ] User Past and Gap-Fill Lab are confirmed to use the same shared past-day simulation core

### Sources

- [ ] SMT/GB actual works
- [ ] Manual monthly works
- [ ] Manual annual works
- [ ] New home simulation works
- [ ] Solar simulation works
- [ ] Battery simulation works
- [ ] Solar + battery simulation works
- [ ] Solar-adjusted usage datasets run through plan engine
- [ ] With-solar and without-solar comparison paths work for supported users
- [ ] Regulated/co-op users can be simulated and priced on their current plan

### Standardization

- [ ] Every source outputs canonical 15-minute usage
- [ ] Current-state baseline exists for every source path
- [ ] Solar-adjusted and solar+battery-adjusted paths output canonical 15-minute datasets
- [ ] Solar and battery are modeled as physical 15-minute layers before pricing, not as monthly billing adjustments

### Plan engine

- [ ] All source paths run through the existing plan engine
- [ ] Plan ranking works for all
- [ ] Billing output is stable enough for launch
- [ ] Solar buyback plans modeled correctly
- [ ] Battery charging/discharging affects billed usage correctly
- [ ] Solar export credits calculated correctly after battery dispatch
- [ ] Solar-only homes produce correct export credits
- [ ] Plan engine prices separate import/export streams rather than a collapsed monthly net value
- [ ] Plans with free nights correctly charge batteries during free periods when the selected battery dispatch policy allows it
- [ ] Competitive-market users receive correct recommended-plan pricing
- [ ] Regulated/co-op users receive correct current-plan pricing
- [ ] Same home can be compared without solar vs with solar vs with solar + battery
- [ ] Solar and battery impacts can be priced without requiring a plan switch recommendation

### UI / monetization

- [ ] User can see ranked plans
- [ ] Switch path works
- [ ] Commission tracking works
- [ ] Competitive-market users can move into the switching flow
- [ ] Regulated/co-op users can still receive a valuable solar/current-plan comparison result even without a switch recommendation

---

Anything not required for the above should be pushed to Phase 2.

---

## Sample user dashboard (launch demo for prospects)

**Goal:** Let potential users see a full, read-only dashboard experience using a real home so they understand what the product does before signing up.

**Entry point:** Main landing page must expose this (e.g. "See sample dashboard" / "View demo" link or CTA that goes to the sample dashboard hub).

**Data:** Use a single **real home** already in the system (e.g. a designated demo house with real usage/simulated/plans data). No fake or synthetic data; read-only views only.

### Sample dashboard hub (landing for the demo)

- [ ] Create a **sample dashboard hub page** that lists and links to all main tools/functions:
  - Usage (real usage view)
  - Past simulated usage (corrected baseline, travel/vacant, weather basis)
  - Future simulated usage (if applicable)
  - Plans / best plans / comparison
  - Home profile
  - Appliances / manual entry (read-only)
  - Current rate / analysis (read-only)
  - Any other user-facing dashboard areas that exist at launch
- [ ] Add short explanatory copy next to each link so prospects know what each section does
- [ ] Link this hub from the main site landing page so it serves as the "table of contents" for the sample experience

### Separate pages that mirror real dashboard pages

- [ ] Implement **separate routes/pages** (e.g. under `/sample` or `/demo`) that mirror the real authenticated dashboard pages:
  - Same or very similar layout and components (e.g. UsageDashboard, usage tables, plan cards, home profile view)
  - Data comes from the **fixed demo house** (and fixed scenario if needed), not from the current user
- [ ] Ensure each page is **read-only**: no forms that submit, no "Edit" or "Save"; optional "Sign up to use this yourself" CTA
- [ ] Add **brief explanatory copy** on each page (above or beside the main content) that tells a potential user:
  - What this screen is for
  - What they're looking at (e.g. "This is your usage for the past year with simulated fill for travel dates")
  - How it fits into the overall flow (e.g. "We use this to recommend the best electricity plans for you")

### Technical notes for implementers

- **Auth:** Sample routes must be accessible **without login** (public or a dedicated "sample" mode that does not require `intelliwatt_user`).
- **Data:** One **demo house ID** (and optionally scenario ID) configured in env or config; all sample pages load that house's data via existing APIs or server-side data fetching, with a clear "sample/demo" flag so no writes occur.
- **Reuse:** Where possible, reuse existing dashboard components (e.g. `app/dashboard/usage/page.tsx`, `app/dashboard/usage/simulated/page.tsx`, plans, home) by passing a "sample mode" or by building thin wrapper pages that fetch demo data and render the same components in read-only form.
- **Navigation:** Sample hub links to each mirror page; each mirror page can link back to the hub and optionally to "Next: Plans" / "Next: Usage" for a guided tour.

### Checklist items

- [ ] Add "Sample dashboard" / "View demo" entry point on main landing page (`app/page.tsx` or equivalent)
- [ ] Create sample dashboard hub page that lists all tools/functions with short descriptions and links to each mirror page
- [ ] Configure a single real demo house (and scenario if needed) for sample data; document in env or config
- [ ] Implement read-only sample route(s) that serve dashboard-style pages without requiring login
- [ ] Mirror Usage page (real usage view) with demo data and explanatory copy
- [ ] Mirror Past simulated usage page with demo data and explanatory copy
- [ ] Mirror Future simulated usage page (if in scope) with demo data and explanatory copy
- [ ] Mirror Plans / best plans (and comparison if applicable) with demo data and explanatory copy
- [ ] Mirror Home profile page (read-only) with explanatory copy
- [ ] Mirror other launch-relevant dashboard pages (e.g. appliances, manual entry, current rate, analysis) as read-only with explanatory copy
- [ ] Ensure every sample page is read-only (no submit/save) and includes a clear "Sign up to try it yourself" or equivalent CTA where appropriate
- [ ] Test full flow: landing → hub → each mirror page; verify copy and data are correct and no auth is required

### Success criteria

- A prospect can land on the site, click through to the sample dashboard hub, and see all main tools/functions listed and explained.
- From the hub, they can open separate pages that mirror real dashboard screens, using a real home's data, with clear explanations on each page.
- The experience is fully read-only and does not require login; implementation reuses existing dashboard UI where possible.

## Post–Past Sim Performance + Read-Path Cleanup Plan

This section is deferred until Past corrected baseline / shared simulation work is fully complete and validated. It captures the next cleanup pass to reduce default heavy reads, enforce explicit heavy actions, and keep all runtime/admin flows on shared modules only. This is a planning section only and is not to be implemented until Past Sim is signed off.

### 1. Global enforcement rule for all future cleanup

- No duplicate business logic is allowed in multiple files.
- Any logic used in more than one place must live in a shared module.
- Routes/pages/admin tools may orchestrate inputs and outputs, but must not own reusable business logic.
- Heavy operations must be explicit whenever possible.
- Default read paths should prefer:
  1. saved artifact / cache / lightweight summary read
  2. shared resolver/service path
  3. explicit rebuild / deep diagnostic only when requested
- Weather adjustment math must live only in the shared simulation core.
- Weather identity/fingerprint logic must live only in a shared weather identity helper.
- Date/window logic must use shared Chicago/canonical window helpers only.

### 2. Simulation Engines admin cleanup (deferred until Past Sim is done)

Current issue:
- `/api/admin/simulation-engines` inspect path is still heavier than it should be because default inspect behavior pulls in deep diagnostic work.

Plan after Past Sim signoff:
- Keep `/api/admin/simulation-engines/diagnostic` as the explicit heavy diagnostic path.
- Make default inspect/read behavior light and artifact/read-first.
- Keep parity/cold-build/recalc/weather-audit work behind explicit flags/actions only.
- Ensure admin inspect uses the same shared canonical window/hash/weather helpers as production and owns only report assembly.

Acceptance:
- Inspect = light read
- Diagnostic = explicit heavy path
- No duplicate canonical logic in admin inspect routes

### 3. Usage runtime payload split (deferred until after Past Sim)

Current issue:
- `/api/user/usage` default path is shared-module aligned but still heavy because it assembles a rich full dataset, including expensive insight/baseload/weather-related work.

Plan after Past Sim signoff:
- Keep shared usage modules intact.
- Split default payload vs advanced payload.
- Default usage read should return the core series/summary needed for the main user experience.
- Advanced baseload/weather/extra insight calculations should be explicit or gated by view need.
- Polling/status flows should prefer the lightweight status endpoint before triggering full usage reloads.

Acceptance:
- Default usage load is lighter
- No route-level duplicated usage logic
- Shared modules remain the only source of truth

### 4. Plans / plan options default-load cleanup (highest-priority post-Past-Sim performance pass)

Current issue:
- `/dashboard/plans` is the heaviest default read path.
- Default behavior currently triggers full dataset mode, large page size behavior, and warmup/bootstrap actions more aggressively than needed.

Plan after Past Sim signoff:
- Make light/paged mode the default Plans experience.
- Move full dataset mode behind an explicit user action.
- Make warmup/pipeline/bootstrap behavior explicit or more strictly gated.
- Preserve cache-first and shared-module estimate behavior.
- Keep detail/compare compute-on-read behavior, since those are explicit user-intent actions.
- Do not weaken estimate correctness to gain speed.

Acceptance:
- Default Plans load is lighter
- Full dataset + warmup behavior is explicit
- Shared estimate/build modules remain canonical
- No new route-level duplicated estimate logic

### 5. Admin / tooling alignment follow-through

After Past Sim signoff, confirm all remaining admin/tooling flows:
- use shared interval fetch/source modules
- use shared Past identity/hash/window helpers
- use shared weather identity helper
- use shared simulation core where simulation is involved
- do not keep local duplicate canonical logic in routes

Specifically re-check:
- Simulation Engines admin paths
- GapFill admin tools
- any Usage/Plans admin helpers used during launch validation

Acceptance:
- Admin tools are presentation/debug glue only
- Shared modules own canonical logic everywhere

### 6. Execution order after Past Sim signoff

1. Final signoff on Past corrected baseline / shared sim path
2. Simulation Engines inspect-vs-diagnostic split
3. Plans default-load cleanup
4. Usage payload split / light-default cleanup
5. Final admin/tooling shared-module audit
6. Final launch performance verification

### 7. Guardrails for implementation

- Do not start this section until Past corrected baseline is complete and signed off.
- Each cleanup step must be surgical and independently testable.
- No broad rewrites.
- No weakening of diagnostic correctness.
- No duplicate logic allowed while optimizing performance.
- Prefer additive flags and explicit actions over hidden behavior changes.
- Every cleanup pass must document:
  - files changed
  - shared modules used
  - heavy default work removed or gated
  - tests run
  - remaining known drift points

### 8. Final summary note

This post–Past Sim cleanup phase exists to reduce default heavy work without compromising correctness. The architectural rule remains: shared modules own canonical logic, services orchestrate, and routes/admin tools only assemble request/response behavior.
