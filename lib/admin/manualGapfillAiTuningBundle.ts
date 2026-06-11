import type { ManualGapfillSeedMode } from "@/lib/admin/manualGapfillClient";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  buildTravelRangeExportClassification,
  extractValidationDayIntervalSeries,
  extractValidationDayKeysFromPolicySnapshot,
  resolveManualGapfillStoredTravelRangesForExport,
  type ExportDeploymentMetadata,
} from "@/lib/admin/aiTuningBundleHelpers";
import { buildSimulationCodeMap } from "@/lib/admin/simulationCodeMap";

type StepState<T> = {
  identityKey: string;
  data: T;
} | null;

function serializeStep(step: StepState<Record<string, unknown>>, stepId: string, isStale: (step: StepState<unknown> | null) => boolean) {
  if (!step) return null;
  return {
    stepId,
    identityKey: step.identityKey,
    stale: isStale(step),
    response: step.data,
  };
}

export function buildManualGapfillAiTuningBundle(args: {
  identityKey: string;
  userEmail: string;
  userId: string;
  sourceHouseId: string;
  labHouseId: string;
  mode: ManualGapfillSeedMode;
  esiid: string;
  includeDiagnostics: boolean;
  anchorEndDate: string;
  includeDailyRows: boolean;
  policySnapshot: Record<string, unknown> | null;
  step1: StepState<Record<string, unknown>>;
  step2Preview: StepState<Record<string, unknown>>;
  step3: StepState<Record<string, unknown>>;
  step4: StepState<Record<string, unknown>>;
  step5: StepState<Record<string, unknown>>;
  isStepStale: (step: StepState<unknown> | null) => boolean;
  deployment?: ExportDeploymentMetadata | null;
}): Record<string, unknown> {
  const step1 = args.step1?.data ?? null;
  const step2 = args.step2Preview?.data ?? null;
  const step3 = args.step3?.data ?? null;
  const step4 = args.step4?.data ?? null;
  const step5 = args.step5?.data ?? null;
  const step5Record = asRecord(step5);
  const compare = asRecord(step5Record.compare);
  const sourceActual = asRecord(step5Record.sourceActual);
  const labSimulated = asRecord(step5Record.labSimulated);
  const diagnosticsV1 = asRecord(step5Record.diagnosticsV1);
  const validationDayKeys = extractValidationDayKeysFromPolicySnapshot(args.policySnapshot ?? step2);
  const coverageWindowRaw = asRecord(asRecord(step1).coverage);
  const coverageWindow =
    asString(coverageWindowRaw.coverageStart) && asString(coverageWindowRaw.coverageEnd)
      ? {
          startDate: asString(coverageWindowRaw.coverageStart)!,
          endDate: asString(coverageWindowRaw.coverageEnd)!,
        }
      : null;
  const travelContext = step5Record.travelContext ?? asRecord(compare).travelContext ?? null;
  const storedTravelRanges = resolveManualGapfillStoredTravelRangesForExport({
    step1TravelRanges: asRecord(step1).travelRanges,
    step4ReadbackTravelRanges: asRecord(asRecord(step4).readback).travelRanges,
    travelContext,
  });

  const dailyRows = asArray(compare.dailyRows);
  const validationIntervalCurveDiagnostics =
    step5Record.validationIntervalCurveDiagnostics ?? diagnosticsV1.validationIntervalCurveDiagnostics ?? null;

  return {
    purpose:
      "Structured Manual GapFill Lab AI tuning bundle for simulation accuracy review, miss identification, and targeted tuning recommendations.",
    bundleVersion: "manual-gapfill-ai-tuning-bundle-v1",
    exportedAt: new Date().toISOString(),
    workflow: "manual_gapfill_lab_mg1_mg5",
    identity: {
      identityKey: args.identityKey,
      userEmail: args.userEmail.trim() || null,
      userId: args.userId.trim() || null,
      sourceHouseId: args.sourceHouseId.trim() || null,
      labHouseId: args.labHouseId.trim() || null,
      mode: args.mode,
      esiid: args.esiid.trim() || null,
      actualContextHouseId: asString(asRecord(step1).sourceHouseId) ?? args.sourceHouseId,
      sourceKind: asString(asRecord(step1).actualSourceKind) ?? "SMT",
    },
    options: {
      includeDiagnostics: args.includeDiagnostics,
      includeDailyRows: args.includeDailyRows,
      anchorEndDate: args.anchorEndDate.trim() || null,
    },
    steps: {
      mg1_sourceContext: serializeStep(args.step1, "MG-1", args.isStepStale),
      mg2_validationPolicy: serializeStep(args.step2Preview, "MG-2", args.isStepStale),
      mg3_seed: serializeStep(args.step3, "MG-3", args.isStepStale),
      mg4_runReadback: serializeStep(args.step4, "MG-4", args.isStepStale),
      mg5_compare: serializeStep(args.step5, "MG-5", args.isStepStale),
    },
    totals: {
      sourceActualKwh: asNumber(compare.actualTotalKwh ?? sourceActual.totalKwh),
      labSimulatedKwh: asNumber(compare.simulatedTotalKwh ?? labSimulated.totalKwh),
      deltaKwh: asNumber(compare.deltaKwh),
      percentDelta: asNumber(compare.percentDelta),
    },
    sourceActualDailyRows: dailyRows.map((row) => ({
      ...asRecord(row),
      role: "source_actual",
    })),
    labSimulatedDailyRows: dailyRows.map((row) => ({
      date: asString(asRecord(row).date),
      simulatedKwh: asNumber(asRecord(row).simulatedKwh),
      deltaKwh: asNumber(asRecord(row).deltaKwh),
      percentDelta: asNumber(asRecord(row).percentDelta),
      role: "lab_simulated",
    })),
    selectedValidationDateKeys: validationDayKeys,
    validationDayIntervalSeries: extractValidationDayIntervalSeries({
      actualDataset: step5Record.sourceActualDataset ?? null,
      simulatedDataset: step5Record.labDataset ?? null,
      validationDayKeys,
    }),
    diagnostics: {
      dailyWeatherMissDiagnostics: diagnosticsV1.dailyWeatherMissDiagnostics ?? null,
      weatherDiagnostics: step5Record.weatherDiagnostics ?? diagnosticsV1.weatherDiagnostics ?? null,
      travelDiagnostics: step5Record.travelDiagnostics ?? diagnosticsV1.travelDiagnostics ?? null,
      billPeriodAllocationDiagnostics:
        step5Record.billPeriodAllocationDiagnostics ?? diagnosticsV1.billPeriodAllocationDiagnostics ?? null,
      validationIntervalCurveDiagnostics,
      worstDayDiagnostics: step5Record.worstDayDiagnostics ?? diagnosticsV1.worstDayDiagnostics ?? null,
      dashboardSummary: step5Record.dashboardSummary ?? diagnosticsV1.dashboardSummary ?? null,
    },
    travelClassification: buildTravelRangeExportClassification({
      storedTravelRanges,
      coverageWindow,
    }),
    isolationGuardrails: {
      ...(asRecord(step5Record.diagnostics)),
      manualRunIsolation: asString(asRecord(step4).manualRunIsolation) ?? "manual_totals_only",
      localGapFillSelectorUsed: false,
      sourceActualPassedIntoManualSimulator: false,
      travelShouldReduceManualSim: false,
      manualSimExpectedToEstimateNormalCounterfactualUsage: true,
      travelActualMarkedNonRepresentative: true,
    },
    simulationCodeMap: buildSimulationCodeMap({
      surface: "manual_gapfill_lab",
      deployment: args.deployment ?? null,
    }),
  };
}
