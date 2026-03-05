# Sim Platform Contract (v1)
_Last updated: 2026-03-05_

This document defines hard architectural rules for the simulation system.

All code written for the simulator must conform to this contract.

---

This document defines the **canonical data model** for IntelliWatt/IntelliPath simulation datasets and overlays.

The goal is to ensure:
- Every module composes cleanly
- We never redo baseline/overlay plumbing
- Customer-visible outputs remain simple
- Internal layers stay debuggable and trainable

---

## 1) Core principles

### 1.1 Canonical time series
All simulation datasets are represented as a **15-minute interval series**.

- Interval cadence: **15 minutes**
- Expected intervals per local day: **96**
- Timestamp format: ISO UTC string (e.g. `2025-08-05T00:15:00.000Z`)
- Window: continuous range `[windowStartUtc, windowEndUtc]` inclusive of 15-min slots as defined by the engine

**Invariant A — Canonical timestamps**
All datasets and overlays that are meant to be composed MUST:
- Use the same exact timestamp set for a given window
- Be joinable by timestamp string equality (`tsIso`)

### 1.2 Absolute vs delta
We distinguish:
- **Datasets**: absolute kWh values per interval
- **Overlays**: delta kWh values per interval

**Invariant B — Overlay is always a delta curve**
Every overlay MUST output a `deltaKwhByInterval` curve (same timestamps as base).

Applying overlays must be simple and deterministic:
- `kwh_final[t] = clamp0(kwh_base[t] + Σ overlayDelta[t])`

### 1.3 Two overlay classes
Overlays exist in two lifecycle stages:

1) **Applied overlays**  
Changes that are already true today (past upgrades/changes)  
Transform:
- `Corrected Baseline → Current-State Baseline`

2) **Scenario overlays**  
What-if changes the user is considering or recommendations being tested  
Transform:
- `Current-State Baseline → Projected Usage`

This prevents rework later when adding "past upgrades" vs "future recommendations".

---

## 2) Customer-visible model

Customers should see at most:

1) **Usage (Actual)**  
2) **Baseline (Current Home)** *(internally: current-state baseline)*  
3) **Projected Usage** *(baseline + scenario overlays)*

Internal layers like raw past reconstruction are not customer-facing by default.

---

## 3) Canonical dataset types (4-layer stack)

### 3.1 Past Baseline (Raw)
**Meaning:** reconstructed/gap-filled past usage curve before corrections.  
**Use cases:** debugging, training, instrumentation.  
**Customer-visible:** no (internal by default).

**Canonical key:** `past_baseline_raw`

### 3.2 Corrected Baseline
**Meaning:** Past Baseline after normalization/corrections (travel removal, missing data correction, smoothing, artifact handling).  
**Use cases:** canonical "best estimate baseline" used as the foundation for applied overlays.  
**Customer-visible:** typically no, unless a debug/admin view.

**Canonical key:** `baseline_corrected`

### 3.3 Current-State Baseline (UI: "Future Baseline" if desired)
**Meaning:** Corrected Baseline + **Applied overlays** (past changes already true).  
This represents the home's baseline **as it exists now**.  
**Use cases:** plan costing baseline, starting point for scenarios.  
**Customer-visible:** yes (this is the "Baseline (Current Home)").

**Canonical key:** `baseline_current_state`

### 3.4 Projected Usage (Final Usage)
**Meaning:** Current-State Baseline + **Scenario overlays** (what-if changes).  
**Use cases:** ROI, plan comparison under scenarios, recommendations.  
**Customer-visible:** yes.

**Canonical key:** `usage_projected`

---

## 4) Overlay contract

### 4.1 Overlay schema (conceptual)
Every overlay MUST produce:

- `overlayId` (string, stable)
- `overlayClass`: `"applied"` | `"scenario"`
- `overlayType` (string enum, e.g. `"pool_schedule"`, `"hvac_upgrade"`, `"solar"`)
- `inputs` (JSON: parameters/user inputs used)
- `windowStartUtc`, `windowEndUtc`
- `deltaKwhByInterval`: array aligned to canonical timestamps
- `meta`: diagnostics (optional)

**Invariant C — Delta curve alignment**
Overlay delta output must:
- Have exactly the same timestamps as the base dataset window
- Or provide a joinable mapping by timestamp
- Missing timestamps are not allowed in production (must be filled with 0)

### 4.2 Overlay application rules
- Overlays are additive deltas.
- Engine applies overlays in a deterministic order:
  1) Applied overlays (build "current-state baseline")
  2) Scenario overlays (build projected usage)
- Overlays MUST NOT mutate baseline inputs.
- Overlays MUST NOT rebase other overlays.

**Invariant D — Deterministic composition**
Given:
- same base dataset
- same overlay list (same ordering rules)
The output MUST be identical.

### 4.3 Negative usage handling
Physical usage cannot be negative.

- After applying overlays: clamp at 0
- Track clamp diagnostics:
  - count of clamped intervals
  - total clamped kWh

**Invariant E — No negative kWh**
Final interval kWh must be `>= 0`.

---

## 5) Vacant/Travel vs Test Dates rules

### 5.1 Terms
- **Vacant/Travel dates (DB)**: customer-entered dates indicating abnormal occupancy/usage.  
  These should **not** be used as "ground truth" for evaluating simulation accuracy.

- **Test Dates (Admin)**: dates selected by the admin/test harness used to evaluate simulation accuracy against actual interval data.

### 5.2 Requirements
- Vacant/Travel dates are **guardrails** and are never scored.
- Test Dates are the **scoring set**.

**Invariant F — No overlap**
Test Dates MUST NOT overlap Vacant/Travel dates.
If overlap exists:
- reject request (400)
- return overlap counts and sample keys

### 5.3 Production parity requirement
The simulator should honor Vacant/Travel dates for production datasets where applicable.

For the Gap-Fill Lab "test-days-only" engine path:
- It MAY ignore full-year production-building
- It MUST still:
  - block overlap with Vacant/Travel
  - report both sets separately

---

## 6) Window rules

### 6.1 Window definition
A dataset window is defined as:
- `windowStartUtc`: first timestamp
- `windowEndUtc`: last timestamp inclusive

**Invariant G — Window is explicit**
Every dataset and overlay must carry its window start/end.

### 6.2 Month labeling (for reports)
Monthly totals and labels should be derived consistently:
- Prefer actual interval month keys where available
- Use canonical month keys stored in build inputs if already computed

---

## 7) Caching & identity

### 7.1 Baseline builders
**Rule:** Only one baseline builder is canonical in production at a time.

We can have multiple internal engines/versions, but:
- One is the "source of truth" baseline pipeline for composition
- Alternate builders must be versioned and not break the schema

**Invariant H — One canonical baseline pipeline**
At runtime, only one baseline builder is used to generate each baseline type for a given scenario/version.

### 7.2 Dataset identity
A dataset is identified by:
- `houseId`
- `datasetType` (one of the 4 above)
- `scenarioId` (or baseline scenario key)
- `inputHash` (hash of all inputs and config)

**Invariant I — Cache correctness**
Cache hits are valid only if:
- `inputHash` matches
- window matches
- datasetType matches

---

## 8) Training & model-building contract (forward-looking)

### 8.1 What we learn from homes
From each home with actual intervals we can derive:
- Monthly totals
- Day totals
- Hourly means
- 96-slot normalized shapes by month and weekday/weekend
- Feature labels (home profile, appliances, occupancy, weather regime flags later)

### 8.2 Priors
We will maintain a "prior library":
- global priors (all homes)
- clustered priors (by home archetype)
- personalization priors (per-home from training window)

These priors feed:
- new-build baseline builder (no intervals)
- manual curve builder (monthly totals + priors)
- recommendation engines (TOU shifting, etc.)

---

## 9) Required invariants checklist (must hold)

1) **Canonical timestamps** per window are joinable by timestamp string equality  
2) **Overlays are delta curves** aligned to the same timestamp set  
3) **No negative kWh** after composition (clamp + diagnostics)  
4) **Applied vs Scenario overlays** are distinct and applied in order  
5) **Vacant/Travel (DB)** never scored; **Test Dates** are scoring set only  
6) **No overlap** between Vacant/Travel and Test Dates (hard error)  
7) Window start/end is explicit in every dataset/overlay  
8) One canonical baseline pipeline in production at a time  
9) Cache identity uses datasetType + scenario + inputHash

---

## 10) Naming conventions (recommended)

### Internal keys
- `past_baseline_raw`
- `baseline_corrected`
- `baseline_current_state`
- `usage_projected`

### Customer-facing labels
- **Usage (Actual)**
- **Baseline (Current Home)** *(maps to `baseline_current_state`)*
- **Projected Usage** *(maps to `usage_projected`)*

### Admin/testing labels
- **Vacant/Travel dates (DB)**
- **Test Dates (Admin)**

---

## 11) Implementation notes (non-binding but recommended)

- Keep overlay schemas stable and version them (`overlayVersion`)
- Always include report diagnostics:
  - expected vs actual interval counts
  - joinPct
  - coveragePct
  - clamp counts
- Prefer "lite training" that avoids full-year builds for admin tooling
- Keep production simulation build paths separate from admin testing paths
  but enforce the same invariants.

---

# Implementation Roadmap

The simulation platform should be implemented in the following order.

## Phase 1 — Core Data Structures

Implement canonical dataset and overlay structures.

Modules:
- IntervalDataset
- OverlayResult
- DatasetMeta

Files:
- lib/sim/types.ts
- lib/sim/dataset.ts
- lib/sim/overlay.ts

---

## Phase 2 — Baseline Builder

Create the canonical baseline builder.

Responsibilities:
- Build Past Baseline Raw
- Apply corrections
- Produce Corrected Baseline

Files:
- lib/sim/baselineBuilder.ts

Inputs:
- actual intervals
- usage shape profile
- travel dates

Outputs:
- IntervalDataset (baseline_corrected)

---

## Phase 3 — Applied Overlay Engine

Apply overlays representing changes that already occurred.

Examples:
- HVAC replacement
- solar installed
- pool schedule change

Files:
- lib/sim/overlayEngine.ts
- lib/sim/overlays/appliance.ts
- lib/sim/overlays/solar.ts

---

## Phase 4 — Scenario Overlay Engine

Simulate proposed changes.

Examples:
- add insulation
- add battery
- TOU shifting

Files:
- lib/sim/overlays/scenario/

---

## Phase 5 — Projection Engine

Combine:

baseline_current_state + scenario overlays

to produce usage_projected.

Files:
- lib/sim/projectionEngine.ts

---

## Phase 6 — Rate Plan Engine

Price any dataset under a tariff.

Files:
- lib/rateEngine/rateEngine.ts

---

## Phase 7 — Upgrade ROI Engine

Rank upgrade overlays.

Files:
- lib/roi/upgradeEngine.ts

---

## Admin Tools Requirements

Admin tooling for the simulation platform must satisfy the contract in **[ADMIN_TOOLS_CONTRACT.md](./ADMIN_TOOLS_CONTRACT.md)**. Key invariants:

- Anything affecting sim outputs or recommendations must be DB-configurable and editable via admin tooling where appropriate.
- Testing utilities must exist for each simulator stage (baseline, overlays, projection, rate/ROI).
- Costs and assumptions (e.g. financing, upgrade costs) must be editable without deploy.
- Versioning and audit logging are required for admin-driven changes to config or catalogs.
- Feature flags / kill switches are required for safety where changes can affect production behavior.
- Catalogs (upgrades, overlay definitions) and plan rules must be editable via admin; no hardcoded production costs.
- Access is admin-only, with server-side enforcement (e.g. `x-admin-token`).

---
