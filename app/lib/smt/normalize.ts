import { parseSmtCsvFlexible } from '@/lib/smt/parseCsv';
import {
  groupNormalize,
  type SmtAdhocRow,
} from '@/lib/analysis/normalizeSmt';

export type NormalizeDefaults = {
  esiid?: string | null;
  meter?: string | null;
  source?: string | null;
};

export type NormalizedInterval = {
  esiid: string;
  meter: string;
  ts: Date;
  kwh: number;
  source: string | null;
};

export type NormalizeStats = {
  totalRows: number;
  processedRows: number;
  invalidEsiid: number;
  invalidTimestamp: number;
  invalidKwh: number;
  totalKwh: number;
  tsMin: string | null;
  tsMax: string | null;
};

function normalizeEsiid(raw?: string | null, fallback?: string | null): string | null {
  const candidate = (raw ?? fallback ?? '').trim();
  if (!candidate) return null;
  const stripped = candidate.replace(/^'+/, '');
  return stripped || null;
}

function normalizeMeter(raw?: string | null, fallback?: string | null): string {
  const candidate = (raw ?? fallback ?? '').trim();
  return candidate || 'unknown';
}

function parseCentralIso(raw?: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  // Perf: computing timezone offsets via Intl.DateTimeFormat.formatToParts is expensive.
  // SMT CSVs contain thousands of 15-min rows; we cache offsets at hour granularity.
  const offsetCacheKeyForLocal = (y: number, m0: number, d: number, h: number) =>
    `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}-${String(h).padStart(2, '0')}`;

  const CHICAGO_DTF = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Module-level cache (survives across calls within the same invocation).
  // Keyed by local YYYY-MM-DD-HH so DST transitions are handled correctly.
  const offsetMinutesCache: Map<string, number> =
    ((globalThis as any).__iwChicagoOffsetCache as Map<string, number> | undefined) ??
    (((globalThis as any).__iwChicagoOffsetCache = new Map()) as Map<string, number>);

  // Extract basic components (MM/DD/YYYY HH:mm[:ss][AM|PM]) and treat them as America/Chicago local time.
  const normalized = value.replace(/\s+(CST|CDT|CT)$/i, '').replace(/[T]/g, ' ').trim();
  const match = normalized.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i,
  );

  if (match) {
    const [, mStr, dStr, yStr, hStr, minStr, sStr, ampm] = match;
    const year = Number(yStr.length === 2 ? `20${yStr}` : yStr);
    const month = Number(mStr) - 1;
    const day = Number(dStr);
    let hour = Number(hStr);
    const minute = Number(minStr);
    const second = Number(sStr ?? '0');

    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === 'PM' && hour < 12) hour += 12;
      if (upper === 'AM' && hour === 12) hour = 0;
    }

    const initialUtcMs = Date.UTC(year, month, day, hour, minute, second);

    const cacheKey = offsetCacheKeyForLocal(year, month, day, hour);
    const cached = offsetMinutesCache.get(cacheKey);
    const offsetMinutes =
      typeof cached === 'number'
        ? cached
        : (() => {
            const parts = CHICAGO_DTF.formatToParts(new Date(initialUtcMs));
      const map: Record<string, string> = {};
      for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = p.value;
      }
      const asUtc = Date.UTC(
        Number(map.year),
        Number(map.month) - 1,
        Number(map.day),
        Number(map.hour),
        Number(map.minute),
        Number(map.second),
      );
            const off = (asUtc - initialUtcMs) / 60000;
            offsetMinutesCache.set(cacheKey, off);
            return off;
          })();

    const finalMs = initialUtcMs - offsetMinutes * 60000;
    return new Date(finalMs).toISOString();
  }

  // Fallback: trust the Date parser and assume the string already carries timezone info
  const fallbackDate = new Date(value);
  if (!Number.isNaN(fallbackDate.getTime())) {
    return fallbackDate.toISOString();
  }

  return null;
}

function deriveTimestamp(entry: {
  endLocal?: string | null;
  dateTimeLocal?: string | null;
  startLocal?: string | null;
}): string | null {
  const candidates = [entry.endLocal, entry.dateTimeLocal, entry.startLocal];
  for (const candidate of candidates) {
    const iso = parseCentralIso(candidate);
    if (iso) return iso;
  }

  return null;
}

function parseKwh(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeSmtIntervals(
  csvText: string,
  defaults: NormalizeDefaults = {},
): { intervals: NormalizedInterval[]; stats: NormalizeStats } {
  const parsed = parseSmtCsvFlexible(csvText);

  const rows: SmtAdhocRow[] = [];
  let invalidEsiid = 0;
  let invalidTimestamp = 0;
  let invalidKwh = 0;

  for (const entry of parsed) {
    const timestamp = deriveTimestamp(entry);
    if (!timestamp) {
      invalidTimestamp += 1;
      continue;
    }

    const esiid = normalizeEsiid(entry.esiid, defaults.esiid);
    if (!esiid) {
      invalidEsiid += 1;
      continue;
    }

    const meter = normalizeMeter(entry.meter, defaults.meter);

    const kwh = parseKwh(entry.kwh);
    if (kwh === null) {
      invalidKwh += 1;
      continue;
    }

    rows.push({
      esiid,
      meter,
      timestamp,
      kwh,
    });
  }

  const grouped = groupNormalize(rows, 'esiid_meter', { tz: 'America/Chicago' });
  const intervals: NormalizedInterval[] = [];

  let totalKwh = 0;
  let tsMin: string | null = null;
  let tsMax: string | null = null;

  for (const [composite, { points }] of Object.entries(grouped.groups)) {
    const [esiidKey, meterKey] = composite.split('|');
    const resolvedEsiid = normalizeEsiid(esiidKey, defaults.esiid);
    const resolvedMeter = normalizeMeter(meterKey, defaults.meter);

    if (!resolvedEsiid) {
      continue;
    }

    for (const point of points) {
      if (typeof point.kwh !== 'number' || !Number.isFinite(point.kwh)) continue;
      const tsDate = new Date(point.ts);
      if (Number.isNaN(tsDate.getTime())) continue;

      intervals.push({
        esiid: resolvedEsiid,
        meter: resolvedMeter,
        ts: tsDate,
        kwh: point.kwh,
        source: defaults.source ?? null,
      });

      totalKwh += point.kwh;
      if (!tsMin || point.ts < tsMin) tsMin = point.ts;
      if (!tsMax || point.ts > tsMax) tsMax = point.ts;
    }
  }

  const stats: NormalizeStats = {
    totalRows: parsed.length,
    processedRows: rows.length,
    invalidEsiid,
    invalidTimestamp,
    invalidKwh,
    totalKwh,
    tsMin,
    tsMax,
  };

  return { intervals, stats };
}

