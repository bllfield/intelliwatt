# Unified fingerprint plan — shippable agent slices

This document breaks [`UNIFIED_SIM_FINGERPRINT_PLAN.md`](./UNIFIED_SIM_FINGERPRINT_PLAN.md) into **15 ordered slices**. Run **one slice per agent session** unless a slice explicitly says it can pair with another.

**Global rules for every slice (copy into each agent prompt):**

- Read the canonical plan sections cited in the slice; do not contradict Section 4 (single write authority, stitch/compare consumers, wrappers), Section 5 (data boundaries), or [`metadataWindow.ts`](../modules/usageSimulator/metadataWindow.ts) shared-window rules for coverage metadata.
- **No second simulator**, no route-local simulation math, no altering modeled outputs in routes or UI.
- `recalcSimulatorBuild` and its callees remain the only writers of modeled day outputs; stitch (`dataset.ts` curve path) and compare (`compareProjection` attach path) stay consumers only.
- Routes: orchestration and serialization only. UI: display and controls only.
- Prefer additive changes; preserve Past Sim stitch semantics unless fixing a proven bug with regression tests.

**Primary reference:** `docs/UNIFIED_SIM_FINGERPRINT_PLAN.md` (sections referenced as §).

---

## How many slices?

**15 shippable slices**, ordered by dependency. Approximate grouping:

| # | Theme |
|---|--------|
| 1 | Observability foundation (correlation id + recalc lifecycle) |
| 2 | Observability — simulation, stitch, compare attach, artifact freshness |
| 3 | Observability — fingerprint + admin lab + timeout semantics |
| 4 | API contracts — failure codes + correlation on user + admin surfaces |
| 5 | UI — user Past Sim states and honesty |
| 6 | UI — admin Gap-Fill Lab states and required visibility |
| 7 | Phase 1 — shared day-level temperature modeling (engine + past day + `simulatePastUsageDataset`) |
| 8 | Phase 2a — schema + build metadata for fingerprint persistence (resolve §29 minimally) |
| 9 | Phase 2b — `UsageFingerprint` + `WholeHomeFingerprint` builders + §13 freshness |
| 10 | Phase 2c — `ResolvedSimFingerprint` resolver + wire into `recalcSimulatorBuild` / sim chain |
| 11 | Phase 3 — measurement instrumentation (timers, memory hooks, compare attach cost) |
| 12 | Phase 4 — hosting decision + droplet orchestration for fingerprint-heavy work only |
| 13 | Phase 6–7 — cohort prior builder + full resolver coverage for modes (with Phase 5 leftovers) |
| 14 | Phase 8–9 — mode adapters + weather contract unification |
| 15 | Phase 10–12 — admin calibration integration + protection pass + hardening/tests |

---

## Slice 1 — Observability: correlation id + recalc lifecycle

**Goal:** Implement §6 (A) and the recalc-related parts of correlation propagation per §6 intro and §7 (droplet logging note).

**Scope:**

1. Add a small module (e.g. `modules/usageSimulator/simObservability.ts`): `createSimCorrelationId()`, `logSimObservabilityEvent()` emitting single-line JSON to stdout with a stable prefix (e.g. `[simObservability]`).
2. Wrap or instrument **`recalcSimulatorBuild`** (`modules/usageSimulator/service.ts`) so every run emits: `recalc_start`, `recalc_success`, or `recalc_failure` with `correlationId`, `userId`, `houseId`, `mode`, `scenarioId` (if available), `durationMs`, and on failure `failureCode` / `failureMessage` compatible with existing `SimulatorRecalcErr`.
3. Thread **`correlationId`** through **`dispatchPastSimRecalc`** (`pastSimRecalcDispatch.ts`): generate if missing; pass into `recalcSimulatorBuild`.
4. Extend **`PastSimRecalcQueuedPayloadV1`** (`simDropletJob.ts`) with optional `correlationId`; set on enqueue; **`pastSimRecalcQueuedWorker.ts`** passes it into `recalcSimulatorBuild`.

**Out of scope:** Day simulation inner logging (Slice 2), route response bodies (Slice 4).

**Verify:** Run existing `tests/usageSimulator/service.artifactOnly.test.ts` (or targeted recalc tests); no change to numeric simulation outputs.

**Plan refs:** §6 (A), §7 last bullet, §28 (no swallowed errors for these paths).

---

## Slice 2 — Observability: simulation, stitch, compare, artifact freshness

**Goal:** Cover §6 (C), (D) with structured events at shared-module boundaries (not routes).

**Scope:**

1. **`simulatePastUsageDataset`** (`modules/simulatedUsage/simulatePastUsageDataset.ts`): log `day_simulation_start` / `success` / `failure` (names aligned to §6) with `correlationId` passed from caller or new optional param threaded from `recalcSimulatorBuild` context.
2. **`buildSimulatedUsageDatasetFromCurve`** / **`buildCurveFromPatchedIntervals`** (`modules/usageSimulator/dataset.ts`): log `stitch_start` / `success` / `failure` with `correlationId`; do not change stitch math.
3. **`getSimulatedUsageForHouseScenario`** compare attach path: log `compareProjection_start` / `success` / `failure` around `attachValidationCompareProjection` / `buildValidationCompareProjectionSidecar` (file: `service.ts` + `compareProjection.ts` as appropriate).
4. Artifact path: where cache hit/miss/stale is already determined, emit `artifact_cache_hit` / `miss` / `artifact_stale_detected` with `buildId`/`artifactId` when available.

**Constraints:** Logging only; no behavior change to outputs.

**Verify:** Grep tests or add minimal tests that log functions are called (mock) if low risk.

**Plan refs:** §6 (C), (D), §4 stitch/compare consumers.

---

## Slice 3 — Observability: fingerprint events + admin lab + timeout

**Goal:** When fingerprint builders exist, they must log §6 (B); until then add **no-op or stub** hooks. Add admin lab action logs §6 (E) and explicit **timeout** signaling for recalc path §6 (A).

**Scope:**

1. Define shared event names for §6 (B) (`whole_home_fingerprint_build_*`, `usage_fingerprint_build_*`, `resolved_sim_fingerprint_*`) in `simObservability.ts` (types only OK until Slice 9–10).
2. **`app/api/admin/tools/gapfill-lab/route.ts`**: for actions `lookup_source_houses`, `replace_test_home_from_source`, `save_test_home_inputs`, `run_test_home_canonical_recalc`, log structured events with `sourceHouseId`/`testHomeId` when present.
3. User recalc route / dispatch: ensure timeout path logs `recalc_timeout` with `correlationId` (not silent HTML success per §6 forbidden list).

**Dependencies:** Slice 1–2 complete preferred so `correlationId` exists end-to-end.

**Plan refs:** §6 (B), (E), §7 admin actions table.

---

## Slice 4 — API: failure contracts + correlation in responses

**Goal:** §7 table — explicit `failureCode` / `failureMessage` for expected failures; optional `correlationId` in JSON for clients.

**Scope:**

1. **`app/api/user/simulator/recalc/route.ts`:** map shared-module errors to stable codes; never return success on failure; include `correlationId` in body or header when available.
2. **`app/api/user/usage/simulated/house/route.ts`:** same pattern for read failures; no local compare math.
3. **`app/api/admin/tools/gapfill-lab/route.ts`:** structured errors for auth, bad action, upstream failure; pass through `validationSelectionDiagnostics` where applicable.

**Constraints:** Additive JSON fields; do not fork simulator.

**Verify:** Add/extend API contract tests per §27 (API failure contract tests).

**Plan refs:** §7, §28 (failure codes).

---

## Slice 5 — UI: user Past Sim — states and honesty

**Goal:** §8 user section — loading, ready, stale/building, failed, timeout, empty, retry; never fake success; no local modeled math.

**Scope:** `components/usage/UsageSimulatorClient.tsx` (and shared usage components as needed): explicit UI for each state; baseline vs compare sections unchanged architecturally; compare renders shared payload only.

**Dependencies:** Slice 4 helps (typed errors); can proceed in parallel if API fields are stubbed.

**Verify:** Tests per §27 user page failure-state tests.

**Plan refs:** §8 (user), §25.

---

## Slice 6 — UI: admin Gap-Fill Lab — visibility + states

**Goal:** §8 admin section + §23 visibility checklist.

**Scope:** `GapFillLabCanonicalClient.tsx` (and related): show source house id, test home id, treatment mode, admin validation mode, system default validation mode (`userDefaultValidationSelectionMode`), fingerprint freshness summary (§13 fields when API provides), `failureCode`/`failureMessage`; same state machine as user page.

**Dependencies:** Slice 4–5 ideal.

**Verify:** §27 admin page failure-state tests.

**Plan refs:** §8 (admin), §23 (identity + sections A–H as applicable to current UI).

---

## Slice 7 — Phase 1: shared day-level temperature modeling upgrade

**Goal:** §26 Phase 1 + §21 — improve **`buildPastSimulatedBaselineV1`**, **`simulatePastDay`**, integration in **`simulatePastUsageDataset`**; **do not** change stitch integration semantics in `dataset.ts` except via upstream simulated day values.

**Scope:**

- Temperature-response-driven day totals; explicit DOW / weekday-weekend; intraday shape subordinate to day total; same logic for travel/vacant and validation/test modeled days.
- **Forbidden:** rigid per-bucket quotas, copying meter as simulated, ACTUAL labeled as simulated.

**Constraints:** Preserve **`buildCurveFromPatchedIntervals`** / **`buildSimulatedUsageDatasetFromCurve`** behavior for how days are merged; add regression tests for stitch if touching boundaries.

**Verify:** Simulator/engine tests + artifact-only tests; compare §27 projection integrity.

**Plan refs:** §21, §26 Phase 1, §4 Past Sim stitch preservation.

---

## Slice 8 — Phase 2a: persistence + build metadata for fingerprints

**Goal:** §26 Phase 5 + §29 decisions — additive schema (Prisma usage domain or as decided) for fingerprint rows; build metadata hooks on `UsageSimulatorBuild` or equivalent.

**Scope:** Migrations in repo conventions; store hashes/`staleReason`/`builtAt` per §13; no second artifact family.

**Dependencies:** Slice 7 recommended so day-model inputs to fingerprints are stable.

**Verify:** Migration applies; artifact-only tests for build rows.

**Plan refs:** §13, §17 persistence recommendations, §29.

---

## Slice 9 — Phase 2b: UsageFingerprint + WholeHomeFingerprint builders + freshness

**Goal:** §26 Phase 2 + §11 + §17 — single shared implementation each for background and recalc; §13 state machine.

**Scope:**

- **`UsageFingerprint`**: from intervals + weather aligned to canonical window (`recalcSimulatorBuild` / `simulatePastUsageDataset` path).
- **`WholeHomeFingerprint`**: from home + appliance audited fields; triggers as §11 A/B.
- Persistence using Slice 8 schema; same builders from orchestration and recalc.

**Verify:** Fingerprint builder identity tests §27.

**Plan refs:** §11, §17, §14 admin/user prebuilt fingerprints.

---

## Slice 10 — Phase 2c: ResolvedSimFingerprint resolver + wire to sim chain

**Goal:** §11 C + §17 ResolvedSimFingerprint — resolver produces inputs consumed by shared chain; **`recalcSimulatorBuild` → `simulatePastUsageDataset`** uses resolved inputs; no route math.

**Scope:** Shared module for resolution (blend, constraints placeholders for later slices); build metadata records provenance; optional cache uses same resolver function.

**Dependencies:** Slices 8–9.

**Verify:** Canonical chain tests; no duplicate resolver paths.

**Plan refs:** §17, §19 table (actual-data row).

---

## Slice 11 — Phase 3: measurement instrumentation

**Goal:** §12 + §26 Phase 3 — measure CPU/time/memory for day sim, fingerprint builds, resolver, compare attach.

**Scope:** Timers/metrics around the listed functions; document baseline numbers; no product behavior change beyond logging/metrics.

**Dependencies:** Slices 7–10.

**Verify:** Performance smoke tests §27; recorded fixtures.

**Plan refs:** §12, §26 Phase 3.

---

## Slice 12 — Phase 4: hosting / droplet for heavy work only

**Goal:** §26 Phase 4 + §4 Droplet scope — if limits exceeded, move **same** `recalcSimulatorBuild` + fingerprint builders behind queue/droplet; **no** droplet-only simulator fork; **no** compare-heavy workflow by default.

**Scope:** Orchestration changes only; workers call same modules; document decision in repo docs or ADR.

**Dependencies:** Slice 11 measurements.

**Plan refs:** §4 Droplet scope, §26 Phase 4.

---

## Slice 13 — Phase 6–7: cohort prior + full resolver coverage

**Goal:** §18 cohort builder + §26 Phases 6–7 — cohort prior artifact feeds `WholeHomeFingerprint`; resolver covers all resolution states in §17 for modes that exist.

**Scope:** Shared modules only; similarity features per §18; wire into resolver from Slice 10.

**Dependencies:** Slices 8–10; Slice 12 if hosting affects async builds.

**Plan refs:** §18, §19, §26 Phases 6–7.

---

## Slice 14 — Phase 8–9: mode adapters + weather unification

**Goal:** §19 + §20 + §26 Phases 8–9 — manual monthly/annual/new-build terminate in same shared day-level weather-driven contract; **`loadWeatherForPastWindow`** semantics for non-`SMT_BASELINE` builders.

**Scope:** `buildSimulatorInputs` / service adapters; **no** separate climate-only simulator.

**Dependencies:** Slice 7 (day contract), Slice 10 (resolver), Slice 13 (priors as needed).

**Verify:** Mode adapter + weather tests §27.

**Plan refs:** §19, §20, §26 Phases 8–9.

---

## Slice 15 — Phase 10–12: admin calibration UI + protection pass + hardening

**Goal:** §26 Phases 10–12 + §23–§24 + §11 projection pass.

**Scope:**

- Admin treatment selector + diagnostics + Section 23 UI sections not yet present; treatment matrix §24.
- Phase 11: verify baseline vs compare, `validationOnlyDateKeysLocal` / `actualContextHouseId` compare path, stitch parity user/admin.
- Phase 12: load/regression tests, migration safety, §27 remaining tests (observability, triage fixtures).

**Dependencies:** Prior slices per feature.

**Plan refs:** §23, §24, §26 Phases 10–12, §27, §9 troubleshooting order for QA.

---

## Optional parallel tracks (not separate numbered slices)

- **Tests-only sprint:** Expand §27 categories without feature work (after Slice 4).
- **Documentation:** Operator runbook from §9 triage flow (any time after Slice 2).

---

## Slice count summary

| Count | Meaning |
|------|---------|
| **15** | Numbered implementation slices (1–15) |
| **12** | Plan “Phase” numbers in §26 (Phase 1–12); slices map to them with some phases split across multiple slices (e.g. Phase 2 → Slices 8–10) |

When assigning an agent, paste **Global rules** + **one slice** block + the list of files from the canonical plan §3 table relevant to that slice.
