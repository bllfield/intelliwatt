# HOT PATH AUDIT (Phase A)

## 1) Audit Purpose and Constraints

- This document is a current-state audit for the simulator recalc/read hot path, scoped to process inefficiency and duplicate work behind the observed timeout envelope (~300s).
- This is an evidence pass only. No runtime behavior, schema, route contract, or output semantics are changed by this document.
- This audit operationalizes the current Phase A planning direction and aligns with the architecture guardrails in `docs/UNIFIED_SIM_FINGERPRINT_PLAN.md`.
- For non-baseline coverage metadata, the canonical shared source remains `resolveCanonicalUsage365CoverageWindow()` in `modules/usageSimulator/metadataWindow.ts`.
- Hosting/off-box conclusions are explicitly deferred until duplicate-work cleanup and remeasurement are completed.

## 2) End-to-End Hot Path Stage Audit

### Stage-by-stage table

| Stage | Primary owner | Inputs consumed | Outputs produced | Heavy reads | Persistence R/W | Repeated work risks | Lighter option candidate | Wrong-layer risk |
|---|---|---|---|---|---|---|---|---|
| POST user recalc | `app/api/user/simulator/recalc/route.ts:POST` | `userId`, `houseId`, `mode`, optional `scenarioId`, `weatherPreference`; default validation selection mode | dispatch request with correlation id and execution mode response | user/house ownership checks | none | repeated auth/ownership checks are expected; no major duplicate | none (thin route) | low |
| Dispatch | `modules/usageSimulator/pastSimRecalcDispatch.ts:dispatchPastSimRecalc` | recalc args + optional correlation id | inline result or droplet enqueue (`jobId`) | none | queue create/update for async path | inline timeout + retry behavior can lead to repeated recalc attempts at caller level | keep one retry policy owner above dispatch | medium (if callers stack retries) |
| Async worker | `modules/usageSimulator/pastSimRecalcQueuedWorker.ts:runPastSimRecalcQueuedWorker` | queued payload | same `recalcSimulatorBuild` output side effects | job payload read | job status write | duplicate recalc orchestration behavior if inline and async diverge over time | enforce same shared recalc entry and options | medium |
| Recalc core entry | `modules/usageSimulator/service.ts:recalcSimulatorBuild -> recalcSimulatorBuildImpl` | all recalc inputs, selected mode, scenario context, correlation id | persisted build + dataset + hashes | multiple DB loads across manual/home/appliance/scenario/events/build rows | `UsageSimulatorBuild` upsert; optional buckets and interval series writes | monolithic chain can recompute inputs, windows, and derived metadata in one request | split orchestration into smaller stage wrappers with reusable artifacts | high |
| Build input assembly | `modules/usageSimulator/build.ts:buildSimulatorInputs` | mode, home/appliance/manual payloads, travel ranges, canonical months | monthly totals, shapes, source notes | `fetchActualCanonicalMonthlyTotals`, `fetchActualIntradayShape96` for SMT path | none directly | possible duplicate data pulls with downstream simulation reads for same window | input extraction layer caches reusable light summaries | medium |
| Validation day auto-select (when needed) | `modules/usageSimulator/service.ts:recalcSimulatorBuildImpl` | canonical window, timezone, travel keys | selected validation keys + diagnostics | full-window `getActualIntervalsForRange` via candidate coverage helper | none | interval load can overlap with later simulation interval load | reuse a single interval pull result for selection + simulation when possible | high |
| Fingerprint readiness/ensure | `modules/usageSimulator/fingerprintOrchestration.ts:ensureSimulatorFingerprintsForRecalc` | house ids, profiles, mode, actual readiness, window | refreshed/persisted fingerprint artifacts | delegated to builders | writes `building/ready/failed` fingerprints | always executes whole-home then usage path (for SMT baseline) | add policy gate for reuse by status/sourceHash before full build | high |
| Whole-home fingerprint build | `modules/usageSimulator/wholeHomeFingerprintBuilder.ts:buildAndPersistWholeHomeFingerprint` | profile snapshots | whole-home fingerprint payload + sourceHash | read prior artifact row | writes `building` then `ready/failed` | repeated source hash and upsert churn on same request chain | avoid rebuild if ready and sourceHash unchanged | medium |
| Usage fingerprint build | `modules/usageSimulator/usageFingerprintBuilder.ts:buildAndPersistUsageFingerprint` | actual house context, window, weather identity | usage fingerprint payload + sourceHash | `getIntervalDataFingerprint`, `computePastWeatherIdentity` | writes `building` then `ready/failed` | interval fingerprint read overlaps with later simulation interval fetch | share interval identity + window-level memoized data within request | high |
| Resolved fingerprint assembly | `modules/usageSimulator/resolveSimFingerprint.ts:resolveSimFingerprint` | mode + manual constraint context + fingerprint rows | `ResolvedSimFingerprint` | latest whole-home + usage artifact rows | none | repeated resolver calls if triggered in multiple branches | resolve once per request and propagate | medium |
| Shared day simulation entry | `modules/simulatedUsage/simulatePastUsageDataset.ts:simulatePastUsageDataset` | build inputs, weather mode, ranges, selected keep-ref keys | stitched dataset, day results, optional curve | `getActualIntervalsForRange` (non-low-data), `loadWeatherForPastWindow`, profile reads | none direct (caller persists) | potential overlap with prior interval/hash/weather reads | feed preloaded lightweight inputs where available | high |
| Weather load | `modules/simulatedUsage/simulatePastUsageDataset.ts:loadWeatherForPastWindow` | date window + canonical keys | weather maps + provenance | weather day reads and backfill/repair if missing | weather persistence may update missing/stub rows | conditional fallback loads can repeat in same request family | centralize one weather load artifact per request/window | medium |
| Day-level engine | `modules/simulatedUsage/engine.ts:buildPastSimulatedBaselineV1`, `modules/simulatedUsage/pastDaySimulator.ts:simulatePastDay` | patched interval baseline + weather + profiles + resolved fingerprint | patched intervals + simulated day rows | operates in-memory once inputs loaded | none | low duplicate risk inside stage; risk is repeated invocation by caller paths | keep single owner and no side reads | low |
| Stitch/materialization | `modules/usageSimulator/dataset.ts:buildCurveFromPatchedIntervals`, `buildSimulatedUsageDatasetFromCurve` | patched intervals/day results | curve, dataset, canonical simulated-day totals map | in-memory transforms | none | if called repeatedly for same request, compute duplication | generate once and reuse projected variants | medium |
| Persist build/artifacts | `modules/usageSimulator/service.ts:recalcSimulatorBuildImpl` | buildInputs, dataset, hash, fingerprint refs | saved build row and optional cache rows | write-path readbacks (minimal) | `UsageSimulatorBuild`, bucket rows, interval series cache rows | duplicate hash/serialization prep before write | single hash pipeline and single serialization payload | medium |
| Canonical read path | `modules/usageSimulator/service.ts:getSimulatedUsageForHouseScenario` | user/house/scenario/read mode/projection mode | projected dataset with compare attached | build reads, cache reads, interval/weather/profile identity reads, actual daily fetch for compare | cache writes on rebuild path | repeated read calls with different projection modes; repeated identity computation | one canonical read + in-memory projection variants | high |
| Baseline projection + compare attach | `modules/usageSimulator/service.ts:projectBaselineFromCanonicalDataset`, `attachValidationCompareProjection`; sidecar in `modules/usageSimulator/compareProjection.ts` | dataset + validation keys + actual daily by date | baseline-safe dataset + compare rows/metrics + sidecar payload | targeted `getActualDailyKwhForLocalDateKeys` | none | compare payload packaged twice (meta + sidecar), baseline/raw double-read in some routes | compute once, package once, derive sidecar from same in-memory object | medium |
| User route serialization | `app/api/user/usage/simulated/house/route.ts:GET` | read output | API payload + compare sidecar + headers | may trigger second read after usage-shape ensure | none | second `getSimulatedUsageForHouseScenario` on auto-build branch | preserve single read where practical | medium |
| Admin canonical recalc/read | `app/api/admin/tools/gapfill-lab/route.ts` | action payload, selected days, treatment mode | recalc output + canonical dataset + compare diagnostics | recalc + dual reads + selected-day interval pulls | compare run snapshot writes | back-to-back raw/baseline reads (`allow_rebuild` twice), possible extra selected-day interval pull | one read then in-memory baseline projection and compare assembly | high |

### Required audit fields per stage

For each stage above, refactor phases should capture and validate:

- exact inputs/outputs contract;
- heavy reads and persistence reads/writes;
- repeated hashing/serialization;
- repeated window/date computation;
- repeated weather loads;
- repeated interval pulls;
- repeated artifact reads;
- repeated compare generation/prep;
- whether stage can be lighter;
- whether work belongs in a different layer.

## 3) Duplicate / Potential Duplicate Work Inventory

| Symptom | Current owner (`file:function`) | Why wasteful | Target owner after refactor | Expected benefit |
|---|---|---|---|---|
| Dual canonical reads in admin path (`raw` then `baseline`) | `app/api/admin/tools/gapfill-lab/route.ts` with `getSimulatedUsageForHouseScenario(...projectionMode: "raw")` and again baseline | Repeats build/cache/identity/projection and compare attachment path in same request | shared read/projection layer in `modules/usageSimulator/service.ts` returning one canonical read plus projection variants | lower DB/cache pressure, reduced latency, easier traceability |
| Validation day auto-select full-window interval pull then simulation interval pull | `modules/usageSimulator/service.ts:recalcSimulatorBuildImpl` + `modules/simulatedUsage/simulatePastUsageDataset.ts` | Full-window intervals can be fetched once for selection and again for simulation | input extraction + simulation preload contract | lower interval read cost and request wall time |
| Fingerprint interval fingerprint read overlaps simulation interval read | `modules/usageSimulator/usageFingerprintBuilder.ts` + `modules/simulatedUsage/simulatePastUsageDataset.ts` | One request path touches same window data for hash and then full rows | artifact policy + input extraction reuse surface | less duplicate heavy I/O and hashing |
| Repeated canonical window derivation inside one flow | `modules/usageSimulator/service.ts` (`resolveCanonicalUsage365CoverageWindow()` called in multiple branches) | Small per-call cost, but repeated date/window transforms and key rebounding in monolith | shared request-scoped window context object | cleaner logic, fewer drift points |
| Artifact-only read identity recomputation each read | `modules/usageSimulator/service.ts:getSimulatedUsageForHouseScenario` artifact path | Recomputes interval/weather/profile identity + hash even when artifact row already exact-matchable by saved metadata | artifact state/persistence policy layer | reduced read-path compute and better cache hit path |
| Route-level second read on usage-shape auto-build fallback | `app/api/user/usage/simulated/house/route.ts:GET` | Two full read attempts in one request | shared retry wrapper in service layer | lower route complexity and duplicate cost |
| Weather supplemental reload in selected-day compare branch | `modules/usageSimulator/service.ts` selected-day compare helper | Additional weather load can occur after shared sim weather path | shared weather accessor with request-level memoization | avoid duplicate weather work |
| Repeated serialization and hash prep during recalc write | `modules/usageSimulator/service.ts:recalcSimulatorBuildImpl` | buildInputsHash and storage payload assembly repeated across branches | persistence policy layer | less CPU churn and clearer write authority |
| Compare projection packaged in both dataset meta and sidecar | `modules/usageSimulator/service.ts` + `modules/usageSimulator/compareProjection.ts` + user route | not huge compute duplication, but duplicate payload shape handling | compare projection layer with one packaging policy | slimmer responses and lower route glue |
| Fingerprint ensure always enters builder path | `modules/usageSimulator/fingerprintOrchestration.ts` | no explicit reuse gate before build calls; builders still execute checks and writes | artifact state/policy layer with should-rebuild decision | reduce unnecessary fingerprint rebuild churn |

## 4) Lightweight Pull Rule Audit Matrix

| Use case | Minimal required data shape | Forbidden heavier fallback unless justified | Current owner | Target owner |
|---|---|---|---|---|
| Validation compare actuals | daily totals keyed by selected local date keys | full-year interval fetch for compare-only reads | `getValidationActualDailyByDateForDataset` in `modules/usageSimulator/service.ts` using `getActualDailyKwhForLocalDateKeys` | compare projection layer |
| Past stitched simulation | one interval series for canonical window + resolved inputs | duplicate full-window pull for selection and simulation in same request | `recalcSimulatorBuildImpl` + `simulatePastUsageDataset` | shared execution preload layer |
| Artifact read | one artifact/build read per request path | raw read + baseline read + compare read as separate heavy service calls | admin route and service consumers | read/projection layer |
| Fingerprint readiness check | artifact status + sourceHash decision | unconditional build calls when ready hash already matches | `ensureSimulatorFingerprintsForRecalc` + builders | artifact state/policy layer |
| Window/date coverage metadata | one canonical window resolution per request | multiple ad hoc window resolutions | service/read paths | shared timezone/window helper context |
| Source hash and identity | one computed identity reused by downstream stages | recomputing source hash/identity in multiple branches | service artifact paths + fingerprint builders | persistence policy + request context |
| Weather dependency | one weather load per request/window with proven reuse | extra weather reload after shared simulation weather load | `simulatePastUsageDataset` + downstream selected-day helpers | shared weather access layer |
| Selected-day compare in admin | selected days actual/sim daily + canonical dataset projections | full-window interval + repeated dataset read when selected-day shape is enough | gapfill admin route | compare projection layer + lightweight pull contract |

## 5) Observability Coverage and Gaps

### Current coverage map

| Stage | Current event coverage | `durationMs` | `memoryRssMb` | `correlationId` |
|---|---|---|---|---|
| recalc lifecycle | `recalc_start`, `recalc_success`, `recalc_failure` in `recalcSimulatorBuild` | yes (success/failure) | no | yes |
| inline timeout | `recalc_timeout` in `dispatchPastSimRecalc` | yes | no | yes |
| whole-home fingerprint | `whole_home_fingerprint_build_start/success/failure` | yes | yes | yes |
| usage fingerprint | `usage_fingerprint_build_start/success/failure` | yes | yes | yes |
| resolve fingerprint | `resolved_sim_fingerprint_resolution_start/success/failure` | yes | yes | yes |
| day simulation | `day_simulation_start`, `day_simulation_baseline_phase`, `day_simulation_success/failure` | yes | yes | yes |
| stitch curve/dataset | `stitch_curve_*`, `stitch_dataset_*` | no (success currently counts only) | no | yes |
| compare attach | `compareProjection_start/success/failure` in `getSimulatedUsageForHouseScenario` | yes | yes | yes |
| artifact cache read hints | `artifact_cache_hit/miss/stale_detected` | no | no | yes |

### Primary observability gaps

- No end-to-end read envelope timing for `getSimulatedUsageForHouseScenario` (total read latency missing).
- Large recalc sub-stages inside `recalcSimulatorBuildImpl` are not individually timed (input assembly, validation selection, write/persist).
- Stitch events do not emit `durationMs` and `memoryRssMb`.
- Nested recalc calls from read path do not consistently preserve parent correlation context.
- Route-level timing is not emitted for user/admin route wrappers.

## 6) Evidence Appendix (Symbol Coverage Checklist)

All required anchors were validated in active code usage:

| Symbol / concept | Verified owner(s) |
|---|---|
| `recalcSimulatorBuild`, `recalcSimulatorBuildImpl` | `modules/usageSimulator/service.ts` |
| `buildSimulatorInputs` | `modules/usageSimulator/build.ts`, called by service recalc |
| `buildAndPersistWholeHomeFingerprint` | `modules/usageSimulator/wholeHomeFingerprintBuilder.ts` |
| `buildAndPersistUsageFingerprint` | `modules/usageSimulator/usageFingerprintBuilder.ts` |
| `resolveSimFingerprint` | `modules/usageSimulator/resolveSimFingerprint.ts` |
| `simulatePastUsageDataset` | `modules/simulatedUsage/simulatePastUsageDataset.ts` |
| `buildPastSimulatedBaselineV1` | `modules/simulatedUsage/engine.ts` (invoked by `simulatePastUsageDataset`) |
| `simulatePastDay` | `modules/simulatedUsage/pastDaySimulator.ts` |
| `buildCurveFromPatchedIntervals` | `modules/usageSimulator/dataset.ts` |
| `buildSimulatedUsageDatasetFromCurve` | `modules/usageSimulator/dataset.ts` |
| `getSimulatedUsageForHouseScenario` | `modules/usageSimulator/service.ts` |
| `buildValidationCompareProjectionSidecar` | `modules/usageSimulator/compareProjection.ts`; used by user route |
| `projectBaselineFromCanonicalDataset` | `modules/usageSimulator/service.ts` usage path |
| `validationOnlyDateKeysLocal` | recalc build inputs + read projection in `modules/usageSimulator/service.ts` |
| `actualContextHouseId` | recalc/read compare contexts in `modules/usageSimulator/service.ts` |
| `resolveCanonicalUsage365CoverageWindow` | service metadata window ownership (`modules/usageSimulator/service.ts`) and shared window policy |
| `loadWeatherForPastWindow` | `modules/simulatedUsage/simulatePastUsageDataset.ts` |
| `getActualIntervalsForRange` | simulation input load + admin route selected-day reads |
| `getActualDailyKwhForLocalDateKeys` | validation compare daily-actual pull (`modules/usageSimulator/service.ts`) |
| `UsageSimulatorBuild` | recalc/write/read in `modules/usageSimulator/service.ts` |
| `PastSimulatedDatasetCache` | cache read/write helpers used by `getSimulatedUsageForHouseScenario` |
| `WholeHomeFingerprint`, `UsageFingerprint`, `ResolvedSimFingerprint` | fingerprint builders/repo/resolver modules |
| `building`, `staleReason` | fingerprint artifact status fields in builders/repo |
| `correlationId`, `durationMs`, `memoryRssMb` | `modules/usageSimulator/simObservability.ts` and pipeline emitters |

## 7) Source Files Used for This Audit

- `app/api/user/simulator/recalc/route.ts`
- `modules/usageSimulator/pastSimRecalcDispatch.ts`
- `modules/usageSimulator/pastSimRecalcQueuedWorker.ts`
- `modules/usageSimulator/simDropletJob.ts`
- `modules/usageSimulator/service.ts`
- `modules/usageSimulator/build.ts`
- `modules/usageSimulator/fingerprintOrchestration.ts`
- `modules/usageSimulator/wholeHomeFingerprintBuilder.ts`
- `modules/usageSimulator/usageFingerprintBuilder.ts`
- `modules/usageSimulator/resolveSimFingerprint.ts`
- `modules/usageSimulator/fingerprintArtifactsRepo.ts`
- `modules/simulatedUsage/simulatePastUsageDataset.ts`
- `modules/simulatedUsage/engine.ts`
- `modules/simulatedUsage/pastDaySimulator.ts`
- `modules/usageSimulator/dataset.ts`
- `modules/usageSimulator/compareProjection.ts`
- `app/api/user/usage/simulated/house/route.ts`
- `app/api/admin/tools/gapfill-lab/route.ts`
- `modules/usageSimulator/simObservability.ts`

## 8) Phase A Exit Criteria Status

- `docs/HOT_PATH_AUDIT.md` created: yes.
- Full hot path stage table including recalc and read families: yes.
- Duplicate-work inventory with owner/waste/target/benefit: yes.
- Lightweight pull decision matrix with forbidden heavy fallbacks: yes.
- Observability coverage and gap identification: yes.
- Explicit hosting-deferral statement until cleanup + remeasurement: yes.
