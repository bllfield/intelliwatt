/**
 * Home-local 15-minute load curve and time-of-day buckets (Usage dashboard parity).
 * Do not bucket by UTC ISO substring — Green Button / SMT instants must map through home TZ.
 */

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function normalizeHomeTimezoneForLoadCurve(timezone: string | null | undefined): string {
  const tz = String(timezone ?? "").trim();
  return tz || "America/Chicago";
}

export function hhmmInHomeTimezone(timestamp: string, timezone: string): string | null {
  const ts = new Date(String(timestamp ?? ""));
  if (!Number.isFinite(ts.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: normalizeHomeTimezoneForLoadCurve(timezone),
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(ts);
    const hour = parts.find((part) => part.type === "hour")?.value ?? "";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "";
    const hhmm = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
  } catch {
    return null;
  }
}

export function hourInHomeTimezone(timestamp: string, timezone: string): number | null {
  const ts = new Date(String(timestamp ?? ""));
  if (!Number.isFinite(ts.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: normalizeHomeTimezoneForLoadCurve(timezone),
      hour: "numeric",
      hour12: false,
    }).formatToParts(ts);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "");
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
    return hour;
  } catch {
    return null;
  }
}

export function buildFifteenMinuteAveragesFromIntervalRows(
  rows: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>,
  timezone: string
): Array<{ hhmm: string; avgKw: number }> {
  const buckets = new Map<string, { sumKw: number; count: number }>();
  for (const row of rows) {
    const timestamp = String(row?.timestamp ?? "");
    if (!timestamp) continue;
    const hhmm = hhmmInHomeTimezone(timestamp, timezone);
    if (!hhmm) continue;
    const kwh = Number(row?.kwh ?? row?.consumption_kwh ?? 0) || 0;
    const current = buckets.get(hhmm) ?? { sumKw: 0, count: 0 };
    current.sumKw += kwh * 4;
    current.count += 1;
    buckets.set(hhmm, current);
  }
  return Array.from(buckets.entries())
    .map(([hhmm, bucket]) => ({
      hhmm,
      avgKw: bucket.count > 0 ? round2(bucket.sumKw / bucket.count) : 0,
    }))
    .sort((left, right) => (left.hhmm < right.hhmm ? -1 : left.hhmm > right.hhmm ? 1 : 0));
}

export function buildTimeOfDayBucketsFromIntervalRows(
  rows: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>,
  timezone: string
): Array<{ key: string; label: string; kwh: number }> {
  const sums = { overnight: 0, morning: 0, afternoon: 0, evening: 0 };
  for (const row of rows) {
    const timestamp = String(row?.timestamp ?? "");
    if (!timestamp) continue;
    const hour = hourInHomeTimezone(timestamp, timezone);
    if (hour == null) continue;
    const kwh = Number(row?.kwh ?? row?.consumption_kwh ?? 0) || 0;
    if (hour < 6) sums.overnight += kwh;
    else if (hour < 12) sums.morning += kwh;
    else if (hour < 18) sums.afternoon += kwh;
    else sums.evening += kwh;
  }
  return [
    { key: "overnight", label: "Overnight (12am–6am)", kwh: round2(sums.overnight) },
    { key: "morning", label: "Morning (6am–12pm)", kwh: round2(sums.morning) },
    { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: round2(sums.afternoon) },
    { key: "evening", label: "Evening (6pm–12am)", kwh: round2(sums.evening) },
  ];
}
