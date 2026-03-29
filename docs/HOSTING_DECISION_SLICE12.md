# Slice 12 — Hosting / droplet (Phase 4) decision record

**Date:** 2026-03-28  
**Plan refs:** `UNIFIED_SIM_FINGERPRINT_PLAN.md` §12 (performance/hosting gate), §26 Phase 4, §28 (anti-drift).

## Measurement decision (Section 12 precondition)

There is **no** committed production or staging evidence in this repository that the upgraded shared path **systematically exceeds Vercel execution time or memory limits** or is unsafe with adequate margin. Slice 11 added **instrumentation** (`durationMs`, `memoryRssMb`, structured pipeline events) so that evidence *can* be collected from log drains; it did not include a recorded benchmark or Vercel failure analysis that satisfies the Section 12 gate.

**Conclusion:** A **new** hosting/orchestration change is **not justified by the current measurement record**. Ops should enable collection, review logs against SLOs, then re-open Phase 4 if data shows sustained limit breaches.

## What already exists (no second simulator)

The codebase **already** supports off-request execution of the **same** canonical recalc:

- `dispatchPastSimRecalc` (`pastSimRecalcDispatch.ts`) builds a typed payload (including `correlationId`) and, when `shouldEnqueuePastSimRecalcRemote()` is true and enqueue succeeds, returns `executionMode: "droplet_async"` with `jobId` — otherwise it runs `recalcSimulatorBuild` inline (with an inline timeout and `recalc_timeout` semantics).
- `runPastSimRecalcQueuedWorker` (`pastSimRecalcQueuedWorker.ts`) loads the job payload and calls **`recalcSimulatorBuild` only** — same module entry as Vercel/inline. Fingerprint builders and resolved fingerprint resolution remain **inside** that canonical path, not a fork.

**Explicitly not moved by default:** compare remains a lightweight consumer on read (`compareProjection` / `getSimulatedUsageForHouseScenario`); there is no compare-specific droplet job in this design.

## What did not change in Slice 12

No new queue routes, no default flip to droplet-only recalc, no compare-heavy workflow, no stitch changes, no alternate simulator path. Toggle behavior remains env-driven (`PAST_SIM_RECALC_INLINE`, droplet webhook URL/secret per `dropletSimWebhook.ts`).

## Follow-up when evidence exists

If logs show Vercel is unsuitable: prefer **operational** tuning (enqueue when remote is configured, capacity on worker host) before any code fork. Any code change must preserve **`recalcSimulatorBuild`** as the single writer of modeled outputs and keep correlation id on enqueue + worker payloads.
