// lib/analysis/normalizeSmt.ts
// PATCH: add strict TZ parsing options using Luxon helper

import type { AmbiguousPolicy } from '@/lib/time/tz';
import { parseInZoneToUTC } from '@/lib/time/tz';

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

