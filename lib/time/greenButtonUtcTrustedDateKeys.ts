/**
 * Past Sim fetches Green Button on the UTC day grid, but the engine labels and
 * completeness-checks home-local calendar days. Remap adapter trusted UTC keys
 * to every home date touched by those UTC-grid intervals.
 */

import type { HomeProjectedIntervalPoint } from "@/lib/time/actualIntervalCalendar";

function utcDateKeyFromIsoTimestamp(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function mapGreenButtonUtcTrustedDateKeysToHome(
  trustedUtcDateKeys: ReadonlyArray<string>,
  intervals: ReadonlyArray<Pick<HomeProjectedIntervalPoint, "timestamp" | "homeDateKey">>,
): Set<string> {
  const trustedUtc = new Set(
    trustedUtcDateKeys
      .map((key) => String(key ?? "").slice(0, 10))
      .filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
  );
  if (trustedUtc.size === 0) return new Set<string>();

  const homeKeysByUtcDay = new Map<string, Set<string>>();
  for (const row of intervals) {
    const utcKey = utcDateKeyFromIsoTimestamp(String(row.timestamp ?? ""));
    if (!utcKey || !trustedUtc.has(utcKey)) continue;
    const homeKey = String(row.homeDateKey ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(homeKey)) continue;
    const bucket = homeKeysByUtcDay.get(utcKey) ?? new Set<string>();
    bucket.add(homeKey);
    homeKeysByUtcDay.set(utcKey, bucket);
  }

  const homeTrusted = new Set<string>();
  for (const utcKey of trustedUtc) {
    for (const homeKey of homeKeysByUtcDay.get(utcKey) ?? []) {
      homeTrusted.add(homeKey);
    }
  }
  return homeTrusted;
}
