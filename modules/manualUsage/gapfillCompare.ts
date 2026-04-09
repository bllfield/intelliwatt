import type {
  ManualAnnualCompareSummary as GapfillManualAnnualCompareSummary,
  ManualMonthlyCompareRow as GapfillManualMonthlyCompareRow,
  ManualUsageReadModel,
} from "@/modules/manualUsage/readModel";

export type { GapfillManualAnnualCompareSummary, GapfillManualMonthlyCompareRow };

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dateKeyInTimezone(timestamp: string, timezone: string): string {
  try {
    const d = new Date(timestamp);
    if (!Number.isFinite(d.getTime())) return timestamp.slice(0, 10);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(d);
    const y = parts.find((part) => part.type === "year")?.value ?? "";
    const m = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    return `${y}-${m}-${day}`;
  } catch {
    return timestamp.slice(0, 10);
  }
}

function buildDatasetTotalsByDate(dataset: any): Map<string, number> {
  const intervalTotals = new Map<string, number>();
  const intervals = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
  const timezone = String(dataset?.meta?.timezone ?? "America/Chicago").trim() || "America/Chicago";
  for (const row of intervals) {
    const timestamp = String((row as any)?.timestamp ?? "").trim();
    const kwh = Number((row as any)?.kwh ?? Number.NaN);
    if (!timestamp || !Number.isFinite(kwh)) continue;
    const dateKey = dateKeyInTimezone(timestamp, timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    intervalTotals.set(dateKey, (intervalTotals.get(dateKey) ?? 0) + kwh);
  }
  if (intervalTotals.size > 0) return intervalTotals;

  const dailyTotals = new Map<string, number>();
  const dailyRows = Array.isArray(dataset?.daily) ? dataset.daily : [];
  for (const row of dailyRows) {
    const date = String((row as any)?.date ?? "").slice(0, 10);
    const kwh = Number((row as any)?.kwh ?? Number.NaN);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(kwh)) continue;
    dailyTotals.set(date, (dailyTotals.get(date) ?? 0) + kwh);
  }
  return dailyTotals;
}

function dayKeysForRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return out;
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 24 * 60 * 60 * 1000) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return out;
}

function sumRangeTotals(range: { startDate: string; endDate: string }, totalsByDate: Map<string, number>): number {
  return round2(dayKeysForRange(range.startDate, range.endDate).reduce((sum, dateKey) => sum + (totalsByDate.get(dateKey) ?? 0), 0));
}

export function buildGapfillManualMonthlyCompareRows(args: {
  manualReadModel: ManualUsageReadModel | null | undefined;
  actualDataset?: any;
}): GapfillManualMonthlyCompareRow[] {
  const readModel = args.manualReadModel;
  if (!readModel || readModel.payloadMode !== "MONTHLY") return [];
  const actualTotalsByDate = args.actualDataset != null ? buildDatasetTotalsByDate(args.actualDataset) : null;
  return readModel.billPeriodCompare.rows.map((row) => {
    const actualIntervalKwh =
      actualTotalsByDate != null ? sumRangeTotals({ startDate: row.startDate, endDate: row.endDate }, actualTotalsByDate) : round2(row.actualIntervalTotalKwh ?? 0);
    const stageOneTargetKwh = round2(row.stageOneTargetTotalKwh ?? 0);
    const simulatedKwh = round2(row.simulatedStatementTotalKwh ?? 0);
    return {
      month: row.month,
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
  manualReadModel: ManualUsageReadModel | null | undefined;
  actualDataset?: any;
}): GapfillManualAnnualCompareSummary {
  const readModel = args.manualReadModel;
  if (!readModel || readModel.payloadMode !== "ANNUAL") {
    return {
      actualIntervalKwh: 0,
      stageOneTargetKwh: 0,
      simulatedKwh: 0,
      simulatedVsActualDeltaKwh: 0,
      simulatedVsTargetDeltaKwh: 0,
      targetVsActualDeltaKwh: 0,
    };
  }
  const annualRow = readModel.billPeriodCompare.rows[0];
  const actualTotalsByDate = args.actualDataset != null ? buildDatasetTotalsByDate(args.actualDataset) : null;
  const actualIntervalKwh =
    annualRow && actualTotalsByDate != null
      ? sumRangeTotals({ startDate: annualRow.startDate, endDate: annualRow.endDate }, actualTotalsByDate)
      : round2(readModel.annualCompareSummary?.actualIntervalKwh ?? 0);
  const stageOneTargetKwh = round2(readModel.annualCompareSummary?.stageOneTargetKwh ?? 0);
  const simulatedKwh = round2(readModel.annualCompareSummary?.simulatedKwh ?? 0);
  return (
    {
      actualIntervalKwh,
      stageOneTargetKwh,
      simulatedKwh,
      simulatedVsActualDeltaKwh: round2(simulatedKwh - actualIntervalKwh),
      simulatedVsTargetDeltaKwh: round2(simulatedKwh - stageOneTargetKwh),
      targetVsActualDeltaKwh: round2(stageOneTargetKwh - actualIntervalKwh),
    }
  );
}
