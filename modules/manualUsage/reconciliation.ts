import { billingPeriodsEndingAt } from "@/modules/manualUsage/billingPeriods";
import type { ManualUsagePayload, TravelRange } from "@/modules/simulatedUsage/types";

export type ManualMonthlyReconciliationStatus =
  | "reconciled"
  | "delta_present"
  | "filled_later"
  | "travel_overlap"
  | "missing_input"
  | "sim_result_unavailable";

export type ManualMonthlyReconciliationRow = {
  month: string;
  startDate: string;
  endDate: string;
  inputKind: "entered_nonzero" | "entered_zero" | "missing";
  enteredStatementTotalKwh: number | null;
  simulatedStatementTotalKwh: number | null;
  deltaKwh: number | null;
  eligible: boolean;
  status: ManualMonthlyReconciliationStatus;
  reason: string | null;
};

export type ManualMonthlyReconciliation = {
  anchorEndDate: string;
  eligibleRangeCount: number;
  ineligibleRangeCount: number;
  reconciledRangeCount: number;
  deltaPresentRangeCount: number;
  rows: ManualMonthlyReconciliationRow[];
};

type ManualMonthlyInputStateLike = {
  inputKindByMonth?: Record<string, "entered_nonzero" | "entered_zero" | "missing">;
} | null;

function normalizeRanges(ranges: unknown): TravelRange[] {
  if (!Array.isArray(ranges)) return [];
  return ranges
    .map((range) => ({
      startDate: String((range as any)?.startDate ?? "").slice(0, 10),
      endDate: String((range as any)?.endDate ?? "").slice(0, 10),
    }))
    .filter((range) => /^\d{4}-\d{2}-\d{2}$/.test(range.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(range.endDate));
}

function round2(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function buildDailyTotalsByDate(dataset: any): Map<string, number> {
  const out = new Map<string, number>();
  const dailyRows = Array.isArray(dataset?.daily) ? dataset.daily : [];
  for (const row of dailyRows) {
    const date = String((row as any)?.date ?? "").slice(0, 10);
    const kwh = Number((row as any)?.kwh ?? NaN);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(kwh)) continue;
    out.set(date, (out.get(date) ?? 0) + kwh);
  }
  return out;
}

function overlapsTravel(period: { startDate: string; endDate: string }, travelRanges: TravelRange[]): boolean {
  return travelRanges.some((range) => !(range.endDate < period.startDate || range.startDate > period.endDate));
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

export function buildManualMonthlyReconciliation(args: {
  payload: ManualUsagePayload | null;
  dataset: any;
}): ManualMonthlyReconciliation | null {
  const payload = args.payload;
  if (!payload || payload.mode !== "MONTHLY") return null;
  const anchorEndDate = String(payload.anchorEndDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorEndDate)) return null;

  const periods = billingPeriodsEndingAt(anchorEndDate, 12);
  if (periods.length === 0) return null;

  const enteredByMonth = new Map<string, number | null>();
  for (const row of Array.isArray(payload.monthlyKwh) ? payload.monthlyKwh : []) {
    const month = String((row as any)?.month ?? "").trim();
    const raw = (row as any)?.kwh;
    enteredByMonth.set(month, typeof raw === "number" && Number.isFinite(raw) ? raw : null);
  }

  const dailyTotalsByDate = buildDailyTotalsByDate(args.dataset);
  const meta = args.dataset?.meta && typeof args.dataset.meta === "object" ? args.dataset.meta : {};
  const inputState = (meta.manualMonthlyInputState ?? null) as ManualMonthlyInputStateLike;
  const filledMonths = new Set(
    Array.isArray(meta.filledMonths) ? meta.filledMonths.map((value: unknown) => String(value ?? "").trim()) : []
  );
  const travelRanges = normalizeRanges(payload.travelRanges);

  const rows: ManualMonthlyReconciliationRow[] = periods.map((period) => {
    const inputKind = inputState?.inputKindByMonth?.[period.id] ?? (enteredByMonth.get(period.id) == null ? "missing" : "entered_nonzero");
    const enteredStatementTotalKwh = enteredByMonth.get(period.id) ?? null;
    const simulatedStatementTotalKwh = round2(
      dayKeysForRange(period.startDate, period.endDate).reduce((sum, date) => sum + (dailyTotalsByDate.get(date) ?? 0), 0)
    );
    const isFilledLater = filledMonths.has(period.id) || inputKind === "missing";
    const hasTravelOverlap = overlapsTravel(period, travelRanges);

    let eligible = true;
    let status: ManualMonthlyReconciliationStatus = "reconciled";
    let reason: string | null = null;
    if (isFilledLater) {
      eligible = false;
      status = inputKind === "missing" ? "missing_input" : "filled_later";
      reason = inputKind === "missing" ? "User did not provide this statement range." : "This statement range was filled later by shared Past Sim.";
    } else if (hasTravelOverlap) {
      eligible = false;
      status = "travel_overlap";
      reason = "This entered statement range overlaps travel/vacant exclusions.";
    } else if (simulatedStatementTotalKwh == null) {
      eligible = false;
      status = "sim_result_unavailable";
      reason = "Past Sim totals were unavailable for this statement range.";
    }

    const deltaKwh =
      eligible && enteredStatementTotalKwh != null && simulatedStatementTotalKwh != null
        ? round2(simulatedStatementTotalKwh - enteredStatementTotalKwh)
        : null;
    if (eligible && deltaKwh != null && Math.abs(deltaKwh) > 0.05) {
      status = "delta_present";
      reason = "Past Sim total differs from the entered statement total.";
    }

    return {
      month: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      inputKind,
      enteredStatementTotalKwh,
      simulatedStatementTotalKwh,
      deltaKwh,
      eligible,
      status,
      reason,
    };
  });

  return {
    anchorEndDate,
    eligibleRangeCount: rows.filter((row) => row.eligible).length,
    ineligibleRangeCount: rows.filter((row) => !row.eligible).length,
    reconciledRangeCount: rows.filter((row) => row.status === "reconciled").length,
    deltaPresentRangeCount: rows.filter((row) => row.status === "delta_present").length,
    rows,
  };
}
