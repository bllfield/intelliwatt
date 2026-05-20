import {
  CANONICAL_COVERAGE_LAG_DAYS,
  CANONICAL_COVERAGE_TOTAL_DAYS,
} from "@/lib/usage/canonicalCoverageConfig";

export function isYearMonth(s: string): boolean {
  return /^\d{4}-\d{2}$/.test(String(s ?? "").trim());
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInUtcMonth(year: number, monthIndex0: number): number {
  // monthIndex0: 0-11
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export function anchorEndDateUtc(anchorEndMonth: string, billEndDay: number): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(anchorEndMonth ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex0 = Number(m[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex0) || monthIndex0 < 0 || monthIndex0 > 11) return null;

  const dim = daysInUtcMonth(year, monthIndex0);
  const day = Math.max(1, Math.min(dim, Math.trunc(billEndDay)));
  return new Date(Date.UTC(year, monthIndex0, day, 0, 0, 0, 0));
}

export function monthAdd(ym: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return ym;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + delta);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

export function monthsEndingAt(endYm: string, count = 12): string[] {
  const n = Math.max(1, Math.min(24, Math.trunc(count)));
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthAdd(endYm, -i));
  return out;
}

export function lastFullMonthChicago(now = new Date()): string {
  // Determine current Chicago year/month, then subtract 1 month.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "");
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    // Fallback: local clock
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  return month === 1 ? `${year - 1}-12` : `${year}-${pad2(month - 1)}`;
}

const CHICAGO_TZ = "America/Chicago";

const chicagoDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHICAGO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const chicagoSlotFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHICAGO_TZ,
  hour: "numeric",
  minute: "numeric",
  hour12: false,
});

export function chicagoDateKey(now: Date = new Date()): string {
  try {
    return chicagoDateFmt.format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Null-safe Chicago calendar date key for SMT coverage labeling. */
export function smtCoverageDateKey(date: Date | null | undefined): string | null {
  if (!date) return null;
  try {
    return chicagoDateFmt.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Local 15-minute slot index (0–95) in America/Chicago for SMT completeness checks. */
export function chicagoSlot96FromTs(ts: Date): number | null {
  try {
    const parts = chicagoSlotFmt.formatToParts(ts);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const slot = hour * 4 + Math.floor(minute / 15);
    return slot >= 0 && slot <= 95 ? slot : null;
  } catch {
    return null;
  }
}

export function rollingAutoAnchorEndDateChicago(
  now = new Date(),
  lagDays = CANONICAL_COVERAGE_LAG_DAYS
): string {
  const safeLagDays = Math.max(0, Math.trunc(lagDays));
  return prevCalendarDayDateKey(chicagoDateKey(now), safeLagDays);
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(
  timezone: string,
  opts: {
    year?: "numeric" | "2-digit";
    month?: "numeric" | "2-digit";
    day?: "numeric" | "2-digit";
    hour?: "numeric" | "2-digit";
    minute?: "numeric" | "2-digit";
    weekday?: "short" | "long" | "narrow";
    hour12?: boolean;
  }
): Intl.DateTimeFormat {
  const key = `${timezone}|${JSON.stringify(opts)}`;
  const cached = dtfCache.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...opts });
  dtfCache.set(key, created);
  return created;
}

export function dateTimePartsInTimezone(
  input: Date | string,
  timezone = "America/Chicago"
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekdayIndex: number; // 0=Sun..6=Sat
  dateKey: string; // YYYY-MM-DD
  yearMonth: string; // YYYY-MM
} | null {
  const ts = input instanceof Date ? input : new Date(String(input ?? ""));
  if (!Number.isFinite(ts.getTime())) return null;
  try {
    const fmt = getFormatter(timezone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    });
    const parts = fmt.formatToParts(ts);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const year = Number(get("year"));
    const month = Number(get("month"));
    const day = Number(get("day"));
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    const weekday = get("weekday");
    if (![year, month, day, hour, minute].every((n) => Number.isFinite(n))) return null;
    const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
    if (weekdayIndex < 0) return null;
    const yearMonth = `${String(year)}-${pad2(month)}`;
    const dateKey = `${yearMonth}-${pad2(day)}`;
    return { year, month, day, hour, minute, weekdayIndex, dateKey, yearMonth };
  } catch {
    return null;
  }
}

export function prevCalendarDayDateKey(ymd: string, daysBack: number): string {
  const key = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  const [y, m, d] = key.split("-").map(Number);
  const back = Math.max(0, Math.trunc(Number(daysBack) || 0));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}

export function enumerateDateKeysInclusive(startDate: string, endDate: string): string[] {
  const start = String(startDate ?? "").slice(0, 10);
  const end = String(endDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return [];
  const out: string[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  for (let t = startMs; t <= endMs; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function canonicalUsageWindowChicago(args?: {
  now?: Date;
  reliableLagDays?: number;
  totalDays?: number;
}): { startDate: string; endDate: string } {
  return canonicalUsageWindowForTimezone({
    ...args,
    timezone: "America/Chicago",
  });
}

export function canonicalUsageWindowForTimezone(args?: {
  now?: Date;
  reliableLagDays?: number;
  totalDays?: number;
  timezone?: string;
}): { startDate: string; endDate: string } {
  const now = args?.now ?? new Date();
  const reliableLagDays = Math.max(0, Math.trunc(args?.reliableLagDays ?? CANONICAL_COVERAGE_LAG_DAYS));
  const totalDays = Math.max(1, Math.trunc(args?.totalDays ?? CANONICAL_COVERAGE_TOTAL_DAYS));
  const timezone = String(args?.timezone ?? "America/Chicago").trim() || "America/Chicago";
  const todayInTimezone = dateTimePartsInTimezone(now, timezone)?.dateKey ?? chicagoDateKey(now);
  const endDate = prevCalendarDayDateKey(todayInTimezone, reliableLagDays);
  const startDate = prevCalendarDayDateKey(endDate, totalDays - 1);
  return { startDate, endDate };
}

