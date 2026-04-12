type MonthlyRowLike = {
  month?: string | null;
  kwh?: number | null;
};

type StitchedMonthLike = {
  yearMonth?: string | null;
  borrowedFromYearMonth?: string | null;
};

type MonthlyDatasetLike = {
  monthly?: MonthlyRowLike[] | null;
  insights?: {
    stitchedMonth?: StitchedMonthLike | null;
  } | null;
} | null | undefined;

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function buildMonthlyTotalsByMonth(rows: MonthlyRowLike[] | null | undefined): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const month = String(row?.month ?? "").slice(0, 7);
    const kwh = Number(row?.kwh ?? Number.NaN);
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(kwh)) continue;
    totals.set(month, round2((totals.get(month) ?? 0) + kwh));
  }
  return totals;
}

export function buildGapfillCompareMonthlyTotals(dataset: MonthlyDatasetLike): Map<string, number> {
  const totals = buildMonthlyTotalsByMonth(dataset?.monthly);
  const stitchedMonth = dataset?.insights?.stitchedMonth;
  const yearMonth = String(stitchedMonth?.yearMonth ?? "").slice(0, 7);
  const borrowedFromYearMonth = String(stitchedMonth?.borrowedFromYearMonth ?? "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(yearMonth) || !/^\d{4}-\d{2}$/.test(borrowedFromYearMonth) || yearMonth === borrowedFromYearMonth) {
    return totals;
  }
  if (!totals.has(yearMonth) && !totals.has(borrowedFromYearMonth)) {
    return totals;
  }
  totals.set(yearMonth, round2((totals.get(yearMonth) ?? 0) + (totals.get(borrowedFromYearMonth) ?? 0)));
  totals.delete(borrowedFromYearMonth);
  return totals;
}

export function buildActualVsTestMonthlyRows(args: {
  actualDataset: MonthlyDatasetLike;
  testDataset: MonthlyDatasetLike;
}) {
  const actualMonthly = buildGapfillCompareMonthlyTotals(args.actualDataset);
  const testMonthly = buildGapfillCompareMonthlyTotals(args.testDataset);
  const allMonths = Array.from(new Set([...Array.from(actualMonthly.keys()), ...Array.from(testMonthly.keys())]))
    .filter((value) => /^\d{4}-\d{2}$/.test(value))
    .sort();
  return allMonths.map((month) => {
    const actual = round2(actualMonthly.get(month) ?? 0);
    const test = round2(testMonthly.get(month) ?? 0);
    return {
      month,
      actual,
      test,
      delta: round2(test - actual),
    };
  });
}
