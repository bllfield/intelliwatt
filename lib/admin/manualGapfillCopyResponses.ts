import type { ManualGapfillSeedMode } from "@/lib/admin/manualGapfillClient";

type StepState<T> = {
  identityKey: string;
  data: T;
} | null;

export function buildManualGapfillAllResponsesPayload(args: {
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
  persistSeedToggle: boolean;
  persistedSeedInSession: boolean;
  status: string | null;
  error: string | null;
  identityNotice: string | null;
  policySnapshot: Record<string, unknown> | null;
  step1: StepState<Record<string, unknown>>;
  step2Preview: StepState<Record<string, unknown>>;
  step3: StepState<Record<string, unknown>>;
  step4: StepState<Record<string, unknown>>;
  step5: StepState<Record<string, unknown>>;
  isStepStale: (step: StepState<unknown> | null) => boolean;
}): Record<string, unknown> {
  const serializeStep = (step: StepState<Record<string, unknown>>, stepId: string) => {
    if (!step) return null;
    return {
      stepId,
      identityKey: step.identityKey,
      stale: args.isStepStale(step),
      response: step.data,
    };
  };

  const step5Response = args.step5?.data ?? null;
  const step5Record = step5Response && typeof step5Response === "object" ? step5Response : null;

  return {
    exportedAt: new Date().toISOString(),
    workflow: "manual_gapfill_lab_mg1_mg5",
    identityKey: args.identityKey,
    identity: {
      userEmail: args.userEmail.trim() || null,
      userId: args.userId.trim() || null,
      sourceHouseId: args.sourceHouseId.trim() || null,
      labHouseId: args.labHouseId.trim() || null,
      mode: args.mode,
      esiid: args.esiid.trim() || null,
    },
    options: {
      includeDiagnostics: args.includeDiagnostics,
      anchorEndDate: args.anchorEndDate.trim() || null,
      includeDailyRows: args.includeDailyRows,
      persistSeedToggle: args.persistSeedToggle,
      persistedSeedInSession: args.persistedSeedInSession,
    },
    ui: {
      status: args.status,
      error: args.error,
      identityNotice: args.identityNotice,
    },
    validationDayPolicySnapshot: args.policySnapshot,
    steps: {
      step1_sourceContext: serializeStep(args.step1, "step1_sourceContext"),
      step2_validationPolicyPreview: serializeStep(args.step2Preview, "step2_validationPolicyPreview"),
      step3_prepareSeed: serializeStep(args.step3, "step3_prepareSeed"),
      step4_runReadback: serializeStep(args.step4, "step4_runReadback"),
      step5_compare: serializeStep(args.step5, "step5_compare"),
    },
    compareExport: step5Record
      ? {
          fullResponse: step5Record,
          diagnosticsV1: step5Record.diagnosticsV1 ?? null,
          weatherDiagnostics: step5Record.weatherDiagnostics ?? null,
          travelDiagnostics: step5Record.travelDiagnostics ?? null,
          billPeriodAllocationDiagnostics: step5Record.billPeriodAllocationDiagnostics ?? null,
          validationIntervalCurveDiagnostics: step5Record.validationIntervalCurveDiagnostics ?? null,
          worstDayDiagnostics: step5Record.worstDayDiagnostics ?? null,
          dashboardSummary: step5Record.dashboardSummary ?? null,
          compareDiagnostics: step5Record.diagnostics ?? null,
        }
      : null,
    copyMeta: {
      includesAllStepResponses: Boolean(
        args.step1 || args.step2Preview || args.step3 || args.step4 || args.step5
      ),
      includesCompareDiagnosticsV1: Boolean(step5Record?.diagnosticsV1),
      includesCompareTopLevelDiagnostics: Boolean(
        step5Record?.weatherDiagnostics ||
          step5Record?.travelDiagnostics ||
          step5Record?.validationIntervalCurveDiagnostics ||
          step5Record?.worstDayDiagnostics
      ),
    },
  };
}

export function buildGapfillLabPageAllResponsesPayload(args: {
  manualGapfillLab: Record<string, unknown> | null;
  requestDebug: unknown[];
  result: unknown;
  pastSimSnapshot: Record<string, unknown> | null;
  pageUi: {
    error: string | null;
    loading: boolean;
    lastHttpStatus: number | null;
    lastFailureFields: unknown;
  };
}): Record<string, unknown> {
  return {
    exportedAt: new Date().toISOString(),
    page: "gapfill-lab",
    manualGapfillLab: args.manualGapfillLab,
    legacyGapfillRuns: {
      stepRequestResponses: args.requestDebug,
      canonicalRecalcResult: args.result ?? null,
      sourceHomePastSimSnapshot: args.pastSimSnapshot ?? null,
    },
    pageUi: args.pageUi,
  };
}
