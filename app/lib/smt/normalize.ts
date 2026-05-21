import { parseSmtCsvFlexible } from '@/lib/smt/parseCsv';

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

function hasClockTime(value: string): boolean {
  return /\b\d{1,2}:\d{2}\b/.test(value);
}

function minus15MinutesUtcIso(iso: string): string {
  return new Date(new Date(iso).getTime() - 15 * 60 * 1000).toISOString();
}

function chicagoHourMinuteFromUtcIso(iso: string): { hour: number; minute: number } | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { hour, minute };
}

/**
 * Many SMT CSVs label interval START (00:00 .. 23:45). Others label interval END
 * (00:15 .. 00:00 next day). Stored SmtInterval.ts must always be interval START
 * so chicagoSlot96FromTs(ts) matches slot 95 at 23:45 local.
 */
function classifyEndColumnTimestampRole(endLocals: string[]): "period_end" | "period_start" {
  const parsed = endLocals
    .map((raw) => ({ raw, iso: parseCentralIso(raw) }))
    .filter((entry): entry is { raw: string; iso: string } => Boolean(entry.iso))
    .sort((left, right) => (left.iso < right.iso ? -1 : left.iso > right.iso ? 1 : 0));
  if (parsed.length === 0) return "period_end";
  const first = chicagoHourMinuteFromUtcIso(parsed[0]!.iso);
  if (!first) return "period_end";
  return first.hour === 0 && first.minute === 0 ? "period_start" : "period_end";
}

function deriveIntervalStartIso(
  entry: {
    endLocal?: string | null;
    dateTimeLocal?: string | null;
    startLocal?: string | null;
  },
  endColumnRole: "period_end" | "period_start"
): string | null {
  const startLocal = String(entry.startLocal ?? "").trim();
  if (startLocal && hasClockTime(startLocal)) {
    return parseCentralIso(startLocal);
  }

  const endLocal = String(entry.endLocal ?? "").trim();
  if (endLocal && hasClockTime(endLocal)) {
    const endIso = parseCentralIso(endLocal);
    if (!endIso) return null;
    if (endColumnRole === "period_start") {
      return endIso;
    }
    return minus15MinutesUtcIso(endIso);
  }

  const dateTimeLocal = String(entry.dateTimeLocal ?? "").trim();
  if (dateTimeLocal && hasClockTime(dateTimeLocal)) {
    return parseCentralIso(dateTimeLocal);
  }

  for (const candidate of [startLocal, endLocal, dateTimeLocal].filter(Boolean)) {
    const iso = parseCentralIso(candidate);
    if (iso) return iso;
  }
  return null;
}

/** @deprecated Use deriveIntervalStartIso; kept for any legacy callers. */
function deriveTimestamp(entry: {
  endLocal?: string | null;
  dateTimeLocal?: string | null;
  startLocal?: string | null;
}): string | null {
  return deriveIntervalStartIso(entry, "period_end");
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

  const endLocalsForRole = parsed
    .map((entry) => String(entry.endLocal ?? "").trim())
    .filter((value) => value.length > 0 && hasClockTime(value));
  const endColumnRole =
    endLocalsForRole.length > 0 ? classifyEndColumnTimestampRole(endLocalsForRole) : "period_end";

  const slotMapByComposite = new Map<string, Map<string, number>>();
  let invalidEsiid = 0;
  let invalidTimestamp = 0;
  let invalidKwh = 0;

  for (const entry of parsed) {
    const startIso = deriveIntervalStartIso(entry, endColumnRole);
    if (!startIso) {
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

    const composite = `${esiid}|${meter}`;
    const slots = slotMapByComposite.get(composite) ?? new Map<string, number>();
    slots.set(startIso, kwh);
    slotMapByComposite.set(composite, slots);
  }

  const intervals: NormalizedInterval[] = [];

  let totalKwh = 0;
  let tsMin: string | null = null;
  let tsMax: string | null = null;

  for (const [composite, slots] of Array.from(slotMapByComposite.entries())) {
    const [esiidKey, meterKey] = composite.split("|");
    const resolvedEsiid = normalizeEsiid(esiidKey, defaults.esiid);
    const resolvedMeter = normalizeMeter(meterKey, defaults.meter);

    if (!resolvedEsiid) {
      continue;
    }

    const points = Array.from(slots.entries()).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    for (const [ts, kwh] of points) {
      if (!Number.isFinite(kwh)) continue;
      const tsDate = new Date(ts);
      if (Number.isNaN(tsDate.getTime())) continue;

      intervals.push({
        esiid: resolvedEsiid,
        meter: resolvedMeter,
        ts: tsDate,
        kwh,
        source: defaults.source ?? null,
      });

      totalKwh += kwh;
      if (!tsMin || ts < tsMin) tsMin = ts;
      if (!tsMax || ts > tsMax) tsMax = ts;
    }
  }

  const stats: NormalizeStats = {
    totalRows: parsed.length,
    processedRows: parsed.length - invalidTimestamp - invalidEsiid - invalidKwh,
    invalidEsiid,
    invalidTimestamp,
    invalidKwh,
    totalKwh,
    tsMin,
    tsMax,
  };

  return { intervals, stats };
}

