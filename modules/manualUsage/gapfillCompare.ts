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
  actualDataset?: any;
}): GapfillManualMonthlyCompareRow[] {
  const readModel = args.manualReadModel;
  if (!readModel || readModel.payloadMode !== "MONTHLY") return [];
  return readModel.billPeriodCompare.rows.map((row) => {
    const actualIntervalKwh = row.actualIntervalTotalKwh == null ? null : round2(row.actualIntervalTotalKwh);
    const stageOneTargetKwh = round2(row.stageOneTargetTotalKwh ?? 0);
    const simulatedKwh = round2(row.simulatedStatementTotalKwh ?? 0);
    return {
      month: row.month,
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
  actualDataset?: any;
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
      simulatedVsActualDeltaKwh: subtractRounded(simulatedKwh, actualIntervalKwh),
      simulatedVsTargetDeltaKwh: round2(simulatedKwh - stageOneTargetKwh),
      targetVsActualDeltaKwh: subtractRounded(stageOneTargetKwh, actualIntervalKwh),
    }
  );
}
