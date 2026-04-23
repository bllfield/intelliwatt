import { lastFullMonthChicago } from "@/modules/onePathSim/manualAnchor";
import { billingPeriodsEndingAt } from "@/modules/onePathSim/manualBillingPeriods";
import type {
  AnnualManualUsagePayload,
  ManualStatementRange,
  ManualUsagePayload,
  MonthlyManualUsagePayload,
  TravelRange,
} from "@/modules/onePathSim/simulatedUsage/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

export const MAX_MANUAL_MONTHLY_BILLS = 12;

export type ManualMonthlyStageOneSurface =
  | "user_usage_manual_monthly_stage_one"
  | "admin_manual_monthly_stage_one";

export type ManualStatementInputRow = {
  startDate: string;
  endDate: string;
  kwh: number | "";
};

export type ManualMonthlyStageOneRow = {
  key: string;
  month: string;
  startDate: string | null;
  endDate: string;
  label: string;
  shortLabel: string;
  kwh: number;
};

export type ManualAnnualStageOneSummary = {
  key: string;
  startDate: string;
  endDate: string;
  anchorEndDate: string;
  label: string;
  shortLabel: string;
  annualKwh: number;
};

export type ManualBillPeriodInputKind = "entered_nonzero" | "entered_zero" | "missing" | "annual_total";

export type ManualBillPeriodTarget = {
  id: string;
  periodType: "monthly_statement" | "annual_total";
  month: string;
  startDate: string;
  endDate: string;
  label: string;
  shortLabel: string;
  enteredKwh: number | null;
  inputKind: ManualBillPeriodInputKind;
  eligibleForConstraint: boolean;
  exclusionReason: "travel_overlap" | "missing_input" | null;
};

export type ManualStageOnePresentation =
  | {
      mode: "MONTHLY";
      surface: ManualMonthlyStageOneSurface;
      rows: ManualMonthlyStageOneRow[];
    }
  | {
      mode: "ANNUAL";
      surface: ManualMonthlyStageOneSurface;
      summary: ManualAnnualStageOneSummary;
    };

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value.trim());
}

function isYearMonth(value: unknown): value is string {
  return typeof value === "string" && YEAR_MONTH_RE.test(value.trim());
}

function formatShortDate(dateKey: string): string {
  if (!isIsoDate(dateKey)) return dateKey;
  const [year, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}/${year.slice(2)}`;
}

export function normalizeTravelRanges(ranges: TravelRange[] | undefined): TravelRange[] {
  return Array.isArray(ranges)
    ? ranges
        .map((range) => ({
          startDate: String(range?.startDate ?? "").slice(0, 10),
          endDate: String(range?.endDate ?? "").slice(0, 10),
        }))
        .filter((range) => isIsoDate(range.startDate) && isIsoDate(range.endDate))
    : [];
}

function overlapsTravelRange(range: { startDate: string; endDate: string }, travelRanges: TravelRange[]): boolean {
  return travelRanges.some((travelRange) => !(travelRange.endDate < range.startDate || travelRange.startDate > range.endDate));
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

export function formatStatementRangeLabel(range: {
  startDate?: string | null;
  endDate: string;
}): { label: string; shortLabel: string } {
  const endLabel = formatShortDate(range.endDate);
  if (isIsoDate(range.startDate)) {
    const startLabel = formatShortDate(range.startDate);
    return {
      label: `${startLabel} - ${endLabel}`,
      shortLabel: `${startLabel}-${endLabel}`,
    };
  }
  return {
    label: `Ending ${endLabel}`,
    shortLabel: endLabel,
  };
}

export function buildManualMonthlyStageOneRows(
  payload: Pick<MonthlyManualUsagePayload, "anchorEndDate" | "monthlyKwh" | "statementRanges">
): ManualMonthlyStageOneRow[] {
  const numericValuesByMonth = new Map<string, number>();
  for (const row of Array.isArray(payload.monthlyKwh) ? payload.monthlyKwh : []) {
    const month = String((row as any)?.month ?? "").trim();
    const kwh = (row as any)?.kwh;
    if (!isYearMonth(month) || typeof kwh !== "number" || !Number.isFinite(kwh)) continue;
    numericValuesByMonth.set(month, kwh);
  }
  return deriveStatementRangesFromMonthlyPayload(payload)
    .map((range) => {
      const kwh = numericValuesByMonth.get(range.month);
      if (typeof kwh !== "number" || !Number.isFinite(kwh)) return null;
      const labels = formatStatementRangeLabel(range);
      return {
        key: `${range.month}:${range.endDate}`,
        month: range.month,
        startDate: range.startDate,
        endDate: range.endDate,
        label: labels.label,
        shortLabel: labels.shortLabel,
        kwh,
      };
    })
    .filter((row): row is ManualMonthlyStageOneRow => row != null)
    .sort((a, b) => (a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0));
}

export function buildManualAnnualStageOneSummary(
  payload: Pick<AnnualManualUsagePayload, "anchorEndDate" | "annualKwh">
): ManualAnnualStageOneSummary | null {
  const anchorEndDate = String(payload.anchorEndDate ?? "").slice(0, 10);
  const annualKwh = Number(payload.annualKwh);
  if (!isIsoDate(anchorEndDate) || !Number.isFinite(annualKwh)) return null;
  const startDate = addDaysToIsoDate(anchorEndDate, -364);
  const labels = formatStatementRangeLabel({ startDate, endDate: anchorEndDate });
  return {
    key: `annual:${anchorEndDate}`,
    startDate,
    endDate: anchorEndDate,
    anchorEndDate,
    label: labels.label,
    shortLabel: labels.shortLabel,
    annualKwh,
  };
}

export function buildManualBillPeriodTargets(payload: ManualUsagePayload): ManualBillPeriodTarget[] {
  if (payload.mode === "MONTHLY") {
    const numericValuesByMonth = new Map<string, number | null>();
    for (const row of Array.isArray(payload.monthlyKwh) ? payload.monthlyKwh : []) {
      const month = String((row as any)?.month ?? "").trim();
      const rawKwh = (row as any)?.kwh;
      if (!isYearMonth(month)) continue;
      numericValuesByMonth.set(month, typeof rawKwh === "number" && Number.isFinite(rawKwh) ? rawKwh : null);
    }
    return deriveStatementRangesFromMonthlyPayload(payload)
      .map((range) => {
        const labels = formatStatementRangeLabel(range);
        const enteredKwh = numericValuesByMonth.get(range.month) ?? null;
        const inputKind: ManualBillPeriodInputKind =
          enteredKwh == null ? "missing" : enteredKwh === 0 ? "entered_zero" : "entered_nonzero";
        return {
          id: range.month,
          periodType: "monthly_statement" as const,
          month: range.month,
          startDate: range.startDate ?? range.endDate,
          endDate: range.endDate,
          label: labels.label,
          shortLabel: labels.shortLabel,
          enteredKwh,
          inputKind,
          // Monthly statement totals remain exact-match targets even when travel overlaps the range.
          eligibleForConstraint: enteredKwh != null,
          exclusionReason: enteredKwh == null ? ("missing_input" as const) : null,
        };
      })
      .filter((period) => isIsoDate(period.startDate))
      .sort((a, b) => (a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0));
  }

  const summary = buildManualAnnualStageOneSummary(payload);
  if (!summary) return [];
  const travelOverlap = overlapsTravelRange(
    {
      startDate: summary.startDate,
      endDate: summary.endDate,
    },
    normalizeTravelRanges(payload.travelRanges)
  );
  return [
    {
      id: summary.key,
      periodType: "annual_total",
      month: "Annual total",
      startDate: summary.startDate,
      endDate: summary.endDate,
      label: summary.label,
      shortLabel: summary.shortLabel,
      enteredKwh: summary.annualKwh,
      inputKind: "annual_total",
      eligibleForConstraint: !travelOverlap,
      exclusionReason: travelOverlap ? "travel_overlap" : null,
    },
  ];
}

export function buildManualBillPeriodTotalsById(periods: ManualBillPeriodTarget[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const period of periods) {
    if (!period.eligibleForConstraint) continue;
    const enteredKwh = Number(period.enteredKwh);
    if (!Number.isFinite(enteredKwh)) continue;
    out[period.id] = Math.max(0, enteredKwh);
  }
  return out;
}

export function resolveManualMonthlyStageOnePresentation(args: {
  surface?: ManualMonthlyStageOneSurface | null;
  payload?: ManualUsagePayload | null;
}): { surface: ManualMonthlyStageOneSurface; rows: ManualMonthlyStageOneRow[] } | null {
  if (!args.surface || args.payload?.mode !== "MONTHLY") return null;
  const rows = buildManualMonthlyStageOneRows(args.payload);
  if (rows.length === 0) return null;
  return {
    surface: args.surface,
    rows,
  };
}

export function resolveManualAnnualStageOnePresentation(args: {
  surface?: ManualMonthlyStageOneSurface | null;
  payload?: ManualUsagePayload | null;
}): { surface: ManualMonthlyStageOneSurface; summary: ManualAnnualStageOneSummary } | null {
  if (!args.surface || args.payload?.mode !== "ANNUAL") return null;
  const summary = buildManualAnnualStageOneSummary(args.payload);
  if (!summary) return null;
  return {
    surface: args.surface,
    summary,
  };
}

export function resolveManualStageOnePresentation(args: {
  surface?: ManualMonthlyStageOneSurface | null;
  payload?: ManualUsagePayload | null;
}): ManualStageOnePresentation | null {
  const monthly = resolveManualMonthlyStageOnePresentation(args);
  if (monthly) return { mode: "MONTHLY", ...monthly };
  const annual = resolveManualAnnualStageOnePresentation(args);
  if (annual) return { mode: "ANNUAL", ...annual };
  return null;
}

export function pickManualUsagePayload(
  ...candidates: Array<ManualUsagePayload | null | undefined>
): ManualUsagePayload | null {
  for (const candidate of candidates) {
    if (candidate?.mode === "MONTHLY" || candidate?.mode === "ANNUAL") return candidate;
  }
  return null;
}

export function pickMonthlyManualUsagePayload(
  ...candidates: Array<ManualUsagePayload | Extract<ManualUsagePayload, { mode: "MONTHLY" }> | null | undefined>
): Extract<ManualUsagePayload, { mode: "MONTHLY" }> | null {
  for (const candidate of candidates) {
    if (candidate?.mode === "MONTHLY") return candidate;
  }
  return null;
}

export function resolveManualStageOneLabPayloads(args: {
  savedPayload?: ManualUsagePayload | null;
  loadedPayload?: ManualUsagePayload | null;
  lookupPayload?: ManualUsagePayload | null;
  loadedSourcePayload?: ManualUsagePayload | null;
  lookupSourcePayload?: ManualUsagePayload | null;
  loadedSourceSeed?: ManualUsagePayload | null;
  lookupSourceSeed?: ManualUsagePayload | null;
}): {
  sourcePayload: ManualUsagePayload | null;
  previewPayload: ManualUsagePayload | null;
} {
  const sourcePayload = pickManualUsagePayload(
    args.loadedSourcePayload,
    args.lookupSourcePayload,
    args.loadedSourceSeed,
    args.lookupSourceSeed
  );
  const previewPayload = pickManualUsagePayload(args.savedPayload, args.loadedPayload, args.lookupPayload, sourcePayload);
  return {
    sourcePayload,
    previewPayload,
  };
}

export function resolveManualMonthlyLabStageOnePayloads(args: {
  savedPayload?: ManualUsagePayload | null;
  loadedPayload?: ManualUsagePayload | null;
  lookupPayload?: ManualUsagePayload | null;
  loadedSourcePayload?: ManualUsagePayload | null;
  lookupSourcePayload?: ManualUsagePayload | null;
  loadedSourceSeed?: Extract<ManualUsagePayload, { mode: "MONTHLY" }> | null;
  lookupSourceSeed?: Extract<ManualUsagePayload, { mode: "MONTHLY" }> | null;
}): {
  sourcePayload: Extract<ManualUsagePayload, { mode: "MONTHLY" }> | null;
  previewPayload: Extract<ManualUsagePayload, { mode: "MONTHLY" }> | null;
} {
  const sourcePayload = pickMonthlyManualUsagePayload(
    args.loadedSourcePayload,
    args.lookupSourcePayload,
    args.loadedSourceSeed,
    args.lookupSourceSeed
  );
  const previewPayload = pickMonthlyManualUsagePayload(args.savedPayload, args.loadedPayload, args.lookupPayload, sourcePayload);
  return {
    sourcePayload,
    previewPayload,
  };
}

export function shouldUseManualMonthlyStageOnePayload(args: {
  manualUsageHouseId?: string | null;
  selectedUsageHouseId?: string | null;
}): boolean {
  return !args.manualUsageHouseId || !args.selectedUsageHouseId || args.selectedUsageHouseId === args.manualUsageHouseId;
}

export function resolveManualMonthlyStageOneRenderMode(args: {
  forceManualMonthlyStageOne?: boolean;
  rows?: ManualMonthlyStageOneRow[] | null;
}): "rows" | "empty" | "off" {
  if ((args.rows?.length ?? 0) > 0) return "rows";
  if (args.forceManualMonthlyStageOne) return "empty";
  return "off";
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
