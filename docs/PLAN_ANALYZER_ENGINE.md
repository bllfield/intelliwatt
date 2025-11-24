# Plan Analyzer Engine (Rate + Usage Costing Stack)

_Last updated: 2025-11-23_

This document defines the architecture and contracts for IntelliWatt's **Plan Analyzer Engine**: the stack that takes:

- **PlanRules** (from the EFL Fact Card Engine), and
- **Interval usage** (SMT / Green Button / simulated 15-minute series),

and produces:

- Per-interval pricing and charges
- Daily and monthly bill summaries
- Total cost per plan over the analysis window
- Multi-plan comparisons sorted from lowest to highest cost.

This doc is the single source of truth for the Plan Analyzer APIs and internal TypeScript interfaces used by pricing and comparison features.

---

## 1. Layers

From bottom to top:

1. **EFL PlanRules Engine** (existing)  
   Module: `lib/efl/planEngine.ts`
   - Interpret PlanRules
   - Determine active TOU period for a timestamp
   - Compute per-interval charges via `getIntervalPricingForTimestamp` / `computeIntervalCharge`

2. **Plan Analyzer Core Types** (NEW)  
   Module: `lib/planAnalyzer/planTypes.ts`
   - Defines: `IntervalUsagePoint`, `PlanIntervalCost`, `PlanDailyCostSummary`, `PlanMonthlyCostSummary`, `RatePlanRef`, `RatePlanWithRules`, `PlanCostEngineInput`, `PlanCostResult`, `PlanComparisonInput`, `PlanComparisonResult`

3. **Per-Plan Cost Engine** (NEW)  
   Module: `lib/planAnalyzer/planCostEngine.ts`  
   - Entry point: `computePlanCost(input: PlanCostEngineInput): PlanCostResult`  
   - Responsibility: single-plan pricing over a usage series

4. **Multi-Plan Analyzer** (NEW)  
   Module: `lib/planAnalyzer/multiPlanAnalyzer.ts`  
   - Entry point: `comparePlans(input: PlanComparisonInput): PlanComparisonResult`  
   - Responsibility: run `computePlanCost` per plan and sort by total cost

5. **HTTP + UI Layers** (future)  
   Planned endpoints:
   - `/api/plan-analyzer/plan-cost`
   - `/api/plan-analyzer/compare`  
   Planned UI:
   - IntelliWatt estimate panel on plan cards
   - Comparison table ordered by total cost

---

## 2. Core Data Contracts

### 2.1 Interval usage input

Defined in `lib/planAnalyzer/planTypes.ts`:

- `IntervalUsagePoint`
  - `timestamp: string` — ISO 8601 with timezone
  - `kwhImport: number`
  - `kwhExport: number`

Usage must be pre-sorted ascending by timestamp regardless of source (SMT, Green Button, simulated).

### 2.2 PlanRules (pricing input)

The Plan Analyzer consumes **PlanRules** produced by the EFL Fact Card Engine (`lib/efl/planEngine.ts`) and does **not** parse EFL PDFs directly.

- `RatePlanWithRules` binds a lightweight `RatePlanRef` to a `PlanRules` object.
- Keeps analyzer logic decoupled from Prisma/WattBuy models.

### 2.3 Cost outputs

Three detail levels:

1. **Per-interval (PlanIntervalCost)**
   - Timestamp, kWh import/export
   - Import/export rates and charges
   - Active TOU period label and `isFree`

2. **Daily summaries (PlanDailyCostSummary)**
   - Local date (YYYY-MM-DD)
   - Daily kWh import/export
   - Energy charges, base charges, bill credits, total

3. **Monthly summaries (PlanMonthlyCostSummary)**
   - Local month (YYYY-MM)
   - Monthly kWh import/export
   - Energy charges, base charges, TDSP delivery, bill credits, total

`PlanCostResult` bundles the above plus `RatePlanRef` and `totalCostDollars`.

---

## 3. Per-Plan Cost Engine

### 3.1 Entry point

- `computePlanCost(input: PlanCostEngineInput): PlanCostResult` (stubbed)

### 3.2 Expected behavior (future implementation)

Given `RatePlanWithRules`, `IntervalUsagePoint[]`, and an IANA timezone:

1. For each interval:
   - Determine applicable PlanRules pricing band.
   - Compute import/export charges.
   - Emit `PlanIntervalCost`.
2. Group by local day/month (using `tz`):
   - Sum kWh and dollar amounts.
   - Apply base charges and bill credits.
3. Return `PlanCostResult` (interval detail, daily/monthly rollups, total).

The engine remains pure and testable — no DB/HTTP.

---

## 4. Multi-Plan Analyzer

### 4.1 Entry point

- `comparePlans(input: PlanComparisonInput): PlanComparisonResult`

### 4.2 Behavior

1. Call `computePlanCost` for each plan.
2. Sort results by `totalCostDollars`.
3. Return per-plan results plus sorted plan IDs.

Currently propagates the `computePlanCost` stub error until that function is implemented.

---

## 5. Integration Notes

- **WattBuy**: discovery & compliance (plan metadata, EFL URLs). No pricing math.
- **EFL Fact Card Engine**: owns PlanRules extracted from PDFs.
- **Plan Analyzer**: consumes PlanRules + usage to produce costs and comparisons.
- **Future UI**: WattBuy plan card + IntelliWatt usage-based estimate + comparison table.

---

## 6. Implementation Progress

- [x] Core Plan Analyzer types (`lib/planAnalyzer/planTypes.ts`)
- [x] Per-plan cost engine stub (`lib/planAnalyzer/planCostEngine.ts`)
- [x] Multi-plan analyzer stub (`lib/planAnalyzer/multiPlanAnalyzer.ts`)
- [ ] Per-plan cost engine implementation
- [ ] Admin test harness for Plan Analyzer
- [ ] HTTP endpoints for single-plan and multi-plan analysis
- [ ] UI components for IntelliWatt usage-based estimates/comparisons

