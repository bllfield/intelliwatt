import { prisma } from "@/lib/db";
import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { buildManualUsagePastSimReadResult } from "@/modules/manualUsage/pastSimReadResult";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { buildValidationCompareProjectionSidecar, type ValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection";
import { buildDailyCurveComparePayload } from "@/modules/usageSimulator/dailyCurveCompareSummary";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";
import { buildSharedPastSimDiagnostics, type SharedDiagnosticsCallerType } from "@/modules/usageSimulator/sharedDiagnostics";
import {
  getSimulatedUsageForHouseScenario,
  recalcSimulatorBuild,
  type RecalcSimulatorBuildArgs,
} from "@/modules/usageSimulator/service";
import {
  buildWeatherEfficiencyDerivedInput,
  resolveSharedWeatherSensitivityEnvelope,
  type WeatherEfficiencyDerivedInput,
} from "@/modules/weatherSensitivity/shared";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

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
  actualDataset: any | null;
  manualUsagePayload: ManualUsagePayload | null;
  homeProfile: Record<string, unknown> | null;
  applianceProfile: Record<string, unknown> | null;
  weatherEnvelope: Awaited<ReturnType<typeof resolveSharedWeatherSensitivityEnvelope>>;
};

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

async function loadSharedContext(args: {
  userId: string;
  houseId: string;
  actualContextHouseId?: string | null;
  manualUsagePayload?: ManualUsagePayload | null;
}): Promise<LoadedSharedContext> {
  const house = await (prisma as any).houseAddress.findFirst({
    where: { id: args.houseId, userId: args.userId, archivedAt: null },
    select: { id: true, esiid: true },
  });
  if (!house) throw new Error("house_not_found");
  const actualContextHouseId = String(args.actualContextHouseId ?? args.houseId);
  const [
    actualResult,
    manualUsageRecord,
    homeProfile,
    applianceProfileRecord,
  ] = await Promise.all([
    getActualUsageDatasetForHouse(actualContextHouseId, house.esiid ?? null, { skipFullYearIntervalFetch: true }).catch(() => null),
    args.manualUsagePayload !== undefined
      ? Promise.resolve({ payload: args.manualUsagePayload ?? null })
      : getManualUsageInputForUserHouse({ userId: args.userId, houseId: args.houseId }).catch(() => ({ payload: null })),
    getHomeProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.houseId }).catch(() => null),
    getApplianceProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.houseId }).catch(() => null),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRecord as any)?.appliancesJson ?? null);
  const weatherEnvelope = await resolveSharedWeatherSensitivityEnvelope({
    actualDataset: actualResult?.dataset ?? null,
    manualUsagePayload: manualUsageRecord.payload ?? null,
    homeProfile,
    applianceProfile,
    weatherHouseId: actualContextHouseId,
  }).catch(() => ({
    score: null,
    derivedInput: null,
  }));
  return {
    house: { id: String(house.id), esiid: house.esiid ? String(house.esiid) : null },
    actualContextHouseId,
    actualDataset: actualResult?.dataset ?? null,
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
  const coverageWindow = resolveCanonicalUsage365CoverageWindow();
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
    args.loaded.weatherEnvelope.derivedInput ?? buildWeatherEfficiencyDerivedInput(args.loaded.weatherEnvelope.score ?? null);
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
    sourceDerivedMode: null,
    manualTravelVacantDonorPoolMode: null,
    weatherEfficiencyDerivedInput: derivedInput,
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
}): Promise<CanonicalSimulationArtifact> {
  const datasetRead = await getSimulatedUsageForHouseScenario({
    userId: args.engineInput.runtime.userId,
    houseId: args.engineInput.houseId,
    scenarioId: args.engineInput.scenarioId,
    readMode: "artifact_only",
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
      await getActualUsageDatasetForHouse(
        args.engineInput.actualContextHouseId,
        args.engineInput.runtime.esiid ?? null,
        { skipFullYearIntervalFetch: true }
      ).catch(() => null)
    )?.dataset ?? null;
  const compareProjection = buildValidationCompareProjectionSidecar(datasetRead.dataset);
  const manualReadResult =
    args.engineInput.inputType === "MANUAL_MONTHLY" || args.engineInput.inputType === "MANUAL_ANNUAL"
      ? await buildManualUsagePastSimReadResult({
          userId: args.engineInput.runtime.userId,
          houseId: args.engineInput.houseId,
          scenarioId: args.engineInput.scenarioId,
          readMode: "artifact_only",
          callerType: args.callerType,
          usageInputMode: args.engineInput.inputType,
          weatherLogicMode: args.engineInput.weatherLogicMode,
          actualDataset,
          actualReference: {
            userId: args.engineInput.runtime.userId,
            houseId: args.engineInput.actualContextHouseId,
            scenarioId: null,
          },
        })
      : null;
  const sharedDiagnostics =
    manualReadResult && manualReadResult.ok
      ? manualReadResult.sharedDiagnostics
      : buildSharedPastSimDiagnostics({
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
    manualMonthlyReconciliation: manualReadResult && manualReadResult.ok ? manualReadResult.manualMonthlyReconciliation : null,
    manualParitySummary: manualReadResult && manualReadResult.ok ? manualReadResult.manualParitySummary : null,
    sharedDiagnostics: (sharedDiagnostics as Record<string, unknown>) ?? null,
  };
}

export async function runSharedSimulation(
  engineInput: CanonicalSimulationEngineInput
): Promise<CanonicalSimulationArtifact> {
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
  const result = await recalcSimulatorBuild(recalcArgs);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return buildArtifactFromEngineInput({
    engineInput,
    callerType: "user_past",
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
  const curvePayload = buildDailyCurveComparePayload({
    actualDataset: null,
    simulatedDataset: artifact.dataset,
    compareRows: artifact.compareProjection?.rows ?? [],
    timezone: String((meta as any)?.timezone ?? "America/Chicago"),
  });
  return {
    runIdentity: {
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
    },
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
    failureCode: null,
    failureMessage: null,
  };
}
