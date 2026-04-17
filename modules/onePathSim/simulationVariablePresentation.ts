import { buildWeekdayWeekendBreakdownNote } from "@/components/usage/readoutTruth";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { buildOnePathRunReadOnlyView } from "@/modules/onePathSim/runReadOnlyView";
import type {
  EffectiveSimulationVariablesUsed,
  SimulationVariableInputType,
  SimulationVariableValueSource,
} from "@/modules/onePathSim/simulationVariablePolicy";
import type { OnePathKnownScenario } from "@/modules/onePathSim/knownHouseScenarios";
import { buildOnePathOwnershipAudit } from "@/modules/onePathSim/onePathOwnershipAudit";
import { buildOnePathTuningCycleSummary } from "@/modules/onePathSim/tuningCycleSummary";
import { buildUsageDisplayTotalsAudit } from "@/modules/onePathSim/usageDisplayTotalsAudit";

export type SimulationVariablePolicyResponseShape = {
  familyMeta: Record<string, { title: string; description: string }>;
  defaults: Record<string, unknown>;
  effectiveByMode: Record<string, Record<string, unknown>>;
  overrides: Record<string, unknown>;
};

export type SimulationVariableFieldAdminView = {
  key: string;
  label: string;
  description: string;
  tuningHint: string;
  resolvedValue: number | string | null;
  valueSource: SimulationVariableValueSource;
  currentModeOverrideValue: number | null;
};

export type SimulationVariableFamilyAdminView = {
  familyKey: string;
  title: string;
  description: string;
  adminSummary: string;
  modeLabel: string;
  modeOverrideBucketLabel: string;
  fields: SimulationVariableFieldAdminView[];
};

type CurveShapingSummaryItem = {
  familyKey: string;
  familyTitle: string;
  key: string;
  label: string;
  resolvedValue: number | string | null;
  valueSource: SimulationVariableValueSource;
  whyItMatters: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\bKwh\b/g, "kWh")
    .replace(/\bKw\b/g, "kW")
    .replace(/\bCdd\b/g, "CDD")
    .replace(/\bHdd\b/g, "HDD")
    .replace(/\bDom\b/g, "DOM")
    .replace(/\bEv\b/g, "EV")
    .replace(/\bHvac\b/g, "HVAC")
    .replace(/\bSeer\b/g, "SEER")
    .replace(/\bPct\b/g, "Percent")
    .replace(/\bF\b/g, "F")
    .replace(/\bMin\b/g, "Min")
    .replace(/\bMax\b/g, "Max")
    .replace(/\bBase\b/g, "Base")
    .replace(/\bPer\b/g, "Per")
    .replace(/\s+/g, " ")
    .trim();
}

function familyAdminSummary(familyTitle: string): string {
  return `This family controls the shared ${familyTitle.toLowerCase()} behavior used by the simulation producer. Adjust these values when you want to tighten or loosen how this part of the shared sim responds.`;
}

function curveShapingWhyItMatters(familyKey: string, fieldKey: string): string {
  if (familyKey === "weatherShaping") return "Directly changes how strongly weather reshapes day totals and intraday curve amplitude.";
  if (familyKey === "intradayShapeReconstruction") return "Directly changes where load moves inside the day and how sharp peaks or valleys can become.";
  if (familyKey === "engineProfile") return "Changes the baseline profile heuristics that the shared sim uses before final curve normalization.";
  if (familyKey === "constraintRebalance") return "Changes how aggressively the shared sim clamps, preserves shape, or rebalances back to target totals.";
  if (familyKey === "pastDayCore") return "Changes donor-day selection and fallback behavior that strongly affects borrowed day shapes.";
  if (familyKey === "lowDataWeatherEvidence") return "Changes how low-data/manual runs infer weather-sensitive shape pressure.";
  return "Affects shared curve-shaping behavior used by the simulation producer.";
}

function isCurveSensitiveField(familyKey: string, fieldKey: string): boolean {
  const key = fieldKey.toLowerCase();
  if (familyKey === "weatherShaping") return true;
  if (familyKey === "intradayShapeReconstruction") return true;
  if (familyKey === "constraintRebalance") {
    return key.includes("flatten") || key.includes("amplitude") || key.includes("responsiveness") || key.includes("rebalance") || key.includes("shape");
  }
  if (familyKey === "engineProfile") {
    return key.includes("tilt") || key.includes("profile") || key.includes("shape") || key.includes("hvac") || key.includes("pool");
  }
  if (familyKey === "pastDayCore") {
    return key.includes("donor") || key.includes("weather") || key.includes("anchor");
  }
  if (familyKey === "lowDataWeatherEvidence") {
    return key.includes("sensitivity") || key.includes("hvac") || key.includes("baseload") || key.includes("weather");
  }
  return false;
}

function buildCurveShapingSummary(variableFamilies: SimulationVariableFamilyAdminView[]): CurveShapingSummaryItem[] {
  return variableFamilies
    .flatMap((family) =>
      family.fields
        .filter((field) => isCurveSensitiveField(family.familyKey, field.key))
        .map((field) => ({
          familyKey: family.familyKey,
          familyTitle: family.title,
          key: field.key,
          label: field.label,
          resolvedValue: field.resolvedValue,
          valueSource: field.valueSource,
          whyItMatters: curveShapingWhyItMatters(family.familyKey, field.key),
        }))
    )
    .slice(0, 24);
}

function fieldDescription(familyTitle: string, key: string): string {
  const readableKey = humanizeKey(key).toLowerCase();
  if (key.includes("threshold")) return `This threshold decides when the shared ${familyTitle.toLowerCase()} logic changes behavior.`;
  if (key.includes("weight")) return `This weight changes how strongly ${readableKey} influences the shared ${familyTitle.toLowerCase()} calculation.`;
  if (key.includes("min")) return `This lower guardrail limits how far the shared ${familyTitle.toLowerCase()} logic can drop ${readableKey}.`;
  if (key.includes("max")) return `This upper guardrail limits how far the shared ${familyTitle.toLowerCase()} logic can push ${readableKey}.`;
  if (key.includes("count")) return `This count controls how many qualifying records or samples the shared ${familyTitle.toLowerCase()} logic expects before it uses this branch.`;
  if (key.includes("cap")) return `This cap prevents the shared ${familyTitle.toLowerCase()} logic from overshooting in this area.`;
  if (key.includes("base")) return `This is the shared starting point before other ${familyTitle.toLowerCase()} adjustments are applied.`;
  if (key.includes("factor") || key.includes("mult") || key.includes("ratio")) {
    return `This scaling value changes the strength of the shared ${familyTitle.toLowerCase()} behavior for ${readableKey}.`;
  }
  if (key.includes("start") || key.includes("end")) {
    return `This boundary tells the shared ${familyTitle.toLowerCase()} logic where this adjustment range begins or ends.`;
  }
  return `This tunable value is part of the shared ${familyTitle.toLowerCase()} logic and affects how ${readableKey} behaves in the simulation.`;
}

function fieldTuningHint(key: string): string {
  if (key.includes("threshold")) return "Raise it to make the branch harder to trigger. Lower it to let the branch activate more often.";
  if (key.includes("weight")) return "Raise it to make this factor matter more. Lower it to reduce its influence.";
  if (key.includes("min")) return "Raise it to make the floor less permissive. Lower it to allow more compression.";
  if (key.includes("max")) return "Raise it to allow more headroom. Lower it to clamp sooner.";
  if (key.includes("count")) return "Raise it to demand more evidence. Lower it to let sparse evidence qualify sooner.";
  if (key.includes("cap")) return "Raise it to allow larger outcomes. Lower it to keep this branch tighter.";
  if (key.includes("base")) return "Raise it to shift the whole behavior upward. Lower it to make the baseline more conservative.";
  if (key.includes("factor") || key.includes("mult") || key.includes("ratio")) {
    return "Raise it to strengthen this response. Lower it to soften the response.";
  }
  return "Adjust in small steps, then compare the shared simulated output against actual or target truth.";
}

function modeToInputType(mode: string): SimulationVariableInputType {
  if (mode === "MANUAL_MONTHLY") return "MANUAL_MONTHLY";
  if (mode === "MANUAL_ANNUAL") return "MANUAL_ANNUAL";
  if (mode === "NEW_BUILD") return "NEW_BUILD";
  return "INTERVAL";
}

function modeToBucketKey(mode: SimulationVariableInputType): "intervalOverrides" | "manualMonthlyOverrides" | "manualAnnualOverrides" | "newBuildOverrides" {
  if (mode === "MANUAL_MONTHLY") return "manualMonthlyOverrides";
  if (mode === "MANUAL_ANNUAL") return "manualAnnualOverrides";
  if (mode === "NEW_BUILD") return "newBuildOverrides";
  return "intervalOverrides";
}

function modeLabel(mode: SimulationVariableInputType): string {
  if (mode === "MANUAL_MONTHLY") return "Manual Monthly";
  if (mode === "MANUAL_ANNUAL") return "Manual Annual";
  if (mode === "NEW_BUILD") return "New Build";
  return "Interval";
}

function resolveValueSource(args: {
  familyKey: string;
  fieldKey: string;
  inputType: SimulationVariableInputType;
  response: SimulationVariablePolicyResponseShape;
  runSnapshot?: EffectiveSimulationVariablesUsed | null;
}): SimulationVariableValueSource {
  const familySnapshots =
    args.runSnapshot?.inputType === args.inputType
      ? (args.runSnapshot.familyByFamilyResolvedValues as Record<string, { valuesByKey?: Record<string, { valueSource?: SimulationVariableValueSource }> }> | undefined)
      : undefined;
  const familySnapshot = familySnapshots?.[args.familyKey] ?? null;
  const snapshotSource = familySnapshot?.valuesByKey?.[args.fieldKey as never]?.valueSource;
  if (snapshotSource) return snapshotSource;

  const familyOverrides = (args.response.overrides?.[args.familyKey] as Record<string, unknown> | undefined) ?? {};
  const modeBucketKey = modeToBucketKey(args.inputType);
  const sharedDefaults = (familyOverrides.sharedDefaults as Record<string, unknown> | undefined) ?? {};
  const modeOverrides = (familyOverrides[modeBucketKey] as Record<string, unknown> | undefined) ?? {};
  if (typeof modeOverrides[args.fieldKey] === "number" || typeof sharedDefaults[args.fieldKey] === "number") {
    return "explicit admin override";
  }
  return "shared default";
}

export function buildSimulationVariableFamilyAdminView(args: {
  familyKey: string;
  mode: string;
  response: SimulationVariablePolicyResponseShape;
  runSnapshot?: EffectiveSimulationVariablesUsed | null;
}): SimulationVariableFamilyAdminView | null {
  const inputType = modeToInputType(args.mode);
  const familyMeta = args.response.familyMeta?.[args.familyKey];
  const familyValues = (args.response.effectiveByMode?.[inputType]?.[args.familyKey] as Record<string, unknown> | undefined) ?? null;
  if (!familyMeta || !familyValues) return null;
  const familyOverrides = (args.response.overrides?.[args.familyKey] as Record<string, unknown> | undefined) ?? {};
  const currentModeBucketKey = modeToBucketKey(inputType);
  const currentModeOverrides = (familyOverrides[currentModeBucketKey] as Record<string, unknown> | undefined) ?? {};

  const fields: SimulationVariableFieldAdminView[] = Object.keys(familyValues).map((fieldKey) => ({
    key: fieldKey,
    label: humanizeKey(fieldKey),
    description: fieldDescription(familyMeta.title, fieldKey),
    tuningHint: fieldTuningHint(fieldKey),
    resolvedValue:
      typeof familyValues[fieldKey] === "number" || typeof familyValues[fieldKey] === "string" ? (familyValues[fieldKey] as number | string) : null,
    valueSource: resolveValueSource({
      familyKey: args.familyKey,
      fieldKey,
      inputType,
      response: args.response,
      runSnapshot: args.runSnapshot,
    }),
    currentModeOverrideValue: typeof currentModeOverrides[fieldKey] === "number" ? Number(currentModeOverrides[fieldKey]) : null,
  }));

  return {
    familyKey: args.familyKey,
    title: familyMeta.title,
    description: familyMeta.description,
    adminSummary: familyAdminSummary(familyMeta.title),
    modeLabel: modeLabel(inputType),
    modeOverrideBucketLabel: currentModeBucketKey,
    fields,
  };
}

export function buildSimulationVariableCopyPayload(args: {
  mode: string;
  response: SimulationVariablePolicyResponseShape;
  runSnapshot?: EffectiveSimulationVariablesUsed | null;
  currentControls?: Record<string, unknown>;
  engineInput?: Record<string, unknown> | null;
  readModel?: Record<string, unknown> | null;
  artifact?: Record<string, unknown> | null;
  knownScenario?: Partial<OnePathKnownScenario> | null;
  sandboxSummary?: Record<string, unknown> | null;
  loadedSourceContext?: Record<string, unknown> | null;
  baselineParityReport?: Record<string, unknown> | null;
  baselineParityAudit?: Record<string, unknown> | null;
  runtimeEnvParityTrace?: Record<string, unknown> | null;
  intervalPastReadinessTrace?: Record<string, unknown> | null;
  readOnlyAudit?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const inputType = modeToInputType(args.mode);
  const loadedSourceContext = asRecord(args.loadedSourceContext);
  const readModel = asRecord(args.readModel);
  const artifact = asRecord(args.artifact);
  const sandboxRunStatus = asRecord(asRecord(args.sandboxSummary).runStatus);
  const source =
    args.runSnapshot?.inputType === inputType
      ? "canonical_last_run_snapshot"
      : Object.keys(loadedSourceContext).length
        ? "lookup_source_context"
        : "current_admin_mode_resolution";
  const familyKeys = Object.keys(args.response.familyMeta ?? {});
  const compareProjection = (readModel.compareProjection as Record<string, unknown> | undefined) ?? null;
  const rows = Array.isArray(compareProjection?.rows) ? compareProjection.rows : [];
  const variableFamilies = familyKeys
    .map((familyKey) =>
      buildSimulationVariableFamilyAdminView({
        familyKey,
        mode: inputType,
        response: args.response,
        runSnapshot: args.runSnapshot,
      })
    )
    .filter(Boolean) as SimulationVariableFamilyAdminView[];
  const copiedLoadedSourceContext = Object.keys(loadedSourceContext).length
    ? {
        actualDatasetSummary: loadedSourceContext.actualDatasetSummary ?? null,
        actualDatasetMeta: loadedSourceContext.actualDatasetMeta ?? null,
        usageTruthSource: loadedSourceContext.usageTruthSource ?? null,
        usageTruthSeedResult: loadedSourceContext.usageTruthSeedResult ?? null,
        upstreamUsageTruth: loadedSourceContext.upstreamUsageTruth ?? null,
        manualUsagePayload: loadedSourceContext.manualUsagePayload ?? null,
        manualUsageUpdatedAt: loadedSourceContext.manualUsageUpdatedAt ?? null,
        travelRangesFromDb: loadedSourceContext.travelRangesFromDb ?? [],
        homeProfile: loadedSourceContext.homeProfile ?? null,
        applianceProfile: loadedSourceContext.applianceProfile ?? null,
        weatherScore: loadedSourceContext.weatherScore ?? null,
        weatherDerivedInput: loadedSourceContext.weatherDerivedInput ?? null,
        userUsagePageBaselineContract: loadedSourceContext.userUsagePageBaselineContract ?? null,
      }
    : null;
  const dashboardContract =
    loadedSourceContext.userUsagePageBaselineContract ?? loadedSourceContext.userUsageBaselineContract ?? null;
  const dashboardViewModel = buildUserUsageDashboardViewModel((dashboardContract as any) ?? null);
  const weatherScore = asRecord(asRecord(dashboardContract).weatherSensitivityScore);
  const copiedDashboardViewModel = dashboardViewModel
    ? {
        coverage: dashboardViewModel.coverage,
        headlineTotals: {
          totalKwh: dashboardViewModel.derived.totalKwh,
          totals: dashboardViewModel.derived.totals,
          avgDailyKwh: dashboardViewModel.derived.avgDailyKwh,
          baseload: dashboardViewModel.derived.baseload,
          baseloadDaily: dashboardViewModel.derived.baseloadDaily,
          baseloadMonthly: dashboardViewModel.derived.baseloadMonthly,
          peakDay: dashboardViewModel.derived.peakDay,
          peakHour: dashboardViewModel.derived.peakHour,
          weekdayKwh: dashboardViewModel.derived.weekdayKwh,
          weekendKwh: dashboardViewModel.derived.weekendKwh,
          timeOfDayBuckets: dashboardViewModel.derived.timeOfDayBuckets,
        },
        breakdownNote: buildWeekdayWeekendBreakdownNote({
          weekdayKwh: dashboardViewModel.derived.weekdayKwh,
          weekendKwh: dashboardViewModel.derived.weekendKwh,
          summaryTotalKwh: dashboardViewModel.derived.totalKwh,
        }),
        monthlyRows: dashboardViewModel.derived.monthly,
        dailyRows: dashboardViewModel.derived.daily,
        dailyRowsCount: dashboardViewModel.derived.daily.length,
        fifteenMinuteCurve: {
          rowsCount: dashboardViewModel.derived.fifteenCurve.length,
          preview: dashboardViewModel.derived.fifteenCurve.slice(0, 12),
          sourceOfDaySimulationCore: dashboardViewModel.coverage?.sourceOfDaySimulationCore ?? null,
          weatherBasisLabel: dashboardViewModel.coverage?.weatherBasisLabel ?? null,
          sourceOwner: "buildUserUsageDashboardViewModel(...).derived.fifteenCurve",
        },
        weatherScoreDisplay: Object.keys(weatherScore).length
          ? {
              scoringMode: weatherScore.scoringMode ?? null,
              scoringModeLabel:
                weatherScore.scoringMode === "BILLING_PERIOD_BASED" ? "Billing-period based" : "Interval based",
              weatherEfficiencyScore0to100: weatherScore.weatherEfficiencyScore0to100 ?? null,
              explanationSummary: weatherScore.explanationSummary ?? null,
              estimatedWeatherDrivenLoadShare: weatherScore.estimatedWeatherDrivenLoadShare ?? null,
              estimatedBaseloadShare: weatherScore.estimatedBaseloadShare ?? null,
            }
          : null,
      }
    : null;
  const displayTotalsDataset =
    asRecord(asRecord(dashboardContract).dataset).summary != null
      ? asRecord(dashboardContract).dataset
      : readModel.dataset ?? null;
  const displayTotalsAudit =
    displayTotalsDataset && Object.keys(asRecord(displayTotalsDataset)).length
      ? buildUsageDisplayTotalsAudit({ dataset: displayTotalsDataset })
      : null;
  const baselineParityReport = args.baselineParityReport ?? loadedSourceContext.baselineParityReport ?? null;
  const baselineParityAudit = args.baselineParityAudit ?? loadedSourceContext.baselineParityAudit ?? null;
  const runtimeEnvParityTrace = args.runtimeEnvParityTrace ?? loadedSourceContext.runtimeEnvParityTrace ?? null;
  const intervalPastReadinessTrace = args.intervalPastReadinessTrace ?? null;
  const readOnlyAudit = args.readOnlyAudit ?? loadedSourceContext.readOnlyAudit ?? null;
  const lookupOnly = !Object.keys(readModel).length && !Object.keys(artifact).length && !args.runSnapshot;
  const baselinePassthrough =
    !lookupOnly &&
    (sandboxRunStatus.runType === "BASELINE_PASSTHROUGH" ||
      asRecord(readModel.dataset).meta != null &&
        Boolean(asRecord(asRecord(readModel.dataset).meta).baselinePassthrough) ||
      Boolean(asRecord(asRecord(artifact.dataset).meta).baselinePassthrough) ||
      artifact.engineVersion === "baseline_passthrough_v1");
  const pastSim = !lookupOnly && !baselinePassthrough;
  const runType = lookupOnly ? "LOOKUP_ONLY" : baselinePassthrough ? "BASELINE_PASSTHROUGH" : "PAST_SIM";
  const readModelDataset = asNullableRecord(readModel.dataset);
  const runDisplayView =
    pastSim && readModelDataset
      ? buildOnePathRunReadOnlyView({
          dataset: readModelDataset,
          engineInput: asNullableRecord(args.engineInput),
          readModel,
        })
      : null;
  const rawMonthlyRows = Array.isArray(readModelDataset?.monthly)
    ? (readModelDataset?.monthly as Array<Record<string, unknown>>)
        .map((row) => ({
          month: String(row?.month ?? "").slice(0, 7),
          kwh: Number(row?.kwh ?? Number.NaN),
        }))
        .filter((row) => /^\d{4}-\d{2}$/.test(row.month) && Number.isFinite(row.kwh))
    : [];
  const runDisplayContract = runDisplayView
    ? {
        sourceOwner: "buildOnePathRunReadOnlyView",
        monthlyDisplayOwner: "buildOnePathRunReadOnlyView(...).monthlyRows",
        monthlyDisplayRows: runDisplayView.monthlyRows,
        rawMonthlyRows,
        monthlyRowsDifferFromRaw: JSON.stringify(runDisplayView.monthlyRows) !== JSON.stringify(rawMonthlyRows),
        stitchedMonth: runDisplayView.stitchedMonth,
        fifteenMinuteCurve: {
          rowsCount: runDisplayView.fifteenMinuteAverages.length,
          preview: runDisplayView.fifteenMinuteAverages.slice(0, 12),
          sourceOwner: runDisplayView.fifteenMinuteCurveSourceOwner,
        },
        coverage: {
          start: runDisplayView.summary.coverageStart,
          end: runDisplayView.summary.coverageEnd,
          intervalsCount: runDisplayView.summary.intervalsCount,
          source: runDisplayView.summary.source,
          weatherBasisLabel: runDisplayView.summary.weatherBasisLabel,
        },
      }
    : null;
  return {
    purpose: "Copyable shared simulation variable payload for AI-assisted tuning and curve-shaping review.",
    selectedMode: inputType,
    source,
    aiPayloadMeta: {
      payloadVersion: "one-path-ai-copy-v2",
      selectedMode: inputType,
      runType,
      sourceKind: copiedLoadedSourceContext?.usageTruthSource ?? source,
      lookupOnly,
      baselinePassthrough,
      pastSim,
      includesDashboardViewModel: Boolean(copiedDashboardViewModel),
      includesRunDisplayContract: Boolean(runDisplayContract),
      includesParitySections: Boolean(baselineParityReport || baselineParityAudit),
      includesEnvReadinessTraceSections: Boolean(runtimeEnvParityTrace || intervalPastReadinessTrace),
      includesReadOnlyAudit: Boolean(readOnlyAudit),
    },
    currentControls: args.currentControls ?? {},
    knownScenario: args.knownScenario ?? null,
    sandboxSummary: args.sandboxSummary ?? null,
    loadedSourceContext: copiedLoadedSourceContext,
    userUsageDashboardViewModel: copiedDashboardViewModel,
    runDisplayContract,
    baselineParityReport,
    baselineParityAudit,
    displayTotalsAudit,
    runtimeEnvParityTrace,
    intervalPastReadinessTrace,
    readOnlyAudit,
    tuningCycleSummary: buildOnePathTuningCycleSummary({
      knownScenario: args.knownScenario,
      sandboxSummary: args.sandboxSummary,
      selectedMode: inputType,
    }),
    runIdentity: args.runSnapshot?.runIdentityLinkage ?? null,
    engineInput: args.engineInput ?? null,
    truthConsole: args.readModel
      ? {
          preCutoverHarness: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).preCutoverHarness ?? null
            : null,
          stageBoundaryMap: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).stageBoundaryMap ?? null
            : null,
          upstreamUsageTruth: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).upstreamUsageTruth ?? null
            : null,
          sharedDerivedInputs: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).sharedDerivedInputs ?? null
            : null,
          sourceTruthIdentity: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).sourceTruthIdentity ?? null
            : null,
          constraintRebalance: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).constraintRebalance ?? null
            : null,
          donorFallbackExclusions: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).donorFallbackExclusions ?? null
            : null,
          intradayReconstruction: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).intradayReconstruction ?? null
            : null,
          finalSharedOutputContract: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).finalSharedOutputContract ?? null
            : null,
          chartWindowDisplay: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).chartWindowDisplay ?? null
            : null,
          manualStatementAnnual: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).manualStatementAnnual ?? null
            : null,
          annualModeTruth: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).annualModeTruth ?? null
            : null,
          newBuildModeTruth: readModel.sourceOfTruthSummary
            ? (readModel.sourceOfTruthSummary as Record<string, unknown>).newBuildModeTruth ?? null
            : null,
        }
      : null,
    upstreamUsageTruth: readModel.sourceOfTruthSummary
      ? ((readModel.sourceOfTruthSummary as Record<string, unknown>).upstreamUsageTruth ?? null)
      : null,
    runResults: args.readModel
      ? {
          datasetSummary: readModel.dataset && typeof readModel.dataset === "object"
            ? ((readModel.dataset as Record<string, unknown>).summary ?? null)
            : null,
          compareProjectionMetrics: compareProjection?.metrics ?? null,
          compareProjectionRowsCount: rows.length,
          tuningSummary: readModel.tuningSummary ?? null,
          dailyShapeTuning: readModel.dailyShapeTuning ?? null,
          manualParitySummary: readModel.manualParitySummary ?? null,
          manualMonthlyReconciliation: readModel.manualMonthlyReconciliation ?? null,
          sharedDiagnostics: readModel.sharedDiagnostics ?? null,
          sourceOfTruthSummary: readModel.sourceOfTruthSummary ?? null,
          readModelRunIdentity: readModel.runIdentity ?? null,
          artifactSummary: args.artifact
            ? {
                artifactId: artifact.artifactId ?? null,
                artifactInputHash: artifact.artifactInputHash ?? null,
                buildInputsHash: artifact.buildInputsHash ?? null,
                engineVersion: artifact.engineVersion ?? null,
                inputType: artifact.inputType ?? null,
                simulatorMode: artifact.simulatorMode ?? null,
              }
            : null,
        }
      : null,
    curveShapingSummary: {
      note: "Highest-priority shape-sensitive shared variables first. Use this section before the full family dump when tuning curves with AI.",
      items: buildCurveShapingSummary(variableFamilies),
    },
    ownershipAudit: buildOnePathOwnershipAudit(),
    variableFamilies,
    rawEffectiveSimulationVariablesUsed: args.runSnapshot ?? null,
    rawReadModel: args.readModel ?? null,
  };
}
