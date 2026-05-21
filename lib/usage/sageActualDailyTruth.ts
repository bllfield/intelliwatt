import { chicagoDateKey } from "@/lib/time/chicago";

export type SageActualDailyRow = { date: string; kwh: number };

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/** Daily rows from sage `getActualUsageDatasetForHouse` (same truth as Usage / baseline passthrough). */
export function sageActualDailyRowsFromDataset(dataset: unknown): SageActualDailyRow[] {
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) return [];
  const daily = (dataset as { daily?: unknown }).daily;
  if (!Array.isArray(daily)) return [];
  const out: SageActualDailyRow[] = [];
  for (const row of daily) {
    const date = asDateKey((row as { date?: unknown })?.date);
    const kwh = Number((row as { kwh?: unknown })?.kwh);
    if (!date || !Number.isFinite(kwh)) continue;
    out.push({ date, kwh: round2(kwh) });
  }
  return out;
}

export function sageActualDailyKwhByDate(dataset: unknown): Map<string, number> {
  return new Map(sageActualDailyRowsFromDataset(dataset).map((row) => [row.date, row.kwh] as const));
}

export type DailyRowWithSource = {
  date: string;
  kwh: number;
  source?: string;
  sourceDetail?: string;
};

/**
 * Past Sim display must not re-sum stitched intervals for ACTUAL-labeled days.
 * Overlay sage daily kWh (Chicago SQL aggregation from actualDatasetForHouse).
 */
export function applySageActualDailyTruthToDisplayRows<T extends DailyRowWithSource>(
  rows: T[],
  sageByDate: Map<string, number>
): T[] {
  if (sageByDate.size === 0) return rows;
  return rows.map((row) => {
    const date = asDateKey(row.date);
    if (!date) return row;
    if (String(row.source ?? "").toUpperCase() !== "ACTUAL") return row;
    const sageKwh = sageByDate.get(date);
    if (sageKwh === undefined) return row;
    return { ...row, kwh: round2(sageKwh) };
  });
}

export function sageActualDailyKwhByDateFromRows(
  rows: Array<{ date: string; kwh: number }> | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    const date = asDateKey(row?.date);
    const kwh = Number(row?.kwh);
    if (!date || !Number.isFinite(kwh)) continue;
    map.set(date, round2(kwh));
  }
  return map;
}

export type ValidationCompareRowLike = {
  localDate: string;
  dayType: "weekday" | "weekend";
  actualDayKwh: number;
  simulatedDayKwh: number;
  errorKwh: number;
  percentError: number | null;
  weather?: unknown;
};

/** Validation compare "actual" column must match sage daily truth, not stitched interval re-sums. */
export function applySageActualDailyTruthToCompareRows<T extends ValidationCompareRowLike>(
  rows: T[],
  sageByDate: Map<string, number>
): T[] {
  if (sageByDate.size === 0) return rows;
  return rows.map((row) => {
    const date = asDateKey(row.localDate);
    if (!date) return row;
    const sageKwh = sageByDate.get(date);
    if (sageKwh === undefined) return row;
    const actualDayKwh = round2(sageKwh);
    const simulatedDayKwh = round2(Number(row.simulatedDayKwh) || 0);
    const errorKwh = round2(simulatedDayKwh - actualDayKwh);
    const percentError =
      Math.abs(actualDayKwh) > 1e-6 ? round2((Math.abs(errorKwh) / Math.abs(actualDayKwh)) * 100) : null;
    return {
      ...row,
      actualDayKwh,
      errorKwh,
      percentError,
    };
  });
}

/** Chicago calendar-day rollup for interval points (aligns with sage SMT daily SQL). */
export function aggregateChicagoDailyKwhFromIntervals(
  intervals: Array<{ timestamp: string; kwh?: number; consumption_kwh?: number }>
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const row of intervals ?? []) {
    const ts = String(row?.timestamp ?? "");
    if (!ts) continue;
    const parsed = new Date(ts);
    if (!Number.isFinite(parsed.getTime())) continue;
    const date = chicagoDateKey(parsed);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const kwh = Number(row?.kwh ?? row?.consumption_kwh ?? 0) || 0;
    byDate.set(date, round2((byDate.get(date) ?? 0) + kwh));
  }
  return byDate;
}
