import { buildContiguousStatementRanges } from "@/modules/manualUsage/statementRanges";
import type {
  AnnualManualUsagePayload,
  ManualUsagePayload,
  MonthlyManualUsagePayload,
  TravelRange,
} from "@/modules/simulatedUsage/types";

type DailyUsageRow = { date?: string; kwh?: number };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value.trim());
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeDailyRows(rows: unknown): Array<{ date: string; kwh: number }> {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      date: String((row as DailyUsageRow)?.date ?? "").slice(0, 10),
      kwh: Number((row as DailyUsageRow)?.kwh ?? Number.NaN),
    }))
    .filter((row) => isIsoDate(row.date) && Number.isFinite(row.kwh))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function enumerateDateKeysInclusive(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return [];
  const out: string[] = [];
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 24 * 60 * 60 * 1000) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return out;
}

export function hasUsableMonthlyPayload(payload: ManualUsagePayload | null | undefined): payload is MonthlyManualUsagePayload {
  return Boolean(
    payload &&
      payload.mode === "MONTHLY" &&
      isIsoDate(payload.anchorEndDate) &&
      Array.isArray(payload.monthlyKwh) &&
      payload.monthlyKwh.some((row) => typeof row?.kwh === "number" && Number.isFinite(row.kwh))
  );
}

export function hasUsableAnnualPayload(payload: ManualUsagePayload | null | undefined): payload is AnnualManualUsagePayload {
  return Boolean(
    payload &&
      payload.mode === "ANNUAL" &&
      isIsoDate(payload.anchorEndDate) &&
      typeof payload.annualKwh === "number" &&
      Number.isFinite(payload.annualKwh)
  );
}

export function resolveSeedAnchorEndDate(args: {
  sourcePayload: ManualUsagePayload | null;
  actualEndDate?: string | null;
}): string | null {
  const sourceAnchor =
    args.sourcePayload && isIsoDate((args.sourcePayload as any).anchorEndDate)
      ? String((args.sourcePayload as any).anchorEndDate).trim()
      : null;
  if (sourceAnchor) return sourceAnchor;
  return isIsoDate(args.actualEndDate) ? args.actualEndDate.trim() : null;
}

export function deriveMonthlySeedFromActual(args: {
  anchorEndDate: string;
  sourcePayload: ManualUsagePayload | null;
  travelRanges: TravelRange[];
  dailyRows: unknown;
}): MonthlyManualUsagePayload | null {
  if (hasUsableMonthlyPayload(args.sourcePayload)) {
    return {
      mode: "MONTHLY",
      anchorEndDate: args.sourcePayload.anchorEndDate,
      monthlyKwh: args.sourcePayload.monthlyKwh,
      statementRanges: args.sourcePayload.statementRanges,
      travelRanges: args.sourcePayload.travelRanges,
    };
  }

  const normalizedDailyRows = normalizeDailyRows(args.dailyRows);
  if (normalizedDailyRows.length === 0 || !isIsoDate(args.anchorEndDate)) return null;
  const coverageStart = normalizedDailyRows[0]!.date;
  const coverageEnd = normalizedDailyRows[normalizedDailyRows.length - 1]!.date;
  const kwhByDate = new Map(normalizedDailyRows.map((row) => [row.date, row.kwh]));
  const seededRanges = buildContiguousStatementRanges(args.anchorEndDate, 12).filter(
    (range) => range.startDate != null && range.startDate >= coverageStart && range.endDate <= coverageEnd
  );
  if (seededRanges.length === 0) return null;

  const monthlyKwh = seededRanges.map((range) => ({
    month: range.month,
    kwh: round2(
      enumerateDateKeysInclusive(range.startDate ?? range.endDate, range.endDate).reduce(
        (sum, dateKey) => sum + (kwhByDate.get(dateKey) ?? 0),
        0
      )
    ),
  }));
  return {
    mode: "MONTHLY",
    anchorEndDate: seededRanges[0]!.endDate,
    monthlyKwh,
    statementRanges: seededRanges,
    travelRanges: args.travelRanges,
  };
}

export function deriveAnnualSeed(args: {
  anchorEndDate: string;
  sourcePayload: ManualUsagePayload | null;
  travelRanges: TravelRange[];
  dailyRows: unknown;
  monthlySeed?: MonthlyManualUsagePayload | null;
}): AnnualManualUsagePayload | null {
  if (hasUsableAnnualPayload(args.sourcePayload)) {
    return {
      mode: "ANNUAL",
      anchorEndDate: args.sourcePayload.anchorEndDate,
      annualKwh: args.sourcePayload.annualKwh,
      travelRanges: args.sourcePayload.travelRanges,
    };
  }
  if (hasUsableMonthlyPayload(args.sourcePayload)) {
    const annualKwh = round2(args.sourcePayload.monthlyKwh.reduce((sum, row) => sum + (typeof row.kwh === "number" ? row.kwh : 0), 0));
    return {
      mode: "ANNUAL",
      anchorEndDate: args.sourcePayload.anchorEndDate,
      annualKwh,
      travelRanges: args.sourcePayload.travelRanges,
    };
  }
  if (args.monthlySeed) {
    const annualKwh = round2(args.monthlySeed.monthlyKwh.reduce((sum, row) => sum + (typeof row.kwh === "number" ? row.kwh : 0), 0));
    return {
      mode: "ANNUAL",
      anchorEndDate: args.monthlySeed.anchorEndDate,
      annualKwh,
      travelRanges: args.travelRanges,
    };
  }

  const normalizedDailyRows = normalizeDailyRows(args.dailyRows);
  if (normalizedDailyRows.length === 0 || !isIsoDate(args.anchorEndDate)) return null;
  const annualKwh = round2(normalizedDailyRows.reduce((sum, row) => sum + row.kwh, 0));
  return {
    mode: "ANNUAL",
    anchorEndDate: args.anchorEndDate,
    annualKwh,
    travelRanges: args.travelRanges,
  };
}
