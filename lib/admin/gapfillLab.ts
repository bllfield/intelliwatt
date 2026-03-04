/**
 * Gap-Fill Lab: compute comparison metrics between actual and simulated intervals on masked (travel/vacant) days.
 * Used only by the admin Gap-Fill Lab tool.
 */

export type IntervalPoint = { timestamp: string; kwh: number };

export function computeGapFillMetrics(args: {
  actual: IntervalPoint[];
  simulated: IntervalPoint[];
  /** Map timestamp (ISO) -> simulated kwh for lookup */
  simulatedByTs: Map<string, number>;
}): {
  mae: number;
  rmse: number;
  mape: number;
  maxAbs: number;
  byMonth: Array<{ month: string; mae: number; mape: number; count: number }>;
  byHour: Array<{ hour: number; mae: number; mape: number; count: number }>;
  byDayType: Array<{ dayType: "weekday" | "weekend"; mae: number; mape: number; count: number }>;
  worstDays: Array<{ date: string; absErrorKwh: number }>;
  pasteSummary: string;
} {
  const { actual, simulatedByTs } = args;
  const errors: number[] = [];
  const absErrors: number[] = [];
  const byMonth = new Map<string, { sumAbs: number; sumAbsPct: number; sumActual: number; count: number }>();
  const byHour = new Map<number, { sumAbs: number; sumAbsPct: number; sumActual: number; count: number }>();
  const byDayType = new Map<"weekday" | "weekend", { sumAbs: number; sumAbsPct: number; sumActual: number; count: number }>();
  const byDate = new Map<string, number>();

  for (const p of actual) {
    const ts = String(p?.timestamp ?? "").trim();
    const actualKwh = Number(p?.kwh) || 0;
    const simKwh = simulatedByTs.get(ts) ?? 0;
    const err = simKwh - actualKwh;
    const absErr = Math.abs(err);
    errors.push(err);
    absErrors.push(absErr);

    const date = ts.slice(0, 10);
    const month = date.slice(0, 7);
    const hour = new Date(ts).getUTCHours();
    const dow = new Date(ts).getUTCDay();
    const dayType: "weekday" | "weekend" = dow === 0 || dow === 6 ? "weekend" : "weekday";

    byDate.set(date, (byDate.get(date) ?? 0) + absErr);
    byMonth.set(month, {
      sumAbs: (byMonth.get(month)?.sumAbs ?? 0) + absErr,
      sumAbsPct: (byMonth.get(month)?.sumAbsPct ?? 0) + (actualKwh > 1e-6 ? absErr / actualKwh : 0),
      sumActual: (byMonth.get(month)?.sumActual ?? 0) + actualKwh,
      count: (byMonth.get(month)?.count ?? 0) + 1,
    });
    byHour.set(hour, {
      sumAbs: (byHour.get(hour)?.sumAbs ?? 0) + absErr,
      sumAbsPct: (byHour.get(hour)?.sumAbsPct ?? 0) + (actualKwh > 1e-6 ? absErr / actualKwh : 0),
      sumActual: (byHour.get(hour)?.sumActual ?? 0) + actualKwh,
      count: (byHour.get(hour)?.count ?? 0) + 1,
    });
    byDayType.set(dayType, {
      sumAbs: (byDayType.get(dayType)?.sumAbs ?? 0) + absErr,
      sumAbsPct: (byDayType.get(dayType)?.sumAbsPct ?? 0) + (actualKwh > 1e-6 ? absErr / actualKwh : 0),
      sumActual: (byDayType.get(dayType)?.sumActual ?? 0) + actualKwh,
      count: (byDayType.get(dayType)?.count ?? 0) + 1,
    });
  }

  const n = errors.length;
  const mae = n > 0 ? absErrors.reduce((a, b) => a + b, 0) / n : 0;
  const rmse = n > 0 ? Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / n) : 0;
  const sumActual = actual.reduce((s, p) => s + (Number(p.kwh) || 0), 0);
  const mape = sumActual > 1e-6 ? (absErrors.reduce((a, b) => a + b, 0) / sumActual) * 100 : 0;
  const maxAbs = absErrors.length > 0 ? Math.max(...absErrors) : 0;

  const round2 = (x: number) => Math.round(x * 100) / 100;

  const worstDays = Array.from(byDate.entries())
    .map(([date, absErrorKwh]) => ({ date, absErrorKwh }))
    .sort((a, b) => b.absErrorKwh - a.absErrorKwh)
    .slice(0, 10);

  const byMonthArr = Array.from(byMonth.entries())
    .map(([month, v]) => ({
      month,
      mae: round2(v.sumAbs / (v.count || 1)),
      mape: round2((v.count && v.sumActual > 1e-6 ? (v.sumAbsPct / v.count) * 100 : 0)),
      count: v.count,
    }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  const byHourArr = Array.from({ length: 24 }, (_, hour) => {
    const v = byHour.get(hour);
    return {
      hour,
      mae: v ? round2(v.sumAbs / (v.count || 1)) : 0,
      mape: v && v.count && v.sumActual > 1e-6 ? round2((v.sumAbsPct / v.count) * 100) : 0,
      count: v?.count ?? 0,
    };
  });

  const byDayTypeArr: Array<{ dayType: "weekday" | "weekend"; mae: number; mape: number; count: number }> = [
    "weekday",
    "weekend",
  ].map((dayType) => {
    const v = byDayType.get(dayType as "weekday" | "weekend");
    return {
      dayType: dayType as "weekday" | "weekend",
      mae: v ? round2(v.sumAbs / (v.count || 1)) : 0,
      mape: v && v.count && v.sumActual > 1e-6 ? round2((v.sumAbsPct / v.count) * 100) : 0,
      count: v?.count ?? 0,
    };
  });

  const pasteSummary = [
    `Gap-Fill Lab | masked intervals: ${n}`,
    `MAE: ${round2(mae)} kWh | RMSE: ${round2(rmse)} | MAPE: ${round2(mape)}% | MaxAbs: ${round2(maxAbs)} kWh`,
    `Worst days: ${worstDays.map((d) => `${d.date}: ${round2(d.absErrorKwh)}`).join(" | ")}`,
  ].join("\n");

  return {
    mae: round2(mae),
    rmse: round2(rmse),
    mape: round2(mape),
    maxAbs: round2(maxAbs),
    byMonth: byMonthArr,
    byHour: byHourArr,
    byDayType: byDayTypeArr,
    worstDays: worstDays.map((d) => ({ ...d, absErrorKwh: round2(d.absErrorKwh) })),
    pasteSummary,
  };
}

/** Return the next calendar date (YYYY-MM-DD) after the given one. */
function nextCalendarDay(ymd: string): string {
  const d = new Date(ymd + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Enumerate local date keys (YYYY-MM-DD) for a range. start/end are treated as calendar dates
 * (YYYY-MM-DD). If they are full ISO strings, they are converted to local date keys in tz first.
 * Returns the list of calendar date strings from start to end inclusive, so they match
 * dateKeyInTimezone(ts, tz) when filtering masked intervals. */
export function localDateKeysInRange(startDate: string, endDate: string, tz: string): string[] {
  const rawStart = String(startDate).trim();
  const rawEnd = String(endDate).trim();
  const startKey = /^\d{4}-\d{2}-\d{2}$/.test(rawStart.slice(0, 10))
    ? rawStart.slice(0, 10)
    : dateKeyInTimezone(rawStart, tz);
  const endKey = /^\d{4}-\d{2}-\d{2}$/.test(rawEnd.slice(0, 10))
    ? rawEnd.slice(0, 10)
    : dateKeyInTimezone(rawEnd, tz);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey) || !/^\d{4}-\d{2}-\d{2}$/.test(endKey)) return [];
  const first = startKey <= endKey ? startKey : endKey;
  const last = startKey <= endKey ? endKey : startKey;
  const out: string[] = [];
  let cur = first;
  while (cur <= last) {
    out.push(cur);
    if (cur === last) break;
    cur = nextCalendarDay(cur);
  }
  return out;
}

/** Get local date key (YYYY-MM-DD) for a timestamp in the given timezone. */
export function dateKeyInTimezone(tsIso: string, tz: string): string {
  try {
    const d = new Date(tsIso);
    if (!Number.isFinite(d.getTime())) return tsIso.slice(0, 10);
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const parts = fmt.formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value ?? "";
    const day = parts.find((p) => p.type === "day")?.value ?? "";
    return `${y}-${m}-${day}`;
  } catch {
    return tsIso.slice(0, 10);
  }
}