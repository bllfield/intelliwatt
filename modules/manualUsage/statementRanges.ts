import { lastFullMonthChicago } from "@/modules/manualUsage/anchor";
import { billingPeriodsEndingAt } from "@/modules/manualUsage/billingPeriods";
import type { ManualStatementRange } from "@/modules/simulatedUsage/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

export const MAX_MANUAL_MONTHLY_BILLS = 12;

export type ManualStatementInputRow = {
  startDate: string;
  endDate: string;
  kwh: number | "";
};

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value.trim());
}

function isYearMonth(value: unknown): value is string {
  return typeof value === "string" && YEAR_MONTH_RE.test(value.trim());
}

export function addDaysToIsoDate(dateKey: string, deltaDays: number): string {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return dateKey;
  return new Date(parsed.getTime() + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

function resolveVisibleBillCount(rows: Array<{ month?: unknown; kwh?: unknown }> | undefined, minimumCount = 1): number {
  const monthlyRows = Array.isArray(rows) ? rows : [];
  let lastVisibleIndex = -1;
  for (let index = 0; index < monthlyRows.length; index += 1) {
    const row = monthlyRows[index];
    const hasMonth = isYearMonth((row as any)?.month);
    const hasNumericKwh = typeof (row as any)?.kwh === "number" && Number.isFinite((row as any).kwh);
    if (hasMonth || hasNumericKwh) lastVisibleIndex = index;
  }
  return Math.max(minimumCount, Math.min(MAX_MANUAL_MONTHLY_BILLS, lastVisibleIndex + 1 || minimumCount));
}

export function buildContiguousStatementRanges(anchorEndDate: string, count = MAX_MANUAL_MONTHLY_BILLS): ManualStatementRange[] {
  const periods = billingPeriodsEndingAt(anchorEndDate, Math.max(1, Math.min(MAX_MANUAL_MONTHLY_BILLS, Math.trunc(count))));
  return periods
    .map((period) => ({
      month: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
    }))
    .reverse();
}

export function normalizeStatementRanges(ranges: unknown): ManualStatementRange[] {
  if (!Array.isArray(ranges)) return [];
  const out: ManualStatementRange[] = [];
  for (const range of ranges) {
    const endDate = String((range as any)?.endDate ?? "").slice(0, 10);
    const startDateRaw = (range as any)?.startDate;
    const startDate =
      startDateRaw == null || startDateRaw === ""
        ? null
        : isIsoDate(String(startDateRaw).slice(0, 10))
          ? String(startDateRaw).slice(0, 10)
          : null;
    const monthRaw = String((range as any)?.month ?? "").trim();
    if (!isIsoDate(endDate)) continue;
    out.push({
      month: isYearMonth(monthRaw) ? monthRaw : endDate.slice(0, 7),
      startDate,
      endDate,
    });
  }
  out.sort((a, b) => b.endDate.localeCompare(a.endDate));
  return out.slice(0, MAX_MANUAL_MONTHLY_BILLS);
}

export function deriveStatementRangesFromMonthlyPayload(payload: {
  anchorEndDate?: unknown;
  monthlyKwh?: Array<{ month?: unknown; kwh?: unknown }>;
  statementRanges?: unknown;
}): ManualStatementRange[] {
  const explicitRanges = normalizeStatementRanges(payload.statementRanges);
  if (explicitRanges.length > 0) return explicitRanges;
  const anchorEndDate = isIsoDate(payload.anchorEndDate) ? payload.anchorEndDate.trim() : `${lastFullMonthChicago()}-15`;
  const visibleCount = resolveVisibleBillCount(payload.monthlyKwh, 1);
  return buildContiguousStatementRanges(anchorEndDate, visibleCount);
}

export function buildStatementRowsFromMonthlyPayload(payload: {
  anchorEndDate?: unknown;
  monthlyKwh?: Array<{ month?: unknown; kwh?: unknown }>;
  statementRanges?: unknown;
}): ManualStatementInputRow[] {
  const valueByMonth = new Map<string, number | "">();
  for (const row of Array.isArray(payload.monthlyKwh) ? payload.monthlyKwh : []) {
    const month = String((row as any)?.month ?? "").trim();
    const kwh = (row as any)?.kwh;
    if (!isYearMonth(month)) continue;
    valueByMonth.set(month, typeof kwh === "number" && Number.isFinite(kwh) ? kwh : "");
  }
  return deriveStatementRangesFromMonthlyPayload(payload).map((range) => ({
    startDate: range.startDate ?? "",
    endDate: range.endDate,
    kwh: valueByMonth.get(range.month) ?? "",
  }));
}

export function buildMonthlyPayloadFromStatementRows(rows: ManualStatementInputRow[]): {
  ok: true;
  anchorEndDate: string;
  monthlyKwh: Array<{ month: string; kwh: number | "" }>;
  statementRanges: ManualStatementRange[];
} | {
  ok: false;
  error: string;
} {
  const visibleRows = rows.slice(0, MAX_MANUAL_MONTHLY_BILLS);
  if (visibleRows.length === 0) return { ok: false, error: "monthly_statement_required" };
  for (const row of visibleRows) {
    if (!isIsoDate(row.endDate)) return { ok: false, error: "billEndDate_invalid" };
  }
  for (let index = 1; index < visibleRows.length; index += 1) {
    if (!(visibleRows[index - 1]!.endDate > visibleRows[index]!.endDate)) {
      return { ok: false, error: "billEndDate_order_invalid" };
    }
  }
  const oldestRow = visibleRows[visibleRows.length - 1]!;
  if (!isIsoDate(oldestRow.startDate)) {
    return { ok: false, error: "billStartDate_invalid" };
  }
  if (oldestRow.startDate > oldestRow.endDate) {
    return { ok: false, error: "billStartDate_after_endDate" };
  }

  const statementRanges = visibleRows.map((row, index) => {
    const startDate = index === visibleRows.length - 1 ? row.startDate : addDaysToIsoDate(visibleRows[index + 1]!.endDate, 1);
    return {
      month: row.endDate.slice(0, 7),
      startDate,
      endDate: row.endDate,
    };
  });
  const distinctMonthCount = new Set(statementRanges.map((row) => row.month)).size;
  if (distinctMonthCount !== statementRanges.length) {
    return { ok: false, error: "billEndMonth_duplicate" };
  }

  return {
    ok: true,
    anchorEndDate: statementRanges[0]!.endDate,
    monthlyKwh: statementRanges.map((range, index) => ({
      month: range.month,
      kwh: visibleRows[index]!.kwh === "" ? "" : Number(visibleRows[index]!.kwh),
    })),
    statementRanges,
  };
}
