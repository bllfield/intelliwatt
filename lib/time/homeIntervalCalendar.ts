/**
 * Single owner for 15-minute interval time: source delivery → instant → home-local calendar.
 * All surfaces (SMT, ESPI/Green Button exports, DB rows, sim) should use this module only.
 */

import { DateTime } from "luxon";

import type { AmbiguousPolicy } from "@/lib/time/tz";
import { parseInZoneToUTC } from "@/lib/time/tz";

// ─── Source delivery (how the vendor encoded timestamps) ─────────────────────

export type IntervalTimestampEncoding =
  | "instant_iso"
  | "unix_seconds_utc"
  | "unix_seconds_local"
  | "naive_wall_clock"
  | "utc_day_grid"
  | "local_day_grid";

export type IntervalEdge = "start" | "end";

/** Declares how raw timestamps must be read. UTC is not assumed unless encoding says so. */
export type IntervalDelivery = {
  encoding: IntervalTimestampEncoding;
  sourceTimezone?: string;
  intervalEdge?: IntervalEdge;
  durationSeconds?: number;
  ambiguous?: AmbiguousPolicy;
  feedTzOffsetSeconds?: number | null;
};

export type RawIntervalInput = {
  timestamp: string | number | Date;
  kwh: number;
  durationSeconds?: number | null;
  unit?: string | null;
};

export type ResolvedIntervalInstant = {
  tsUtc: Date;
  tsUtcIso: string;
};

// ─── Home calendar (user/plan timezone) ──────────────────────────────────────

export type HomeIntervalCalendar = {
  timezone: string;
};

export type CanonicalIntervalPoint = {
  tsUtc: string;
  kwh: number;
};

export type HomeIntervalRecord = {
  tsUtc: string;
  kwh: number;
  homeDateKey: string;
  homeSlot: number;
  homeSlotsExpected: number;
};

export type HomeDailyIntervalSummary = {
  homeDateKey: string;
  kwh: number;
  slotsFilled: number;
  slotsExpected: number;
};

export type ConvertRawIntervalsResult = {
  delivery: IntervalDelivery;
  home: HomeIntervalCalendar;
  intervals: HomeIntervalRecord[];
  daily: HomeDailyIntervalSummary[];
  dropped: number;
  totalKwh: number;
  firstTsUtc: string | null;
  lastTsUtc: string | null;
  homeCoverageStart: string | null;
  homeCoverageEnd: string | null;
};

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

// ─── Feed / source helpers ───────────────────────────────────────────────────

export function ianaTimezoneFromEspiTzOffset(tzOffsetSeconds: number): string | null {
  const abs = Math.abs(Math.trunc(tzOffsetSeconds));
  if (abs === 21_600) return "America/Chicago";
  if (abs === 25_200) return "America/Denver";
  if (abs === 28_800) return "America/Los_Angeles";
  if (abs === 14_400) return "America/New_York";
  if (abs === 0) return "UTC";
  return null;
}

export function inferSourceTimezoneFromFeed(args: {
  tzOffsetSeconds?: number | null;
  titleHints?: string[];
  fallback?: string;
}): string {
  const hints = (args.titleHints ?? []).join(" ").toLowerCase();
  if (hints.includes("central time")) return "America/Chicago";
  if (hints.includes("eastern")) return "America/New_York";
  if (hints.includes("mountain")) return "America/Denver";
  if (hints.includes("pacific")) return "America/Los_Angeles";
  if (args.tzOffsetSeconds != null) {
    const fromOffset = ianaTimezoneFromEspiTzOffset(args.tzOffsetSeconds);
    if (fromOffset) return fromOffset;
  }
  return args.fallback ?? "America/Chicago";
}

/** ESPI interval feeds (e.g. SMT XML export): Unix UTC starts + feed tzOffset metadata. */
export function deliveryFromEspiFeedMetadata(args: {
  tzOffsetSeconds?: number | null;
  titleHints?: string[];
}): IntervalDelivery {
  const sourceTimezone = inferSourceTimezoneFromFeed({
    tzOffsetSeconds: args.tzOffsetSeconds,
    titleHints: args.titleHints,
    fallback: "America/Chicago",
  });
  return {
    encoding: "unix_seconds_utc",
    sourceTimezone,
    intervalEdge: "start",
    durationSeconds: 900,
    feedTzOffsetSeconds: args.tzOffsetSeconds ?? null,
  };
}

export function normalizeEnergyToKwh(value: number | string, unit?: string | null): number | null {
  const numeric = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const u = unit?.toLowerCase().trim();
  if (u === "wh") return numeric / 1000;
  if (u === "kwh") return numeric;
  if (Math.abs(numeric) > 100) return numeric / 1000;
  return numeric;
}

// ─── Instant resolution ──────────────────────────────────────────────────────

function parseUnixSecondsToDate(seconds: number): Date | null {
  if (!Number.isFinite(seconds)) return null;
  const ms = Math.abs(seconds) >= 1e11 ? Math.trunc(seconds) : Math.trunc(seconds) * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseInstantIso(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(trimmed) || /Z$/i.test(trimmed);
  if (hasOffset) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function gridInstantUtc(dateKey: string, slot: number): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || slot < 0 || slot > 99) return null;
  const ms = Date.parse(`${dateKey}T00:00:00.000Z`) + slot * FIFTEEN_MIN_MS;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function gridInstantLocal(dateKey: string, slot: number, zone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || slot < 0 || slot > 99) return null;
  const dt = DateTime.fromISO(`${dateKey}T00:00:00`, { zone }).plus({ minutes: slot * 15 });
  return dt.isValid ? dt.toUTC().toJSDate() : null;
}

/** America/Chicago local-day grid: midnight + sequential 15-minute slots (DST-aware). */
export function homeLocalSequentialSlotUtc(
  homeDateKey: string,
  slotIndex: number,
  home: HomeIntervalCalendar,
): Date | null {
  if (slotIndex < 0 || slotIndex > 99) return null;
  return gridInstantLocal(homeDateKey, slotIndex, home.timezone);
}

function applyIntervalEdge(instant: Date, delivery: IntervalDelivery, durationSeconds: number): Date {
  if (delivery.intervalEdge !== "end") return instant;
  return new Date(instant.getTime() - durationSeconds * 1000);
}

export function resolveIntervalInstant(
  raw: RawIntervalInput,
  delivery: IntervalDelivery,
): ResolvedIntervalInstant | null {
  const durationSeconds =
    raw.durationSeconds && raw.durationSeconds > 0
      ? raw.durationSeconds
      : delivery.durationSeconds ?? 900;

  let instant: Date | null = null;

  switch (delivery.encoding) {
    case "instant_iso": {
      if (typeof raw.timestamp === "number") {
        instant = parseUnixSecondsToDate(raw.timestamp);
        break;
      }
      if (raw.timestamp instanceof Date) {
        instant = new Date(raw.timestamp.getTime());
        break;
      }
      const iso = String(raw.timestamp);
      instant = parseInstantIso(iso);
      if (!instant && delivery.sourceTimezone) {
        instant = parseInZoneToUTC(iso, delivery.sourceTimezone, delivery.ambiguous ?? "earlier");
      }
      break;
    }
    case "unix_seconds_utc": {
      const sec =
        typeof raw.timestamp === "number"
          ? raw.timestamp
          : Number(String(raw.timestamp).trim());
      instant = parseUnixSecondsToDate(sec);
      break;
    }
    case "unix_seconds_local": {
      const zone = delivery.sourceTimezone;
      if (!zone) return null;
      const sec =
        typeof raw.timestamp === "number"
          ? raw.timestamp
          : Number(String(raw.timestamp).trim());
      const asUtc = parseUnixSecondsToDate(sec);
      if (!asUtc) return null;
      const parts = DateTime.fromJSDate(asUtc, { zone: "utc" });
      const local = DateTime.fromObject(
        {
          year: parts.year,
          month: parts.month,
          day: parts.day,
          hour: parts.hour,
          minute: parts.minute,
          second: parts.second,
          millisecond: parts.millisecond,
        },
        { zone },
      );
      instant = local.isValid ? local.toUTC().toJSDate() : null;
      break;
    }
    case "naive_wall_clock": {
      const zone = delivery.sourceTimezone;
      if (!zone) return null;
      const text =
        raw.timestamp instanceof Date ? raw.timestamp.toISOString() : String(raw.timestamp);
      instant = parseInZoneToUTC(text, zone, delivery.ambiguous ?? "earlier");
      break;
    }
    case "utc_day_grid": {
      const text = String(raw.timestamp);
      const dateKey = text.slice(0, 10);
      const parsed = parseInstantIso(text) ?? parseUnixSecondsToDate(Number(text));
      const slot =
        parsed != null
          ? Math.floor(
              (parsed.getTime() - (gridInstantUtc(dateKey, 0)?.getTime() ?? 0)) / FIFTEEN_MIN_MS,
            )
          : 0;
      instant = gridInstantUtc(dateKey, slot);
      break;
    }
    case "local_day_grid": {
      const zone = delivery.sourceTimezone;
      if (!zone) return null;
      const text = String(raw.timestamp);
      const dateKey = text.slice(0, 10);
      const parsed = parseInZoneToUTC(text, zone, delivery.ambiguous ?? "earlier");
      const dayStart = DateTime.fromISO(`${dateKey}T00:00:00`, { zone });
      const parsedDt = parsed
        ? DateTime.fromJSDate(parsed, { zone: "utc" }).setZone(zone)
        : null;
      const slot =
        parsedDt?.isValid && dayStart.isValid
          ? Math.floor(parsedDt.diff(dayStart, "minutes").minutes / 15)
          : 0;
      instant = gridInstantLocal(dateKey, slot, zone);
      break;
    }
    default:
      return null;
  }

  if (!instant || Number.isNaN(instant.getTime())) return null;
  const start = applyIntervalEdge(instant, delivery, durationSeconds);
  if (Number.isNaN(start.getTime())) return null;
  return { tsUtc: start, tsUtcIso: start.toISOString() };
}

// ─── Home-local projection ─────────────────────────────────────────────────────

export function createHomeIntervalCalendar(timezone: string): HomeIntervalCalendar {
  const zone = String(timezone ?? "").trim();
  if (!zone) throw new Error("Home timezone is required");
  return { timezone: zone };
}

export function expectedSlotsForLocalDate(dateKey: string, home: HomeIntervalCalendar): number {
  const start = DateTime.fromISO(dateKey, { zone: home.timezone });
  if (!start.isValid) return 96;
  const minutes = start.plus({ days: 1 }).diff(start, "minutes").minutes;
  return Math.max(1, Math.round(minutes / 15));
}

export function localDateKey(tsUtc: Date | string, home: HomeIntervalCalendar): string {
  return toHomeDateTime(tsUtc, home).toFormat("yyyy-MM-dd");
}

export function localSlotIndex(tsUtc: Date | string, home: HomeIntervalCalendar): number {
  const dt = toHomeDateTime(tsUtc, home);
  const minutes = dt.diff(dt.startOf("day"), "minutes").minutes;
  return Math.max(0, Math.floor(minutes / 15));
}

export function localDayBoundsUtc(
  dateKey: string,
  home: HomeIntervalCalendar,
): { startUtc: Date; endUtcExclusive: Date } {
  const start = DateTime.fromISO(dateKey, { zone: home.timezone }).startOf("day");
  const end = start.plus({ days: 1 });
  return {
    startUtc: start.toUTC().toJSDate(),
    endUtcExclusive: end.toUTC().toJSDate(),
  };
}

export function enumerateLocalDateKeys(
  startDateKey: string,
  endDateKey: string,
  home: HomeIntervalCalendar,
): string[] {
  let cursor = DateTime.fromISO(startDateKey, { zone: home.timezone });
  const end = DateTime.fromISO(endDateKey, { zone: home.timezone });
  if (!cursor.isValid || !end.isValid) return [];
  const out: string[] = [];
  while (cursor <= end) {
    out.push(cursor.toFormat("yyyy-MM-dd"));
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

function toHomeDateTime(tsUtc: Date | string, home: HomeIntervalCalendar): DateTime {
  const iso = typeof tsUtc === "string" ? tsUtc : tsUtc.toISOString();
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(home.timezone);
}

function projectInstant(
  resolved: ResolvedIntervalInstant,
  kwh: number,
  home: HomeIntervalCalendar,
): HomeIntervalRecord {
  const dateKey = localDateKey(resolved.tsUtc, home);
  return {
    tsUtc: resolved.tsUtcIso,
    kwh,
    homeDateKey: dateKey,
    homeSlot: localSlotIndex(resolved.tsUtc, home),
    homeSlotsExpected: expectedSlotsForLocalDate(dateKey, home),
  };
}

/**
 * Main entry: raw vendor rows + delivery contract + home timezone → final interval output.
 */
export function convertRawIntervalsToHome(
  rawRows: RawIntervalInput[],
  delivery: IntervalDelivery,
  home: HomeIntervalCalendar,
): ConvertRawIntervalsResult {
  const slotMap = new Map<string, HomeIntervalRecord>();
  let dropped = 0;

  for (const row of rawRows) {
    const kwh = normalizeEnergyToKwh(row.kwh as number | string, row.unit);
    if (kwh == null) {
      dropped += 1;
      continue;
    }
    const resolved = resolveIntervalInstant(row, delivery);
    if (!resolved) {
      dropped += 1;
      continue;
    }
    slotMap.set(resolved.tsUtcIso, projectInstant(resolved, kwh, home));
  }

  const intervals = Array.from(slotMap.values()).sort((a, b) =>
    a.tsUtc < b.tsUtc ? -1 : a.tsUtc > b.tsUtc ? 1 : 0,
  );

  const dailyMap = new Map<string, { kwh: number; slots: Set<number> }>();
  for (const row of intervals) {
    const bucket = dailyMap.get(row.homeDateKey) ?? { kwh: 0, slots: new Set<number>() };
    bucket.kwh += row.kwh;
    bucket.slots.add(row.homeSlot);
    dailyMap.set(row.homeDateKey, bucket);
  }

  const daily: HomeDailyIntervalSummary[] = Array.from(dailyMap.entries())
    .map(([homeDateKey, bucket]) => ({
      homeDateKey,
      kwh: bucket.kwh,
      slotsFilled: bucket.slots.size,
      slotsExpected: expectedSlotsForLocalDate(homeDateKey, home),
    }))
    .sort((a, b) => (a.homeDateKey < b.homeDateKey ? -1 : 1));

  const totalKwh = intervals.reduce((sum, row) => sum + row.kwh, 0);

  return {
    delivery,
    home,
    intervals,
    daily,
    dropped,
    totalKwh,
    firstTsUtc: intervals[0]?.tsUtc ?? null,
    lastTsUtc: intervals[intervals.length - 1]?.tsUtc ?? null,
    homeCoverageStart: daily[0]?.homeDateKey ?? null,
    homeCoverageEnd: daily[daily.length - 1]?.homeDateKey ?? null,
  };
}

export function toCanonicalPoints(intervals: HomeIntervalRecord[]): CanonicalIntervalPoint[] {
  return intervals.map((row) => ({ tsUtc: row.tsUtc, kwh: row.kwh }));
}

/** Texas SMT persisted rows and canonical window use Chicago until per-home TZ exists. */
export const SMT_DEFAULT_HOME_TIMEZONE = "America/Chicago";

export function smtHomeIntervalCalendar(): HomeIntervalCalendar {
  return createHomeIntervalCalendar(SMT_DEFAULT_HOME_TIMEZONE);
}

/** Distinct local slot indices that should exist on this calendar day (DST-aware). */
export function enumerateExpectedLocalSlotsForDate(
  dateKey: string,
  home: HomeIntervalCalendar,
): number[] {
  const { startUtc, endUtcExclusive } = localDayBoundsUtc(dateKey, home);
  const slots = new Set<number>();
  for (let ms = startUtc.getTime(); ms < endUtcExclusive.getTime(); ms += FIFTEEN_MIN_MS) {
    slots.add(localSlotIndex(new Date(ms), home));
  }
  return Array.from(slots).sort((a, b) => a - b);
}

export function missingLocalSlotsForDate(
  filledSlots: ReadonlySet<number>,
  dateKey: string,
  home: HomeIntervalCalendar,
): number[] {
  return enumerateExpectedLocalSlotsForDate(dateKey, home).filter((slot) => !filledSlots.has(slot));
}
