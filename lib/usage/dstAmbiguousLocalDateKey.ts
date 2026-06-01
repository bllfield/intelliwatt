import {
  createHomeIntervalCalendar,
  expectedSlotsForLocalDate,
} from "@/lib/time/homeIntervalCalendar";

/** Local calendar days with non-standard 15-minute grids (DST spring-forward / fall-back). */
export function isDstAmbiguousLocalDateKey(dateKey: string, timezone: string): boolean {
  const dk = String(dateKey ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return false;
  const home = createHomeIntervalCalendar(String(timezone ?? "America/Chicago").trim() || "America/Chicago");
  return expectedSlotsForLocalDate(dk, home) !== 96;
}

export function filterOutDstAmbiguousLocalDateKeys(dateKeys: Iterable<string>, timezone: string): string[] {
  return Array.from(dateKeys)
    .map((dk) => String(dk ?? "").slice(0, 10))
    .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk) && !isDstAmbiguousLocalDateKey(dk, timezone))
    .sort();
}
