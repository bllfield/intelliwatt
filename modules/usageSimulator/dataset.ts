import { logSimPipelineEvent } from "@/modules/usageSimulator/simObservability";
import { generateSimulatedCurve } from "@/modules/simulatedUsage/engine";
import { roundDayKwhDisplay } from "@/modules/simulatedUsage/pastDaySimulator";
import type { SimulatedDayResult } from "@/modules/simulatedUsage/pastDaySimulatorTypes";
import type { SimulatedCurve } from "@/modules/simulatedUsage/types";
import type { ResolvedSimFingerprint } from "@/modules/usageSimulator/resolvedSimFingerprintTypes";

type UsageSeriesPoint = { timestamp: string; kwh: number };

/** Per-day Past display: stitch/simulator-owned reasons (not GapFill compare). */
export type PastSimulatedDaySourceDetail =
  | "SIMULATED_TRAVEL_VACANT"
  | "SIMULATED_TEST_DAY"
  | "SIMULATED_INCOMPLETE_METER"
  | "SIMULATED_LEADING_MISSING"
  | "SIMULATED_OTHER";

function round2(n: number): number {
  return roundDayKwhDisplay(n);
}

function low10Average(values: number[]): number | null {
  const finite = (values ?? []).filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const positive = finite.filter((v) => v > 1e-6).sort((a, b) => a - b);
  const count10 = Math.max(1, Math.floor((positive.length || finite.length) * 0.1));
  const slice =
    positive.length >= count10
      ? positive.slice(0, count10)
      : finite.sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(finite.length * 0.1)));
  if (!slice.length) return null;
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  return Number.isFinite(avg) ? round2(avg) : null;
}

type BaseloadOptions = {
  excludedDateKeys?: Set<string>;
  minDayKwhFloor?: number;
  baseloadDayMultiplier?: number;
  percentile?: number;
};

function dateKeyUtcFromIso(tsIso: string): string {
  return tsIso.slice(0, 10);
}

function percentileCont(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function computeNormalLifeBaseloadKw(
  intervals: Array<{ tsIso: string; kwh: number }>,
  options: BaseloadOptions = {}
): { baseloadKw: number | null; fallbackUsed: boolean; debugNote: string | null } {
  const minDayKwhFloor = Number.isFinite(options.minDayKwhFloor) ? Number(options.minDayKwhFloor) : 4;
  const baseloadDayMultiplier = Number.isFinite(options.baseloadDayMultiplier)
    ? Number(options.baseloadDayMultiplier)
    : 1.3;
  const percentile = Number.isFinite(options.percentile) ? Number(options.percentile) : 0.1;
  const excluded = options.excludedDateKeys;

  const kept: Array<{ tsIso: string; kwh: number; dayKey: string }> = [];
  for (const row of intervals ?? []) {
    const tsIso = String(row?.tsIso ?? "");
    const kwh = Number(row?.kwh);
    if (!tsIso || !Number.isFinite(kwh)) continue;
    const dayKey = dateKeyUtcFromIso(tsIso);
    if (excluded?.has(dayKey)) continue;
    kept.push({ tsIso, kwh, dayKey });
  }

  const dayTotals = new Map<string, number>();
  for (const row of kept) dayTotals.set(row.dayKey, (dayTotals.get(row.dayKey) ?? 0) + row.kwh);
  const positiveDayTotals = Array.from(dayTotals.values())
    .filter((v) => Number.isFinite(v) && v > 1e-6)
    .sort((a, b) => a - b);
  const lowCount = Math.max(1, Math.floor(positiveDayTotals.length * 0.2));
  const lowSlice = positiveDayTotals.slice(0, lowCount);
  const avgLowDayKwh =
    lowSlice.length > 0 ? lowSlice.reduce((a, b) => a + b, 0) / lowSlice.length : null;
  const baseloadKwhPerDayCandidate = avgLowDayKwh ?? 0;
  const minDayKwh = Math.max(minDayKwhFloor, baseloadKwhPerDayCandidate * baseloadDayMultiplier);

  const qualityDays = new Set<string>();
  dayTotals.forEach((total, dayKey) => {
    if ((Number(total) || 0) >= minDayKwh) qualityDays.add(dayKey);
  });
  const qualityRows = kept.filter((row) => qualityDays.has(row.dayKey));
  const filteredKwSamples = qualityRows
    .map((row) => (Number(row.kwh) || 0) * 4)
    .filter((kw) => Number.isFinite(kw) && kw > 1e-6)
    .sort((a, b) => a - b);

  if (filteredKwSamples.length < 500) {
    const fallbackKw = kept
      .map((row) => (Number(row.kwh) || 0) * 4)
      .filter((kw) => Number.isFinite(kw) && kw > 1e-6)
      .sort((a, b) => a - b);
    const p10Fallback = percentileCont(fallbackKw, percentile);
    const fallbackSlice = p10Fallback == null ? [] : fallbackKw.filter((kw) => kw <= p10Fallback);
    const fallbackAvg =
      fallbackSlice.length > 0
        ? fallbackSlice.reduce((a, b) => a + b, 0) / fallbackSlice.length
        : null;
    return {
      baseloadKw: fallbackAvg == null ? null : round2(fallbackAvg),
      fallbackUsed: true,
      debugNote: "Baseload fallback used: fewer than 500 filtered interval samples.",
    };
  }

  const p10 = percentileCont(filteredKwSamples, percentile);
  const pool = p10 == null ? [] : filteredKwSamples.filter((kw) => kw <= p10);
  const avg = pool.length > 0 ? pool.reduce((a, b) => a + b, 0) / pool.length : null;
  return { baseloadKw: avg == null ? null : round2(avg), fallbackUsed: false, debugNote: null };
}

function toDateKey(tsIso: string): string {
  return tsIso.slice(0, 10);
}

function dayOfWeekUtc(dateKey: string): number {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  const t = d.getTime();
  if (!Number.isFinite(t)) return 0;
  return d.getUTCDay();
}

function daysInMonth(year: number, month1: number): number {
  if (!Number.isFinite(year) || !Number.isFinite(month1) || month1 < 1 || month1 > 12) return 31;
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function chicagoParts(ts: Date): { year: number; month: number; day: number; yearMonth: string } | null {
  return datePartsInTimezone(ts, "America/Chicago");
}

/** Date parts in a given timezone (for monthly grouping). Uses same shape as chicagoParts. */
function datePartsInTimezone(ts: Date, tz: string): { year: number; month: number; day: number; yearMonth: string } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(ts);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const year = Number(get("year"));
    const month = Number(get("month"));
    const day = Number(get("day"));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { year, month, day, yearMonth: `${String(year)}-${String(month).padStart(2, "0")}` };
  } catch {
    return null;
  }
}

function lastNYearMonthsFrom(year: number, month1: number, n: number): string[] {
  const out: string[] = [];
  const count = Math.max(1, Math.floor(n));
  for (let i = count - 1; i >= 0; i--) {
    const idx = month1 - i;
    const y = idx >= 1 ? year : year - Math.ceil((1 - idx) / 12);
    const m = ((idx - 1) % 12 + 12) % 12 + 1;
    out.push(`${String(y)}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

function buildDisplayMonthlyFromIntervals(args: {
  intervals: Array<{ timestamp: string; consumption_kwh: number }>;
  endDate: string;
  /** When set, group by this timezone (e.g. house timezone). Otherwise uses America/Chicago for backward compatibility. */
  timezone?: string;
  /** When true, group intervals by UTC month (timestamp YYYY-MM). Use for Past stitched curves so monthly matches daily and no zeros from TZ shift. */
  useUtcMonth?: boolean;
}): {
  monthly: Array<{ month: string; kwh: number }>;
  stitchedMonth:
    | {
        mode: "PRIOR_YEAR_TAIL";
        yearMonth: string;
        haveDaysThrough: number;
        missingDaysFrom: number;
        missingDaysTo: number;
        borrowedFromYearMonth: string;
        completenessRule: string;
      }
    | null;
} {
  const useUtcMonth = Boolean(args.useUtcMonth);
  const tz = args.timezone && args.timezone.trim() ? args.timezone.trim() : "America/Chicago";
  const partsFn = (ts: Date) => datePartsInTimezone(ts, tz);
  const monthTotals = new Map<string, number>();
  const dayTotals = new Map<string, number>(); // `${YYYY-MM}-${DD}`
  for (const iv of args.intervals ?? []) {
    const tsIso = String(iv?.timestamp ?? "");
    const kwh = Number(iv?.consumption_kwh) || 0;
    if (useUtcMonth) {
      const ym = tsIso.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      monthTotals.set(ym, (monthTotals.get(ym) ?? 0) + kwh);
      const dateKey = tsIso.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        dayTotals.set(dateKey, (dayTotals.get(dateKey) ?? 0) + kwh);
      }
    } else {
      const ts = new Date(tsIso);
      if (!Number.isFinite(ts.getTime())) continue;
      const p = partsFn(ts);
      if (!p) continue;
      monthTotals.set(p.yearMonth, (monthTotals.get(p.yearMonth) ?? 0) + kwh);
      const dayKey = `${p.yearMonth}-${String(p.day).padStart(2, "0")}`;
      dayTotals.set(dayKey, (dayTotals.get(dayKey) ?? 0) + kwh);
    }
  }

  const endAnchor = new Date(`${String(args.endDate).slice(0, 10)}T23:59:59.999Z`);
  let endParts: { year: number; month: number; day: number; yearMonth: string };
  if (useUtcMonth) {
    const y = endAnchor.getUTCFullYear();
    const m = endAnchor.getUTCMonth() + 1;
    const d = endAnchor.getUTCDate();
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      const fallback = Array.from(monthTotals.entries())
        .map(([month, kwh]) => ({ month, kwh: round2(kwh) }))
        .sort((a, b) => (a.month < b.month ? -1 : 1));
      return { monthly: fallback, stitchedMonth: null };
    }
    endParts = { year: y, month: m, day: d, yearMonth: `${String(y)}-${String(m).padStart(2, "0")}` };
  } else {
    const p = partsFn(endAnchor);
    if (!p) {
      const fallback = Array.from(monthTotals.entries())
        .map(([month, kwh]) => ({ month, kwh: round2(kwh) }))
        .sort((a, b) => (a.month < b.month ? -1 : 1));
      return { monthly: fallback, stitchedMonth: null };
    }
    endParts = p;
  }

  const yearMonths = lastNYearMonthsFrom(endParts.year, endParts.month, 12);
  const displayTotals = new Map<string, number>();
  for (const ym of yearMonths) displayTotals.set(ym, monthTotals.get(ym) ?? 0);

  const dim = daysInMonth(endParts.year, endParts.month);
  const haveDaysThrough = Math.max(0, Math.min(dim, endParts.day));
  let stitchedMonth: {
    mode: "PRIOR_YEAR_TAIL";
    yearMonth: string;
    haveDaysThrough: number;
    missingDaysFrom: number;
    missingDaysTo: number;
    borrowedFromYearMonth: string;
    completenessRule: string;
  } | null = null;

  if (haveDaysThrough < dim) {
    const borrowedFromYearMonth = `${String(endParts.year - 1)}-${String(endParts.month).padStart(2, "0")}`;
    let stitchedKwh = 0;
    for (let d = 1; d <= haveDaysThrough; d++) {
      const k = `${endParts.yearMonth}-${String(d).padStart(2, "0")}`;
      stitchedKwh += dayTotals.get(k) ?? 0;
    }
    for (let d = haveDaysThrough + 1; d <= dim; d++) {
      const k = `${borrowedFromYearMonth}-${String(d).padStart(2, "0")}`;
      stitchedKwh += dayTotals.get(k) ?? 0;
    }
    displayTotals.set(endParts.yearMonth, stitchedKwh);
    stitchedMonth = {
      mode: "PRIOR_YEAR_TAIL",
      yearMonth: endParts.yearMonth,
      haveDaysThrough,
      missingDaysFrom: haveDaysThrough + 1,
      missingDaysTo: dim,
      borrowedFromYearMonth,
      completenessRule: "SIMULATED_INTERVALS",
    };
  }

  const monthly = yearMonths.map((month) => ({ month, kwh: round2(displayTotals.get(month) ?? 0) }));
  return { monthly, stitchedMonth };
}

/** UTC-month variant for interval-based curves (Past stitched). Exported for cache restore. */
export function buildDisplayMonthlyFromIntervalsUtc(
  intervals: Array<{ timestamp: string; consumption_kwh: number }>,
  endDate: string
): {
  monthly: Array<{ month: string; kwh: number }>;
  usageBucketsByMonth: Record<string, Record<string, number>>;
  stitchedMonth:
    | {
        mode: "PRIOR_YEAR_TAIL";
        yearMonth: string;
        haveDaysThrough: number;
        missingDaysFrom: number;
        missingDaysTo: number;
        borrowedFromYearMonth: string;
        completenessRule: string;
      }
    | null;
} {
  const monthlyBuild = buildDisplayMonthlyFromIntervals({
    intervals,
    endDate,
    useUtcMonth: true,
  });
  const usageBucketsByMonth = usageBucketsByMonthFromSimulatedMonthly(monthlyBuild.monthly);
  return { monthly: monthlyBuild.monthly, usageBucketsByMonth, stitchedMonth: monthlyBuild.stitchedMonth };
}

/** Build daily array from 15-min intervals (one row per date, sorted ascending). For cache restore so daily matches the interval set. */
export function buildDailyFromIntervals(
  intervals: Array<{ timestamp: string; consumption_kwh?: number; kwh?: number }>,
  simulatedDateKeys?: Set<string>
): Array<{ date: string; kwh: number; source?: "ACTUAL" | "SIMULATED" }> {
  const dailyMap = new Map<string, number>();
  for (const iv of intervals ?? []) {
    const dk = String(iv?.timestamp ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    const kwh = Number(iv?.consumption_kwh ?? iv?.kwh ?? 0) || 0;
    dailyMap.set(dk, (dailyMap.get(dk) ?? 0) + kwh);
  }
  return Array.from(dailyMap.entries())
    .map(([date, kwh]) => ({
      date,
      kwh: round2(kwh),
      ...(simulatedDateKeys ? { source: simulatedDateKeys.has(date) ? ("SIMULATED" as const) : ("ACTUAL" as const) } : {}),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Shared interval aggregation for Past parity/restore:
 * - interval sum (source-of-truth for summary totals),
 * - daily totals (from intervals),
 * - display monthly totals (UTC month, stitched end-month semantics).
 */
export function recomputePastAggregatesFromIntervals(args: {
  intervals: Array<{ timestamp: string; consumption_kwh?: number; kwh?: number }>;
  curveEndDate?: string | null;
  simulatedDateKeys?: Set<string>;
}): {
  intervalCount: number;
  intervalSumKwh: number;
  daily: Array<{ date: string; kwh: number; source?: "ACTUAL" | "SIMULATED" }>;
  dailySumKwh: number;
  monthly: Array<{ month: string; kwh: number }>;
  monthlySumKwh: number;
  usageBucketsByMonth: Record<string, Record<string, number>>;
  stitchedMonth:
    | {
        mode: "PRIOR_YEAR_TAIL";
        yearMonth: string;
        haveDaysThrough: number;
        missingDaysFrom: number;
        missingDaysTo: number;
        borrowedFromYearMonth: string;
        completenessRule: string;
      }
    | null;
} {
  const normalized = (args.intervals ?? []).map((iv) => ({
    timestamp: String(iv?.timestamp ?? ""),
    kwh: Number(iv?.consumption_kwh ?? iv?.kwh ?? 0) || 0,
  }));
  const intervalCount = normalized.length;
  const intervalSumKwh = round2(normalized.reduce((s, r) => s + (Number(r.kwh) || 0), 0));
  const daily = buildDailyFromIntervals(normalized, args.simulatedDateKeys);
  const dailySumKwh = round2(daily.reduce((s, d) => s + (Number(d?.kwh) || 0), 0));
  const fallbackCurveEnd =
    normalized.length > 0 ? String(normalized[normalized.length - 1]?.timestamp ?? "").slice(0, 10) : "";
  const curveEnd = String(args.curveEndDate ?? "").slice(0, 10) || fallbackCurveEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(curveEnd)) {
    return {
      intervalCount,
      intervalSumKwh,
      daily,
      dailySumKwh,
      monthly: [],
      monthlySumKwh: 0,
      usageBucketsByMonth: {},
      stitchedMonth: null,
    };
  }
  const monthlyBuild = buildDisplayMonthlyFromIntervalsUtc(
    normalized.map((iv) => ({
      timestamp: String(iv.timestamp ?? ""),
      consumption_kwh: Number(iv.kwh) || 0,
    })),
    curveEnd
  );
  const monthly = monthlyBuild.monthly;
  const monthlySumKwh = round2(monthly.reduce((s, m) => s + (Number(m?.kwh) || 0), 0));
  return {
    intervalCount,
    intervalSumKwh,
    daily,
    dailySumKwh,
    monthly,
    monthlySumKwh,
    usageBucketsByMonth: monthlyBuild.usageBucketsByMonth,
    stitchedMonth: monthlyBuild.stitchedMonth,
  };
}

/**
 * True when persisted meta includes explicit simulated-day ownership fields (possibly empty).
 * Plain `meta: {}` from older saves is treated as absent so legacy daily-row labeling still applies.
 */
export function pastMetaHasExplicitSimulatedDayFields(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(m, "simulatedTravelVacantDateKeysLocal") ||
    Object.prototype.hasOwnProperty.call(m, "simulatedTestModeledDateKeysLocal") ||
    Object.prototype.hasOwnProperty.call(m, "simulatedSourceDetailByDate")
  );
}

const CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY = "canonicalArtifactSimulatedDayTotalsByDate";

/**
 * Date keys for which the persisted artifact records simulated-day kWh totals (same authority as
 * `readCanonicalArtifactSimulatedDayTotalsByDate` in service). When non-empty, this is the
 * authoritative simulated-day membership set for restore — it cannot be expanded by stale keys left
 * in `simulatedSourceDetailByDate` from an older save.
 */
export function readCanonicalSimulatedDateKeysFromDataset(dataset: unknown): Set<string> {
  const out = new Set<string>();
  const addFrom = (raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    for (const k of Object.keys(raw as Record<string, unknown>)) {
      const dk = String(k).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) out.add(dk);
    }
  };
  if (!dataset || typeof dataset !== "object") return out;
  const d = dataset as Record<string, unknown>;
  const meta = d.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    addFrom((meta as Record<string, unknown>)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY]);
  }
  addFrom(d[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY]);
  return out;
}

/**
 * Simulated-day keys from persisted artifact meta (current-run truth). Prefer this over scanning
 * `dataset.daily` for SIMULATED rows so stale labels from an older save cannot leak into restore.
 * Returns an empty set when meta lists/maps are empty (no simulated days in this artifact).
 *
 * `reconcileRestoredPastDatasetFromDecodedIntervals` prefers `readCanonicalSimulatedDateKeysFromDataset`
 * when that set is non-empty; this union (including keys from `simulatedSourceDetailByDate`) is used
 * for legacy artifacts without canonical per-day totals.
 */
export function simulatedDateKeysUnionFromPastDatasetMeta(meta: unknown): Set<string> {
  const out = new Set<string>();
  if (!meta || typeof meta !== "object") return out;
  const m = meta as Record<string, unknown>;
  const addArr = (a: unknown) => {
    if (!Array.isArray(a)) return;
    for (const x of a) {
      const dk = String(x ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) out.add(dk);
    }
  };
  addArr(m.simulatedTravelVacantDateKeysLocal);
  addArr(m.simulatedTestModeledDateKeysLocal);
  const byDetail = m.simulatedSourceDetailByDate;
  if (byDetail && typeof byDetail === "object" && !Array.isArray(byDetail)) {
    for (const k of Object.keys(byDetail)) {
      const dk = String(k).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) out.add(dk);
    }
  }
  return out;
}

/** Legacy: derive simulated keys from stored daily rows when meta has no simulated-day lists/maps. */
export function simulatedDateKeysFromPastDatasetDaily(daily: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(daily)) return out;
  for (const d of daily) {
    const row = d as { source?: string; date?: string };
    if (String(row?.source ?? "").toUpperCase() !== "SIMULATED") continue;
    const dk = String(row?.date ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) out.add(dk);
  }
  return out;
}

export function enrichPastDailyRowsWithSourceDetailFromMeta(
  daily: Array<{ date: string; kwh: number; source?: string }>,
  meta: unknown,
  options?: {
    /** When meta omits per-day detail, use labels from the pre-reconcile daily rows (legacy artifacts). */
    legacyDailyByDate?: Map<string, { sourceDetail?: string }>;
  }
): Array<{
  date: string;
  kwh: number;
  source: "ACTUAL" | "SIMULATED";
  sourceDetail: PastSimulatedDaySourceDetail | "ACTUAL";
}> {
  const m = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : null;
  const byDetail = m?.simulatedSourceDetailByDate as Record<string, PastSimulatedDaySourceDetail> | undefined;
  const legacyMap = options?.legacyDailyByDate;
  return daily.map((row) => {
    const dk = String(row.date).slice(0, 10);
    const isSim = String(row.source ?? "").toUpperCase() === "SIMULATED";
    if (!isSim) {
      return {
        date: dk,
        kwh: row.kwh,
        source: "ACTUAL" as const,
        sourceDetail: "ACTUAL" as const,
      };
    }
    const hasMetaDetailKey =
      byDetail && typeof byDetail === "object" && Object.prototype.hasOwnProperty.call(byDetail, dk);
    if (hasMetaDetailKey) {
      const detail = (byDetail as Record<string, unknown>)[dk];
      const sourceDetail: PastSimulatedDaySourceDetail =
        detail === "SIMULATED_TRAVEL_VACANT" || detail === "SIMULATED_TEST_DAY"
          ? detail
          : detail === "SIMULATED_INCOMPLETE_METER" || detail === "SIMULATED_LEADING_MISSING"
            ? detail
            : "SIMULATED_OTHER";
      return { date: dk, kwh: row.kwh, source: "SIMULATED" as const, sourceDetail };
    }
    const legacyDetail = String(legacyMap?.get(dk)?.sourceDetail ?? "");
    if (
      legacyDetail === "SIMULATED_TRAVEL_VACANT" ||
      legacyDetail === "SIMULATED_TEST_DAY" ||
      legacyDetail === "SIMULATED_INCOMPLETE_METER" ||
      legacyDetail === "SIMULATED_LEADING_MISSING"
    ) {
      return { date: dk, kwh: row.kwh, source: "SIMULATED" as const, sourceDetail: legacyDetail as PastSimulatedDaySourceDetail };
    }
    return {
      date: dk,
      kwh: row.kwh,
      source: "SIMULATED" as const,
      sourceDetail: "SIMULATED_OTHER",
    };
  });
}

/**
 * After decoding `intervals15` from the blob, rebuild `daily` / aggregates from intervals so
 * persisted `datasetJson.daily` cannot carry stale SIMULATED rows or labels from a prior run.
 * Simulated-day membership and sourceDetail come from meta when present; otherwise legacy daily scan.
 */
export function reconcileRestoredPastDatasetFromDecodedIntervals(args: {
  dataset: any;
  decodedIntervals: Array<{ timestamp: string; kwh?: number; consumption_kwh?: number }>;
  fallbackEndDate: string;
}): void {
  const { dataset, decodedIntervals, fallbackEndDate } = args;
  if (!dataset || typeof dataset !== "object" || !Array.isArray(decodedIntervals) || decodedIntervals.length === 0) {
    return;
  }
  const lastDecodedTs = decodedIntervals[decodedIntervals.length - 1]?.timestamp;
  const curveEnd =
    (lastDecodedTs && String(lastDecodedTs).slice(0, 10)) ||
    String((dataset as any)?.summary?.end ?? fallbackEndDate).slice(0, 10);

  const meta = (dataset as any)?.meta;
  const canonicalSimKeys = readCanonicalSimulatedDateKeysFromDataset(dataset);
  const simDateKeys =
    canonicalSimKeys.size > 0
      ? canonicalSimKeys
      : pastMetaHasExplicitSimulatedDayFields(meta)
        ? simulatedDateKeysUnionFromPastDatasetMeta(meta)
        : simulatedDateKeysFromPastDatasetDaily((dataset as any)?.daily);

  const recomputed = recomputePastAggregatesFromIntervals({
    intervals: decodedIntervals,
    curveEndDate: curveEnd,
    simulatedDateKeys: simDateKeys,
  });

  const legacyDailyByDate = new Map<string, { sourceDetail?: string }>();
  for (const d of Array.isArray((dataset as any)?.daily) ? (dataset as any).daily : []) {
    const dk = String((d as any)?.date ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) legacyDailyByDate.set(dk, { sourceDetail: (d as any)?.sourceDetail });
  }
  const enrichedDaily = enrichPastDailyRowsWithSourceDetailFromMeta(recomputed.daily, (dataset as any)?.meta, {
    legacyDailyByDate,
  });

  (dataset as any).daily = enrichedDaily;
  if (recomputed.monthly.length > 0) {
    (dataset as any).monthly = recomputed.monthly;
    (dataset as any).usageBucketsByMonth = recomputed.usageBucketsByMonth;
  }

  (dataset as any).series.daily = enrichedDaily.map((d) => ({
    timestamp: `${d.date}T00:00:00.000Z`,
    kwh: Number(d.kwh) || 0,
    source: d.source,
    sourceDetail: d.sourceDetail,
  }));
  if (recomputed.monthly.length > 0) {
    (dataset as any).series.monthly = recomputed.monthly.map((m) => ({
      timestamp: `${m.month}-01T00:00:00.000Z`,
      kwh: Number(m.kwh) || 0,
    }));
    (dataset as any).series.annual = [
      {
        timestamp: `${curveEnd.slice(0, 4)}-01-01T00:00:00.000Z`,
        kwh: recomputed.monthlySumKwh,
      },
    ];
  }

  if (dataset.insights && typeof dataset.insights === "object") {
    let weekdaySum = 0;
    let weekendSum = 0;
    for (const row of enrichedDaily) {
      const dow = dayOfWeekUtc(row.date);
      const kwh = Number(row.kwh) || 0;
      if (dow === 0 || dow === 6) weekendSum += kwh;
      else weekdaySum += kwh;
    }
    (dataset.insights as any).weekdayVsWeekend = { weekday: round2(weekdaySum), weekend: round2(weekendSum) };
    if (enrichedDaily.length > 0) {
      const peakDay = enrichedDaily.reduce((a, b) => (b.kwh > a.kwh ? b : a));
      (dataset.insights as any).peakDay = { date: peakDay.date, kwh: peakDay.kwh };
    }
    if (recomputed.stitchedMonth !== undefined) {
      (dataset.insights as any).stitchedMonth = recomputed.stitchedMonth;
    }
  }

  if (!dataset.summary || typeof dataset.summary !== "object") (dataset as any).summary = {};
  if ((dataset.summary as any).totalKwh == null) {
    (dataset.summary as any).totalKwh = recomputed.intervalSumKwh;
  }
  if ((dataset.summary as any).intervalsCount == null) {
    (dataset.summary as any).intervalsCount = recomputed.intervalCount;
  }
  if (!dataset.totals || typeof dataset.totals !== "object") (dataset as any).totals = {};
  if ((dataset.totals as any).importKwh == null) {
    (dataset.totals as any).importKwh = recomputed.intervalSumKwh;
  }
  if ((dataset.totals as any).netKwh == null) {
    (dataset.totals as any).netKwh = recomputed.intervalSumKwh;
  }
  if ((dataset.totals as any).exportKwh == null) {
    (dataset.totals as any).exportKwh = 0;
  }
}

function buildMonthlyTotalsFromIntervals(intervals: Array<{ timestamp: string; consumption_kwh: number }>) {
  const monthTotals = new Map<string, number>();
  for (const iv of intervals ?? []) {
    const tsIso = String(iv?.timestamp ?? "");
    const ym = tsIso.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const kwh = Number(iv?.consumption_kwh) || 0;
    monthTotals.set(ym, (monthTotals.get(ym) ?? 0) + kwh);
  }
  return Array.from(monthTotals.entries())
    .map(([month, kwh]) => ({ month, kwh: round2(kwh) }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

function computeFifteenMinuteAverages(intervals: Array<{ timestamp: string; consumption_kwh: number }>) {
  const buckets = new Map<string, { sumKw: number; count: number }>();
  for (let i = 0; i < intervals.length; i++) {
    const ts = intervals[i].timestamp;
    const hhmm = ts.slice(11, 16);
    const kwh = Number(intervals[i].consumption_kwh) || 0;
    const kw = kwh * 4;
    const cur = buckets.get(hhmm) ?? { sumKw: 0, count: 0 };
    cur.sumKw += kw;
    cur.count += 1;
    buckets.set(hhmm, cur);
  }
  return Array.from(buckets.entries())
    .map(([hhmm, v]) => ({ hhmm, avgKw: v.count > 0 ? round2(v.sumKw / v.count) : 0 }))
    .sort((a, b) => (a.hhmm < b.hhmm ? -1 : 1));
}

function chicagoHour(ts: Date): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(ts);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "");
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
    return hour;
  } catch {
    return null;
  }
}

function computeTimeOfDayBuckets(intervals: Array<{ timestamp: string; consumption_kwh: number }>) {
  const sums = { overnight: 0, morning: 0, afternoon: 0, evening: 0 };
  for (const iv of intervals ?? []) {
    const ts = new Date(String(iv?.timestamp ?? ""));
    if (!Number.isFinite(ts.getTime())) continue;
    const hour = chicagoHour(ts);
    if (hour == null) continue;
    const kwh = Number(iv?.consumption_kwh) || 0;
    if (hour < 6) sums.overnight += kwh;
    else if (hour < 12) sums.morning += kwh;
    else if (hour < 18) sums.afternoon += kwh;
    else sums.evening += kwh;
  }
  return [
    { key: "overnight", label: "Overnight (12am–6am)", kwh: round2(sums.overnight) },
    { key: "morning", label: "Morning (6am–12pm)", kwh: round2(sums.morning) },
    { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: round2(sums.afternoon) },
    { key: "evening", label: "Evening (6pm–12am)", kwh: round2(sums.evening) },
  ];
}

function excludedDateKeysFromTravelRanges(
  ranges: Array<{ startDate: string; endDate: string }> | undefined
): Set<string> {
  const out = new Set<string>();
  for (const r of ranges ?? []) {
    const start = String(r?.startDate ?? "").slice(0, 10);
    const end = String(r?.endDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
    const a = new Date(start + "T12:00:00.000Z");
    const b = new Date(end + "T12:00:00.000Z");
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) continue;
    let ms = Math.min(a.getTime(), b.getTime());
    const last = Math.max(a.getTime(), b.getTime());
    while (ms <= last) {
      out.add(new Date(ms).toISOString().slice(0, 10));
      ms += 24 * 60 * 60 * 1000;
    }
  }
  return out;
}

export type SimulatorBuildInputsV1 = {
  version: 1;
  mode: "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";
  baseKind: "MANUAL" | "ESTIMATED" | "SMT_ACTUAL_BASELINE";
  canonicalEndMonth: string;
  canonicalMonths: string[];
  // For manual billing-period semantics (V1): optional explicit periods overriding calendar-month bucketing.
  canonicalPeriods?: Array<{ id: string; startDate: string; endDate: string }>;
  weatherPreference?: "NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE";
  weatherNormalizerVersion?: string;
  monthlyTotalsKwhByMonth: Record<string, number>;
  intradayShape96: number[];
  weekdayWeekendShape96?: { weekday: number[]; weekend: number[] };
  travelRanges?: Array<{ startDate: string; endDate: string }>;
  /** Optional shared actual-context source house; defaults to the scenario houseId. */
  actualContextHouseId?: string;
  /**
   * Gap-Fill validation-only days simulated in the canonical recalc run.
   * These keys remain ACTUAL in baseline display surfaces and are used for compare projection sidecar output.
   */
  validationOnlyDateKeysLocal?: string[];
  /** Effective selector used for this build's validation-day selection. */
  effectiveValidationSelectionMode?:
    | "manual"
    | "random_simple"
    | "customer_style_seasonal_mix"
    | "stratified_weather_balanced";
  /** Optional diagnostics snapshot for explainability of selected validation days. */
  validationSelectionDiagnostics?: Record<string, unknown>;
  notes?: string[];
  filledMonths?: string[];
  // Snapshots (for auditing / future UI): not required for regen.
  snapshots?: {
    manualUsagePayload?: any;
    homeProfile?: any;
    applianceProfile?: any;
    baselineHomeProfile?: any;
    baselineApplianceProfile?: any;
    actualSource?: "SMT" | "GREEN_BUTTON" | null;
    actualMonthlyAnchorsByMonth?: Record<string, number>;
    actualIntradayShape96?: number[];
    smtMonthlyAnchorsByMonth?: Record<string, number>;
    smtIntradayShape96?: number[];
    // Scenario audit fields (not used for regen)
    scenario?: { id: string; name: string } | null;
    scenarioEvents?: any[];
    scenarioOverlay?: any;
    // Workspace chaining audit (Future based on Past)
    pastScenario?: { id: string; name: string } | null;
    pastScenarioEvents?: any[];
  };
  /** Phase 2c: single shared resolver output; attached during recalc for canonical sim chain provenance. */
  resolvedSimFingerprint?: ResolvedSimFingerprint;
};

export type SimulatedUsageDatasetMeta = {
  datasetKind: "SIMULATED";
  baseKind: SimulatorBuildInputsV1["baseKind"];
  mode: SimulatorBuildInputsV1["mode"];
  canonicalEndMonth: string;
  notes: string[];
  filledMonths: string[];
  excludedDays: number;
  renormalized: boolean;
  // Hybrid gap-fill support (V1): which months are actual vs simulated.
  monthProvenanceByMonth?: Record<string, "ACTUAL" | "SIMULATED">;
  actualSource?: "SMT" | "GREEN_BUTTON" | null;
  // Service-attached metadata (persisted build)
  buildInputsHash?: string;
  lastBuiltAt?: string | null;
  scenarioKey?: string;
  /** Past gap-fill: daily total for excluded days used weekday/weekend avg from UsageShapeProfile. */
  weekdayWeekendSplitUsed?: boolean;
  /** Past gap-fill: source of daily total for excluded days. */
  dayTotalSource?: "usageShapeProfile_avgKwhPerDayByMonth" | "fallback_month_avg";
  dayTotalShapingPath?: string;
  curveShapingVersion?: string;
  /** Gap-fill lab: why UsageShapeProfile was or wasn't used. */
  usageShapeProfileDiag?: {
    found: boolean;
    id: string | null;
    version: string | null;
    derivedAt: string | null;
    windowStartUtc: string | null;
    windowEndUtc: string | null;
    profileMonthKeys: string[];
    weekdayAvgLen: number | null;
    weekendAvgLen: number | null;
    canonicalMonths: string[];
    canonicalMonthsLen: number;
    inlineDerivedFromActual?: boolean;
    reasonNotUsed: string | null;
    ensuredInFlow?: boolean;
    ensureAttempted?: boolean;
    ensuredReason?: string | null;
    ensureFailedReason?: string | null;
    ensuredProfileId?: string | null;
    canonicalCoverageStartDate?: string;
    canonicalCoverageEndDate?: string;
  };
  profileAutoBuilt?: boolean;
  scenarioId?: string | null;
  /** Past: cold_build | recalc | lab_validation | cache_restore. */
  buildPathKind?: "cold_build" | "recalc" | "lab_validation" | "cache_restore";
  /** Past: shared simulator core identifier for validation. */
  sourceOfDaySimulationCore?: string;
  /** Past: engine/derivation version. */
  derivationVersion?: string;
  simVersion?: string;
  /** Past: daily table row count (for validation). */
  dailyRowCount?: number;
  /** Past: 15-min interval count. */
  intervalCount?: number;
  coverageStart?: string;
  coverageEnd?: string;
  actualDayCount?: number;
  simulatedDayCount?: number;
  stitchedDayCount?: number;
  actualIntervalsCount?: number;
  referenceDaysCount?: number;
  shapeMonthsPresent?: string[];
  excludedDateKeysCount?: number;
  excludedDateKeysFingerprint?: string;
  leadingMissingDaysCount?: number;
  /** Past: weather provenance — kind used (e.g. ACTUAL_LAST_YEAR, STUB_V1, MIXED). */
  weatherKindUsed?: string;
  /** Past: stub_only | actual_only | mixed_actual_and_stub | none | unknown (unknown when provenance missing, e.g. cache restore). */
  weatherSourceSummary?: "stub_only" | "actual_only" | "mixed_actual_and_stub" | "none" | "unknown";
  weatherFallbackReason?: string | null;
  weatherProviderName?: string;
  weatherRowsCount?: number;
  weatherStubRowCount?: number;
  weatherActualRowCount?: number;
  weatherCoverageStart?: string | null;
  weatherCoverageEnd?: string | null;
  /** Shared Past path weather integration flag for report wiring. */
  weatherUsed?: boolean;
  /** Shared Past path weather integration note for report wiring. */
  weatherNote?: string;
  /** Sample of canonical shared-sim per-day diagnostics for Gap-Fill reports. */
  simulatedDayDiagnosticsSample?: Array<{
    localDate: string;
    targetDayKwhBeforeWeather: number;
    weatherAdjustedDayKwh: number;
    dayTypeUsed: "weekday" | "weekend" | null;
    shapeVariantUsed: string | null;
    finalDayKwh: number;
    intervalSumKwh: number;
    fallbackLevel: string | null;
  }>;
  /** Canonical shared-sim daily totals keyed by simulated local date. */
  canonicalArtifactSimulatedDayTotalsByDate?: Record<string, number>;
  /** Shared post-sim separation: travel/vacant simulated days (baseline should remain SIMULATED). */
  simulatedTravelVacantDateKeysLocal?: string[];
  /** Shared post-sim separation: modeled test/validation days (baseline projection flips to ACTUAL). */
  simulatedTestModeledDateKeysLocal?: string[];
  /** Optional per-day source detail map for downstream chart/table notation. */
  simulatedSourceDetailByDate?: Record<string, PastSimulatedDaySourceDetail>;
  /**
   * Gap-Fill validation-only scored day keys.
   * These keys stay actual in baseline display/totals and are used by compare projection surfaces.
   */
  validationOnlyDateKeysLocal?: string[];
  /** Effective selector used when this artifact/build was generated. */
  effectiveValidationSelectionMode?:
    | "manual"
    | "random_simple"
    | "customer_style_seasonal_mix"
    | "stratified_weather_balanced";
  /** Optional diagnostics snapshot for explainability of selected validation days. */
  validationSelectionDiagnostics?: Record<string, unknown>;
  /** Compare-only projection rows for validation/test days from this same canonical family. */
  validationCompareRows?: Array<{
    localDate: string;
    dayType: "weekday" | "weekend";
    actualDayKwh: number;
    simulatedDayKwh: number;
    errorKwh: number;
    percentError: number | null;
    /** Same-date slice of `dailyWeather` when present (read/display only). */
    weather?: {
      tAvgF: number | null;
      tMinF: number | null;
      tMaxF: number | null;
      hdd65: number | null;
      cdd65: number | null;
      source: string | null;
      weatherMissing: boolean;
    };
  }>;
  validationCompareMetrics?: {
    mae: number;
    rmse: number;
    mape: number;
    wape: number;
    maxAbs: number;
    totalActualKwhMasked: number;
    totalSimKwhMasked: number;
    deltaKwhMasked: number;
    mapeFiltered: number | null;
    mapeFilteredCount: number;
  };
  /** Optional shared actual-context source house used to build this artifact. */
  actualContextHouseId?: string;
};

export type SimulatedUsageDataset = {
  summary: {
    source: "SIMULATED";
    intervalsCount: number;
    totalKwh: number;
    start: string;
    end: string;
    latest: string;
  };
  series: {
    intervals15: Array<{ timestamp: string; kwh: number }>;
    hourly: Array<{ timestamp: string; kwh: number }>;
    daily: Array<{
      timestamp: string;
      kwh: number;
      source?: "ACTUAL" | "SIMULATED";
      sourceDetail?: PastSimulatedDaySourceDetail | "ACTUAL" | "ACTUAL_VALIDATION_TEST_DAY";
    }>;
    monthly: Array<{ timestamp: string; kwh: number }>;
    annual: Array<{ timestamp: string; kwh: number }>;
  };
  daily: Array<{
    date: string;
    kwh: number;
    source?: "ACTUAL" | "SIMULATED";
    sourceDetail?: PastSimulatedDaySourceDetail | "ACTUAL" | "ACTUAL_VALIDATION_TEST_DAY";
  }>;
  monthly: Array<{ month: string; kwh: number }>;
  insights: {
    fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
    timeOfDayBuckets: any[];
    stitchedMonth: any;
    peakDay: { date: string; kwh: number } | null;
    peakHour: any;
    baseload: any;
    baseloadMethod?: "FILTERED_NORMAL_LIFE_V1" | "FALLBACK_V1" | "SQL_P10_V1";
    baseloadFallbackUsed?: boolean;
    baseloadDebugNote?: string | null;
    baseloadDaily?: any;
    baseloadMonthly?: any;
    weekdayVsWeekend: { weekday: number; weekend: number };
  };
  totals: {
    importKwh: number;
    exportKwh: number;
    netKwh: number;
  };
  meta: SimulatedUsageDatasetMeta;
  /** Monthly usage buckets (e.g. kwh.m.all.total per YYYY-MM) for plan costing; same shape as buildUsageBucketsForEstimate. */
  usageBucketsByMonth: Record<string, Record<string, number>>;
  /** When includeIntervals15m is true: same series used internally for totals/insights. Omitted when false (default). */
  intervals15m?: Array<{ timestamp: string; kwh: number }>;
};

export function buildSimulatedUsageDatasetFromBuildInputs(
  buildInputs: SimulatorBuildInputsV1,
  options?: { excludedDateKeys?: Set<string>; includeIntervals15m?: boolean }
): SimulatedUsageDataset {
  const curve = generateSimulatedCurve({
    canonicalMonths: buildInputs.canonicalMonths,
    periods: (buildInputs as any).canonicalPeriods ?? undefined,
    monthlyTotalsKwhByMonth: buildInputs.monthlyTotalsKwhByMonth,
    intradayShape96: buildInputs.intradayShape96,
    weekdayWeekendShape96: buildInputs.weekdayWeekendShape96,
    travelRanges: buildInputs.travelRanges,
  });

  const dailyMap = new Map<string, number>();
  for (let j = 0; j < curve.intervals.length; j++) {
    const dk = toDateKey(curve.intervals[j].timestamp);
    dailyMap.set(dk, (dailyMap.get(dk) ?? 0) + (Number(curve.intervals[j].consumption_kwh) || 0));
  }
  const daily = Array.from(dailyMap.entries())
    .map(([date, kwh]) => ({ date, kwh: round2(kwh) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const monthlyBuild = buildDisplayMonthlyFromIntervals({
    intervals: curve.intervals,
    endDate: curve.end,
  });
  const monthly = monthlyBuild.monthly;
  const totalFromMonthly = round2(monthly.reduce((s, m) => s + (Number(m.kwh) || 0), 0));

  const seriesDaily: UsageSeriesPoint[] = daily.map((d) => ({ timestamp: `${d.date}T00:00:00.000Z`, kwh: d.kwh }));
  const seriesMonthly: UsageSeriesPoint[] = monthly.map((m) => ({ timestamp: `${m.month}-01T00:00:00.000Z`, kwh: m.kwh }));
  const seriesAnnual: UsageSeriesPoint[] = [{ timestamp: curve.end.slice(0, 4) + "-01-01T00:00:00.000Z", kwh: totalFromMonthly }];

  const fifteenMinuteAverages = computeFifteenMinuteAverages(curve.intervals);
  const timeOfDayBuckets = computeTimeOfDayBuckets(curve.intervals);

  let weekdaySum = 0;
  let weekendSum = 0;
  for (let j = 0; j < daily.length; j++) {
    const dow = dayOfWeekUtc(daily[j].date);
    if (dow === 0 || dow === 6) weekendSum += daily[j].kwh;
    else weekdaySum += daily[j].kwh;
  }

  const peakDay = daily.length > 0 ? daily.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;

  const excludedDateKeys = options?.excludedDateKeys ?? excludedDateKeysFromTravelRanges(buildInputs.travelRanges);
  const baseloadComputed = computeNormalLifeBaseloadKw(
    curve.intervals.map((i) => ({ tsIso: String(i.timestamp ?? ""), kwh: Number(i.consumption_kwh) || 0 })),
    { excludedDateKeys: excludedDateKeys.size > 0 ? excludedDateKeys : undefined }
  );
  const baseload = baseloadComputed.baseloadKw;
  const baseloadMethod: "FILTERED_NORMAL_LIFE_V1" | "FALLBACK_V1" | "SQL_P10_V1" = baseloadComputed
    .fallbackUsed
    ? "FALLBACK_V1"
    : "FILTERED_NORMAL_LIFE_V1";
  const baseloadDaily = low10Average(daily.map((d) => Number(d.kwh) || 0));
  const baseloadMonthly = low10Average(monthly.map((m) => Number(m.kwh) || 0));

  const usageBucketsByMonth = usageBucketsByMonthFromSimulatedMonthly(monthly);

  const intervals15m = options?.includeIntervals15m
    ? curve.intervals.map((i) => ({
        timestamp: String(i.timestamp ?? ""),
        kwh: Number(i.consumption_kwh) || 0,
      }))
    : undefined;

  return {
    summary: {
      source: "SIMULATED" as const,
      intervalsCount: curve.intervals.length,
      totalKwh: totalFromMonthly,
      start: curve.start,
      end: curve.end,
      latest: curve.end,
    },
    series: {
      intervals15: intervals15m ?? ([] as UsageSeriesPoint[]),
      hourly: [] as UsageSeriesPoint[],
      daily: seriesDaily,
      monthly: seriesMonthly,
      annual: seriesAnnual,
    },
    daily,
    monthly,
    insights: {
      fifteenMinuteAverages,
      timeOfDayBuckets,
      stitchedMonth: monthlyBuild.stitchedMonth,
      peakDay: peakDay ? { date: peakDay.date, kwh: peakDay.kwh } : null,
      peakHour: null,
      baseload,
      baseloadMethod,
      baseloadFallbackUsed: baseloadComputed.fallbackUsed,
      baseloadDebugNote: baseloadComputed.debugNote,
      baseloadDaily,
      baseloadMonthly,
      weekdayVsWeekend: { weekday: round2(weekdaySum), weekend: round2(weekendSum) },
    },
    totals: {
      importKwh: totalFromMonthly,
      exportKwh: 0,
      netKwh: totalFromMonthly,
    },
    meta: {
      datasetKind: "SIMULATED",
      baseKind: buildInputs.baseKind,
      mode: buildInputs.mode,
      canonicalEndMonth: buildInputs.canonicalEndMonth,
      notes: buildInputs.notes ?? [],
      filledMonths: buildInputs.filledMonths ?? [],
      excludedDays: curve.meta.excludedDays,
      renormalized: curve.meta.renormalized,
    },
    usageBucketsByMonth,
    ...(intervals15m !== undefined && { intervals15m }),
  };
}

/** Build a SimulatedCurve from patched 15-min intervals (e.g. output of buildPastSimulatedBaselineV1). */
export function buildCurveFromPatchedIntervals(args: {
  startDate: string;
  endDate: string;
  intervals: Array<{ timestamp: string; kwh: number }>;
  /** Observability: plan §6 stitch (Slice 2). */
  correlationId?: string;
}): SimulatedCurve {
  if (args.correlationId) {
    logSimPipelineEvent("stitch_curve_start", {
      correlationId: args.correlationId,
      source: "buildCurveFromPatchedIntervals",
    });
  }
  const rows = (args.intervals ?? [])
    .map((p) => ({ timestamp: String(p?.timestamp ?? ""), consumption_kwh: Number(p?.kwh) || 0, interval_minutes: 15 as const }))
    .filter((p) => p.timestamp.length > 0)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  const monthlyTotalsMap = new Map<string, number>();
  for (const iv of rows) {
    const ym = iv.timestamp.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    monthlyTotalsMap.set(ym, (monthlyTotalsMap.get(ym) ?? 0) + (Number(iv.consumption_kwh) || 0));
  }
  const monthlyTotals = Array.from(monthlyTotalsMap.entries())
    .map(([month, kwh]) => ({ month, kwh: Math.round(kwh * 100) / 100 }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  const annualTotalKwh = monthlyTotals.reduce((s, m) => s + m.kwh, 0);

  const curve: SimulatedCurve = {
    start: String(args.startDate).slice(0, 10),
    end: String(args.endDate).slice(0, 10),
    intervals: rows,
    monthlyTotals,
    annualTotalKwh: Math.round(annualTotalKwh * 100) / 100,
    meta: { excludedDays: 0, renormalized: false },
  };
  if (args.correlationId) {
    logSimPipelineEvent("stitch_curve_success", {
      correlationId: args.correlationId,
      source: "buildCurveFromPatchedIntervals",
      intervalRowCount: rows.length,
    });
  }
  return curve;
}

/** Build dataset from a precomputed curve (e.g. Past stitched actual + simulated). Use when the curve was built outside generateSimulatedCurve. */
export function buildSimulatedUsageDatasetFromCurve(
  curve: SimulatedCurve,
  meta: {
    baseKind: SimulatorBuildInputsV1["baseKind"];
    mode: SimulatorBuildInputsV1["mode"];
    canonicalEndMonth: string;
    notes?: string[];
    filledMonths?: string[];
  },
  options?: {
    excludedDateKeys?: Set<string>;
    /** When set, monthly display groups by this timezone (fixes 0 kWh for non-Chicago). */
    timezone?: string;
    /** When true, group monthly by UTC month so it matches daily (fixes Past simulated zeros). */
    useUtcMonth?: boolean;
    /** Canonical simulated-day artifacts used for simulated-date daily display parity. */
    simulatedDayResults?: SimulatedDayResult[];
    /**
     * Gap-Fill lab_validation + sparse stitched curves: skip fifteen-minute profiles, time-of-day buckets,
     * and normal-life baseload math (heavy on CPU/allocations; not used for compare_core scoring).
     */
    skipHeavyInsights?: boolean;
    /** Observability: plan §6 stitch (Slice 2). */
    correlationId?: string;
  }
): SimulatedUsageDataset {
  if (options?.correlationId) {
    logSimPipelineEvent("stitch_dataset_start", {
      correlationId: options.correlationId,
      source: "buildSimulatedUsageDatasetFromCurve",
    });
  }
  const dailyMap = new Map<string, number>();
  for (let j = 0; j < curve.intervals.length; j++) {
    const dk = toDateKey(curve.intervals[j].timestamp);
    dailyMap.set(dk, (dailyMap.get(dk) ?? 0) + (Number(curve.intervals[j].consumption_kwh) || 0));
  }
  const simulatedDisplayByDate = new Map<string, number>();
  const simulatedSourceByDate = new Set<string>();
  const simulatedSourceDetailByDate = new Map<string, PastSimulatedDaySourceDetail>();
  for (const row of options?.simulatedDayResults ?? []) {
    const dk = String(row?.localDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    simulatedDisplayByDate.set(
      dk,
      Number(row.displayDayKwh ?? row.intervalSumKwh ?? row.finalDayKwh) || 0
    );
    simulatedSourceByDate.add(dk);
    const reason = String((row as any)?.simulatedReasonCode ?? "");
    // TRAVEL_VACANT vs TEST (compare) vs incomplete/leading-missing vs generic OTHER.
    const detail: PastSimulatedDaySourceDetail =
      reason === "TRAVEL_VACANT"
        ? "SIMULATED_TRAVEL_VACANT"
        : reason === "TEST_MODELED_KEEP_REF" || reason === "FORCED_SELECTED_DAY"
          ? "SIMULATED_TEST_DAY"
          : reason === "INCOMPLETE_METER_DAY"
            ? "SIMULATED_INCOMPLETE_METER"
            : reason === "LEADING_MISSING_DAY"
              ? "SIMULATED_LEADING_MISSING"
              : "SIMULATED_OTHER";
    simulatedSourceDetailByDate.set(dk, detail);
  }
  // Daily display values for simulated days come from shared core SimulatedDayResult.
  const daily = Array.from(dailyMap.entries())
    .map(([date, kwh]) => ({
      date,
      kwh: round2(simulatedDisplayByDate.has(date) ? simulatedDisplayByDate.get(date)! : kwh),
      source: simulatedSourceByDate.has(date) ? ("SIMULATED" as const) : ("ACTUAL" as const),
      sourceDetail: simulatedSourceByDate.has(date)
        ? simulatedSourceDetailByDate.get(date) ?? "SIMULATED_OTHER"
        : ("ACTUAL" as const),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const canonicalArtifactSimulatedDayTotalsByDate = Object.fromEntries(
    daily
      .filter((row) => simulatedSourceByDate.has(row.date))
      .map((row) => [row.date, round2(Number(row.kwh) || 0)] as const)
  );

  const monthlyBuild = buildDisplayMonthlyFromIntervals({
    intervals: curve.intervals,
    endDate: curve.end,
    timezone: options?.timezone,
    useUtcMonth: options?.useUtcMonth,
  });
  // Use stitched display-monthly output so boundary month windows don't show duplicate current month rows.
  const monthly = monthlyBuild.monthly;
  const totalFromMonthly = round2(monthly.reduce((s, m) => s + (Number(m.kwh) || 0), 0));

  const seriesDaily: SimulatedUsageDataset["series"]["daily"] = daily.map((d) => ({
    timestamp: `${d.date}T00:00:00.000Z`,
    kwh: d.kwh,
    source: d.source,
    sourceDetail: d.sourceDetail,
  }));
  const seriesMonthly: UsageSeriesPoint[] = monthly.map((m) => ({ timestamp: `${m.month}-01T00:00:00.000Z`, kwh: m.kwh }));
  const seriesAnnual: UsageSeriesPoint[] = [{ timestamp: curve.end.slice(0, 4) + "-01-01T00:00:00.000Z", kwh: totalFromMonthly }];
  const seriesIntervals15: UsageSeriesPoint[] = curve.intervals.map((i) => ({
    timestamp: i.timestamp,
    kwh: Number(i.consumption_kwh) || 0,
  }));
  // Summary must reflect the exact post-patch intervals returned to clients.
  const totalFromIntervals = round2(seriesIntervals15.reduce((s, r) => s + (Number(r.kwh) || 0), 0));

  const skipHeavyInsights = options?.skipHeavyInsights === true;
  const fifteenMinuteAverages = skipHeavyInsights ? [] : computeFifteenMinuteAverages(curve.intervals);
  const timeOfDayBuckets = skipHeavyInsights ? [] : computeTimeOfDayBuckets(curve.intervals);

  let weekdaySum = 0;
  let weekendSum = 0;
  for (let j = 0; j < daily.length; j++) {
    const dow = dayOfWeekUtc(daily[j].date);
    if (dow === 0 || dow === 6) weekendSum += daily[j].kwh;
    else weekdaySum += daily[j].kwh;
  }

  const peakDay = daily.length > 0 ? daily.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;

  const baseloadComputed = skipHeavyInsights
    ? { baseloadKw: null as number | null, fallbackUsed: true, debugNote: "sparse_curve_lab_skip" as string | null }
    : computeNormalLifeBaseloadKw(
        curve.intervals.map((i) => ({ tsIso: String(i.timestamp ?? ""), kwh: Number(i.consumption_kwh) || 0 })),
        { excludedDateKeys: options?.excludedDateKeys }
      );
  const baseload = baseloadComputed.baseloadKw;
  const baseloadMethod: "FILTERED_NORMAL_LIFE_V1" | "FALLBACK_V1" | "SQL_P10_V1" = baseloadComputed
    .fallbackUsed
    ? "FALLBACK_V1"
    : "FILTERED_NORMAL_LIFE_V1";
  const baseloadDaily = skipHeavyInsights ? 0 : low10Average(daily.map((d) => Number(d.kwh) || 0));
  const baseloadMonthly = skipHeavyInsights ? 0 : low10Average(monthly.map((m) => Number(m.kwh) || 0));

  const usageBucketsByMonth = usageBucketsByMonthFromSimulatedMonthly(monthly);

  const startDateOnly = curve.start.slice(0, 10);
  const endDateOnly = curve.end.slice(0, 10);
  const summaryStart = /^\d{4}-\d{2}-\d{2}$/.test(startDateOnly) ? startDateOnly : curve.start;
  const summaryEnd = /^\d{4}-\d{2}-\d{2}$/.test(endDateOnly) ? endDateOnly : curve.end;
  if (process.env.NODE_ENV !== "production" && process.env.DEBUG_SIM_USAGE_SUMMARY === "1") {
    const delta = round2(totalFromIntervals - totalFromMonthly);
    console.debug("[usageSimulator.summary]", {
      intervalsCount: seriesIntervals15.length,
      summaryTotalKwh: totalFromIntervals,
      sumIntervalsKwh: totalFromIntervals,
      deltaFromMonthly: delta,
    });
  }

  const dataset: SimulatedUsageDataset = {
    summary: {
      source: "SIMULATED" as const,
      intervalsCount: seriesIntervals15.length,
      totalKwh: totalFromIntervals,
      start: summaryStart,
      end: summaryEnd,
      latest: summaryEnd,
    },
    series: {
      intervals15: seriesIntervals15,
      hourly: [] as UsageSeriesPoint[],
      daily: seriesDaily,
      monthly: seriesMonthly,
      annual: seriesAnnual,
    },
    daily,
    monthly,
    insights: {
      fifteenMinuteAverages,
      timeOfDayBuckets,
      stitchedMonth: monthlyBuild.stitchedMonth,
      peakDay: peakDay ? { date: peakDay.date, kwh: peakDay.kwh } : null,
      peakHour: null,
      baseload,
      baseloadMethod,
      baseloadFallbackUsed: baseloadComputed.fallbackUsed,
      baseloadDebugNote: baseloadComputed.debugNote,
      baseloadDaily,
      baseloadMonthly,
      weekdayVsWeekend: { weekday: round2(weekdaySum), weekend: round2(weekendSum) },
    },
    totals: {
      importKwh: totalFromMonthly,
      exportKwh: 0,
      netKwh: totalFromMonthly,
    },
    meta: {
      datasetKind: "SIMULATED",
      baseKind: meta.baseKind,
      mode: meta.mode,
      canonicalEndMonth: meta.canonicalEndMonth,
      notes: meta.notes ?? [],
      filledMonths: meta.filledMonths ?? [],
      excludedDays: curve.meta.excludedDays,
      renormalized: curve.meta.renormalized,
      canonicalArtifactSimulatedDayTotalsByDate,
      simulatedTravelVacantDateKeysLocal: daily
        .filter((row) => row.sourceDetail === "SIMULATED_TRAVEL_VACANT")
        .map((row) => row.date),
      simulatedTestModeledDateKeysLocal: daily
        .filter((row) => row.sourceDetail === "SIMULATED_TEST_DAY")
        .map((row) => row.date),
      simulatedSourceDetailByDate: daily.reduce<Record<string, PastSimulatedDaySourceDetail>>((acc, row) => {
        if (row.source !== "SIMULATED") return acc;
        const d = row.sourceDetail;
        acc[row.date] =
          d === "SIMULATED_TRAVEL_VACANT" ||
          d === "SIMULATED_TEST_DAY" ||
          d === "SIMULATED_INCOMPLETE_METER" ||
          d === "SIMULATED_LEADING_MISSING" ||
          d === "SIMULATED_OTHER"
            ? d
            : "SIMULATED_OTHER";
        return acc;
      }, {}),
    },
    usageBucketsByMonth,
  };
  (dataset as SimulatedUsageDataset & { canonicalArtifactSimulatedDayTotalsByDate: Record<string, number> })
    .canonicalArtifactSimulatedDayTotalsByDate = canonicalArtifactSimulatedDayTotalsByDate;
  if (options?.correlationId) {
    logSimPipelineEvent("stitch_dataset_success", {
      correlationId: options.correlationId,
      source: "buildSimulatedUsageDatasetFromCurve",
      dailyRowCount: daily.length,
    });
  }
  return dataset;
}

/** Build usage buckets by month (same shape as buildUsageBucketsForEstimate) from simulated monthly totals. Used for Past/Future so plan costing can use simulated usage. */
export function usageBucketsByMonthFromSimulatedMonthly(
  monthly: Array<{ month: string; kwh: number }>
): Record<string, Record<string, number>> {
  const CORE_TOTAL_KEY = "kwh.m.all.total";
  const out: Record<string, Record<string, number>> = {};
  for (const m of monthly ?? []) {
    const ym = String(m?.month ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const kwh = typeof m?.kwh === "number" && Number.isFinite(m.kwh) ? m.kwh : 0;
    if (!out[ym]) out[ym] = {};
    out[ym][CORE_TOTAL_KEY] = Math.max(0, kwh);
  }
  return out;
}
