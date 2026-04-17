import { prisma } from "@/lib/db";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import {
  attachOnePathRunIdentityToEffectiveSimulationVariablesUsed,
  buildOnePathDailyCurveComparePayload,
  buildOnePathManualBillPeriodTargets,
  buildOnePathSharedPastSimDiagnostics,
  buildOnePathValidationCompareProjectionSidecar,
  buildOnePathWeatherEfficiencyDerivedInput,
  getOnePathManualUsageInput,
  resolveOnePathCanonicalUsage365CoverageWindow,
  resolveOnePathManualStageOnePresentation,
  resolveOnePathUpstreamUsageTruthForSimulation,
  resolveOnePathWeatherSensitivityEnvelope,
  type UpstreamUsageTruthSeedResult,
  type UpstreamUsageTruthSection,
  type UpstreamUsageTruthSource,
} from "@/modules/onePathSim/runtime";
import { buildOnePathManualArtifactDecorations } from "@/modules/onePathSim/manualArtifactDecorations";
import { buildOnePathTruthSummary, type OnePathTruthSummary } from "@/modules/onePathSim/onePathTruthSummary";
import {
  type EffectiveSimulationVariablesUsed,
} from "@/modules/onePathSim/simulationVariablePolicy";
import {
  type RecalcSimulatorBuildArgs,
  type SharedDiagnosticsCallerType,
  type ValidationCompareProjectionSidecar,
  readOnePathSimulatedUsageScenario,
  runOnePathSimulatorBuild,
} from "@/modules/onePathSim/serviceBridge";
import { getMemoryRssMb, logSimPipelineEvent } from "@/modules/onePathSim/usageSimulator/simObservability";
import { type WeatherEfficiencyDerivedInput } from "@/modules/onePathSim/weatherSensitivityShared";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import type { ManualUsagePayload } from "@/modules/onePathSim/simulatedUsage/types";

export type CanonicalSimulationInputType =
  | "INTERVAL"
  | "MANUAL_MONTHLY"
  | "MANUAL_ANNUAL"
  | "NEW_BUILD";

export type CanonicalSimulationEngineInput = {
  engineInputVersion: "one-path-sim-v1";
  inputType: CanonicalSimulationInputType;
  simulatorMode: "SMT_BASELINE" | "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE";
  houseId: string;
  actualContextHouseId: string;
  scenarioId: string | null;
  timezone: string;
  coverageWindowStart: string | null;
  coverageWindowEnd: string | null;
  canonicalMonths: string[];
  canonicalEndMonth: string | null;
  anchorEndDate: string | null;
  billEndDay: number | null;
  statementRanges: unknown[];
  dateSourceMode: string | null;
  manualConstraintMode: "INTERVAL" | "MANUAL_MONTHLY" | "MANUAL_ANNUAL" | "NEW_BUILD";
  monthlyTotalsKwhByMonth: Record<string, number>;
  annualTargetKwh: number | null;
  manualBillPeriodTotalsKwhById: Record<string, number>;
  normalizedMonthTargetsByMonth: Record<string, number>;
  monthlyTargetConstructionDiagnostics: unknown[] | null;
  actualIntervalsReference: unknown;
  actualDailyReference: unknown;
  actualMonthlyReference: unknown;
  actualSource: string | null;
  actualIntervalFingerprint: string | null;
  weatherIdentity: string | null;
  usageShapeIdentity: string | null;
  travelRanges: Array<{ startDate: string; endDate: string }>;
  excludedDateKeysLocal: string[];
  validationOnlyDateKeysLocal: string[];
  validationSelectionMode: string | null;
  validationSelectionDiagnostics: Record<string, unknown> | null;
  homeProfile: Record<string, unknown> | null;
  applianceProfile: Record<string, unknown> | null;
  occupantProfile: Record<string, unknown> | null;
  poolProfile: Record<string, unknown> | null;
  evProfile: Record<string, unknown> | null;
  weatherPreference: "NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE";
  weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER" | "LONG_TERM_AVERAGE_WEATHER";
  weatherDaysReference: unknown;
  sharedProducerPathUsed: true;
  sourceDerivedMode: string | null;
  manualTravelVacantDonorPoolMode: string | null;
  weatherEfficiencyDerivedInput: WeatherEfficiencyDerivedInput | null;
  upstreamUsageTruth: UpstreamUsageTruthSection | null;
  runtime: {
    userId: string;
    houseId: string;
    esiid: string | null;
    actualContextHouseId: string;
    mode: "SMT_BASELINE" | "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE";
    scenarioId: string | null;
    persistPastSimBaseline: boolean;
    weatherPreference: "NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE";
    validationOnlyDateKeysLocal: string[];
    preLockboxTravelRanges: Array<{ startDate: string; endDate: string }>;
    validationDaySelectionMode: string | null;
    validationDayCount: number | null;
    runContext?: Partial<RecalcSimulatorBuildArgs["runContext"]>;
  };
};

export type CanonicalSimulationArtifact = {
  artifactId: string | null;
  artifactInputHash: string | null;
  engineVersion: string | null;
  buildInputsHash: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  houseId: string;
  scenarioId: string | null;
  actualContextHouseId: string;
  inputType: CanonicalSimulationInputType;
  simulatorMode: CanonicalSimulationEngineInput["simulatorMode"];
  engineInput: CanonicalSimulationEngineInput;
  dataset: {
    summary: any;
    daily: any[];
    monthly: any[];
    series: { intervals15: any[] };
    meta: Record<string, unknown>;
  };
  simulatedDayResults: any[];
  stitchedCurve: any[];
  monthlyTargetConstructionDiagnostics: unknown[] | null;
  manualMonthlyInputState: unknown;
  manualBillPeriods: unknown[];
  manualBillPeriodTotalsKwhById: Record<string, number>;
  sourceDerivedMonthlyTotalsKwhByMonth: Record<string, number>;
  compareProjection: ValidationCompareProjectionSidecar | null;
  manualMonthlyReconciliation: unknown;
  manualParitySummary: unknown;
  sharedDiagnostics: Record<string, unknown> | null;
  effectiveSimulationVariablesUsed: EffectiveSimulationVariablesUsed | null;
};

export type CanonicalSimulationReadModel = {
  runIdentity: Record<string, unknown>;
  dataset: CanonicalSimulationArtifact["dataset"];
  compareProjection: ValidationCompareProjectionSidecar | null;
  manualMonthlyReconciliation: unknown;
  manualParitySummary: unknown;
  sharedDiagnostics: Record<string, unknown> | null;
  curveCompareActualIntervals15: any[];
  curveCompareSimulatedIntervals15: any[];
  curveCompareSimulatedDailyRows: any[];
  dailyShapeTuning: Record<string, unknown>;
  tuningSummary: Record<string, unknown>;
  effectiveSimulationVariablesUsed: EffectiveSimulationVariablesUsed | null;
  sourceOfTruthSummary: OnePathTruthSummary;
  failureCode: string | null;
  failureMessage: string | null;
};

export type IntervalRawInput = {
  userId: string;
  houseId: string;
  actualContextHouseId?: string | null;
  scenarioId?: string | null;
  weatherPreference?: CanonicalSimulationEngineInput["weatherPreference"];
  validationSelectionMode?: string | null;
  validationDayCount?: number | null;
  validationOnlyDateKeysLocal?: string[];
  travelRanges?: Array<{ startDate: string; endDate: string }>;
  persistRequested?: boolean;
};

export type ManualMonthlyRawInput = IntervalRawInput & {
  manualUsagePayload?: ManualUsagePayload | null;
};

export type ManualAnnualRawInput = IntervalRawInput & {
  manualUsagePayload?: ManualUsagePayload | null;
};

export type NewBuildRawInput = IntervalRawInput;

type LoadedSharedContext = {
  house: { id: string; esiid: string | null };
  actualContextHouseId: string;
  usageTruthSource: UpstreamUsageTruthSource;
  usageTruthSeedResult: UpstreamUsageTruthSeedResult;
  upstreamUsageTruth: UpstreamUsageTruthSection;
  actualDataset: any | null;
  manualUsagePayload: ManualUsagePayload | null;
  homeProfile: Record<string, unknown> | null;
  applianceProfile: Record<string, unknown> | null;
  weatherEnvelope: Awaited<ReturnType<typeof resolveOnePathWeatherSensitivityEnvelope>>;
};

export class UpstreamUsageTruthMissingError extends Error {
  code = "usage_truth_missing" as const;
  usageTruthSource: UpstreamUsageTruthSource;
  seedResult: UpstreamUsageTruthSeedResult;
  upstreamUsageTruth: UpstreamUsageTruthSection;

  constructor(args: {
    usageTruthSource: UpstreamUsageTruthSource;
    seedResult: UpstreamUsageTruthSeedResult;
    upstreamUsageTruth: UpstreamUsageTruthSection;
  }) {
    super("Upstream usage truth is required before simulation can run.");
    this.name = "UpstreamUsageTruthMissingError";
    Object.setPrototypeOf(this, new.target.prototype);
    this.usageTruthSource = args.usageTruthSource;
    this.seedResult = args.seedResult;
    this.upstreamUsageTruth = args.upstreamUsageTruth;
  }
}

export class SharedSimulationRunError extends Error {
  code: string;
  missingItems: string[];

  constructor(args: { code: string; missingItems?: string[] }) {
    super(args.code);
    this.name = "SharedSimulationRunError";
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = args.code;
    this.missingItems = Array.isArray(args.missingItems) ? args.missingItems : [];
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeTravelRanges(value: unknown): Array<{ startDate: string; endDate: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => ({
      startDate: String((row as any)?.startDate ?? "").slice(0, 10),
      endDate: String((row as any)?.endDate ?? "").slice(0, 10),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(row.endDate));
}

function normalizeWeatherPreference(
  value: unknown
): CanonicalSimulationEngineInput["weatherPreference"] {
  return value === "NONE" || value === "LONG_TERM_AVERAGE" ? value : "LAST_YEAR_WEATHER";
}

function deriveWeatherLogicMode(
  weatherPreference: CanonicalSimulationEngineInput["weatherPreference"]
): CanonicalSimulationEngineInput["weatherLogicMode"] {
  return weatherPreference === "LONG_TERM_AVERAGE"
    ? "LONG_TERM_AVERAGE_WEATHER"
    : "LAST_YEAR_ACTUAL_WEATHER";
}

function toScenarioKey(scenarioId: string | null | undefined): string {
  return scenarioId && scenarioId.trim() ? scenarioId.trim() : "BASELINE";
}

function isBaselinePassthroughInput(engineInput: CanonicalSimulationEngineInput): boolean {
  return engineInput.scenarioId == null && engineInput.inputType !== "NEW_BUILD";
}

function buildMonthlyTotalsRecord(rows: unknown): Record<string, number> {
  if (!Array.isArray(rows)) return {};
  return rows.reduce<Record<string, number>>((acc, row) => {
    const month = String((row as any)?.month ?? "").slice(0, 7);
    const kwh = Number((row as any)?.kwh ?? Number.NaN);
    if (/^\d{4}-\d{2}$/.test(month) && Number.isFinite(kwh)) {
      acc[month] = kwh;
    }
    return acc;
  }, {});
}

function buildManualBillPeriodTotalsRecord(rows: unknown): Record<string, number> {
  if (!Array.isArray(rows)) return {};
  return rows.reduce<Record<string, number>>((acc, row) => {
    const id = String((row as any)?.id ?? "");
    const kwh = Number((row as any)?.targetKwh ?? (row as any)?.kwh ?? Number.NaN);
    if (id && Number.isFinite(kwh)) {
      acc[id] = kwh;
    }
    return acc;
  }, {});
}

function buildIntervalBaselinePassthroughDataset(args: {
  engineInput: CanonicalSimulationEngineInput;
  upstreamUsageTruth: Awaited<ReturnType<typeof resolveOnePathUpstreamUsageTruthForSimulation>>;
}) {
  const sourceDataset = args.upstreamUsageTruth.dataset ?? {};
  const summary = asRecord((sourceDataset as any).summary) ?? {};
  const meta = asRecord((sourceDataset as any).meta) ?? {};
  const monthlyRows = Array.isArray((sourceDataset as any).monthly) ? (sourceDataset as any).monthly : [];
  const totalKwh =
    typeof summary.totalKwh === "number"
      ? summary.totalKwh
      : monthlyRows.reduce((sum: number, row: any) => sum + (Number(row?.kwh) || 0), 0);

  return {
    ...sourceDataset,
    summary: {
      ...summary,
      source: summary.source ?? args.engineInput.actualSource ?? "ACTUAL",
      totalKwh,
      start: summary.start ?? args.engineInput.coverageWindowStart ?? null,
      end: summary.end ?? args.engineInput.coverageWindowEnd ?? null,
      latest: summary.latest ?? summary.end ?? args.engineInput.coverageWindowEnd ?? null,
    },
    daily: Array.isArray((sourceDataset as any).daily) ? (sourceDataset as any).daily : [],
    monthly: monthlyRows,
    series: {
      ...((sourceDataset as any).series ?? {}),
      intervals15: Array.isArray((sourceDataset as any)?.series?.intervals15)
        ? (sourceDataset as any).series.intervals15
        : [],
    },
    meta: {
      ...meta,
      datasetKind: meta.datasetKind ?? "ACTUAL",
      scenarioKey: "BASELINE",
      scenarioId: null,
      baselinePassthrough: true,
      baselinePassthroughMode: "INTERVAL",
      baselineSource: "upstream_usage_truth",
      baselineSimulationBlocked: true,
      sharedProducerPathUsed: false,
      inputType: args.engineInput.inputType,
      simulatorMode: args.engineInput.simulatorMode,
      actualContextHouseId: args.engineInput.actualContextHouseId,
      usageTruthSource: args.upstreamUsageTruth.usageTruthSource,
      usageTruthSeedResult: args.upstreamUsageTruth.seedResult,
      coverageStart: meta.coverageStart ?? args.engineInput.coverageWindowStart ?? summary.start ?? null,
      coverageEnd: meta.coverageEnd ?? args.engineInput.coverageWindowEnd ?? summary.end ?? null,
      canonicalMonths:
        Array.isArray(meta.canonicalMonths) && meta.canonicalMonths.length > 0
          ? meta.canonicalMonths
          : args.engineInput.canonicalMonths,
      lockboxExecutionMode: "baseline_passthrough_only",
    },
  };
}

function buildManualBaselinePassthroughDataset(args: {
  engineInput: CanonicalSimulationEngineInput;
  upstreamUsageTruth: Awaited<ReturnType<typeof resolveOnePathUpstreamUsageTruthForSimulation>>;
  manualUsagePayload: ManualUsagePayload | null;
}) {
  const statementRanges =
    Array.isArray((args.manualUsagePayload as any)?.statementRanges)
      ? ((args.manualUsagePayload as any).statementRanges as unknown[])
      : Array.isArray(args.engineInput.statementRanges)
        ? args.engineInput.statementRanges
        : [];
  const monthlyRows =
    args.manualUsagePayload?.mode === "MONTHLY"
      ? (
          Array.isArray((args.manualUsagePayload as any)?.monthlyKwh) &&
          (args.manualUsagePayload as any).monthlyKwh.length > 0
            ? (args.manualUsagePayload as any).monthlyKwh
            : Object.entries(args.engineInput.monthlyTotalsKwhByMonth).map(([month, kwh]) => ({ month, kwh }))
        )
          .map((row: any) => ({
            month: String(row?.month ?? "").slice(0, 7),
            kwh: Number(row?.kwh ?? 0) || 0,
          }))
          .filter((row) => /^\d{4}-\d{2}$/.test(row.month))
          .sort((a, b) => (a.month < b.month ? -1 : 1))
      : [];
  const annualTotalKwh =
    args.manualUsagePayload?.mode === "ANNUAL"
      ? Math.max(0, Number(args.manualUsagePayload.annualKwh ?? args.engineInput.annualTargetKwh ?? 0) || 0)
      : monthlyRows.reduce((sum, row) => sum + row.kwh, 0);
  const firstStatementRange = Array.isArray(statementRanges) ? (statementRanges[0] as any) : null;
  const lastStatementRange = Array.isArray(statementRanges)
    ? (statementRanges[statementRanges.length - 1] as any)
    : null;
  const payloadAnchorEndDate =
    typeof (args.manualUsagePayload as any)?.anchorEndDate === "string"
      ? String((args.manualUsagePayload as any).anchorEndDate).slice(0, 10)
      : null;
  const startDate =
    typeof lastStatementRange?.startDate === "string"
      ? String(lastStatementRange.startDate).slice(0, 10)
      : args.engineInput.coverageWindowStart ?? null;
  const endDate =
    typeof firstStatementRange?.endDate === "string"
      ? String(firstStatementRange.endDate).slice(0, 10)
      : payloadAnchorEndDate ?? args.engineInput.anchorEndDate ?? args.engineInput.coverageWindowEnd ?? null;
  const presentation = resolveOnePathManualStageOnePresentation({
    surface: "admin_manual_monthly_stage_one",
    payload: args.manualUsagePayload,
  });
  const billPeriods =
    args.manualUsagePayload != null ? buildOnePathManualBillPeriodTargets(args.manualUsagePayload) : [];
  const manualBillPeriodTotalsKwhById =
    buildManualBillPeriodTotalsRecord(statementRanges) ?? args.engineInput.manualBillPeriodTotalsKwhById;
  const annualSeriesTimestamp =
    (endDate ?? args.engineInput.coverageWindowEnd ?? `${new Date().getUTCFullYear()}-12-31`).slice(0, 4) +
    "-01-01T00:00:00.000Z";

  return {
    summary: {
      source: "MANUAL",
      intervalsCount: 0,
      totalKwh: annualTotalKwh,
      start: startDate,
      end: endDate,
      latest: endDate,
    },
    daily: [],
    monthly: monthlyRows,
    series: {
      intervals15: [],
      daily: [],
      monthly: monthlyRows.map((row) => ({
        timestamp: `${row.month}-01T00:00:00.000Z`,
        kwh: row.kwh,
      })),
      annual: [{ timestamp: annualSeriesTimestamp, kwh: annualTotalKwh }],
    },
    meta: {
      datasetKind: "MANUAL_BASELINE_PASSTHROUGH",
      scenarioKey: "BASELINE",
      scenarioId: null,
      baselinePassthrough: true,
      baselinePassthroughMode: args.engineInput.inputType,
      baselineSource: "upstream_manual_usage_truth",
      baselineSimulationBlocked: true,
      sharedProducerPathUsed: false,
      inputType: args.engineInput.inputType,
      simulatorMode: args.engineInput.simulatorMode,
      actualContextHouseId: args.engineInput.actualContextHouseId,
      usageTruthSource: args.upstreamUsageTruth.usageTruthSource,
      usageTruthSeedResult: args.upstreamUsageTruth.seedResult,
      coverageStart: startDate ?? args.engineInput.coverageWindowStart ?? null,
      coverageEnd: endDate ?? args.engineInput.coverageWindowEnd ?? null,
      canonicalMonths: args.engineInput.canonicalMonths,
      timezone: args.engineInput.timezone,
      statementRanges,
      manualBillPeriods: billPeriods,
      manualBillPeriodTotalsKwhById,
      manualStageOnePresentation: presentation,
      manualPayloadMode: args.manualUsagePayload?.mode ?? null,
      lockboxExecutionMode: "baseline_passthrough_only",
    },
  };
}

async function buildBaselinePassthroughArtifact(args: {
  engineInput: CanonicalSimulationEngineInput;
  callerType: SharedDiagnosticsCallerType;
}): Promise<CanonicalSimulationArtifact> {
  const startedAt = Date.now();
  logSimPipelineEvent("baseline_dataset_passthrough_start", {
    userId: args.engineInput.runtime.userId,
    houseId: args.engineInput.houseId,
    sourceHouseId:
      args.engineInput.actualContextHouseId !== args.engineInput.houseId
        ? args.engineInput.actualContextHouseId
        : undefined,
    mode: args.engineInput.simulatorMode,
    inputType: args.engineInput.inputType,
    scenarioId: null,
    source: "buildBaselinePassthroughArtifact",
    memoryRssMb: getMemoryRssMb(),
  });

  const upstreamUsageTruth = await resolveOnePathUpstreamUsageTruthForSimulation({
    userId: args.engineInput.runtime.userId,
    houseId: args.engineInput.houseId,
    actualContextHouseId: args.engineInput.actualContextHouseId,
    seedIfMissing: true,
  });

  if (!upstreamUsageTruth.dataset) {
    logSimPipelineEvent("baseline_dataset_passthrough_failure", {
      userId: args.engineInput.runtime.userId,
      houseId: args.engineInput.houseId,
      sourceHouseId:
        args.engineInput.actualContextHouseId !== args.engineInput.houseId
          ? args.engineInput.actualContextHouseId
          : undefined,
      mode: args.engineInput.simulatorMode,
      inputType: args.engineInput.inputType,
      scenarioId: null,
      usageTruthSource: upstreamUsageTruth.usageTruthSource,
      seedOk: upstreamUsageTruth.seedResult?.ok,
      failureMessage: "baseline_upstream_usage_truth_missing_after_seed",
      source: "buildBaselinePassthroughArtifact",
      memoryRssMb: getMemoryRssMb(),
    });
    throw new UpstreamUsageTruthMissingError({
      usageTruthSource: upstreamUsageTruth.usageTruthSource,
      seedResult: upstreamUsageTruth.seedResult,
      upstreamUsageTruth: upstreamUsageTruth.summary,
    });
  }

  const manualUsagePayload =
    args.engineInput.inputType === "MANUAL_MONTHLY" || args.engineInput.inputType === "MANUAL_ANNUAL"
      ? (await getOnePathManualUsageInput({
          userId: args.engineInput.runtime.userId,
          houseId: args.engineInput.houseId,
        }).catch(() => ({ payload: null }))).payload ?? null
      : null;

  const dataset =
    args.engineInput.inputType === "INTERVAL"
      ? buildIntervalBaselinePassthroughDataset({
          engineInput: args.engineInput,
          upstreamUsageTruth,
        })
      : buildManualBaselinePassthroughDataset({
          engineInput: args.engineInput,
          upstreamUsageTruth,
          manualUsagePayload,
        });

  const compareProjection = buildOnePathValidationCompareProjectionSidecar(dataset);
  const manualReadResult =
    args.engineInput.inputType === "MANUAL_MONTHLY" || args.engineInput.inputType === "MANUAL_ANNUAL"
      ? await buildOnePathManualArtifactDecorations({
          userId: args.engineInput.runtime.userId,
          houseId: args.engineInput.houseId,
          scenarioId: null,
          dataset,
          displayDataset: dataset,
          callerType: args.callerType,
          usageInputMode: args.engineInput.inputType,
          weatherLogicMode: args.engineInput.weatherLogicMode,
          artifactId: null,
          artifactInputHash: null,
          artifactEngineVersion: "baseline_passthrough_v1",
          actualDataset: upstreamUsageTruth.dataset,
        })
      : null;
  const sharedDiagnostics =
    manualReadResult?.sharedDiagnostics ??
    buildOnePathSharedPastSimDiagnostics({
      callerType: args.callerType,
      dataset,
      scenarioId: null,
      usageInputMode: args.engineInput.inputType,
      weatherLogicMode: args.engineInput.weatherLogicMode,
      artifactId: null,
      artifactInputHash: "",
      artifactEngineVersion: "baseline_passthrough_v1",
      compareProjection,
      manualMonthlyReconciliation: null,
    });

  logSimPipelineEvent("baseline_dataset_passthrough_success", {
    userId: args.engineInput.runtime.userId,
    houseId: args.engineInput.houseId,
    sourceHouseId:
      args.engineInput.actualContextHouseId !== args.engineInput.houseId
        ? args.engineInput.actualContextHouseId
        : undefined,
    mode: args.engineInput.simulatorMode,
    inputType: args.engineInput.inputType,
    scenarioId: null,
    usageTruthSource: upstreamUsageTruth.usageTruthSource,
    seedingAttempted: upstreamUsageTruth.seedResult != null,
    intervalCount: Array.isArray((dataset as any)?.series?.intervals15) ? (dataset as any).series.intervals15.length : 0,
    dayCount: Array.isArray((dataset as any)?.daily) ? (dataset as any).daily.length : 0,
    monthCount: Array.isArray((dataset as any)?.monthly) ? (dataset as any).monthly.length : 0,
    durationMs: Date.now() - startedAt,
    source: "buildBaselinePassthroughArtifact",
    memoryRssMb: getMemoryRssMb(),
  });

  return {
    artifactId: null,
    artifactInputHash: null,
    engineVersion: "baseline_passthrough_v1",
    buildInputsHash: null,
    createdAt: null,
    updatedAt: null,
    houseId: args.engineInput.houseId,
    scenarioId: null,
    actualContextHouseId: args.engineInput.actualContextHouseId,
    inputType: args.engineInput.inputType,
    simulatorMode: args.engineInput.simulatorMode,
    engineInput: args.engineInput,
    dataset: {
      summary: (dataset as any)?.summary ?? {},
      daily: Array.isArray((dataset as any)?.daily) ? (dataset as any).daily : [],
      monthly: Array.isArray((dataset as any)?.monthly) ? (dataset as any).monthly : [],
      series: {
        intervals15: Array.isArray((dataset as any)?.series?.intervals15)
          ? (dataset as any).series.intervals15
          : [],
      },
      meta: (asRecord((dataset as any)?.meta) ?? {}) as Record<string, unknown>,
    },
    simulatedDayResults: [],
    stitchedCurve: [],
    monthlyTargetConstructionDiagnostics: null,
    manualMonthlyInputState: (dataset as any)?.meta?.manualMonthlyInputState ?? null,
    manualBillPeriods: Array.isArray((dataset as any)?.meta?.manualBillPeriods)
      ? (dataset as any).meta.manualBillPeriods
      : [],
    manualBillPeriodTotalsKwhById:
      ((dataset as any)?.meta?.manualBillPeriodTotalsKwhById as Record<string, number> | undefined) ?? {},
    sourceDerivedMonthlyTotalsKwhByMonth: buildMonthlyTotalsRecord((dataset as any)?.monthly),
    compareProjection,
    manualMonthlyReconciliation: manualReadResult?.manualMonthlyReconciliation ?? null,
    manualParitySummary: manualReadResult?.manualParitySummary ?? null,
    sharedDiagnostics: (sharedDiagnostics as Record<string, unknown>) ?? null,
    effectiveSimulationVariablesUsed: null,
  };
}

async function loadSharedContext(args: {
  userId: string;
  houseId: string;
  actualContextHouseId?: string | null;
  manualUsagePayload?: ManualUsagePayload | null;
  seedUsageTruthIfMissing?: boolean;
}): Promise<LoadedSharedContext> {
  const upstreamUsageTruth = await resolveOnePathUpstreamUsageTruthForSimulation({
    userId: args.userId,
    houseId: args.houseId,
    actualContextHouseId: args.actualContextHouseId,
    seedIfMissing: args.seedUsageTruthIfMissing === true,
  });
  if (!upstreamUsageTruth.dataset) {
    throw new UpstreamUsageTruthMissingError({
      usageTruthSource: upstreamUsageTruth.usageTruthSource,
      seedResult: upstreamUsageTruth.seedResult,
      upstreamUsageTruth: upstreamUsageTruth.summary,
    });
  }
  const [
    manualUsageRecord,
    homeProfile,
    applianceProfileRecord,
  ] = await Promise.all([
    args.manualUsagePayload !== undefined
      ? Promise.resolve({ payload: args.manualUsagePayload ?? null })
      : getOnePathManualUsageInput({ userId: args.userId, houseId: args.houseId }).catch(() => ({ payload: null })),
    getHomeProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.houseId }).catch(() => null),
    getApplianceProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.houseId }).catch(() => null),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRecord as any)?.appliancesJson ?? null);
  const weatherEnvelope = await resolveOnePathWeatherSensitivityEnvelope({
    actualDataset: upstreamUsageTruth.dataset,
    manualUsagePayload: manualUsageRecord.payload ?? null,
    homeProfile,
    applianceProfile,
    weatherHouseId: upstreamUsageTruth.actualContextHouse.id,
  }).catch(() => ({
    score: null,
    derivedInput: null,
  }));
  return {
    house: upstreamUsageTruth.selectedHouse,
    actualContextHouseId: upstreamUsageTruth.actualContextHouse.id,
    usageTruthSource: upstreamUsageTruth.usageTruthSource,
    usageTruthSeedResult: upstreamUsageTruth.seedResult,
    upstreamUsageTruth: upstreamUsageTruth.summary,
    actualDataset: upstreamUsageTruth.dataset,
    manualUsagePayload: manualUsageRecord.payload ?? null,
    homeProfile: (homeProfile as Record<string, unknown> | null) ?? null,
    applianceProfile: (applianceProfile as Record<string, unknown> | null) ?? null,
    weatherEnvelope,
  };
}

function buildCanonicalEngineInput(args: {
  inputType: CanonicalSimulationInputType;
  scenarioId: string | null;
  weatherPreference: CanonicalSimulationEngineInput["weatherPreference"];
  validationSelectionMode?: string | null;
  validationDayCount?: number | null;
  validationOnlyDateKeysLocal?: string[];
  travelRanges?: Array<{ startDate: string; endDate: string }>;
  persistRequested?: boolean;
  loaded: LoadedSharedContext;
  runtimeUserId: string;
}): CanonicalSimulationEngineInput {
  const coverageWindow = resolveOnePathCanonicalUsage365CoverageWindow();
  const manualUsagePayload = args.loaded.manualUsagePayload;
  const actualMeta = asRecord(args.loaded.actualDataset?.meta) ?? {};
  const statementRanges = Array.isArray((manualUsagePayload as any)?.statementRanges) ? (manualUsagePayload as any).statementRanges : [];
  const monthlyTotalsRows = Array.isArray((manualUsagePayload as any)?.monthlyKwh) ? (manualUsagePayload as any).monthlyKwh : [];
  const monthlyTotalsKwhByMonth = Object.fromEntries(
    monthlyTotalsRows
      .map((row: any) => [String(row?.month ?? "").slice(0, 7), Number(row?.kwh ?? Number.NaN)])
      .filter((entry: [string, number]) => /^\d{4}-\d{2}$/.test(entry[0]) && Number.isFinite(entry[1]))
  ) as Record<string, number>;
  const derivedInput =
    args.loaded.weatherEnvelope.derivedInput ?? buildOnePathWeatherEfficiencyDerivedInput(args.loaded.weatherEnvelope.score ?? null);
  const actualMonthlyRows = Array.isArray(args.loaded.actualDataset?.monthly) ? args.loaded.actualDataset.monthly : [];
  const actualMonthlyReference = Object.fromEntries(
    actualMonthlyRows
      .map((row: any) => [String(row?.month ?? "").slice(0, 7), Number(row?.kwh ?? Number.NaN)])
      .filter((entry: [string, number]) => /^\d{4}-\d{2}$/.test(entry[0]) && Number.isFinite(entry[1]))
  ) as Record<string, number>;
  const travelRanges = normalizeTravelRanges(
    args.travelRanges ??
      (manualUsagePayload && Array.isArray((manualUsagePayload as any).travelRanges)
        ? (manualUsagePayload as any).travelRanges
        : [])
  );
  const weatherPreference = args.weatherPreference;
  const weatherLogicMode = deriveWeatherLogicMode(weatherPreference);
  const anchorEndDate =
    typeof (manualUsagePayload as any)?.anchorEndDate === "string"
      ? String((manualUsagePayload as any).anchorEndDate).slice(0, 10)
      : null;
  const billEndDay = anchorEndDate ? Number(anchorEndDate.slice(8, 10)) || null : null;
  const manualBillPeriodTotalsKwhById = Array.isArray(statementRanges)
    ? Object.fromEntries(
        statementRanges
          .map((row: any) => [String(row?.id ?? `${row?.month ?? ""}:${row?.startDate ?? ""}:${row?.endDate ?? ""}`), Number(row?.targetKwh ?? row?.kwh ?? Number.NaN)])
          .filter(([id, kwh]) => id && Number.isFinite(kwh))
      )
    : {};
  return {
    engineInputVersion: "one-path-sim-v1",
    inputType: args.inputType,
    simulatorMode:
      args.inputType === "INTERVAL"
        ? "SMT_BASELINE"
        : args.inputType === "NEW_BUILD"
          ? "NEW_BUILD_ESTIMATE"
          : "MANUAL_TOTALS",
    houseId: args.loaded.house.id,
    actualContextHouseId: args.loaded.actualContextHouseId,
    scenarioId: args.scenarioId,
    timezone: String(actualMeta.timezone ?? "America/Chicago"),
    coverageWindowStart: coverageWindow.startDate,
    coverageWindowEnd: coverageWindow.endDate,
    canonicalMonths: Array.isArray(actualMeta.canonicalMonths) ? (actualMeta.canonicalMonths as string[]) : [],
    canonicalEndMonth:
      typeof actualMeta.canonicalEndMonth === "string" ? String(actualMeta.canonicalEndMonth) : coverageWindow.endDate.slice(0, 7),
    anchorEndDate,
    billEndDay,
    statementRanges,
    dateSourceMode:
      typeof (manualUsagePayload as any)?.dateSourceMode === "string" ? String((manualUsagePayload as any).dateSourceMode) : null,
    manualConstraintMode: args.inputType,
    monthlyTotalsKwhByMonth,
    annualTargetKwh:
      typeof (manualUsagePayload as any)?.annualKwh === "number" ? Math.max(0, Number((manualUsagePayload as any).annualKwh) || 0) : null,
    manualBillPeriodTotalsKwhById,
    normalizedMonthTargetsByMonth: monthlyTotalsKwhByMonth,
    monthlyTargetConstructionDiagnostics: null,
    actualIntervalsReference: Array.isArray(args.loaded.actualDataset?.series?.intervals15)
      ? args.loaded.actualDataset.series.intervals15
      : [],
    actualDailyReference: Array.isArray(args.loaded.actualDataset?.daily) ? args.loaded.actualDataset.daily : [],
    actualMonthlyReference,
    actualSource: typeof actualMeta.actualSource === "string" ? String(actualMeta.actualSource) : null,
    actualIntervalFingerprint:
      typeof actualMeta.intervalUsageFingerprintIdentity === "string"
        ? String(actualMeta.intervalUsageFingerprintIdentity)
        : null,
    weatherIdentity: typeof actualMeta.weatherDatasetIdentity === "string" ? String(actualMeta.weatherDatasetIdentity) : null,
    usageShapeIdentity: typeof actualMeta.usageShapeProfileIdentity === "string" ? String(actualMeta.usageShapeProfileIdentity) : null,
    travelRanges,
    excludedDateKeysLocal: [],
    validationOnlyDateKeysLocal: Array.isArray(args.validationOnlyDateKeysLocal) ? args.validationOnlyDateKeysLocal : [],
    validationSelectionMode: args.validationSelectionMode ?? null,
    validationSelectionDiagnostics: null,
    homeProfile: args.loaded.homeProfile,
    applianceProfile: args.loaded.applianceProfile,
    occupantProfile: args.loaded.homeProfile,
    poolProfile: args.loaded.homeProfile,
    evProfile: asRecord((args.loaded.homeProfile as any)?.ev) ?? null,
    weatherPreference,
    weatherLogicMode,
    weatherDaysReference: asRecord(args.loaded.actualDataset?.dailyWeather) ?? null,
    sharedProducerPathUsed: true,
    sourceDerivedMode: args.loaded.usageTruthSource,
    manualTravelVacantDonorPoolMode: null,
    weatherEfficiencyDerivedInput: derivedInput,
    upstreamUsageTruth: args.loaded.upstreamUsageTruth,
    runtime: {
      userId: args.runtimeUserId,
      houseId: args.loaded.house.id,
      esiid: args.loaded.house.esiid,
      actualContextHouseId: args.loaded.actualContextHouseId,
      mode:
        args.inputType === "INTERVAL"
          ? "SMT_BASELINE"
          : args.inputType === "NEW_BUILD"
            ? "NEW_BUILD_ESTIMATE"
            : "MANUAL_TOTALS",
      scenarioId: args.scenarioId,
      persistPastSimBaseline: args.persistRequested !== false,
      weatherPreference,
      validationOnlyDateKeysLocal: Array.isArray(args.validationOnlyDateKeysLocal) ? args.validationOnlyDateKeysLocal : [],
      preLockboxTravelRanges: travelRanges,
      validationDaySelectionMode: args.validationSelectionMode ?? null,
      validationDayCount: args.validationDayCount ?? null,
      runContext: {
        callerLabel: "one_path_sim_admin",
      },
    },
  };
}

export async function adaptIntervalRawInput(raw: IntervalRawInput): Promise<CanonicalSimulationEngineInput> {
  const loaded = await loadSharedContext({
    userId: raw.userId,
    houseId: raw.houseId,
    actualContextHouseId: raw.actualContextHouseId,
    seedUsageTruthIfMissing: true,
  });
  return buildCanonicalEngineInput({
    inputType: "INTERVAL",
    scenarioId: raw.scenarioId ?? null,
    weatherPreference: normalizeWeatherPreference(raw.weatherPreference),
    validationSelectionMode: raw.validationSelectionMode ?? null,
    validationDayCount: raw.validationDayCount ?? null,
    validationOnlyDateKeysLocal: raw.validationOnlyDateKeysLocal ?? [],
    travelRanges: raw.travelRanges ?? [],
    persistRequested: raw.persistRequested,
    loaded,
    runtimeUserId: raw.userId,
  });
}

export async function adaptManualMonthlyRawInput(raw: ManualMonthlyRawInput): Promise<CanonicalSimulationEngineInput> {
  const loaded = await loadSharedContext({
    userId: raw.userId,
    houseId: raw.houseId,
    actualContextHouseId: raw.actualContextHouseId,
    manualUsagePayload: raw.manualUsagePayload,
    seedUsageTruthIfMissing: true,
  });
  return buildCanonicalEngineInput({
    inputType: "MANUAL_MONTHLY",
    scenarioId: raw.scenarioId ?? null,
    weatherPreference: normalizeWeatherPreference(raw.weatherPreference),
    validationSelectionMode: raw.validationSelectionMode ?? null,
    validationDayCount: raw.validationDayCount ?? null,
    validationOnlyDateKeysLocal: raw.validationOnlyDateKeysLocal ?? [],
    travelRanges: raw.travelRanges ?? [],
    persistRequested: raw.persistRequested,
    loaded,
    runtimeUserId: raw.userId,
  });
}

export async function adaptManualAnnualRawInput(raw: ManualAnnualRawInput): Promise<CanonicalSimulationEngineInput> {
  const loaded = await loadSharedContext({
    userId: raw.userId,
    houseId: raw.houseId,
    actualContextHouseId: raw.actualContextHouseId,
    manualUsagePayload: raw.manualUsagePayload,
    seedUsageTruthIfMissing: true,
  });
  return buildCanonicalEngineInput({
    inputType: "MANUAL_ANNUAL",
    scenarioId: raw.scenarioId ?? null,
    weatherPreference: normalizeWeatherPreference(raw.weatherPreference),
    validationSelectionMode: raw.validationSelectionMode ?? null,
    validationDayCount: raw.validationDayCount ?? null,
    validationOnlyDateKeysLocal: raw.validationOnlyDateKeysLocal ?? [],
    travelRanges: raw.travelRanges ?? [],
    persistRequested: raw.persistRequested,
    loaded,
    runtimeUserId: raw.userId,
  });
}

export async function adaptNewBuildRawInput(raw: NewBuildRawInput): Promise<CanonicalSimulationEngineInput> {
  const loaded = await loadSharedContext({
    userId: raw.userId,
    houseId: raw.houseId,
    actualContextHouseId: raw.actualContextHouseId,
    seedUsageTruthIfMissing: true,
  });
  return buildCanonicalEngineInput({
    inputType: "NEW_BUILD",
    scenarioId: raw.scenarioId ?? null,
    weatherPreference: normalizeWeatherPreference(raw.weatherPreference),
    validationSelectionMode: raw.validationSelectionMode ?? null,
    validationDayCount: raw.validationDayCount ?? null,
    validationOnlyDateKeysLocal: raw.validationOnlyDateKeysLocal ?? [],
    travelRanges: raw.travelRanges ?? [],
    persistRequested: raw.persistRequested,
    loaded,
    runtimeUserId: raw.userId,
  });
}

async function buildArtifactFromEngineInput(args: {
  engineInput: CanonicalSimulationEngineInput;
  callerType: SharedDiagnosticsCallerType;
  exactArtifactInputHash?: string | null;
}): Promise<CanonicalSimulationArtifact> {
  if (isBaselinePassthroughInput(args.engineInput)) {
    return buildBaselinePassthroughArtifact({
      engineInput: args.engineInput,
      callerType: args.callerType,
    });
  }
  const datasetRead = await readOnePathSimulatedUsageScenario({
    userId: args.engineInput.runtime.userId,
    houseId: args.engineInput.houseId,
    scenarioId: args.engineInput.scenarioId,
    readMode: "artifact_only",
    exactArtifactInputHash: args.exactArtifactInputHash ?? null,
    requireExactArtifactMatch: typeof args.exactArtifactInputHash === "string" && args.exactArtifactInputHash.length > 0,
  });
  if (!datasetRead.ok) {
    throw new Error(datasetRead.message);
  }
  const scenarioKey = toScenarioKey(args.engineInput.scenarioId);
  const buildRec = await (prisma as any).usageSimulatorBuild
    .findUnique({
      where: {
        userId_houseId_scenarioKey: {
          userId: args.engineInput.runtime.userId,
          houseId: args.engineInput.houseId,
          scenarioKey,
        },
      },
      select: {
        id: true,
        buildInputsHash: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    .catch(() => null);
  const actualDataset =
    (
      await resolveOnePathUpstreamUsageTruthForSimulation({
        userId: args.engineInput.runtime.userId,
        houseId: args.engineInput.houseId,
        actualContextHouseId: args.engineInput.actualContextHouseId,
        seedIfMissing: false,
      }).catch(() => null)
    )?.dataset ?? null;
  const compareProjection = buildOnePathValidationCompareProjectionSidecar(datasetRead.dataset);
  const manualReadResult =
    args.engineInput.inputType === "MANUAL_MONTHLY" || args.engineInput.inputType === "MANUAL_ANNUAL"
      ? await buildOnePathManualArtifactDecorations({
          userId: args.engineInput.runtime.userId,
          houseId: args.engineInput.houseId,
          scenarioId: args.engineInput.scenarioId,
          dataset: datasetRead.dataset,
          displayDataset: datasetRead.dataset,
          callerType: args.callerType,
          usageInputMode: args.engineInput.inputType,
          weatherLogicMode: args.engineInput.weatherLogicMode,
          artifactId: buildRec?.id ? String(buildRec.id) : null,
          artifactInputHash:
            typeof (datasetRead.dataset as any)?.meta?.artifactInputHash === "string"
              ? String((datasetRead.dataset as any).meta.artifactInputHash)
              : null,
          artifactEngineVersion:
            typeof (datasetRead.dataset as any)?.meta?.engineVersion === "string"
              ? String((datasetRead.dataset as any).meta.engineVersion)
              : null,
          actualDataset,
        })
      : null;
  const sharedDiagnostics =
    manualReadResult
      ? manualReadResult.sharedDiagnostics
      : buildOnePathSharedPastSimDiagnostics({
          callerType: args.callerType,
          dataset: datasetRead.dataset,
          scenarioId: args.engineInput.scenarioId,
          usageInputMode: args.engineInput.inputType,
          weatherLogicMode: args.engineInput.weatherLogicMode,
          artifactId: buildRec?.id ? String(buildRec.id) : null,
          artifactInputHash: String((datasetRead.dataset as any)?.meta?.artifactInputHash ?? ""),
          artifactEngineVersion: String((datasetRead.dataset as any)?.meta?.engineVersion ?? ""),
          compareProjection,
          manualMonthlyReconciliation: null,
        });
  const effectiveSimulationVariablesUsed = attachOnePathRunIdentityToEffectiveSimulationVariablesUsed(
    ((datasetRead.dataset as any)?.meta?.effectiveSimulationVariablesUsed as EffectiveSimulationVariablesUsed | null | undefined) ?? null,
    {
      artifactId: buildRec?.id ? String(buildRec.id) : null,
      artifactInputHash:
        typeof (datasetRead.dataset as any)?.meta?.artifactInputHash === "string"
          ? String((datasetRead.dataset as any).meta.artifactInputHash)
          : null,
      buildInputsHash: buildRec?.buildInputsHash ? String(buildRec.buildInputsHash) : null,
      engineVersion:
        typeof (datasetRead.dataset as any)?.meta?.engineVersion === "string"
          ? String((datasetRead.dataset as any).meta.engineVersion)
          : typeof (datasetRead.dataset as any)?.meta?.simVersion === "string"
            ? String((datasetRead.dataset as any).meta.simVersion)
            : null,
      houseId: args.engineInput.houseId,
      actualContextHouseId: args.engineInput.actualContextHouseId,
      scenarioId: args.engineInput.scenarioId,
    }
  );
  return {
    artifactId: buildRec?.id ? String(buildRec.id) : null,
    artifactInputHash:
      typeof (datasetRead.dataset as any)?.meta?.artifactInputHash === "string"
        ? String((datasetRead.dataset as any).meta.artifactInputHash)
        : null,
    engineVersion:
      typeof (datasetRead.dataset as any)?.meta?.engineVersion === "string"
        ? String((datasetRead.dataset as any).meta.engineVersion)
        : typeof (datasetRead.dataset as any)?.meta?.simVersion === "string"
          ? String((datasetRead.dataset as any).meta.simVersion)
          : null,
    buildInputsHash: buildRec?.buildInputsHash ? String(buildRec.buildInputsHash) : null,
    createdAt: buildRec?.createdAt ? new Date(buildRec.createdAt).toISOString() : null,
    updatedAt: buildRec?.updatedAt ? new Date(buildRec.updatedAt).toISOString() : null,
    houseId: args.engineInput.houseId,
    scenarioId: args.engineInput.scenarioId,
    actualContextHouseId: args.engineInput.actualContextHouseId,
    inputType: args.engineInput.inputType,
    simulatorMode: args.engineInput.simulatorMode,
    engineInput: args.engineInput,
    dataset: {
      summary: (datasetRead.dataset as any)?.summary ?? {},
      daily: Array.isArray((datasetRead.dataset as any)?.daily) ? (datasetRead.dataset as any).daily : [],
      monthly: Array.isArray((datasetRead.dataset as any)?.monthly) ? (datasetRead.dataset as any).monthly : [],
      series: {
        intervals15: Array.isArray((datasetRead.dataset as any)?.series?.intervals15)
          ? (datasetRead.dataset as any).series.intervals15
          : [],
      },
      meta: asRecord((datasetRead.dataset as any)?.meta) ?? {},
    },
    simulatedDayResults: Array.isArray((datasetRead.dataset as any)?.meta?.simulatedDayResults)
      ? ((datasetRead.dataset as any).meta.simulatedDayResults as any[])
      : [],
    stitchedCurve: Array.isArray((datasetRead.dataset as any)?.series?.hourly) ? (datasetRead.dataset as any).series.hourly : [],
    monthlyTargetConstructionDiagnostics:
      (asRecord((datasetRead.dataset as any)?.meta)?.monthlyTargetConstructionDiagnostics as unknown[] | null) ?? null,
    manualMonthlyInputState: (datasetRead.dataset as any)?.meta?.manualMonthlyInputState ?? null,
    manualBillPeriods: Array.isArray((datasetRead.dataset as any)?.meta?.manualBillPeriods)
      ? (datasetRead.dataset as any).meta.manualBillPeriods
      : [],
    manualBillPeriodTotalsKwhById:
      (asRecord((datasetRead.dataset as any)?.meta?.manualBillPeriodTotalsKwhById) as Record<string, number> | null) ?? {},
    sourceDerivedMonthlyTotalsKwhByMonth:
      (asRecord((datasetRead.dataset as any)?.meta?.sourceDerivedMonthlyTotalsKwhByMonth) as Record<string, number> | null) ?? {},
    compareProjection,
    manualMonthlyReconciliation: manualReadResult ? manualReadResult.manualMonthlyReconciliation : null,
    manualParitySummary: manualReadResult ? manualReadResult.manualParitySummary : null,
    sharedDiagnostics: (sharedDiagnostics as Record<string, unknown>) ?? null,
    effectiveSimulationVariablesUsed,
  };
}

export async function runSharedSimulation(
  engineInput: CanonicalSimulationEngineInput
): Promise<CanonicalSimulationArtifact> {
  if (isBaselinePassthroughInput(engineInput)) {
    return buildArtifactFromEngineInput({
      engineInput,
      callerType: "user_past",
    });
  }
  const recalcArgs: RecalcSimulatorBuildArgs = {
    userId: engineInput.runtime.userId,
    houseId: engineInput.runtime.houseId,
    esiid: engineInput.runtime.esiid,
    actualContextHouseId: engineInput.runtime.actualContextHouseId,
    mode: engineInput.runtime.mode,
    scenarioId: engineInput.runtime.scenarioId,
    weatherPreference: engineInput.runtime.weatherPreference,
    persistPastSimBaseline: engineInput.runtime.persistPastSimBaseline,
    validationOnlyDateKeysLocal: engineInput.runtime.validationOnlyDateKeysLocal,
    preLockboxTravelRanges: engineInput.runtime.preLockboxTravelRanges,
    validationDaySelectionMode: (engineInput.runtime.validationDaySelectionMode as any) ?? undefined,
    validationDayCount: engineInput.runtime.validationDayCount ?? undefined,
    runContext: {
      ...(engineInput.runtime.runContext ?? {}),
      callerLabel: "one_path_sim_admin",
    },
  };
  const result = await runOnePathSimulatorBuild(recalcArgs);
  if (!result.ok) {
    throw new SharedSimulationRunError({
      code: result.error,
      missingItems: result.missingItems,
    });
  }
  return buildArtifactFromEngineInput({
    engineInput,
    callerType: "user_past",
    exactArtifactInputHash: result.canonicalArtifactInputHash ?? null,
  });
}

export async function readSharedSimulationArtifact(args: {
  userId: string;
  houseId: string;
  scenarioId?: string | null;
  inputType: CanonicalSimulationInputType;
  actualContextHouseId?: string | null;
}): Promise<CanonicalSimulationArtifact> {
  const loaded = await loadSharedContext({
    userId: args.userId,
    houseId: args.houseId,
    actualContextHouseId: args.actualContextHouseId,
    seedUsageTruthIfMissing: (args.scenarioId ?? null) == null && args.inputType !== "NEW_BUILD",
  });
  const engineInput = buildCanonicalEngineInput({
    inputType: args.inputType,
    scenarioId: args.scenarioId ?? null,
    weatherPreference: "LAST_YEAR_WEATHER",
    validationSelectionMode: null,
    validationDayCount: null,
    validationOnlyDateKeysLocal: [],
    travelRanges: [],
    persistRequested: true,
    loaded,
    runtimeUserId: args.userId,
  });
  return buildArtifactFromEngineInput({
    engineInput,
    callerType: "user_past",
  });
}

export function buildSharedSimulationReadModel(
  artifact: CanonicalSimulationArtifact
): CanonicalSimulationReadModel {
  const meta = artifact.dataset.meta ?? {};
  const isBaselinePassthroughRead =
    artifact.scenarioId == null &&
    artifact.inputType !== "NEW_BUILD" &&
    Boolean((meta as any)?.baselinePassthrough);
  const curvePayload = isBaselinePassthroughRead
    ? null
    : buildOnePathDailyCurveComparePayload({
        actualDataset: null,
        simulatedDataset: artifact.dataset,
        compareRows: artifact.compareProjection?.rows ?? [],
        timezone: String((meta as any)?.timezone ?? "America/Chicago"),
      });
  const runIdentity = {
    artifactId: artifact.artifactId,
    artifactInputHash: artifact.artifactInputHash,
    engineVersion: artifact.engineVersion,
    buildInputsHash: artifact.buildInputsHash,
    inputType: artifact.inputType,
    simulatorMode: artifact.simulatorMode,
    houseId: artifact.houseId,
    actualContextHouseId: artifact.actualContextHouseId,
    scenarioId: artifact.scenarioId,
    weatherLogicMode: artifact.engineInput.weatherLogicMode,
    sharedProducerPathUsed: artifact.engineInput.sharedProducerPathUsed,
  };
  const sourceOfTruthSummary = buildOnePathTruthSummary({
    inputType: artifact.inputType,
    engineInput: artifact.engineInput as Record<string, unknown>,
    artifact: artifact as unknown as Record<string, unknown>,
    readModel: {
      runIdentity,
      compareProjection: artifact.compareProjection,
      manualMonthlyReconciliation: artifact.manualMonthlyReconciliation,
      manualParitySummary: artifact.manualParitySummary,
      sharedDiagnostics: artifact.sharedDiagnostics,
      dailyShapeTuning: {
        simulatedDayResultsCount: artifact.simulatedDayResults.length,
        manualBillPeriodCount: artifact.manualBillPeriods.length,
        intervalCount: artifact.dataset.series.intervals15.length,
        dailyRowCount: artifact.dataset.daily.length,
      },
      tuningSummary:
        (artifact.sharedDiagnostics?.tuningSummary as Record<string, unknown> | undefined) ??
        ({
          compareRowsCount: artifact.compareProjection?.rows?.length ?? 0,
          monthlyTargetConstructionDiagnosticsCount: artifact.monthlyTargetConstructionDiagnostics?.length ?? 0,
        } as Record<string, unknown>),
      effectiveSimulationVariablesUsed: artifact.effectiveSimulationVariablesUsed,
      sourceOfTruthSummary: {
        stageBoundaryMap: null,
        sharedDerivedInputs: null,
        sourceTruthIdentity: null,
        constraintRebalance: null,
        donorFallbackExclusions: null,
        intradayReconstruction: null,
        finalSharedOutputContract: null,
      },
    },
  });
  return {
    runIdentity,
    dataset: artifact.dataset,
    compareProjection: artifact.compareProjection,
    manualMonthlyReconciliation: artifact.manualMonthlyReconciliation,
    manualParitySummary: artifact.manualParitySummary,
    sharedDiagnostics: artifact.sharedDiagnostics,
    curveCompareActualIntervals15: curvePayload?.actualIntervals15 ?? [],
    curveCompareSimulatedIntervals15: curvePayload?.simulatedIntervals15 ?? [],
    curveCompareSimulatedDailyRows: curvePayload?.simulatedDailyRows ?? [],
    dailyShapeTuning: {
      simulatedDayResultsCount: artifact.simulatedDayResults.length,
      manualBillPeriodCount: artifact.manualBillPeriods.length,
      intervalCount: artifact.dataset.series.intervals15.length,
      dailyRowCount: artifact.dataset.daily.length,
    },
    tuningSummary:
      (artifact.sharedDiagnostics?.tuningSummary as Record<string, unknown> | undefined) ??
      ({
        compareRowsCount: artifact.compareProjection?.rows?.length ?? 0,
        monthlyTargetConstructionDiagnosticsCount: artifact.monthlyTargetConstructionDiagnostics?.length ?? 0,
      } as Record<string, unknown>),
    effectiveSimulationVariablesUsed: artifact.effectiveSimulationVariablesUsed,
    sourceOfTruthSummary,
    failureCode: null,
    failureMessage: null,
  };
}
