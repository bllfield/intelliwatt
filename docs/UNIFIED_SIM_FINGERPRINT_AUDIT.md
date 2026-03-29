# 1. Purpose of this audit
This audit removes ambiguity before implementing unified whole-home / usage fingerprint architecture on top of the existing canonical shared simulator chain.

It is a strict current-state inventory and gap analysis from code inspection only.

# 2. Exact current canonical simulator chain
## Canonical chain (current code)
1. **Entrypoint (user recalc API)**
   - Function/module: `POST` in `app/api/user/simulator/recalc/route.ts`
   - Responsibility: Auth, house ownership check, mode validation (`MANUAL_TOTALS` | `NEW_BUILD_ESTIMATE` | `SMT_BASELINE`), resolves default validation-day mode via `getUserDefaultValidationSelectionMode()`, calls dispatch.

2. **Dispatch**
   - Function/module: `dispatchPastSimRecalc()` in `modules/usageSimulator/pastSimRecalcDispatch.ts`
   - Responsibility: Canonical Past recalc dispatch; either queue droplet async or run inline; both paths call the same `recalcSimulatorBuild()`.

3. **Optional droplet queue persistence/handoff**
   - Function/module: `enqueuePastSimRecalcDropletJob()` in `modules/usageSimulator/simDropletJob.ts`
   - Responsibility: Persist `SimDropletJob` row in usage DB and trigger droplet webhook.

4. **Optional droplet worker execution**
   - Function/module: `runPastSimRecalcQueuedWorker()` in `modules/usageSimulator/pastSimRecalcQueuedWorker.ts`
   - Responsibility: Load queued payload and run same canonical `recalcSimulatorBuild()`.

5. **Build/recalc authority**
   - Function/module: `recalcSimulatorBuild()` in `modules/usageSimulator/service.ts`
   - Responsibility: Load mode inputs (manual/home/appliance/scenario events), enforce requirements, resolve validation-day selection, build simulator inputs, run canonical Past simulation path for Past artifacts, persist build metadata/artifacts, return dataset/build result.

6. **Shared input builder**
   - Function/module: `buildSimulatorInputs()` in `modules/usageSimulator/build.ts`
   - Responsibility: Construct base inputs by mode; actual anchors/manual/new-build estimates; produce `monthlyTotalsKwhByMonth`, shapes, notes, baseKind.

7. **Shared weather loader**
   - Function/module: `loadWeatherForPastWindow()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`
   - Responsibility: Load weather maps and provenance for canonical window.

8. **Day-level simulation core**
   - Function/module: `buildPastSimulatedBaselineV1()` in `modules/simulatedUsage/engine.ts`
   - Responsibility: Determine reference-day pool, simulate excluded/incomplete/forced days via `simulatePastDay()`, return patched intervals + day results.
   - Day routine: `simulatePastDay()` in `modules/simulatedUsage/pastDaySimulator.ts`.

9. **Dataset/materialization**
   - Functions/modules:
     - `buildCurveFromPatchedIntervals()` in `modules/usageSimulator/dataset.ts`
     - `buildSimulatedUsageDatasetFromCurve()` in `modules/usageSimulator/dataset.ts`
   - Responsibility: Build canonical interval curve and canonical dataset object (daily/monthly/summary/series/meta including canonical simulated-day totals map).

10. **Artifact persistence**
    - Build metadata persistence:
      - Model: `UsageSimulatorBuild` in `prisma/schema.prisma`
      - Writer: `recalcSimulatorBuild()` in `modules/usageSimulator/service.ts`
    - Past artifact/cache persistence:
      - Model: `PastSimulatedDatasetCache` in `prisma/usage/schema.prisma`
      - Writers/readers: `saveCachedPastDataset()`, `getCachedPastDataset()`, `getLatestCachedPastDatasetByScenario()` in `modules/usageSimulator/pastCache.ts`

11. **Read service**
    - Function/module: `getSimulatedUsageForHouseScenario()` in `modules/usageSimulator/service.ts`
    - Responsibility: Resolve scenario key, read artifact family (artifact-only or rebuild-allowed path), restore intervals, apply baseline projection + compare projection attachment.

12. **User route output family**
    - Function/module: `GET` in `app/api/user/usage/simulated/house/route.ts`
    - Responsibility: Orchestrate shared service read and serialize user payload; compare sidecar is read from shared compare-projection family (`buildValidationCompareProjectionSidecar()`).

# 3. Exact current output family
## Canonical output family ownership
- **Canonical dataset build**
  - `simulatePastUsageDataset()` in `modules/simulatedUsage/simulatePastUsageDataset.ts`
  - Calls `buildPastSimulatedBaselineV1()` -> `buildCurveFromPatchedIntervals()` -> `buildSimulatedUsageDatasetFromCurve()`.

- **Where canonical dataset is persisted**
  - Build identity + inputs/hash in `UsageSimulatorBuild` (`prisma/schema.prisma`) via `recalcSimulatorBuild()`.
  - Dataset artifact/cache in `PastSimulatedDatasetCache` (`prisma/usage/schema.prisma`) via `saveCachedPastDataset()` (`modules/usageSimulator/pastCache.ts`).

- **Where canonical dataset is restored/read**
  - `getSimulatedUsageForHouseScenario()` (`modules/usageSimulator/service.ts`) restores from `PastSimulatedDatasetCache` using `getCachedPastDataset()` or `getLatestCachedPastDatasetByScenario()`.
  - Restored intervals are decoded and reattached to dataset payload before projection shaping.

- **Where baseline projection is shaped**
  - `projectBaselineFromCanonicalDataset()` in `modules/usageSimulator/compareProjection.ts`.
  - Invoked from `getSimulatedUsageForHouseScenario()` (`modules/usageSimulator/service.ts`) when `projectionMode === "baseline"`.

- **Where validation days remain actual in baseline**
  - `projectBaselineFromCanonicalDataset()` enforces `source: "ACTUAL"` on validation-only local dates and overwrites day kWh from actual usage when available.
  - Actual day map comes from `getValidationActualDailyByDate()` inside `getSimulatedUsageForHouseScenario()` (`modules/usageSimulator/service.ts`).

- **Where compareProjection is attached**
  - `attachValidationCompareProjection()` in `modules/usageSimulator/compareProjection.ts` writes `meta.validationCompareRows` and `meta.validationCompareMetrics`.
  - Called by `getSimulatedUsageForHouseScenario()` after baseline projection.

- **Where validation compare rows are produced**
  - `attachValidationCompareProjection()` computes rows from:
    - `meta.validationOnlyDateKeysLocal`
    - baseline daily rows (actual side)
    - canonical simulated totals (`meta.canonicalArtifactSimulatedDayTotalsByDate`).

- **Where route serializes compare sidecar**
  - User route: `buildValidationCompareProjectionSidecar()` in `modules/usageSimulator/compareProjection.ts` called by `app/api/user/usage/simulated/house/route.ts`.
  - Admin Gap-Fill route also calls same sidecar builder in `app/api/admin/tools/gapfill-lab/route.ts`.

# 4. Exact current weather timeline behavior
- **Weather timeline currently loaded**
  - `loadWeatherForPastWindow()` loads weather by canonical date keys for the full Past window from:
    - `ACTUAL_LAST_YEAR`
    - `NORMAL_AVG`
    using `getHouseWeatherDays(...)`.

- **Actual vs normalized representation**
  - Returned maps are `actualWxByDateKey` and `normalWxByDateKey`.
  - Provenance object includes `weatherKindUsed`, `weatherSourceSummary`, `weatherFallbackReason`, `weatherProviderName`, `weatherCoverageStart`, `weatherCoverageEnd`, `weatherStubRowCount`, `weatherActualRowCount`.

- **Ownership**
  - Weather loading/provenance owner: `modules/simulatedUsage/simulatePastUsageDataset.ts` (`loadWeatherForPastWindow()`).
  - Weather is consumed by day simulation in `buildPastSimulatedBaselineV1()` (`modules/simulatedUsage/engine.ts`).

- **Current runtime behavior in shared Past chain**
  - `simulatePastUsageDataset()` currently hard-fails unless `provenance.weatherSourceSummary === "actual_only"` (returns `actual_weather_required:<summary>` otherwise).
  - So canonical shared Past run currently requires actual-only weather coverage.

- **Whether all modes already share same 365-day weather timeline concept**
  - Past shared simulation path uses canonical window date keys and this weather loader.
  - Manual/new-build baseline builders in `modules/usageSimulator/build.ts` do not call `loadWeatherForPastWindow()`.
  - Therefore: **not all modes currently share the same explicit weather timeline loader in code**.

- **Unclear items**
  - Exact future-state weather normalization contract for manual/new-build modes: `needs implementation decision`.

# 5. Exact current inputs available to the simulator by mode
| mode name | current entry route/page | exact stored inputs currently available | exact shared functions currently loading/building those inputs | exact hard constraints currently available | routed through canonical shared simulator chain now? | exact gaps for this mode |
|---|---|---|---|---|---|---|
| actual-data home (`SMT_BASELINE`) | Page: `app/dashboard/usage/simulated` (`components/usage/UsageSimulatorClient.tsx`), API: `POST /api/user/simulator/recalc` | `ManualUsageInput` (optional), `HomeProfileSimulated`, `ApplianceProfileSimulated`, scenario events (`UsageSimulatorScenarioEvent`), actual intervals source (SMT/Green Button via adapters), `UsageSimulatorBuild`, `PastSimulatedDatasetCache` | `recalcSimulatorBuild()` + `buildSimulatorInputs()` + `simulatePastUsageDataset()` + `buildPastSimulatedBaselineV1()` + `buildSimulatedUsageDatasetFromCurve()` + `getSimulatedUsageForHouseScenario()` | `computeRequirements()` requires home profile valid with past-baseline required fields and actual intervals for `SMT_BASELINE` | **Yes** | No unified fingerprint artifact/contract exists; no resolved fingerprint object consumed by shared sim chain |
| manual monthly (`MANUAL_TOTALS` + payload mode `MONTHLY`) | Page: `app/dashboard/api/page.tsx` -> `/dashboard/api/manual`; API: `POST /api/user/manual-usage`; recalc: `POST /api/user/simulator/recalc` | `ManualUsageInput.payload` (`mode`, `anchorEndDate`, `monthlyKwh[]`, `travelRanges[]`; legacy `anchorEndMonth`, `billEndDay`), `HomeProfileSimulated`, `ApplianceProfileSimulated`, scenario events/build rows | Input write/read: `app/api/user/manual-usage/route.ts`; build/recalc: `recalcSimulatorBuild()` + `buildSimulatorInputs()` (`manualMonthlyTotals()`) | `validateManualUsagePayload()` requires valid anchor + at least one numeric monthly entry; `computeRequirements()` also requires home and appliances completeness for `MANUAL_TOTALS` | **Partially** (mode handled in same `recalcSimulatorBuild()`, but Past weather/day-level shared simulation path is SMT/Past-specific) | No explicit shared constraint adapter contract for manual-monthly into unified fingerprint; no persisted usage fingerprint artifact |
| manual annual (`MANUAL_TOTALS` + payload mode `ANNUAL`) | Page/API same as manual monthly; recalc same endpoint | `ManualUsageInput.payload` (`mode`, `anchorEndDate`, `annualKwh`, `travelRanges[]`; legacy `endDate`), plus home/appliance/build/scenario rows | Input write/read: `app/api/user/manual-usage/route.ts`; build/recalc: `recalcSimulatorBuild()` + `buildSimulatorInputs()` (`annualToMonthlyByWeights()`) | `validateManualUsagePayload()` requires valid anchor + numeric `annualKwh`; `computeRequirements()` requires manual payload + home/appliance | **Partially** (same as manual monthly) | No explicit shared annual-constraint adapter contract; no unified fingerprint persistence/contract |
| new build / zero-data home (`NEW_BUILD_ESTIMATE`) | Page: `app/dashboard/api/page.tsx` new-build card links `/dashboard/usage/simulated?intent=NEW_BUILD`; recalc via `POST /api/user/simulator/recalc` | `HomeProfileSimulated`, `ApplianceProfileSimulated`, scenario/build rows; no manual payload required; no actual intervals required | `recalcSimulatorBuild()` + `buildSimulatorInputs()` -> `estimateUsageForCanonicalWindow()` | `computeRequirements()` requires valid home and appliances for `NEW_BUILD_ESTIMATE` | **Partially** (same recalc entrypoint, but path uses estimator-based baseline, not Past shared weather/day-level simulator path) | No cohort/similar-home shared module in runtime path; no persisted whole-home/usage fingerprint artifact; no resolved-fingerprint contract |

# 6. Exact current home-detail input inventory
## Source model and fields
Primary persisted source: `HomeProfileSimulated` model in `prisma/home-details/schema.prisma`.

Repository/type mapping:
- `HomeProfileSimulatedForSimulator` in `modules/homeProfile/repo.ts`.
- Validation/input contract in `modules/homeProfile/validation.ts` (`HomeProfileInput`, `HomeProfileEv`).

| exact field name | source model/table/type | source file path(s) | currently consumed by sim path, surfaced only, or stored-only |
|---|---|---|---|
| `homeAge` | `HomeProfileSimulated.homeAge` | `prisma/home-details/schema.prisma`, `modules/homeProfile/repo.ts`, `modules/homeProfile/validation.ts` | Stored + loaded; **not found in current Past day-sim usage** |
| `homeStyle` | `HomeProfileSimulated.homeStyle` | same | Stored + loaded; **not found in current Past day-sim usage** |
| `squareFeet` | `HomeProfileSimulated.squareFeet` | same | Consumed by estimator (`estimateUsageForCanonicalWindow`) |
| `stories` | `HomeProfileSimulated.stories` | same | Stored + loaded; not found in current Past day-sim usage |
| `insulationType` | `HomeProfileSimulated.insulationType` | same | Stored + loaded; not found in current Past day-sim usage |
| `windowType` | `HomeProfileSimulated.windowType` | same | Stored + loaded; not found in current Past day-sim usage |
| `foundation` | `HomeProfileSimulated.foundation` | same | Stored + loaded; not found in current Past day-sim usage |
| `ledLights` | `HomeProfileSimulated.ledLights` | same | Consumed by estimator |
| `smartThermostat` | `HomeProfileSimulated.smartThermostat` | same | Consumed by estimator |
| `summerTemp` | `HomeProfileSimulated.summerTemp` | same | Consumed by estimator and Past HVAC weather adjustment (`engine.ts`) |
| `winterTemp` | `HomeProfileSimulated.winterTemp` | same | Consumed by estimator and Past HVAC weather adjustment |
| `occupantsWork` | `HomeProfileSimulated.occupantsWork` | same | Consumed by estimator |
| `occupantsSchool` | `HomeProfileSimulated.occupantsSchool` | same | Consumed by estimator |
| `occupantsHomeAllDay` | `HomeProfileSimulated.occupantsHomeAllDay` | same | Consumed by estimator |
| `fuelConfiguration` | `HomeProfileSimulated.fuelConfiguration` | same | Consumed by estimator and Past HVAC fuel checks |
| `hvacType` | `HomeProfileSimulated.hvacType` | same | Consumed by Past HVAC signal checks |
| `heatingType` | `HomeProfileSimulated.heatingType` | same | Consumed by Past HVAC heating-type logic |
| `hasPool` | `HomeProfileSimulated.hasPool` | same | Consumed by Past pool seasonal load |
| `poolPumpType` | `HomeProfileSimulated.poolPumpType` | same | Consumed by Past pool seasonal load |
| `poolPumpHp` | `HomeProfileSimulated.poolPumpHp` | same | Consumed by Past pool seasonal load |
| `poolSummerRunHoursPerDay` | `HomeProfileSimulated.poolSummerRunHoursPerDay` | same | Consumed by Past pool seasonal load |
| `poolWinterRunHoursPerDay` | `HomeProfileSimulated.poolWinterRunHoursPerDay` | same | Consumed by Past pool seasonal load |
| `hasPoolHeater` | `HomeProfileSimulated.hasPoolHeater` | same | Consumed by Past pool seasonal load |
| `poolHeaterType` | `HomeProfileSimulated.poolHeaterType` | same | Consumed by Past pool seasonal load |
| `evHasVehicle` | `HomeProfileSimulated.evHasVehicle` | same | Stored + surfaced via `ev` object; not found in current Past day-sim path |
| `evCount` | `HomeProfileSimulated.evCount` | same | Stored + surfaced; not found in current Past day-sim path |
| `evChargerType` | `HomeProfileSimulated.evChargerType` | same | Stored + surfaced; not found in current Past day-sim path |
| `evAvgMilesPerDay` | `HomeProfileSimulated.evAvgMilesPerDay` | same | Stored + surfaced; not found in current Past day-sim path |
| `evAvgKwhPerDay` | `HomeProfileSimulated.evAvgKwhPerDay` | same | Stored + surfaced; not found in current Past day-sim path |
| `evChargingBehavior` | `HomeProfileSimulated.evChargingBehavior` | same | Stored + surfaced; not found in current Past day-sim path |
| `evPreferredStartHr` | `HomeProfileSimulated.evPreferredStartHr` | same | Stored + surfaced; not found in current Past day-sim path |
| `evPreferredEndHr` | `HomeProfileSimulated.evPreferredEndHr` | same | Stored + surfaced; not found in current Past day-sim path |
| `evSmartCharger` | `HomeProfileSimulated.evSmartCharger` | same | Stored + surfaced; not found in current Past day-sim path |
| `provenanceJson` | `HomeProfileSimulated.provenanceJson` | `prisma/home-details/schema.prisma`, `app/api/user/home-profile/route.ts` | Stored + route response metadata; not found in current sim math |
| `prefillJson` | `HomeProfileSimulated.prefillJson` | same | Stored + route response metadata; not found in current sim math |

# 7. Exact current appliance/load input inventory
Primary persisted source: `ApplianceProfileSimulated.appliancesJson` in `prisma/appliances/schema.prisma`.

Validation/type source:
- `ApplianceProfilePayloadV1` and `ApplianceRow` in `modules/applianceProfile/validation.ts`.

| exact field name | source model/table/type | source file path(s) | currently consumed by sim path, surfaced only, or stored-only |
|---|---|---|---|
| `appliancesJson` | `ApplianceProfileSimulated.appliancesJson` | `prisma/appliances/schema.prisma`, `modules/applianceProfile/repo.ts` | Stored + loaded |
| `version` | `ApplianceProfilePayloadV1.version` | `modules/applianceProfile/validation.ts` | Stored + normalized; not found as direct sim math input |
| `fuelConfiguration` | `ApplianceProfilePayloadV1.fuelConfiguration` | `modules/applianceProfile/validation.ts` | Consumed by estimator and Past HVAC fuel checks |
| `appliances[].id` | `ApplianceRow.id` | `modules/applianceProfile/validation.ts` | Stored; not found as direct sim math input |
| `appliances[].type` | `ApplianceRow.type` | same | Consumed by estimator (`hvac`, `wh`, `ev`, `pool`) and Past HVAC appliance detection |
| `appliances[].data` | `ApplianceRow.data` | same | Partially consumed in Past path for HVAC heating inference (`heating_type`, `heat_type`, `heat_source`, `fuel_type`) |

Additional route sync behavior:
- `app/api/user/home-profile/route.ts` writes auto-generated `pool` and `hvac` appliance rows (best-effort sync) from home-details fields.
- This is data synchronization behavior; sim ownership remains in shared modules.

# 8. Exact current scenario / event / special-day input inventory
## Travel/vacant and scenario events
- Model: `UsageSimulatorScenarioEvent` (`prisma/schema.prisma`) with fields:
  - `scenarioId`, `effectiveMonth`, `kind`, `payloadJson`.
- User event routes:
  - `app/api/user/simulator/scenarios/[scenarioId]/events/route.ts`
  - `app/api/user/simulator/scenarios/[scenarioId]/events/[eventId]/route.ts`
- Event kinds handled in route/service code:
  - `MONTHLY_ADJUSTMENT` (`payloadJson.multiplier`, `payloadJson.adderKwh`)
  - `TRAVEL_RANGE` (`payloadJson.startDate`, `payloadJson.endDate`)
  - `UPGRADE_ACTION` (ledger/action payload structure)

## Validation/test-day selection
- Shared owner: `modules/usageSimulator/validationSelection.ts`
  - Modes: `manual`, `random_simple`, `customer_style_seasonal_mix`, `stratified_weather_balanced`
  - Function: `selectValidationDayKeys()`
  - Diagnostics type: `ValidationDaySelectionDiagnostics`.
- Persisted default setting:
  - Model: `UsageSimulatorSettings.userDefaultValidationSelectionMode` (`prisma/usage/schema.prisma`)
  - Functions: `getUserDefaultValidationSelectionMode()`, `setUserDefaultValidationSelectionMode()` in `modules/usageSimulator/service.ts`.
- Build input/meta fields in canonical flow:
  - `validationOnlyDateKeysLocal`
  - `validationSelectionDiagnostics`
  - `actualContextHouseId`
  - carried in `recalcSimulatorBuild()` and dataset meta paths in `modules/usageSimulator/service.ts`.

## Weather option
- Recalc input field: `weatherPreference` (`NONE` | `LAST_YEAR_WEATHER` | `LONG_TERM_AVERAGE`) from `app/api/user/simulator/recalc/route.ts`.
- Used in `recalcSimulatorBuild()` for monthly normalization branch (`normalizeMonthlyTotals`).
- Past shared weather loader still owned by `loadWeatherForPastWindow()` in `simulatePastUsageDataset.ts`.

## Current compareProjection contract
- Shared producer: `attachValidationCompareProjection()` (`modules/usageSimulator/compareProjection.ts`)
- Sidecar serializer: `buildValidationCompareProjectionSidecar()` (`modules/usageSimulator/compareProjection.ts`)
- Route fields returned to clients:
  - `compareProjection.rows[]` (`localDate`, `dayType`, `actualDayKwh`, `simulatedDayKwh`, `errorKwh`, `percentError`)
  - `compareProjection.metrics`.

# 9. Exact current shared-module ownership map
## Shared business logic modules (current owners)
- `modules/usageSimulator/service.ts` (recalc/read orchestration, artifact read family, projection application).
- `modules/usageSimulator/build.ts` (mode-based input builder).
- `modules/simulatedUsage/simulatePastUsageDataset.ts` (shared Past simulation entry + shared weather loader).
- `modules/simulatedUsage/engine.ts` and `modules/simulatedUsage/pastDaySimulator.ts` (day-level simulation).
- `modules/usageSimulator/dataset.ts` (curve and dataset shaping).
- `modules/usageSimulator/validationSelection.ts` (validation day selection + diagnostics).
- `modules/usageSimulator/compareProjection.ts` (baseline projection and compare projection shaping).
- `modules/usageSimulator/pastCache.ts` (Past artifact persistence contract).

## Route-only orchestration modules
- `app/api/user/simulator/recalc/route.ts` (auth/validation and dispatch call).
- `app/api/user/usage/simulated/house/route.ts` (auth, baseline alias handling, shared service call, sidecar serialization).
- `app/api/user/manual-usage/route.ts`, `app/api/user/home-profile/route.ts`, `app/api/user/appliances/route.ts` (input persistence APIs).
- `app/api/user/simulator/scenarios/...` routes (scenario event CRUD orchestration).

## Admin-only UI/helper modules
- `app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx` (admin UI).
- `app/api/admin/tools/gapfill-lab/route.ts` (admin orchestration endpoint; canonical sim reads/recalc calls into shared service path).
- `app/api/admin/tools/gapfill-lab/test-home/...` routes (test-home profile/appliance edit isolation).

## Suspicious ownership / drift check
- Shared validation-day selector logic under admin namespace: **not found in current code** (shared owner is `modules/usageSimulator/validationSelection.ts`).
- Route-local compare math separate from shared compareProjection family:
  - user route: **not found in current code** (uses shared sidecar builder).
  - admin route canonical compare sidecar: shared sidecar function is used.
- Route-local day-level simulator math outside shared modules: **not found in current inspected runtime paths**.

## What must remain shared in next phase
- Validation-day selection and diagnostics.
- Baseline projection shaping for validation-day actual behavior.
- Compare projection row/metric shaping.
- Past weather loading/provenance ownership.
- Day-level simulation (`simulatePastDay` family).

## What should never be reimplemented in route/UI code during next phase
- Sim math (daily/interval generation, weather weighting, HVAC/pool shaping).
- Validation day selection algorithms.
- Compare row/metric calculations.
- Artifact identity/hash calculations.

# 10. Exact current gaps for unified fingerprint architecture
1. **No persisted WholeHomeFingerprint artifact exists**
   - Why block: unified fingerprint architecture requires a canonical persisted whole-home representation.
   - Affected code area: no model/function named `WholeHomeFingerprint` in inspected schemas/modules.
   - Gap type: `missing schema`.

2. **No persisted UsageFingerprint artifact exists**
   - Why block: usage-side fingerprint cannot be versioned/read independently today.
   - Affected code area: no `UsageFingerprint` model/contract found; current persisted artifacts are `UsageSimulatorBuild` and `PastSimulatedDatasetCache`.
   - Gap type: `missing schema`.

3. **No shared resolved-fingerprint contract exists**
   - Why block: simulator does not accept a typed resolved fingerprint object as primary input contract.
   - Affected code area: `recalcSimulatorBuild()` and `buildSimulatorInputs()` consume mode-specific payloads/profiles directly.
   - Gap type: `missing shared contract`.

4. **Current simulator does not consume a unified resolved fingerprint object**
   - Why block: prevents single cross-mode fingerprint entry contract.
   - Affected code area: `modules/usageSimulator/service.ts`, `modules/usageSimulator/build.ts`.
   - Gap type: `missing builder`.

5. **Manual monthly mode lacks explicit canonical constraint adapter contract**
   - Why block: constraint translation is embedded in mode-specific logic rather than a reusable fingerprint constraint adapter.
   - Affected code area: `manualMonthlyTotals()` in `modules/usageSimulator/build.ts`, `app/api/user/manual-usage/route.ts`.
   - Gap type: `missing shared contract`.

6. **Manual annual mode lacks explicit canonical constraint adapter contract**
   - Why block: annual-to-month distribution exists, but no explicit fingerprint constraint contract.
   - Affected code area: `annualToMonthlyByWeights()` in `modules/usageSimulator/build.ts`, manual payload routes/types.
   - Gap type: `missing shared contract`.

7. **New build mode lacks shared cohort/archetype selector module**
   - Why block: docs mention similar-home priors; runtime path uses deterministic estimator only.
   - Affected code area: `estimateUsageForCanonicalWindow()` in `modules/usageEstimator/estimate.ts`; no cohort selector module found.
   - Gap type: `missing builder`.

8. **No shared blending layer that merges whole-home and usage fingerprints across modes**
   - Why block: no explicit cross-mode blend stage exists before sim chain.
   - Affected code area: mode branching in `recalcSimulatorBuild()`/`buildSimulatorInputs()`.
   - Gap type: `missing blending layer`.

9. **Weather timeline contract is not unified across all modes**
   - Why block: Past shared path has strict `actual_only` weather requirement; manual/new-build do not route through same weather loader contract.
   - Affected code area: `loadWeatherForPastWindow()` + `simulatePastUsageDataset()` versus mode builders in `build.ts`.
   - Gap type: `missing shared contract`.

10. **No fingerprint-level diagnostics artifact**
    - Why block: current diagnostics are build/sim/compare metadata; no diagnostics model for fingerprint resolution decisions.
    - Affected code area: no fingerprint diagnostics model found in schemas/routes.
    - Gap type: `missing diagnostics`.

11. **No fingerprint persistence/read API family**
    - Why block: next phase needs canonical read/write ownership for fingerprint artifacts.
    - Affected code area: no fingerprint routes/services found; current persistence centers on `UsageSimulatorBuild` + `PastSimulatedDatasetCache`.
    - Gap type: `missing persistence`.

12. **No UI wiring for fingerprint artifacts/contracts**
    - Why block: current UI writes manual/home/appliance/scenario inputs directly; no fingerprint object lifecycle.
    - Affected code area: `UsageSimulatorClient`, manual/home/appliance routes.
    - Gap type: `missing UI wiring`.

# 11. Exact decisions to lock before implementation
1. Exact persistence location and schema for `WholeHomeFingerprint`.
2. Exact persistence location and schema for `UsageFingerprint`.
3. Whether `ResolvedSimFingerprint` is persisted or generated per build/read.
4. Canonical rule for cohort/similar-home membership (if introduced).
5. Canonical shared contract for manual-monthly constraints.
6. Canonical shared contract for manual-annual constraints.
7. How much current mode-specific builder logic is migrated vs wrapped.
8. Unified weather contract across all modes (including whether Past `actual_only` requirement remains).

# 12. Strict anti-drift constraints for the implementation pass
- one simulator only.
- no route-local sim math.
- no admin-only sim math.
- no manual/new-build-only separate simulator.
- one output family only for user/admin consumers.
- same 365-day weather timeline concept for all modes.
- baseline vs compareProjection behavior must remain correct.
- validation days remain actual in baseline.
- compareProjection remains part of the same saved output family.
- validation-day selection ownership remains in shared modules, not route/UI files.
- shared coverage window ownership remains in shared helpers (`resolveCanonicalUsage365CoverageWindow()` and related shared window helpers).

# 13. Recommended next implementation order
1. Lock fingerprint persistence/contract decisions (Section 11).
2. Introduce shared fingerprint schemas + shared resolved-fingerprint contract (no route-local ownership).
3. Add shared mode constraint adapters (manual monthly, manual annual, new build).
4. Route existing recalc/build chain to consume resolved fingerprint contract while preserving current canonical simulator/output family behavior.
