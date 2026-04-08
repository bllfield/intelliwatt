type MonthlyTotalRow = { month?: string | null; kwh?: number | null };

export type GapfillManualMonthlyCompareRow = {
  month: string;
  actualIntervalKwh: number;
  stageOneTargetKwh: number;
  simulatedKwh: number;
  simulatedVsActualDeltaKwh: number;
  simulatedVsTargetDeltaKwh: number;
  targetVsActualDeltaKwh: number;
};

export type GapfillManualAnnualCompareSummary = {
  actualIntervalKwh: number;
  stageOneTargetKwh: number;
  simulatedKwh: number;
  simulatedVsActualDeltaKwh: number;
  simulatedVsTargetDeltaKwh: number;
  targetVsActualDeltaKwh: number;
};

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeMonthlyTotals(rows: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(rows)) return out;
  for (const row of rows as MonthlyTotalRow[]) {
    const month = String(row?.month ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    out[month] = round2(Number(row?.kwh ?? 0) || 0);
  }
  return out;
}

export function buildGapfillManualMonthlyCompareRows(args: {
  actualMonthlyTotals: unknown;
  stageOneMonthlyTotalsKwhByMonth: Record<string, number> | null | undefined;
  simulatedMonthlyTotals: unknown;
}): GapfillManualMonthlyCompareRow[] {
  const actualByMonth = normalizeMonthlyTotals(args.actualMonthlyTotals);
  const simulatedByMonth = normalizeMonthlyTotals(args.simulatedMonthlyTotals);
  const stageOneByMonth = Object.fromEntries(
    Object.entries(args.stageOneMonthlyTotalsKwhByMonth ?? {})
      .filter(([month]) => /^\d{4}-\d{2}$/.test(month))
      .map(([month, value]) => [month, round2(Number(value) || 0)])
  );
  const months = Array.from(
    new Set([...Object.keys(actualByMonth), ...Object.keys(stageOneByMonth), ...Object.keys(simulatedByMonth)])
  ).sort();
  return months.map((month) => {
    const actualIntervalKwh = actualByMonth[month] ?? 0;
    const stageOneTargetKwh = stageOneByMonth[month] ?? 0;
    const simulatedKwh = simulatedByMonth[month] ?? 0;
    return {
      month,
      actualIntervalKwh,
      stageOneTargetKwh,
      simulatedKwh,
      simulatedVsActualDeltaKwh: round2(simulatedKwh - actualIntervalKwh),
      simulatedVsTargetDeltaKwh: round2(simulatedKwh - stageOneTargetKwh),
      targetVsActualDeltaKwh: round2(stageOneTargetKwh - actualIntervalKwh),
    };
  });
}

export function buildGapfillManualAnnualCompareSummary(args: {
  actualMonthlyTotals: unknown;
  stageOneAnnualTotalKwh: number | null | undefined;
  simulatedMonthlyTotals: unknown;
}): GapfillManualAnnualCompareSummary {
  const actualIntervalKwh = round2(
    Object.values(normalizeMonthlyTotals(args.actualMonthlyTotals)).reduce((sum, value) => sum + value, 0)
  );
  const simulatedKwh = round2(
    Object.values(normalizeMonthlyTotals(args.simulatedMonthlyTotals)).reduce((sum, value) => sum + value, 0)
  );
  const stageOneTargetKwh = round2(Number(args.stageOneAnnualTotalKwh ?? 0) || 0);
  return {
    actualIntervalKwh,
    stageOneTargetKwh,
    simulatedKwh,
    simulatedVsActualDeltaKwh: round2(simulatedKwh - actualIntervalKwh),
    simulatedVsTargetDeltaKwh: round2(simulatedKwh - stageOneTargetKwh),
    targetVsActualDeltaKwh: round2(stageOneTargetKwh - actualIntervalKwh),
  };
}
