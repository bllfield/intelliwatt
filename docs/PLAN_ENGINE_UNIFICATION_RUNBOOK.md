# Plan Engine Unification Runbook (One Engine + Materialized Estimates)

## Goal (non-negotiable)
Build **one canonical plan engine** that produces **consistent, accurate results** and **consistent statuses** across:
- Customer dashboard (`/dashboard/plans`, plan detail, compare)
- Admin tools (EFL review, plan details, plan engine lab)
- Background jobs / schedulers

The customer UI must be **fast** and must not trigger recalculation via sort/filter/pagination.

## Key Decisions (locked)
- **One canonical engine module**: all calculation + status semantics + cache/materialization keying live in one place.
- **Materialized estimates**: persist home-scoped estimates in a dedicated table keyed by:
  - `(houseAddressId, ratePlanId, inputsSha256)`
- **Customer-facing status language**:
  - Never show “QUEUED”.
  - Show **“Need usage to estimate”** when usage is missing.
  - Show **“Not Computable Yet”** for everything else that is not immediately computable.
- **Offer list freshness**: offers can change at any time; we treat this as an ingestion+diff problem, not a UI-triggered compute problem.

## Current State (as of this runbook)
- Dashboard offer list is sourced from live WattBuy (with `WattBuyApiSnapshot` TTL caching).
- Templates are linked by `OfferIdRatePlanMap (offerId -> ratePlanId)` into `RatePlan` templates.
- Estimates for the plans list are cache-only (no inline compute), but are currently stored in `WattBuyApiSnapshot` (legacy cache-style).

## Target Architecture
### Data flow (high level)
1) **Offers ingestion** (snapshot + diff) identifies new/changed offers.
2) **Template pipeline** produces/updates `RatePlan` and `OfferIdRatePlanMap`.
3) **Estimate jobs** compute and **upsert materialized estimate rows**.
4) **Customer UI** reads:
   - current offers (from snapshot/live),
   - template mapping (`OfferIdRatePlanMap`),
   - materialized estimates (home-scoped),
   and displays results immediately.

## Implementation Phases (execute in order)
### Phase 1 — Add the materialized estimate table (schema first)
- Add a Prisma model in `prisma/schema.prisma` (master DB) for materialized estimates.
- Required fields:
  - `houseAddressId` (string)
  - `ratePlanId` (string)
  - `inputsSha256` (string)
  - `monthsCount` (int, default 12 in callers)
  - `status` (enum-like string)
  - `reason` (nullable string)
  - `monthlyCostDollars`, `annualCostDollars` (nullable decimals/numbers)
  - `confidence` / `componentsV2` JSON (optional but recommended)
  - `computedAt`, `expiresAt` (for 30-day refresh cadence)
- Add a unique constraint:
  - `@@unique([houseAddressId, ratePlanId, inputsSha256])`

**Result after Phase 1**: DB is ready; no behavior change yet.

### Phase 2 — Canonical engine keying + materialized upsert helpers
Create a single module (canonical engine boundary) that exposes:
- `makeEstimateInputsSha256({ ...canonical inputs... })`
- `upsertMaterializedEstimate({ houseAddressId, ratePlanId, inputsSha256, result })`
- `mapEngineResultToCustomerLabel(...)` (customer UI mapping only; admin keeps detailed reasons)

**Result after Phase 2**: one source of truth for keying and persistence; still no UI change until wired.

### Phase 3 — Pipeline writes materialized estimates
Update the pipeline job/route to:
- compute estimates using the canonical engine
- write to the materialized estimate table
- enforce throttles/locks server-side (not UI-driven)

**Result after Phase 3**: background jobs populate the new table.

### Phase 4 — Dashboard reads materialized estimates (no inline compute)
Update `GET /api/dashboard/plans` to:
- keep fetching the current offers list (snapshot/live)
- map `offerId -> ratePlanId` via `OfferIdRatePlanMap`
- compute `inputsSha256` via the canonical engine helper (same as pipeline)
- look up the materialized estimate row by `(houseAddressId, ratePlanId, inputsSha256)`
- return a stable `trueCostEstimate` derived from the materialized row

**Result after Phase 4**: plans page becomes fast and consistent; no compute happens from UI calls.

### Phase 5 — Customer UI copy (remove “QUEUED”)
Update `/dashboard/plans` UI to:
- replace any “QUEUED” language with:
  - “Need usage to estimate”
  - “Not Computable Yet”
- ensure there is no indefinite “Calculating…” banner unless there is an active job expected to complete soon.

**Result after Phase 5**: UX is understandable and stable.

### Phase 6 — Offer freshness + scheduler policy (new/changed offers)
Implement:
- Offer snapshot diffing (new offerId, changed EFL URL, changed template fingerprint)
- Candidate prioritization (TOU/credits/tiered always; cheapest fixed per term bucket limited)
- 30-day refresh cadence + invalidation triggers (TDSP effective date, usage update, template update)

**Result after Phase 6**: long-term stable operations with bounded compute.

## Guardrails (do not regress)
- **Never compute inline** in the plans list path.
- **One engine** defines:
  - `inputsSha256`
  - compute semantics/statuses
  - mapping to customer labels
- Treat Production as read-only for experiments; use Preview deployments for verification.

