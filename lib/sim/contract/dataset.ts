/**
 * Sim Platform Contract — dataset helpers (join map, coverage, sort diagnostic, adapter).
 */

import { canonicalIntervalKey } from "./time";
import type { IntervalPoint } from "./types";
import { INTERVALS_PER_DAY } from "./types";

/** Build a map tsIso -> kwh for join/lookup. Uses canonical key per point; fallback to raw tsIso when unparseable so no point is dropped. */
export function buildJoinMapByTsIso(points: IntervalPoint[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of points) {
    const tsIso = p?.tsIso ?? "";
    const key = canonicalIntervalKey(tsIso);
    out.set(key || tsIso, Number(p?.kwh) ?? 0);
  }
  return out;
}

/** Coverage diagnostic: expected (from days × 96), actual count, pct, missingCount. Uses only points with valid YYYY-MM-DD prefix so actual and expected are comparable. */
export function computeCoverage(points: IntervalPoint[]): {
  expected: number;
  actual: number;
  pct: number;
  missingCount: number;
} {
  const byDay = new Map<string, number>();
  for (const p of points) {
    const dk = String(p?.tsIso ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) byDay.set(dk, (byDay.get(dk) ?? 0) + 1);
  }
  const actual = Array.from(byDay.values()).reduce((s, n) => s + n, 0);
  const dayCount = byDay.size;
  const expected = dayCount * INTERVALS_PER_DAY;
  const pct = expected > 0 ? actual / expected : 0;
  const missingCount = Math.max(0, expected - actual);
  return { expected, actual, pct, missingCount };
}

/** Diagnostic only: return whether points are sorted by tsIso. No throw in prod. */
export function assertSortedByTsIso(points: IntervalPoint[]): { sorted: boolean; firstOutOfOrder?: number } {
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]?.tsIso ?? "";
    const cur = points[i]?.tsIso ?? "";
    if (cur < prev) return { sorted: false, firstOutOfOrder: i };
  }
  return { sorted: true };
}

/** Adapter: legacy point with `timestamp` -> contract IntervalPoint with tsIso. */
export function fromTimestamp(point: { timestamp: string; kwh: number }): IntervalPoint {
  const ts = String(point?.timestamp ?? "").trim();
  return { tsIso: canonicalIntervalKey(ts), kwh: Number(point?.kwh) ?? 0 };
}
