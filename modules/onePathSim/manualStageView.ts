import {
  buildManualUsageReadModel,
  buildManualStageOnePresentationFromReadModel,
  type ManualAnnualCompareSummary,
  type ManualBillPeriodCompare,
  type ManualMonthlyCompareRow,
  type ManualStageOnePresentationFromReadModel,
} from "@/modules/onePathSim/manualReadModel";
import {
  buildManualBillPeriodTargets,
  resolveManualStageOnePresentation,
  type ManualBillPeriodTarget,
  type ManualStageOnePresentation,
} from "@/modules/onePathSim/manualStatementRanges";
import type { ManualUsagePayload } from "@/modules/onePathSim/simulatedUsage/types";

export type OnePathManualStageOneView = {
  mode: "MONTHLY" | "ANNUAL";
  source: "saved_payload_preview" | "artifact_backed_read_model";
  anchorEndDate: string | null;
  billEndDay: string | null;
  dateSourceMode: string | null;
  travelRanges: Array<{ startDate: string; endDate: string }>;
  eligibleBillPeriodCount: number;
  excludedBillPeriodCount: number;
  billPeriodTargets: ManualBillPeriodTarget[];
  stageOnePresentation: ManualStageOnePresentation | ManualStageOnePresentationFromReadModel;
  billPeriodCompare: ManualBillPeriodCompare | null;
  monthlyCompareRows: ManualMonthlyCompareRow[];
  annualCompareSummary: ManualAnnualCompareSummary | null;
};

function normalizeTravelRanges(value: unknown): Array<{ startDate: string; endDate: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => ({
      startDate: String((row as any)?.startDate ?? "").slice(0, 10),
      endDate: String((row as any)?.endDate ?? "").slice(0, 10),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(row.endDate));
}

function buildBaseView(args: {
  payload: ManualUsagePayload;
  source: OnePathManualStageOneView["source"];
  stageOnePresentation: OnePathManualStageOneView["stageOnePresentation"];
  billPeriodTargets: ManualBillPeriodTarget[];
  billPeriodCompare: ManualBillPeriodCompare | null;
  monthlyCompareRows: ManualMonthlyCompareRow[];
  annualCompareSummary: ManualAnnualCompareSummary | null;
}): OnePathManualStageOneView {
  const payloadMode = args.payload.mode === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  const billPeriodTargets = args.billPeriodTargets;
  const eligibleBillPeriodCount = billPeriodTargets.filter((row) => row.eligibleForConstraint).length;
  return {
    mode: payloadMode,
    source: args.source,
    anchorEndDate: String(args.payload.anchorEndDate ?? "").slice(0, 10) || null,
    billEndDay:
      payloadMode === "MONTHLY" ? String(args.payload.anchorEndDate ?? "").slice(8, 10) || null : null,
    dateSourceMode:
      payloadMode === "MONTHLY" && typeof (args.payload as any).dateSourceMode === "string"
        ? String((args.payload as any).dateSourceMode)
        : null,
    travelRanges: normalizeTravelRanges(args.payload.travelRanges),
    eligibleBillPeriodCount,
    excludedBillPeriodCount: Math.max(0, billPeriodTargets.length - eligibleBillPeriodCount),
    billPeriodTargets,
    stageOnePresentation: args.stageOnePresentation,
    billPeriodCompare: args.billPeriodCompare,
    monthlyCompareRows: args.monthlyCompareRows,
    annualCompareSummary: args.annualCompareSummary,
  };
}

export function buildOnePathManualStageOnePreview(
  payload: ManualUsagePayload | null | undefined
): OnePathManualStageOneView | null {
  if (!payload) return null;
  const stageOnePresentation = resolveManualStageOnePresentation({
    surface: "admin_manual_monthly_stage_one",
    payload,
  });
  if (!stageOnePresentation) return null;
  return buildBaseView({
    payload,
    source: "saved_payload_preview",
    stageOnePresentation,
    billPeriodTargets: buildManualBillPeriodTargets(payload),
    billPeriodCompare: null,
    monthlyCompareRows: [],
    annualCompareSummary: null,
  });
}

export function buildOnePathManualStageOneView(args: {
  payload: ManualUsagePayload | null | undefined;
  dataset: any;
  actualDataset?: any;
}): OnePathManualStageOneView | null {
  if (!args.payload) return null;
  const manualReadModel = buildManualUsageReadModel({
    payload: args.payload,
    dataset: args.dataset,
    actualDataset: args.actualDataset,
  });
  const stageOnePresentation = buildManualStageOnePresentationFromReadModel({
    readModel: manualReadModel,
  });
  if (!manualReadModel || !stageOnePresentation) {
    return buildOnePathManualStageOnePreview(args.payload);
  }
  return buildBaseView({
    payload: args.payload,
    source: "artifact_backed_read_model",
    stageOnePresentation,
    billPeriodTargets: manualReadModel.billPeriodTargets,
    billPeriodCompare: manualReadModel.billPeriodCompare,
    monthlyCompareRows: manualReadModel.monthlyCompareRows,
    annualCompareSummary: manualReadModel.annualCompareSummary,
  });
}
