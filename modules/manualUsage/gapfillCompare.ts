import type {
  ManualAnnualCompareSummary as GapfillManualAnnualCompareSummary,
  ManualMonthlyCompareRow as GapfillManualMonthlyCompareRow,
  ManualUsageReadModel,
} from "@/modules/manualUsage/readModel";

export type { GapfillManualAnnualCompareSummary, GapfillManualMonthlyCompareRow };

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function subtractRounded(left: number | null, right: number | null): number | null {
  return left == null || right == null ? null : round2(left - right);
}

export function buildGapfillManualMonthlyCompareRows(args: {
  manualReadModel: ManualUsageReadModel | null | undefined;
}): GapfillManualMonthlyCompareRow[] {
  const readModel = args.manualReadModel;
  if (!readModel || readModel.payloadMode !== "MONTHLY") return [];
  return readModel.billPeriodCompare.rows.map((row) => {
    const actualIntervalKwh = row.actualIntervalTotalKwh == null ? null : round2(row.actualIntervalTotalKwh);
    const stageOneTargetKwh = round2(row.stageOneTargetTotalKwh ?? 0);
    const simulatedKwh = round2(row.simulatedStatementTotalKwh ?? 0);
    return {
      month: row.month,
      label: `${row.startDate} - ${row.endDate}`,
      eligible: row.eligible,
      parityRequirement: row.parityRequirement,
      status: row.status,
      reason: row.reason,
      actualIntervalKwh,
      stageOneTargetKwh,
      simulatedKwh,
      simulatedVsActualDeltaKwh: subtractRounded(simulatedKwh, actualIntervalKwh),
      simulatedVsTargetDeltaKwh: round2(simulatedKwh - stageOneTargetKwh),
      targetVsActualDeltaKwh: subtractRounded(stageOneTargetKwh, actualIntervalKwh),
    };
  });
}

export function buildGapfillManualAnnualCompareSummary(args: {
  manualReadModel: ManualUsageReadModel | null | undefined;
}): GapfillManualAnnualCompareSummary {
  const readModel = args.manualReadModel;
  if (!readModel || readModel.payloadMode !== "ANNUAL") {
    return {
      actualIntervalKwh: null,
      stageOneTargetKwh: 0,
      simulatedKwh: 0,
      simulatedVsActualDeltaKwh: null,
      simulatedVsTargetDeltaKwh: 0,
      targetVsActualDeltaKwh: null,
    };
  }
  const actualIntervalKwh =
    readModel.annualCompareSummary?.actualIntervalKwh == null ? null : round2(readModel.annualCompareSummary.actualIntervalKwh);
  const stageOneTargetKwh = round2(readModel.annualCompareSummary?.stageOneTargetKwh ?? 0);
  const simulatedKwh = round2(readModel.annualCompareSummary?.simulatedKwh ?? 0);
  return (
    {
      actualIntervalKwh,
      stageOneTargetKwh,
      simulatedKwh,
      eligible: Boolean(readModel.billPeriodCompare.rows[0]?.eligible),
      parityRequirement: readModel.billPeriodCompare.rows[0]?.parityRequirement ?? "excluded_missing_input",
      status: readModel.billPeriodCompare.rows[0]?.status ?? "sim_result_unavailable",
      reason: readModel.billPeriodCompare.rows[0]?.reason ?? null,
      simulatedVsActualDeltaKwh: subtractRounded(simulatedKwh, actualIntervalKwh),
      simulatedVsTargetDeltaKwh: round2(simulatedKwh - stageOneTargetKwh),
      targetVsActualDeltaKwh: subtractRounded(stageOneTargetKwh, actualIntervalKwh),
    }
  );
}
