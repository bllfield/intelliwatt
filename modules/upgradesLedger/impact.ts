/**
 * Upgrade Impact Contract (V1).
 * Normalized output from each upgrade so overlay/curve can consume deltas.
 * V1: additive (kWh deltas) only; multipliers are not supported.
 */

/** YYYY-MM key */
export type YearMonthKey = string;

/** Optional 96-interval daily shape (15-min). When present, delta is applied using this shape per day, normalized so month total matches. */
export type DailyDeltaShape96 = number[];

/** Schedule window for pool, EV, etc. */
export type ScheduleWindow = { start: string; end: string; daysOfWeek?: number[] };

export type UpgradeImpact = {
  /** Per-month kWh delta. When set, overlay uses this instead of uniform monthly or annual-derived. */
  monthlyDeltaKwhByMonth?: Record<YearMonthKey, number>;
  /** Intraday shape for the delta (96 values). Applied per day, normalized so month total matches monthly delta. */
  dailyDeltaShape96?: DailyDeltaShape96;
  /** HVAC/occupancy flags, heat source, etc. (future profile-driven effects). */
  profileParamPatch?: Record<string, unknown>;
  /** Pool, EV, and other scheduled loads. */
  schedules?: ScheduleWindow[];
};

/** V1: single monthly delta (same for each impacted month) or annual to distribute. Stored on ledger / impact blob. */
export type V1DeltaInput = {
  /** kWh change per month (same value to each impacted month). Takes precedence over annualDeltaKwh when both exist. */
  monthlyDeltaKwh?: number | null;
  /** kWh change per year across canonical window; distributed into months by baseline share when monthlyDeltaKwh is missing. */
  annualDeltaKwh?: number | null;
  dailyDeltaShape96?: DailyDeltaShape96 | null;
  schedules?: ScheduleWindow[] | null;
};

const YEAR_MONTH_REGEX = /^\d{4}-\d{2}$/;

export function isYearMonthKey(s: unknown): s is YearMonthKey {
  return typeof s === "string" && YEAR_MONTH_REGEX.test(s.trim());
}

/**
 * Extract V1 delta input from a ledger row (existing columns or impact blob).
 * Uses: deltaKwhAnnualSimulated, deltaKwhMonthlySimulatedJson, and optional impactJson when present.
 */
export function getV1DeltaFromLedgerRow(row: {
  deltaKwhAnnualSimulated?: number | null;
  deltaKwhMonthlySimulatedJson?: unknown;
  impactJson?: unknown;
}): V1DeltaInput {
  const impact = row.impactJson && typeof row.impactJson === "object" && !Array.isArray(row.impactJson)
    ? (row.impactJson as Record<string, unknown>)
    : null;
  const monthlyFromJson = row.deltaKwhMonthlySimulatedJson && typeof row.deltaKwhMonthlySimulatedJson === "object" && !Array.isArray(row.deltaKwhMonthlySimulatedJson)
    ? (row.deltaKwhMonthlySimulatedJson as Record<string, unknown>)
    : null;

  const monthlyDeltaKwh = impact?.monthlyDeltaKwh != null && Number.isFinite(Number(impact.monthlyDeltaKwh))
    ? Number(impact.monthlyDeltaKwh)
    : monthlyFromJson?.uniform != null && Number.isFinite(Number(monthlyFromJson.uniform))
      ? Number(monthlyFromJson.uniform)
      : monthlyFromJson?.value != null && Number.isFinite(Number(monthlyFromJson.value))
        ? Number(monthlyFromJson.value)
        : null;

  const annualDeltaKwh = impact?.annualDeltaKwh != null && Number.isFinite(Number(impact.annualDeltaKwh))
    ? Number(impact.annualDeltaKwh)
    : row.deltaKwhAnnualSimulated != null && Number.isFinite(row.deltaKwhAnnualSimulated)
      ? row.deltaKwhAnnualSimulated
      : null;

  const dailyDeltaShape96 = impact?.dailyDeltaShape96;
  const shape96 = Array.isArray(dailyDeltaShape96) && dailyDeltaShape96.length === 96
    ? (dailyDeltaShape96 as number[])
    : null;

  const schedules = impact?.schedules;
  const sched = Array.isArray(schedules) ? (schedules as ScheduleWindow[]) : null;

  return {
    monthlyDeltaKwh: monthlyDeltaKwh ?? null,
    annualDeltaKwh: annualDeltaKwh ?? null,
    dailyDeltaShape96: shape96 ?? null,
    schedules: sched ?? null,
  };
}
