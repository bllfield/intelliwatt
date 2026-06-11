import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { PAST_VALIDATION_POLICY_REVISION } from "@/lib/usage/pastValidationPolicy";
import {
  computeValidationDayPolicyHash,
  resolveActiveValidationDayPolicyLive,
  resolveGlobalValidationDayKeysForPastSim,
} from "@/lib/usage/validationDayPolicy";
import { readTravelRangesForHouse } from "@/lib/usage/pastSimTravelRanges";
import { buildOnePathManualUsagePastSimReadResult } from "@/modules/onePathSim/manualPastSimReadResult";
import {
  hashManualGapfillSavedSeedPayload,
  type ManualGapfillSeedMode,
} from "@/modules/manualUsage/manualGapfillSeed";
import {
  loadManualGapfillSourceActualDataset,
  resolveManualGapfillSmtSourceContext,
  type ManualGapfillSourceContext,
} from "@/modules/manualUsage/manualGapfillSourceContext";
import {
  buildManualGapfillCompareDiagnosticsV1,
  type ManualGapfillCompareDiagnosticsV1,
} from "@/modules/manualUsage/manualGapfillCompareDiagnosticsV1";
import { buildManualUsageReadModel } from "@/modules/manualUsage/readModel";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { validateManualUsagePayload } from "@/modules/manualUsage/validation";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

const WORKSPACE_PAST_NAME = "Past (Corrected)";

export type ManualGapfillCompareStatus =
  | "ready"
  | "source_context_missing"
  | "lab_readback_missing"
  | "seed_source_mismatch"
  | "policy_mismatch"
  | "artifact_mismatch"
  | "compare_unavailable"
  | "compare_failed";

export type ManualGapfillCompareArgs = {
  userId: string;
  sourceHouseId: string;
  labHouseId: string;
  mode: ManualGapfillSeedMode;
  esiid?: string | null;
  scenarioId?: string | null;
  expectedSeedHash?: string | null;
  expectedSourceFingerprint?: string | null;
  expectedValidationDayPolicyHash?: string | null;
  expectedArtifactInputHash?: string | null;
  includeDailyRows?: boolean;
  includeDiagnostics?: boolean;
};

export type ManualGapfillCompareMonthlyRow = {
  periodId: string;
  startDate: string;
  endDate: string;
  actualKwh: number | null;
  simulatedKwh: number | null;
  deltaKwh: number | null;
  percentDelta: number | null;
  status: "matched" | "missing_actual" | "missing_simulated" | "excluded";
  actualSource: "SMT" | "GREEN_BUTTON" | null;
  simulatedSource: "SIMULATED_MANUAL_CONSTRAINED" | null;
};

export type ManualGapfillCompareEnvelope = {
  ok: boolean;
  status: ManualGapfillCompareStatus;
  mode: ManualGapfillSeedMode;
  identity: {
    sourceHouseId: string;
    labHouseId: string;
    actualContextHouseId: string;
    scenarioId: string | null;
    seedHash: string | null;
    sourceIntervalFingerprint: string | null;
    sourceDailyFingerprint: string | null;
    sourceMonthlyFingerprint: string | null;
    validationDayPolicyRevision: string | null;
    validationDayPolicyHash: string | null;
    artifactInputHash: string | null;
    buildInputsHash: string | null;
  };
  sourceActual: {
    actualSourceKind: "SMT" | "GREEN_BUTTON" | "missing" | "ambiguous";
    coverageStart: string | null;
    coverageEnd: string | null;
    dailyCount: number | null;
    intervalCount: number | null;
    monthlyCount: number | null;
    annualTotalKwh: number | null;
  };
  labSimulated: {
    coverageStart: string | null;
    coverageEnd: string | null;
    dailyRowCount: number | null;
    intervalCount: number | null;
    totalKwh: number | null;
    source: "SIMULATED" | null;
    sourceDetail: "SIMULATED_MANUAL_CONSTRAINED" | null;
    intervalShape: "estimated" | "measured" | null;
  };
  compare: {
    compareScope: "source_actual_vs_lab_simulated";
    compareBasis: "bill_period" | "annual" | "daily_summary" | "mixed";
    status: "pass" | "fail" | "partial" | "not_available";
    actualTotalKwh: number | null;
    simulatedTotalKwh: number | null;
    deltaKwh: number | null;
    absoluteDeltaKwh: number | null;
    percentDelta: number | null;
    monthly?: {
      rowCount: number;
      matchedCount: number;
      missingActualCount: number;
      missingSimulatedCount: number;
      rows: ManualGapfillCompareMonthlyRow[];
    };
    annual?: {
      actualKwh: number | null;
      simulatedKwh: number | null;
      deltaKwh: number | null;
      percentDelta: number | null;
    };
    dailySummary?: {
      comparedDayCount: number;
      missingActualDayCount: number;
      missingSimulatedDayCount: number;
      meanAbsoluteDailyDeltaKwh: number | null;
      medianAbsoluteDailyDeltaKwh: number | null;
      maxAbsoluteDailyDeltaKwh: number | null;
    };
    dailyRows?: Array<{
      date: string;
      actualKwh: number | null;
      simulatedKwh: number | null;
      deltaKwh: number | null;
      percentDelta: number | null;
      actualSource: "SMT" | "GREEN_BUTTON" | null;
      simulatedSource: "SIMULATED_MANUAL_CONSTRAINED" | null;
    }>;
  };
  diagnostics: {
    usedSourceActualTruth: true;
    usedLabSimulatedReadback: boolean;
    usedTestHomeAsTruth: false;
    globalValidationPolicyUsed: true;
    localGapFillSelectorUsed: false;
    seedPrepRun: false;
    pastSimRecalcDispatched: false;
    manualPayloadWritten: false;
    sourceHouseWritten: false;
    labHouseWritten: false;
    compareRun: true;
    productionScoringChanged: false;
    wapeChanged: false;
    compareOnlyNoSimulationMutation: true;
    sourceActualLoadedOnlyForCompare: true;
    labSimulatedLoadedFromArtifact: boolean;
    labRowsMutatedByCompare: false;
    diagnosticsV1Built: boolean;
    warnings: string[];
  };
  diagnosticsV1?: ManualGapfillCompareDiagnosticsV1;
  weatherDiagnostics?: ManualGapfillCompareDiagnosticsV1["weatherDiagnostics"];
  travelDiagnostics?: ManualGapfillCompareDiagnosticsV1["travelDiagnostics"];
  billPeriodAllocationDiagnostics?: ManualGapfillCompareDiagnosticsV1["billPeriodAllocationDiagnostics"];
  validationIntervalCurveDiagnostics?: ManualGapfillCompareDiagnosticsV1["validationIntervalCurveDiagnostics"];
  worstDayDiagnostics?: ManualGapfillCompareDiagnosticsV1["worstDayDiagnostics"];
  dashboardSummary?: ManualGapfillCompareDiagnosticsV1["dashboardSummary"];
};

const MANUAL_GAPFILL_COMPARE_ISOLATION_DIAGNOSTICS = {
  compareOnlyNoSimulationMutation: true as const,
  sourceActualLoadedOnlyForCompare: true as const,
  labRowsMutatedByCompare: false as const,
};

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function percentDelta(actual: number | null, simulated: number | null): number | null {
  if (actual == null || simulated == null || actual === 0) return null;
  return round2(((simulated - actual) / actual) * 100);
}

function deltaKwh(actual: number | null, simulated: number | null): number | null {
  if (actual == null || simulated == null) return null;
  return round2(simulated - actual);
}

function mapActualSourceKind(
  kind: string
): "SMT" | "GREEN_BUTTON" | "missing" | "ambiguous" {
  if (kind === "SMT" || kind === "GREEN_BUTTON" || kind === "missing" || kind === "ambiguous") {
    return kind;
  }
  return "missing";
}

function normalizeActualSourceLabel(
  kind: "SMT" | "GREEN_BUTTON" | "missing" | "ambiguous"
): "SMT" | "GREEN_BUTTON" | null {
  return kind === "SMT" || kind === "GREEN_BUTTON" ? kind : null;
}

function expectedPayloadMode(mode: ManualGapfillSeedMode): ManualUsagePayload["mode"] {
  return mode === "MONTHLY_FROM_SOURCE_INTERVALS" ? "MONTHLY" : "ANNUAL";
}

async function resolveLabPastScenarioId(args: {
  userId: string;
  labHouseId: string;
  scenarioId?: string | null;
}): Promise<string | null> {
  if (args.scenarioId && String(args.scenarioId).trim()) {
    return String(args.scenarioId).trim();
  }
  const row = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: {
        userId: args.userId,
        houseId: args.labHouseId,
        name: WORKSPACE_PAST_NAME,
        archivedAt: null,
      },
      select: { id: true },
    })
    .catch(() => null);
  return row?.id ? String(row.id) : null;
}

function buildFailureEnvelope(args: {
  status: ManualGapfillCompareStatus;
  mode: ManualGapfillSeedMode;
  sourceHouseId: string;
  labHouseId: string;
  policyHash: string;
  sourceContext?: ManualGapfillSourceContext | null;
  seedHash?: string | null;
  scenarioId?: string | null;
  artifactInputHash?: string | null;
  warnings: string[];
  usedLabSimulatedReadback?: boolean;
}): ManualGapfillCompareEnvelope {
  return {
    ok: false,
    status: args.status,
    mode: args.mode,
    identity: {
      sourceHouseId: args.sourceHouseId,
      labHouseId: args.labHouseId,
      actualContextHouseId: args.sourceHouseId,
      scenarioId: args.scenarioId ?? null,
      seedHash: args.seedHash ?? null,
      sourceIntervalFingerprint: args.sourceContext?.fingerprints.intervalFingerprint ?? null,
      sourceDailyFingerprint: args.sourceContext?.fingerprints.dailyFingerprint ?? null,
      sourceMonthlyFingerprint: args.sourceContext?.fingerprints.monthlyFingerprint ?? null,
      validationDayPolicyRevision:
        args.sourceContext?.validation.activeValidationDayPolicyRevision ?? PAST_VALIDATION_POLICY_REVISION,
      validationDayPolicyHash: args.policyHash,
      artifactInputHash: args.artifactInputHash ?? null,
      buildInputsHash: null,
    },
    sourceActual: {
      actualSourceKind: mapActualSourceKind(args.sourceContext?.actualSourceKind ?? "missing"),
      coverageStart: args.sourceContext?.coverage.coverageStart ?? null,
      coverageEnd: args.sourceContext?.coverage.coverageEnd ?? null,
      dailyCount: args.sourceContext?.actualData.dailyTotals?.length ?? null,
      intervalCount: args.sourceContext?.coverage.intervalCount ?? null,
      monthlyCount: args.sourceContext?.actualData.monthlyTotals?.length ?? null,
      annualTotalKwh: args.sourceContext?.actualData.annualTotal ?? null,
    },
    labSimulated: {
      coverageStart: null,
      coverageEnd: null,
      dailyRowCount: null,
      intervalCount: null,
      totalKwh: null,
      source: null,
      sourceDetail: null,
      intervalShape: null,
    },
    compare: {
      compareScope: "source_actual_vs_lab_simulated",
      compareBasis: args.mode === "ANNUAL_FROM_SOURCE_INTERVALS" ? "annual" : "bill_period",
      status: "not_available",
      actualTotalKwh: null,
      simulatedTotalKwh: null,
      deltaKwh: null,
      absoluteDeltaKwh: null,
      percentDelta: null,
    },
    diagnostics: {
      usedSourceActualTruth: true,
      usedLabSimulatedReadback: args.usedLabSimulatedReadback ?? false,
      usedTestHomeAsTruth: false,
      globalValidationPolicyUsed: true,
      localGapFillSelectorUsed: false,
      seedPrepRun: false,
      pastSimRecalcDispatched: false,
      manualPayloadWritten: false,
      sourceHouseWritten: false,
      labHouseWritten: false,
      compareRun: true,
      productionScoringChanged: false,
      wapeChanged: false,
      ...MANUAL_GAPFILL_COMPARE_ISOLATION_DIAGNOSTICS,
      labSimulatedLoadedFromArtifact: args.usedLabSimulatedReadback ?? false,
      diagnosticsV1Built: false,
      warnings: args.warnings,
    },
  };
}

export function buildManualGapfillMonthlyCompare(args: {
  readModel: ReturnType<typeof buildManualUsageReadModel>;
  actualSourceKind: "SMT" | "GREEN_BUTTON" | "missing" | "ambiguous";
}): NonNullable<ManualGapfillCompareEnvelope["compare"]["monthly"]> {
  const actualSource = normalizeActualSourceLabel(args.actualSourceKind);
  const rows: ManualGapfillCompareMonthlyRow[] = (args.readModel?.billPeriodCompare.rows ?? []).map((row) => {
    const actualKwh = row.actualIntervalTotalKwh == null ? null : round2(row.actualIntervalTotalKwh);
    const simulatedKwh =
      row.simulatedStatementTotalKwh == null ? null : round2(row.simulatedStatementTotalKwh);
    let status: ManualGapfillCompareMonthlyRow["status"] = "matched";
    if (!row.eligible) status = "excluded";
    else if (actualKwh == null) status = "missing_actual";
    else if (simulatedKwh == null) status = "missing_simulated";

    return {
      periodId: `${row.month}:${row.endDate}`,
      startDate: row.startDate,
      endDate: row.endDate,
      actualKwh,
      simulatedKwh,
      deltaKwh: deltaKwh(actualKwh, simulatedKwh),
      percentDelta: percentDelta(actualKwh, simulatedKwh),
      status,
      actualSource,
      simulatedSource: simulatedKwh == null ? null : "SIMULATED_MANUAL_CONSTRAINED",
    };
  });

  return {
    rowCount: rows.length,
    matchedCount: rows.filter((row) => row.status === "matched").length,
    missingActualCount: rows.filter((row) => row.status === "missing_actual").length,
    missingSimulatedCount: rows.filter((row) => row.status === "missing_simulated").length,
    rows,
  };
}

export function buildManualGapfillAnnualCompare(args: {
  readModel: ReturnType<typeof buildManualUsageReadModel>;
}): NonNullable<ManualGapfillCompareEnvelope["compare"]["annual"]> {
  const summary = args.readModel?.annualCompareSummary;
  const actualKwh = summary?.actualIntervalKwh == null ? null : round2(summary.actualIntervalKwh);
  const simulatedKwh = summary?.simulatedKwh == null ? null : round2(summary.simulatedKwh);
  return {
    actualKwh,
    simulatedKwh,
    deltaKwh: deltaKwh(actualKwh, simulatedKwh),
    percentDelta: percentDelta(actualKwh, simulatedKwh),
  };
}

export function buildManualGapfillDailyCompareSummary(args: {
  sourceDaily: Array<{ date: string; kwh: number }>;
  labDaily: Array<{ date: string; kwh: number }>;
  actualSourceKind: "SMT" | "GREEN_BUTTON" | "missing" | "ambiguous";
  includeDailyRows: boolean;
}): {
  dailySummary: NonNullable<ManualGapfillCompareEnvelope["compare"]["dailySummary"]>;
  dailyRows?: ManualGapfillCompareEnvelope["compare"]["dailyRows"];
} {
  const actualSource = normalizeActualSourceLabel(args.actualSourceKind);
  const actualByDate = new Map(args.sourceDaily.map((row) => [row.date.slice(0, 10), round2(row.kwh)]));
  const simByDate = new Map(args.labDaily.map((row) => [row.date.slice(0, 10), round2(row.kwh)]));
  const dates = Array.from(
    new Set(Array.from(actualByDate.keys()).concat(Array.from(simByDate.keys())))
  ).sort();

  const dailyRows: NonNullable<ManualGapfillCompareEnvelope["compare"]["dailyRows"]> = [];
  const absDeltas: number[] = [];
  let missingActualDayCount = 0;
  let missingSimulatedDayCount = 0;

  for (const date of dates) {
    const actualKwh = actualByDate.has(date) ? actualByDate.get(date)! : null;
    const simulatedKwh = simByDate.has(date) ? simByDate.get(date)! : null;
    if (actualKwh == null) missingActualDayCount += 1;
    if (simulatedKwh == null) missingSimulatedDayCount += 1;
    const rowDelta = deltaKwh(actualKwh, simulatedKwh);
    if (rowDelta != null) absDeltas.push(Math.abs(rowDelta));

    if (args.includeDailyRows) {
      dailyRows.push({
        date,
        actualKwh,
        simulatedKwh,
        deltaKwh: rowDelta,
        percentDelta: percentDelta(actualKwh, simulatedKwh),
        actualSource,
        simulatedSource: simulatedKwh == null ? null : "SIMULATED_MANUAL_CONSTRAINED",
      });
    }
  }

  const sortedAbs = [...absDeltas].sort((a, b) => a - b);
  const meanAbsoluteDailyDeltaKwh =
    absDeltas.length > 0 ? round2(absDeltas.reduce((sum, value) => sum + value, 0) / absDeltas.length) : null;
  const medianAbsoluteDailyDeltaKwh =
    sortedAbs.length === 0
      ? null
      : round2(
          sortedAbs.length % 2 === 1
            ? sortedAbs[(sortedAbs.length - 1) / 2]!
            : (sortedAbs[sortedAbs.length / 2 - 1]! + sortedAbs[sortedAbs.length / 2]!) / 2
        );
  const maxAbsoluteDailyDeltaKwh = sortedAbs.length > 0 ? round2(sortedAbs[sortedAbs.length - 1]!) : null;

  return {
    dailySummary: {
      comparedDayCount: dates.length,
      missingActualDayCount,
      missingSimulatedDayCount,
      meanAbsoluteDailyDeltaKwh,
      medianAbsoluteDailyDeltaKwh,
      maxAbsoluteDailyDeltaKwh,
    },
    dailyRows: args.includeDailyRows ? dailyRows : undefined,
  };
}

export function buildManualGapfillCompareEnvelope(args: {
  mode: ManualGapfillSeedMode;
  sourceContext: ManualGapfillSourceContext;
  labHouseId: string;
  sourceActualDataset: any;
  labDataset: any;
  labManualPayload: ManualUsagePayload;
  policyHash: string;
  scenarioId: string;
  seedHash: string;
  artifactInputHash: string | null;
  buildInputsHash: string | null;
  includeDailyRows: boolean;
  includeDiagnostics?: boolean;
  validationDayKeys?: string[];
  travelContext?: Parameters<typeof buildManualGapfillCompareDiagnosticsV1>[0]["travelContext"];
  warnings?: string[];
}): ManualGapfillCompareEnvelope {
  const warnings = [...(args.warnings ?? [])];
  const actualSourceKind = mapActualSourceKind(args.sourceContext.actualSourceKind);
  const readModel = buildManualUsageReadModel({
    payload: args.labManualPayload,
    dataset: args.labDataset,
    actualDataset: args.sourceActualDataset,
  });

  if (!readModel) {
    return buildFailureEnvelope({
      status: "compare_unavailable",
      mode: args.mode,
      sourceHouseId: args.sourceContext.sourceHouseId,
      labHouseId: args.labManualPayload ? "" : "",
      policyHash: args.policyHash,
      sourceContext: args.sourceContext,
      seedHash: args.seedHash,
      scenarioId: args.scenarioId,
      artifactInputHash: args.artifactInputHash,
      warnings: [...warnings, "Could not build manual compare read model from lab seed and artifact."],
      usedLabSimulatedReadback: true,
    });
  }

  const labSummary = args.labDataset?.summary ?? {};
  const labSimulated = {
    coverageStart: typeof labSummary.start === "string" ? labSummary.start.slice(0, 10) : null,
    coverageEnd: typeof labSummary.end === "string" ? labSummary.end.slice(0, 10) : null,
    dailyRowCount: Array.isArray(args.labDataset?.daily) ? args.labDataset.daily.length : null,
    intervalCount: Array.isArray(args.labDataset?.series?.intervals15)
      ? args.labDataset.series.intervals15.length
      : null,
    totalKwh: typeof labSummary.totalKwh === "number" ? round2(labSummary.totalKwh) : null,
    source: String(labSummary.source ?? "") === "SIMULATED" ? ("SIMULATED" as const) : null,
    sourceDetail:
      String(labSummary.sourceDetail ?? "") === "SIMULATED_MANUAL_CONSTRAINED"
        ? ("SIMULATED_MANUAL_CONSTRAINED" as const)
        : null,
    intervalShape: "estimated" as const,
  };

  const sourceSummary = args.sourceActualDataset?.summary ?? {};
  const sourceActual = {
    actualSourceKind,
    coverageStart: args.sourceContext.coverage.coverageStart,
    coverageEnd: args.sourceContext.coverage.coverageEnd,
    dailyCount: Array.isArray(args.sourceActualDataset?.daily) ? args.sourceActualDataset.daily.length : null,
    intervalCount: args.sourceContext.coverage.intervalCount ?? null,
    monthlyCount: Array.isArray(args.sourceActualDataset?.monthly)
      ? args.sourceActualDataset.monthly.length
      : null,
    annualTotalKwh: args.sourceContext.actualData.annualTotal,
  };

  const monthly =
    args.mode === "MONTHLY_FROM_SOURCE_INTERVALS"
      ? buildManualGapfillMonthlyCompare({ readModel, actualSourceKind })
      : undefined;
  const annual =
    args.mode === "ANNUAL_FROM_SOURCE_INTERVALS"
      ? buildManualGapfillAnnualCompare({ readModel })
      : undefined;

  const sourceDaily = Array.isArray(args.sourceActualDataset?.daily)
    ? args.sourceActualDataset.daily.map((row: any) => ({
        date: String(row.date).slice(0, 10),
        kwh: Number(row.kwh) || 0,
      }))
    : [];
  const labDaily = Array.isArray(args.labDataset?.daily)
    ? args.labDataset.daily.map((row: any) => ({
        date: String(row.date).slice(0, 10),
        kwh: Number(row.kwh) || 0,
      }))
    : [];
  const { dailySummary, dailyRows } = buildManualGapfillDailyCompareSummary({
    sourceDaily,
    labDaily,
    actualSourceKind,
    includeDailyRows: args.includeDailyRows,
  });

  const actualTotalKwh =
    typeof sourceSummary.totalKwh === "number"
      ? round2(sourceSummary.totalKwh)
      : sourceActual.annualTotalKwh;
  const simulatedTotalKwh = labSimulated.totalKwh;
  const totalDelta = deltaKwh(actualTotalKwh, simulatedTotalKwh);

  const compareBasis: ManualGapfillCompareEnvelope["compare"]["compareBasis"] =
    args.mode === "ANNUAL_FROM_SOURCE_INTERVALS"
      ? "annual"
      : args.includeDailyRows
        ? "mixed"
        : "bill_period";

  let compareStatus: ManualGapfillCompareEnvelope["compare"]["status"] = "not_available";
  if (monthly && monthly.rowCount > 0) {
    compareStatus =
      monthly.missingActualCount === 0 && monthly.missingSimulatedCount === 0 ? "pass" : "partial";
  } else if (annual && (annual.actualKwh != null || annual.simulatedKwh != null)) {
    compareStatus =
      annual.actualKwh != null && annual.simulatedKwh != null
        ? "pass"
        : annual.actualKwh == null || annual.simulatedKwh == null
          ? "partial"
          : "not_available";
  } else if (dailySummary.comparedDayCount > 0) {
    compareStatus =
      dailySummary.missingActualDayCount === 0 && dailySummary.missingSimulatedDayCount === 0
        ? "pass"
        : "partial";
  }

  const includeDiagnostics = args.includeDiagnostics !== false;
  const diagnosticsV1 =
    includeDiagnostics && args.includeDailyRows && dailyRows
      ? buildManualGapfillCompareDiagnosticsV1({
          dailyRows: dailyRows.map((row) => ({
            date: row.date,
            actualKwh: row.actualKwh,
            simulatedKwh: row.simulatedKwh,
            deltaKwh: row.deltaKwh,
            percentDelta: row.percentDelta,
          })),
          monthlyRows: monthly?.rows,
          readModel,
          validationDayKeys: args.validationDayKeys ?? [],
          sourceActualDataset: args.sourceActualDataset,
          labDataset: args.labDataset,
          labManualPayload: args.labManualPayload,
          travelContext: args.travelContext,
          timezone:
            typeof args.labDataset?.meta?.timezone === "string"
              ? args.labDataset.meta.timezone
              : typeof args.sourceActualDataset?.meta?.timezone === "string"
                ? args.sourceActualDataset.meta.timezone
                : null,
        })
      : undefined;

  return {
    ok: true,
    status: "ready",
    mode: args.mode,
    identity: {
      sourceHouseId: args.sourceContext.sourceHouseId,
      labHouseId: args.labHouseId,
      actualContextHouseId: args.sourceContext.sourceHouseId,
      scenarioId: args.scenarioId,
      seedHash: args.seedHash,
      sourceIntervalFingerprint: args.sourceContext.fingerprints.intervalFingerprint,
      sourceDailyFingerprint: args.sourceContext.fingerprints.dailyFingerprint,
      sourceMonthlyFingerprint: args.sourceContext.fingerprints.monthlyFingerprint,
      validationDayPolicyRevision: args.sourceContext.validation.activeValidationDayPolicyRevision,
      validationDayPolicyHash: args.policyHash,
      artifactInputHash: args.artifactInputHash,
      buildInputsHash: args.buildInputsHash,
    },
    sourceActual,
    labSimulated,
    compare: {
      compareScope: "source_actual_vs_lab_simulated",
      compareBasis,
      status: compareStatus,
      actualTotalKwh,
      simulatedTotalKwh,
      deltaKwh: totalDelta,
      absoluteDeltaKwh: totalDelta == null ? null : round2(Math.abs(totalDelta)),
      percentDelta: percentDelta(actualTotalKwh, simulatedTotalKwh),
      monthly,
      annual,
      dailySummary,
      dailyRows,
    },
    diagnostics: {
      usedSourceActualTruth: true,
      usedLabSimulatedReadback: true,
      usedTestHomeAsTruth: false,
      globalValidationPolicyUsed: true,
      localGapFillSelectorUsed: false,
      seedPrepRun: false,
      pastSimRecalcDispatched: false,
      manualPayloadWritten: false,
      sourceHouseWritten: false,
      labHouseWritten: false,
      compareRun: true,
      productionScoringChanged: false,
      wapeChanged: false,
      ...MANUAL_GAPFILL_COMPARE_ISOLATION_DIAGNOSTICS,
      labSimulatedLoadedFromArtifact: true,
      diagnosticsV1Built: Boolean(diagnosticsV1),
      warnings,
    },
    diagnosticsV1,
    weatherDiagnostics: diagnosticsV1?.weatherDiagnostics,
    travelDiagnostics: diagnosticsV1?.travelDiagnostics,
    billPeriodAllocationDiagnostics: diagnosticsV1?.billPeriodAllocationDiagnostics,
    validationIntervalCurveDiagnostics: diagnosticsV1?.validationIntervalCurveDiagnostics,
    worstDayDiagnostics: diagnosticsV1?.worstDayDiagnostics,
    dashboardSummary: diagnosticsV1?.dashboardSummary,
  };
}

export async function compareManualGapfillSourceActualToLabSim(
  args: ManualGapfillCompareArgs
): Promise<ManualGapfillCompareEnvelope> {
  const userId = String(args.userId ?? "").trim();
  const sourceHouseId = String(args.sourceHouseId ?? "").trim();
  const labHouseId = String(args.labHouseId ?? "").trim();
  const mode = args.mode;
  const includeDailyRows = args.includeDailyRows === true;
  const includeDiagnostics = args.includeDiagnostics !== false;
  const warnings: string[] = [];
  const activePolicy = await resolveActiveValidationDayPolicyLive({ surface: "admin_lab" });
  const policyHash = computeValidationDayPolicyHash(activePolicy);

  if (!userId || !sourceHouseId || !labHouseId) {
    return buildFailureEnvelope({
      status: "compare_failed",
      mode,
      sourceHouseId: sourceHouseId || "missing",
      labHouseId: labHouseId || "missing",
      policyHash,
      warnings: ["userId, sourceHouseId, and labHouseId are required."],
    });
  }

  if (labHouseId === sourceHouseId) {
    return buildFailureEnvelope({
      status: "compare_failed",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      warnings: ["labHouseId must differ from sourceHouseId."],
    });
  }

  if (args.expectedValidationDayPolicyHash && args.expectedValidationDayPolicyHash !== policyHash) {
    return buildFailureEnvelope({
      status: "policy_mismatch",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      warnings: ["Active validation-day policy hash does not match expectedValidationDayPolicyHash."],
    });
  }

  const manualRecord = await getManualUsageInputForUserHouse({ userId, houseId: labHouseId });
  const parsed = manualRecord.payload ? validateManualUsagePayload(manualRecord.payload) : null;
  const labManualPayload = parsed?.ok ? parsed.value : null;

  if (!labManualPayload || labManualPayload.mode !== expectedPayloadMode(mode)) {
    const seedHash = labManualPayload ? hashManualGapfillSavedSeedPayload(labManualPayload) : null;
    return buildFailureEnvelope({
      status: "compare_unavailable",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      seedHash,
      warnings: [
        labManualPayload
          ? `Lab manual seed mode ${labManualPayload.mode} does not match requested ${expectedPayloadMode(mode)}.`
          : "No saved lab manual seed found for compare hash/mode verification.",
      ],
    });
  }

  const seedHash = hashManualGapfillSavedSeedPayload(labManualPayload);

  if (args.expectedSeedHash && seedHash !== args.expectedSeedHash) {
    return buildFailureEnvelope({
      status: "seed_source_mismatch",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      seedHash,
      warnings: ["Saved lab manual seed hash does not match expectedSeedHash."],
    });
  }

  const sourceContext = await resolveManualGapfillSmtSourceContext({
    sourceHouseId,
    userId,
    esiid: args.esiid ?? null,
    includeDiagnostics: false,
  });

  if (
    sourceContext.status === "missing" ||
    sourceContext.status === "insufficient" ||
    sourceContext.status === "ambiguous" ||
    sourceContext.actualSourceKind === "missing" ||
    !sourceContext.diagnostics.sourceCoverageSufficient
  ) {
    return buildFailureEnvelope({
      status: "source_context_missing",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      sourceContext,
      seedHash,
      warnings: [...warnings, ...sourceContext.diagnostics.warnings],
    });
  }

  if (
    args.expectedSourceFingerprint &&
    args.expectedSourceFingerprint !== sourceContext.fingerprints.intervalFingerprint
  ) {
    return buildFailureEnvelope({
      status: "seed_source_mismatch",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      sourceContext,
      seedHash,
      warnings: ["Source interval fingerprint does not match expectedSourceFingerprint."],
    });
  }

  const scenarioId = await resolveLabPastScenarioId({
    userId,
    labHouseId,
    scenarioId: args.scenarioId ?? null,
  });
  if (!scenarioId) {
    return buildFailureEnvelope({
      status: "lab_readback_missing",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      sourceContext,
      seedHash,
      warnings: [...warnings, "Past (Corrected) scenario is missing for lab home."],
    });
  }

  const artifactRow = await (usagePrisma as any).pastSimulatedDatasetCache
    .findFirst({
      where: {
        houseId: labHouseId,
        scenarioId,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, inputHash: true, engineVersion: true },
    })
    .catch(() => null);

  const artifactInputHash = artifactRow?.inputHash ? String(artifactRow.inputHash) : null;

  if (args.expectedArtifactInputHash && artifactInputHash !== args.expectedArtifactInputHash) {
    return buildFailureEnvelope({
      status: "artifact_mismatch",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      sourceContext,
      seedHash,
      scenarioId,
      artifactInputHash,
      warnings: ["Lab artifact input hash does not match expectedArtifactInputHash."],
    });
  }

  const usageInputMode =
    mode === "MONTHLY_FROM_SOURCE_INTERVALS" ? "MANUAL_MONTHLY" : "MANUAL_ANNUAL";
  const labReadResult = await buildOnePathManualUsagePastSimReadResult({
    userId,
    houseId: labHouseId,
    scenarioId,
    readMode: "artifact_only",
    callerType: "gapfill_test",
    exactArtifactInputHash: (args.expectedArtifactInputHash ?? artifactInputHash) || undefined,
    requireExactArtifactMatch: Boolean(args.expectedArtifactInputHash ?? artifactInputHash),
    usageInputMode,
    validationPolicyOwner: "global_validation_day_policy_v1",
    artifactId: artifactRow?.id ? String(artifactRow.id) : null,
    artifactInputHash,
    artifactEngineVersion: artifactRow?.engineVersion ? String(artifactRow.engineVersion) : null,
    artifactPersistenceOutcome: "persisted_artifact_exact_read",
    manualUsagePayload: labManualPayload,
  });

  if (!labReadResult.ok) {
    return buildFailureEnvelope({
      status: "lab_readback_missing",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      sourceContext,
      seedHash,
      scenarioId,
      artifactInputHash,
      warnings: [
        ...warnings,
        String(labReadResult.failureCode ?? labReadResult.error ?? "lab_readback_missing"),
      ],
    });
  }

  const labDataset = labReadResult.dataset;
  if (!labDataset) {
    return buildFailureEnvelope({
      status: "lab_readback_missing",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      sourceContext,
      seedHash,
      scenarioId,
      artifactInputHash,
      warnings: [...warnings, "Lab simulated artifact dataset was not available."],
      usedLabSimulatedReadback: true,
    });
  }

  const resolvedArtifactInputHash =
    artifactInputHash ??
    (typeof labDataset?.meta?.artifactInputHash === "string" ? labDataset.meta.artifactInputHash : null);

  const buildRow = await (prisma as any).usageSimulatorBuild
    .findUnique({
      where: {
        userId_houseId_scenarioKey: { userId, houseId: labHouseId, scenarioKey: scenarioId },
      },
      select: { buildInputsHash: true },
    })
    .catch(() => null);

  const sourceActualResult = await loadManualGapfillSourceActualDataset({
    userId,
    sourceHouseId,
    esiid: args.esiid ?? sourceContext.esiid,
    preferredActualSource: sourceContext.actualSource ?? sourceContext.committedUsageSource ?? null,
  });

  if (
    sourceActualResult.actualContextHouseId !== sourceHouseId ||
    sourceActualResult.onePathUpstreamOwner !== "resolveOnePathUpstreamUsageTruthForSimulation"
  ) {
    return buildFailureEnvelope({
      status: "compare_failed",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      sourceContext,
      seedHash,
      scenarioId,
      artifactInputHash: resolvedArtifactInputHash,
      warnings: [
        ...warnings,
        "Source actual dataset owner did not resolve through One Path upstream usage truth.",
      ],
      usedLabSimulatedReadback: true,
    });
  }

  if (!sourceActualResult.dataset) {
    return buildFailureEnvelope({
      status: "source_context_missing",
      mode,
      sourceHouseId,
      labHouseId,
      policyHash,
      sourceContext,
      seedHash,
      scenarioId,
      artifactInputHash: resolvedArtifactInputHash,
      warnings: [...warnings, "Source actual usage dataset could not be loaded for compare."],
      usedLabSimulatedReadback: true,
    });
  }

  const validationSelection = await resolveGlobalValidationDayKeysForPastSim({
    houseId: labHouseId,
    userId,
    esiid: args.esiid ?? sourceContext.esiid,
    sourceHouseId,
    surface: "admin_lab",
  }).catch(() => ({ validationOnlyDateKeysLocal: [] as string[] }));

  const labDbTravelRanges = await readTravelRangesForHouse({ userId, houseId: labHouseId }).catch(() => []);
  const sourceFallbackTravelRanges = await readTravelRangesForHouse({
    userId: sourceContext.userId,
    houseId: sourceHouseId,
  }).catch(() => []);
  const seedPayloadTravelRanges = normalizeManualGapfillTravelRanges(labManualPayload.travelRanges);
  const effectiveTravelRanges =
    labDbTravelRanges.length > 0
      ? labDbTravelRanges
      : seedPayloadTravelRanges.length > 0
        ? seedPayloadTravelRanges
        : sourceFallbackTravelRanges;

  const envelope = buildManualGapfillCompareEnvelope({
    mode,
    sourceContext,
    labHouseId,
    sourceActualDataset: sourceActualResult.dataset!,
    labDataset,
    labManualPayload,
    policyHash,
    scenarioId,
    seedHash,
    artifactInputHash: resolvedArtifactInputHash,
    buildInputsHash: buildRow?.buildInputsHash ? String(buildRow.buildInputsHash) : null,
    includeDailyRows,
    includeDiagnostics,
    validationDayKeys: validationSelection.validationOnlyDateKeysLocal,
    travelContext: {
      effectiveRanges: effectiveTravelRanges,
      labDbRanges: labDbTravelRanges,
      sourceFallbackRanges: sourceFallbackTravelRanges,
      seedPayloadRanges: seedPayloadTravelRanges,
    },
    warnings,
  });

  return envelope;
}

function normalizeManualGapfillTravelRanges(
  ranges: ManualUsagePayload["travelRanges"] | undefined | null
): ManualUsagePayload["travelRanges"] {
  return (ranges ?? [])
    .map((range) => ({
      startDate: String(range.startDate ?? "").slice(0, 10),
      endDate: String(range.endDate ?? "").slice(0, 10),
    }))
    .filter((range) => /^\d{4}-\d{2}-\d{2}$/.test(range.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(range.endDate));
}
