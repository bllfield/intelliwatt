import {
  buildManualBillPeriodTargets,
  buildManualBillPeriodTotalsById,
  formatStatementRangeLabel,
  type ManualAnnualStageOneSummary,
  type ManualBillPeriodTarget,
  type ManualMonthlyStageOneRow,
} from "@/modules/manualUsage/statementRanges";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

export type ManualBillPeriodCompareStatus =
  | "reconciled"
  | "delta_present"
  | "filled_later"
  | "travel_overlap"
  | "missing_input"
  | "sim_result_unavailable";

export type ManualBillPeriodCompareRow = {
  month: string;
  startDate: string;
  endDate: string;
  inputKind: "entered_nonzero" | "entered_zero" | "missing" | "annual_total";
  actualIntervalTotalKwh: number | null;
  enteredStatementTotalKwh: number | null;
  stageOneTargetTotalKwh: number | null;
  simulatedStatementTotalKwh: number | null;
  deltaKwh: number | null;
  eligible: boolean;
  parityRequirement:
    | "exact_match_required"
    | "excluded_travel_overlap"
    | "excluded_missing_input"
    | "excluded_filled_later";
  status: ManualBillPeriodCompareStatus;
  reason: string | null;
};

export type ManualBillPeriodCompare = {
  anchorEndDate: string;
  eligibleRangeCount: number;
  ineligibleRangeCount: number;
  reconciledRangeCount: number;
  deltaPresentRangeCount: number;
  rows: ManualBillPeriodCompareRow[];
};

export type ManualMonthlyCompareRow = {
  month: string;
  label?: string;
  eligible?: boolean;
  parityRequirement?: ManualBillPeriodCompareRow["parityRequirement"];
  status?: ManualBillPeriodCompareStatus;
  reason?: string | null;
  actualIntervalKwh: number | null;
  stageOneTargetKwh: number;
  simulatedKwh: number;
  simulatedVsActualDeltaKwh: number | null;
  simulatedVsTargetDeltaKwh: number;
  targetVsActualDeltaKwh: number | null;
};

export type ManualAnnualCompareSummary = {
  actualIntervalKwh: number | null;
  stageOneTargetKwh: number;
  simulatedKwh: number;
  eligible?: boolean;
  parityRequirement?: ManualBillPeriodCompareRow["parityRequirement"];
  status?: ManualBillPeriodCompareStatus;
  reason?: string | null;
  simulatedVsActualDeltaKwh: number | null;
  simulatedVsTargetDeltaKwh: number;
  targetVsActualDeltaKwh: number | null;
};

export type ManualUsageReadModel = {
  payloadMode: "MONTHLY" | "ANNUAL";
  anchorEndDate: string;
  billPeriodTargets: ManualBillPeriodTarget[];
  billPeriodTotalsKwhById: Record<string, number>;
  billPeriodCompare: ManualBillPeriodCompare;
  monthlyCompareRows: ManualMonthlyCompareRow[];
  annualCompareSummary: ManualAnnualCompareSummary | null;
};

export type ManualMonthlyStageOneCanonicalRow = ManualMonthlyStageOneRow & {
  eligible: boolean;
  parityRequirement: ManualBillPeriodCompareRow["parityRequirement"];
  status: ManualBillPeriodCompareStatus;
  reason: string | null;
};

export type ManualAnnualStageOneCanonicalSummary = ManualAnnualStageOneSummary & {
  eligible: boolean;
  parityRequirement: ManualBillPeriodCompareRow["parityRequirement"];
  status: ManualBillPeriodCompareStatus;
  reason: string | null;
};

export type ManualStageOnePresentationFromReadModel =
  | {
      mode: "MONTHLY";
      rows: ManualMonthlyStageOneCanonicalRow[];
    }
  | {
      mode: "ANNUAL";
      summary: ManualAnnualStageOneCanonicalSummary;
    };

type ManualMonthlyInputStateLike = {
  inputKindByMonth?: Record<string, "entered_nonzero" | "entered_zero" | "missing">;
} | null;

function round2(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function round2Number(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function subtractRounded(left: number | null, right: number | null): number | null {
  return left == null || right == null ? null : round2Number(left - right);
}

function parityRequirementForRow(args: {
  eligible: boolean;
  status: ManualBillPeriodCompareStatus;
}): ManualBillPeriodCompareRow["parityRequirement"] {
  if (args.eligible) return "exact_match_required";
  if (args.status === "travel_overlap") return "excluded_travel_overlap";
  if (args.status === "filled_later") return "excluded_filled_later";
  return "excluded_missing_input";
}

function buildDailyTotalsByDate(dataset: any): Map<string, number> {
  const out = new Map<string, number>();
  const dailyRows = Array.isArray(dataset?.daily) ? dataset.daily : [];
  for (const row of dailyRows) {
    const date = String((row as any)?.date ?? "").slice(0, 10);
    const kwh = Number((row as any)?.kwh ?? Number.NaN);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(kwh)) continue;
    out.set(date, (out.get(date) ?? 0) + kwh);
  }
  return out;
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

function buildIntervalTotalsByDate(dataset: any): Map<string, number> {
  const out = new Map<string, number>();
  const intervals = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
  const timezone = String(dataset?.meta?.timezone ?? "America/Chicago").trim() || "America/Chicago";
  for (const row of intervals) {
    const timestamp = String((row as any)?.timestamp ?? "").trim();
    const kwh = Number((row as any)?.kwh ?? Number.NaN);
    if (!timestamp || !Number.isFinite(kwh)) continue;
    const dateKey = dateKeyInTimezone(timestamp, timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    out.set(dateKey, (out.get(dateKey) ?? 0) + kwh);
  }
  return out;
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

function sumRangeTotals(range: { startDate: string; endDate: string }, totalsByDate: Map<string, number>): number | null {
  return round2(
    dayKeysForRange(range.startDate, range.endDate).reduce((sum, dateKey) => sum + (totalsByDate.get(dateKey) ?? 0), 0)
  );
}

function buildMonthlyTotalsByMonth(dataset: any): Map<string, number> {
  const out = new Map<string, number>();
  const monthlyRows = Array.isArray(dataset?.monthly) ? dataset.monthly : [];
  for (const row of monthlyRows) {
    const month = String((row as any)?.month ?? "").slice(0, 7);
    const kwh = Number((row as any)?.kwh ?? Number.NaN);
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(kwh)) continue;
    out.set(month, (out.get(month) ?? 0) + kwh);
  }
  return out;
}

function listCoveredWholeMonths(range: { startDate: string; endDate: string }): string[] | null {
  if (!/^\d{4}-\d{2}-01$/.test(range.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(range.endDate)) return null;
  const start = new Date(`${range.startDate}T00:00:00.000Z`);
  const end = new Date(`${range.endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return null;
  const lastDayOfEndMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  if (range.endDate !== lastDayOfEndMonth) return null;
  const months: string[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  while (true) {
    months.push(`${year}-${String(month + 1).padStart(2, "0")}`);
    if (year === end.getUTCFullYear() && month === end.getUTCMonth()) break;
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

function sumRangeMonthlyTotals(range: { startDate: string; endDate: string }, totalsByMonth: Map<string, number>): number | null {
  const months = listCoveredWholeMonths(range);
  if (!months || months.length === 0) return null;
  let sum = 0;
  let any = false;
  for (const month of months) {
    if (!totalsByMonth.has(month)) continue;
    sum += totalsByMonth.get(month) ?? 0;
    any = true;
  }
  return any ? round2(sum) : null;
}

export function buildManualUsageReadModel(args: {
  payload: ManualUsagePayload | null;
  dataset: any;
  actualDataset?: any;
}): ManualUsageReadModel | null {
  const payload = args.payload;
  if (!payload || (payload.mode !== "MONTHLY" && payload.mode !== "ANNUAL")) return null;
  const anchorEndDate = String(payload.anchorEndDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorEndDate)) return null;

  const billPeriodTargets = buildManualBillPeriodTargets(payload);
  if (billPeriodTargets.length === 0) return null;
  const billPeriodTotalsKwhById = buildManualBillPeriodTotalsById(billPeriodTargets);

  const simulatedIntervalTotalsByDate = buildIntervalTotalsByDate(args.dataset);
  const simulatedDailyTotalsByDate =
    simulatedIntervalTotalsByDate.size > 0 ? simulatedIntervalTotalsByDate : buildDailyTotalsByDate(args.dataset);

  const actualDatasetTotalsByDate =
    args.actualDataset != null
      ? (() => {
          const actualIntervalTotals = buildIntervalTotalsByDate(args.actualDataset);
          return actualIntervalTotals.size > 0 ? actualIntervalTotals : buildDailyTotalsByDate(args.actualDataset);
        })()
      : null;
  const actualDatasetTotalsByMonth = args.actualDataset != null ? buildMonthlyTotalsByMonth(args.actualDataset) : null;
  const actualDatasetSummaryTotalKwh =
    args.actualDataset != null && Number.isFinite(Number(args.actualDataset?.summary?.totalKwh))
      ? round2(Number(args.actualDataset.summary.totalKwh))
      : null;

  const meta = args.dataset?.meta && typeof args.dataset.meta === "object" ? args.dataset.meta : {};
  const inputState = (meta.manualMonthlyInputState ?? null) as ManualMonthlyInputStateLike;
  const filledMonths = new Set(
    Array.isArray(meta.filledMonths) ? meta.filledMonths.map((value: unknown) => String(value ?? "").trim()) : []
  );

  const rows: ManualBillPeriodCompareRow[] = billPeriodTargets.map((period) => {
    const inputKind =
      payload.mode === "MONTHLY"
        ? (inputState?.inputKindByMonth?.[period.month] ?? period.inputKind)
        : period.inputKind;
    const actualIntervalTotalKwh =
      actualDatasetTotalsByDate != null && actualDatasetTotalsByDate.size > 0
        ? sumRangeTotals(period, actualDatasetTotalsByDate)
        : actualDatasetTotalsByMonth != null && actualDatasetTotalsByMonth.size > 0
          ? sumRangeMonthlyTotals(period, actualDatasetTotalsByMonth)
          : payload.mode === "ANNUAL"
            ? actualDatasetSummaryTotalKwh
            : null;
    const enteredStatementTotalKwh = period.enteredKwh ?? null;
    const stageOneTargetTotalKwh = round2(
      Number.isFinite(Number(billPeriodTotalsKwhById[period.id])) ? Number(billPeriodTotalsKwhById[period.id]) : period.enteredKwh ?? null
    );
    const simulatedStatementTotalKwh = sumRangeTotals(period, simulatedDailyTotalsByDate);
    const isFilledLater = payload.mode === "MONTHLY" && filledMonths.has(period.month);

    let eligible = period.eligibleForConstraint;
    let status: ManualBillPeriodCompareStatus = "reconciled";
    let reason: string | null = null;
    if (period.exclusionReason === "missing_input") {
      eligible = false;
      status = "missing_input";
      reason = "User did not provide this statement range.";
    } else if (period.exclusionReason === "travel_overlap") {
      eligible = false;
      status = "travel_overlap";
      reason = "This entered statement range overlaps travel/vacant exclusions.";
    } else if (isFilledLater) {
      eligible = false;
      status = "filled_later";
      reason = "This statement range was filled later by shared Past Sim.";
    } else if (simulatedStatementTotalKwh == null) {
      eligible = false;
      status = "sim_result_unavailable";
      reason = "Past Sim totals were unavailable for this statement range.";
    }

    const deltaKwh =
      eligible && stageOneTargetTotalKwh != null && simulatedStatementTotalKwh != null
        ? round2(simulatedStatementTotalKwh - stageOneTargetTotalKwh)
        : null;
    if (eligible && deltaKwh != null && Math.abs(deltaKwh) > 0.05) {
      status = "delta_present";
      reason = "Past Sim total differs from the entered statement total.";
    }

    return {
      month: period.month,
      startDate: period.startDate,
      endDate: period.endDate,
      inputKind,
      actualIntervalTotalKwh,
      enteredStatementTotalKwh,
      stageOneTargetTotalKwh,
      simulatedStatementTotalKwh,
      deltaKwh,
      eligible,
      parityRequirement: parityRequirementForRow({ eligible, status }),
      status,
      reason,
    };
  });

  const billPeriodCompare: ManualBillPeriodCompare = {
    anchorEndDate,
    eligibleRangeCount: rows.filter((row) => row.eligible).length,
    ineligibleRangeCount: rows.filter((row) => !row.eligible).length,
    reconciledRangeCount: rows.filter((row) => row.status === "reconciled").length,
    deltaPresentRangeCount: rows.filter((row) => row.status === "delta_present").length,
    rows,
  };

  const monthlyCompareRows =
    payload.mode === "MONTHLY"
      ? rows.map((row) => ({
          month: row.month,
          actualIntervalKwh: round2(row.actualIntervalTotalKwh),
          stageOneTargetKwh: round2Number(row.stageOneTargetTotalKwh ?? 0),
          simulatedKwh: round2Number(row.simulatedStatementTotalKwh ?? 0),
          simulatedVsActualDeltaKwh: subtractRounded(round2(row.simulatedStatementTotalKwh), round2(row.actualIntervalTotalKwh)),
          simulatedVsTargetDeltaKwh: round2Number((row.simulatedStatementTotalKwh ?? 0) - (row.stageOneTargetTotalKwh ?? 0)),
          targetVsActualDeltaKwh: subtractRounded(round2(row.stageOneTargetTotalKwh), round2(row.actualIntervalTotalKwh)),
        }))
      : [];

  const annualRow = payload.mode === "ANNUAL" ? rows[0] ?? null : null;
  const annualCompareSummary =
    annualRow == null
      ? null
      : {
          actualIntervalKwh: round2(annualRow.actualIntervalTotalKwh),
          stageOneTargetKwh: round2Number(annualRow.stageOneTargetTotalKwh ?? 0),
          simulatedKwh: round2Number(annualRow.simulatedStatementTotalKwh ?? 0),
          simulatedVsActualDeltaKwh: subtractRounded(round2(annualRow.simulatedStatementTotalKwh), round2(annualRow.actualIntervalTotalKwh)),
          simulatedVsTargetDeltaKwh: round2Number((annualRow.simulatedStatementTotalKwh ?? 0) - (annualRow.stageOneTargetTotalKwh ?? 0)),
          targetVsActualDeltaKwh: subtractRounded(round2(annualRow.stageOneTargetTotalKwh), round2(annualRow.actualIntervalTotalKwh)),
        };

  return {
    payloadMode: payload.mode,
    anchorEndDate,
    billPeriodTargets,
    billPeriodTotalsKwhById,
    billPeriodCompare,
    monthlyCompareRows,
    annualCompareSummary,
  };
}

export function buildManualStageOnePresentationFromReadModel(args: {
  readModel: ManualUsageReadModel | null | undefined;
}): ManualStageOnePresentationFromReadModel | null {
  const readModel = args.readModel;
  if (!readModel) return null;
  if (readModel.payloadMode === "MONTHLY") {
    return {
      mode: "MONTHLY",
      rows: readModel.billPeriodCompare.rows.map((row) => {
        const labels = formatStatementRangeLabel({
          startDate: row.startDate,
          endDate: row.endDate,
        });
        return {
          key: `${row.month}:${row.endDate}`,
          month: row.month,
          startDate: row.startDate,
          endDate: row.endDate,
          label: labels.label,
          shortLabel: labels.shortLabel,
          kwh: round2Number(row.stageOneTargetTotalKwh ?? 0),
          eligible: row.eligible,
          parityRequirement: row.parityRequirement,
          status: row.status,
          reason: row.reason,
        };
      }),
    };
  }
  const annualRow = readModel.billPeriodCompare.rows[0] ?? null;
  if (!annualRow) return null;
  const labels = formatStatementRangeLabel({
    startDate: annualRow.startDate,
    endDate: annualRow.endDate,
  });
  return {
    mode: "ANNUAL",
    summary: {
      key: annualRow.month,
      startDate: annualRow.startDate,
      endDate: annualRow.endDate,
      anchorEndDate: readModel.anchorEndDate,
      label: labels.label,
      shortLabel: labels.shortLabel,
      annualKwh: round2Number(readModel.annualCompareSummary?.stageOneTargetKwh ?? annualRow.stageOneTargetTotalKwh ?? 0),
      eligible: annualRow.eligible,
      parityRequirement: annualRow.parityRequirement,
      status: annualRow.status,
      reason: annualRow.reason,
    },
  };
}
