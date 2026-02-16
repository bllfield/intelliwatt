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

  // Perf:
  // The old implementation used Intl.DateTimeFormat.formatToParts to derive America/Chicago offsets,
  // which is extremely expensive per-row for 12-month SMT pulls (35k+ intervals).
  //
  // We replace it with a deterministic US DST rule for America/Chicago:
  // - Standard time (CST): UTC-6
  // - Daylight time (CDT): UTC-5
  // - DST starts: second Sunday in March at 02:00 local
  // - DST ends: first Sunday in November at 02:00 local
  //
  // This makes conversion O(1) math per row (no Intl calls).
  const nthWeekdayOfMonth = (year: number, month0: number, weekday0: number, n: number): number => {
    const first = new Date(Date.UTC(year, month0, 1));
    const firstDow = first.getUTCDay(); // safe because we operate in calendar days
    const delta = (weekday0 - firstDow + 7) % 7;
    return 1 + delta + (n - 1) * 7;
  };

  const isChicagoDstForLocal = (
    year: number,
    month0: number,
    day: number,
    hour: number,
    minute: number,
  ): boolean => {
    // Jan/Feb/Dec => standard; Apr-Oct => DST
    if (month0 < 2 || month0 > 10) return false;
    if (month0 > 2 && month0 < 10) return true;

    const minutesOfDay = hour * 60 + minute;

    // March transition
    if (month0 === 2) {
      const startDay = nthWeekdayOfMonth(year, 2, 0, 2); // 2nd Sunday in March
      if (day < startDay) return false;
      if (day > startDay) return true;
      // same day: DST begins at 02:00 local (times before are standard)
      return minutesOfDay >= 2 * 60;
    }

    // November transition
    if (month0 === 10) {
      const endDay = nthWeekdayOfMonth(year, 10, 0, 1); // 1st Sunday in Nov
      if (day < endDay) return true;
      if (day > endDay) return false;
      // same day: DST ends at 02:00 local (times before are DST)
      return minutesOfDay < 2 * 60;
    }

    return false;
  };

  // If SMT includes an explicit timezone suffix, honor it (this disambiguates the repeated
  // 01:xx hour during the DST fall-back transition).
  const tzSuffix = (() => {
    const m = value.match(/\b(CDT|CST|CT)\b/i);
    const s = m?.[1] ? String(m[1]).toUpperCase() : null;
    return s === 'CDT' || s === 'CST' || s === 'CT' ? s : null;
  })();

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

    const isDst =
      tzSuffix === 'CDT'
        ? true
        : tzSuffix === 'CST'
          ? false
          : isChicagoDstForLocal(year, month, day, hour, minute);
    const offsetMinutes = isDst ? -300 : -360;

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
  const rawCandidates = [entry.endLocal, entry.dateTimeLocal, entry.startLocal].filter(
    (c): c is string => Boolean(c && String(c).trim().length > 0),
  );

  const hasTime = (s: string): boolean => /\b\d{1,2}:\d{2}\b/.test(s);

  // Prefer candidates that include a time-of-day component.
  // This avoids accidentally treating "Interval End Date" (date-only) as the timestamp
  // when a separate start/end time column exists.
  const candidates = rawCandidates.sort((a, b) => Number(hasTime(b)) - Number(hasTime(a)));

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

  // Perf:
  // At this point `rows[].timestamp` is already a UTC ISO string (`...Z`) produced by `parseCentralIso()`.
  // Avoid re-parsing every row via Luxon (`parseInZoneToUTC`) inside groupNormalize; plain Date parsing
  // of UTC ISO strings is sufficient and much faster.
  const grouped = groupNormalize(rows, 'esiid_meter', { tz: 'America/Chicago', strictTz: false });
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

