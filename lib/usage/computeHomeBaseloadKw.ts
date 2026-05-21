import { dateKeyFromIntervalPoint } from "@/lib/time/actualIntervalCalendar";
import { createHomeIntervalCalendar } from "@/lib/time/homeIntervalCalendar";

export type HomeBaseloadOptions = {
  excludedDateKeys?: Set<string>;
  minDayKwhFloor?: number;
  baseloadDayMultiplier?: number;
  percentile?: number;
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
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

/**
 * Baseload from full 15-minute intervals grouped by home-local calendar day.
 * Same algorithm for Usage, baseline admin, and Past artifact insights.
 */
export function computeHomeBaseloadKw(
  intervals: Array<{
    tsIso: string;
    kwh: number;
    homeDateKey?: string | null;
  }>,
  homeTimezone: string,
  options: HomeBaseloadOptions = {},
): { baseloadKw: number | null; fallbackUsed: boolean; debugNote: string | null } {
  const home = createHomeIntervalCalendar(homeTimezone);
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
    const dayKey = dateKeyFromIntervalPoint({
      timestamp: tsIso,
      homeDateKey: row.homeDateKey ?? null,
    });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) continue;
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

  const slotKw: number[] = [];
  for (const row of kept) {
    if (!qualityDays.has(row.dayKey)) continue;
    slotKw.push((Number(row.kwh) || 0) * 4);
  }
  if (!slotKw.length) {
    return {
      baseloadKw: null,
      fallbackUsed: true,
      debugNote: `No quality days for baseload (${home.timezone}).`,
    };
  }
  slotKw.sort((a, b) => a - b);
  const p = percentileCont(slotKw, percentile);
  if (p == null || !Number.isFinite(p)) {
    return { baseloadKw: null, fallbackUsed: true, debugNote: "Percentile baseload failed." };
  }
  return { baseloadKw: round2(p), fallbackUsed: false, debugNote: null };
}
