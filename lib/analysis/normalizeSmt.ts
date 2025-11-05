// lib/analysis/normalizeSmt.ts

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
  /** ISO string in UTC (interval START time) */
  ts: string;
  /** kWh for the 15-min interval */
  kwh: number;
};

function parseMaybeNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseIsoLike(s: string): Date | null {
  if (!s) return null;
  try {
    const isoish = s.includes('T') ? s : s.replace(' ', 'T');
    const d = new Date(isoish);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

function toUtcIso(d: Date): string {
  return new Date(d.getTime()).toISOString();
}

function minusMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() - minutes * 60 * 1000);
}

/**
 * Convert SMT-like rows to 15-min points (UTC).
 * - For "adhoc" rows with `timestamp` = END, we emit START = end - 15 min.
 * - For "green button" rows with start/end, we emit START = start.
 * - Rows with invalid time/value are skipped.
 * - Outputs sorted by time and deduped by ts (last-write-wins).
 */
export function normalizeSmtTo15Min(raw: Array<SmtAdhocRow | SmtGbRow>): NormalizedPoint[] {
  const slotMap = new Map<string, number>();

  for (const r of raw ?? []) {
    const hasGbShape = 'start' in (r as SmtGbRow) || 'end' in (r as SmtGbRow);
    if (hasGbShape) {
      const gb = r as SmtGbRow;
      const kwh = parseMaybeNumber(gb.value);
      if (kwh === null) continue;

      const startD = gb.start ? parseIsoLike(gb.start) : null;
      const endD   = gb.end ? parseIsoLike(gb.end) : null;
      const intervalStart = startD ?? (endD ? minusMinutes(endD, 15) : null);
      if (!intervalStart) continue;

      const ts = toUtcIso(intervalStart);
      slotMap.set(ts, kwh);
      continue;
    }

    const adhoc = r as SmtAdhocRow;
    const kwh = parseMaybeNumber(adhoc.kwh);
    if (kwh === null) continue;

    const endD = adhoc.timestamp ? parseIsoLike(adhoc.timestamp) : null;
    if (!endD) continue;

    const startD = minusMinutes(endD, 15);
    const ts = toUtcIso(startD);
    slotMap.set(ts, kwh);
  }

  return Array.from(slotMap.entries())
    .map(([ts, kwh]) => ({ ts, kwh }))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

