// lib/analysis/normalizeSmt.ts
// PATCH: add strict TZ parsing options using Luxon helper

import type { AmbiguousPolicy } from '@/lib/time/tz';
import { parseInZoneToUTC } from '@/lib/time/tz';
import { DateTime } from 'luxon';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

export type SmtAdhocRow = {
  esiid?: string;
  meter?: string;
  /** End timestamp of the 15-minute interval (e.g., "2025-10-30T13:15:00-05:00" or "2025-10-30 13:15:00") */
  timestamp?: string;
  /** energy in kWh for this 15-min interval */
  kwh?: number | string;
};

export type SmtGbRow = {
  /** ISO string */
  start?: string; // interval start
  /** ISO string */
  end?: string;   // interval end
  /** kWh */
  value?: number | string;
};

export type NormalizedPoint = {
  ts: string;   // ISO UTC (interval START)
  kwh: number;  // kWh for the 15-min interval
  filled?: boolean;
};

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function parseMaybeNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// OLD parseIsoLike() removed; replaced by parseInZoneToUTC()

function toUtcIso(d: Date): string {
  return new Date(d.getTime()).toISOString();
}

function minusMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() - minutes * 60 * 1000);
}

export type NormalizeOpts = {
  /** Time zone for naive timestamps (no offset). Default: "America/Chicago" */
  tz?: string;
  /** Enforce zone parsing for naive times. Default: true */
  strictTz?: boolean;
  /** How to resolve fall-back ambiguous times. Default: 'earlier' */
  ambiguous?: AmbiguousPolicy;
};

/**
 * Convert SMT-like rows to 15-min points (UTC), honoring TZ/DST for naive inputs.
 * - Adhoc rows: `timestamp` treated as END (emit START = end - 15 min)
 * - Green Button rows: emit START = `start` if given, else (`end` - 15 min)
 * - Rows with invalid time/value are skipped
 * - Dedup by UTC start key (last-write-wins) and sort ascending
 */
export function normalizeSmtTo15Min(
  raw: Array<SmtAdhocRow | SmtGbRow>,
  opts?: NormalizeOpts
): NormalizedPoint[] {
  const zone = opts?.tz ?? 'America/Chicago';
  const strictTz = opts?.strictTz !== false; // default true
  const ambiguous: AmbiguousPolicy = opts?.ambiguous ?? 'earlier';

  const slotMap = new Map<string, number>();

  for (const r of raw ?? []) {
    const isGb = 'start' in (r as SmtGbRow) || 'end' in (r as SmtGbRow);

    if (isGb) {
      const gb = r as SmtGbRow;
      const kwh = parseMaybeNumber(gb.value);
      if (kwh === null) continue;

      const startD =
        gb.start
          ? (strictTz ? parseInZoneToUTC(gb.start, zone, ambiguous) : new Date(gb.start))
          : null;
      const endD =
        gb.end
          ? (strictTz ? parseInZoneToUTC(gb.end, zone, ambiguous) : new Date(gb.end))
          : null;

      const intervalStart = startD ?? (endD ? minusMinutes(endD, 15) : null);
      if (!intervalStart || Number.isNaN(intervalStart.getTime())) continue;

      const ts = toUtcIso(intervalStart);
      slotMap.set(ts, kwh);
      continue;
    }

    // Adhoc
    const adhoc = r as SmtAdhocRow;
    const kwh = parseMaybeNumber(adhoc.kwh);
    if (kwh === null) continue;

    const endD = adhoc.timestamp
      ? (strictTz ? parseInZoneToUTC(adhoc.timestamp, zone, ambiguous) : new Date(adhoc.timestamp))
      : null;
    if (!endD || Number.isNaN(endD.getTime())) continue;

    const startD = minusMinutes(endD, 15);
    const ts = toUtcIso(startD);
    slotMap.set(ts, kwh);
  }

  return Array.from(slotMap.entries())
    .map(([ts, kwh]) => ({ ts, kwh }))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

export function fillMissing15Min(points: NormalizedPoint[], opts?: {
  start?: string; // UTC ISO
  end?: string;   // UTC ISO
}): NormalizedPoint[] {
  if (!Array.isArray(points) || points.length === 0) return points ?? [];
  const sorted = [...points].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const startMs = new Date(opts?.start ?? sorted[0].ts).getTime();
  const endMs   = new Date(opts?.end   ?? sorted[sorted.length - 1].ts).getTime();

  const index = new Map<string, NormalizedPoint>();
  for (const p of sorted) index.set(p.ts, p);

  const out: NormalizedPoint[] = [];
  for (let t = startMs; t <= endMs; t += FIFTEEN_MIN_MS) {
    const ts = new Date(t).toISOString();
    out.push(index.get(ts) ?? { ts, kwh: 0, filled: true });
  }
  return out;
}

export type GroupBy = 'esiid' | 'meter' | 'esiid_meter';

export type GroupedResult = {
  groups: Record<string, { points: NormalizedPoint[] }>;
  totalCount: number;
};

export function groupNormalize(
  raw: Array<SmtAdhocRow | SmtGbRow>,
  groupBy: GroupBy,
  normalizeOpts: NormalizeOpts,
  fillOpts?: { fill?: boolean; start?: string; end?: string }
): GroupedResult {
  const groups: Record<string, Array<SmtAdhocRow | SmtGbRow>> = {};

  for (const row of raw ?? []) {
    const adhoc = row as SmtAdhocRow;
    const esiid = adhoc.esiid ?? 'unknown';
    const meter = adhoc.meter ?? 'unknown';

    let key: string;
    if (groupBy === 'esiid') {
      key = esiid;
    } else if (groupBy === 'meter') {
      key = meter;
    } else {
      key = `${esiid}|${meter}`;
    }

    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  const result: Record<string, { points: NormalizedPoint[] }> = {};
  let totalCount = 0;

  for (const [key, rows] of Object.entries(groups)) {
    const points = normalizeSmtTo15Min(rows, normalizeOpts);
    const finalPoints = fillOpts?.fill
      ? fillMissing15Min(points, { start: fillOpts.start, end: fillOpts.end })
      : points;
    result[key] = { points: finalPoints };
    totalCount += finalPoints.length;
  }

  return { groups: result, totalCount };
}

export function buildDailyCompleteness(points: NormalizedPoint[], tz: string = 'America/Chicago'): {
  dates: Record<string, { total: number; filled: number; missing: number; completeness: number }>;
} {
  const dates: Record<string, { total: number; filled: number; missing: number; completeness: number }> = {};

  for (const p of points) {
    const d = new Date(p.ts);
    const dateKey = d.toISOString().split('T')[0]; // YYYY-MM-DD

    if (!dates[dateKey]) {
      dates[dateKey] = { total: 0, filled: 0, missing: 0, completeness: 0 };
    }

    dates[dateKey].total++;
    if (p.filled) {
      dates[dateKey].filled++;
    } else {
      dates[dateKey].missing++;
    }
  }

  // Calculate completeness (expected 96 points per day for 15-min intervals)
  const expectedPerDay = 96;
  for (const [date, stats] of Object.entries(dates)) {
    stats.completeness = Math.min(1, stats.total / expectedPerDay);
  }

  return { dates };
}

