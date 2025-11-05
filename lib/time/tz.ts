// lib/time/tz.ts
import { DateTime } from 'luxon';

export type AmbiguousPolicy = 'earlier' | 'later';

/**
 * Parse a time string that may be:
 *  - ISO with offset (trust it)
 *  - ISO/space-separated with NO offset (treat as local wall time in `zone`)
 *
 * Returns a JS Date in UTC (or null if invalid).
 *
 * DST rules:
 *  - Non-existent local times (spring-forward): shift forward to next valid time.
 *  - Ambiguous local times (fall-back): choose per `ambiguous` policy (default 'earlier').
 */
export function parseInZoneToUTC(
  s: string,
  zone: string = 'America/Chicago',
  ambiguous: AmbiguousPolicy = 'earlier'
): Date | null {
  if (!s) return null;

  // Normalize "YYYY-MM-DD HH:mm:ss" to ISO-like "YYYY-MM-DDTHH:mm:ss" for Luxon
  const isoish = s.includes('T') ? s : s.replace(' ', 'T');

  // If string includes an explicit offset (e.g., ±HH:mm or Z), trust it.
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(isoish) || /Z$/.test(isoish);
  if (hasOffset) {
    const d = DateTime.fromISO(isoish, { setZone: true }); // keep provided offset
    return d.isValid ? new Date(d.toUTC().toISO()!) : null;
  }

  // No offset: interpret as wall time in `zone`
  let dt = DateTime.fromISO(isoish, { zone });
  
  // Handle invalid times (e.g., non-existent during spring-forward)
  if (!dt.isValid) {
    // For non-existent times during spring-forward, shift forward to next valid time
    // Parse components and construct a time after the DST transition
    try {
      const parts = isoish.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      if (parts) {
        const [, year, month, day, hour, minute, second] = parts;
        // Try constructing at 3 AM (after spring-forward) on the same day
        const fallback = DateTime.fromObject(
          { year: +year, month: +month, day: +day, hour: 3, minute: +minute, second: +second || 0 },
          { zone }
        );
        if (fallback.isValid) {
          dt = fallback;
        } else {
          return null;
        }
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }

  // Fall-back ambiguity handling:
  // When wall time is ambiguous (exists twice), Luxon resolves to earlier by default.
  // To force 'later', add 1 hour during overlap window if the same wall clock exists twice.
  if (isAmbiguousWallTime(dt)) {
    if (ambiguous === 'later') {
      // Move forward one hour within overlap to target the second instance
      const later = dt.plus({ hours: 1 });
      dt = later.set({ millisecond: 0 });
    }
    // earlier = keep as-is (Luxon's default behavior)
  }

  return dt.toUTC().toJSDate();
}

/** Detects whether a local wall time occurs twice due to fall-back. */
function isAmbiguousWallTime(dt: DateTime): boolean {
  // Re-create the same wall clock at the same zone, then compute potential alternate offset version
  // Strategy: generate the same local wall clock with 'prefer late' by adding 1 hour and checking if UTC instants differ by 1 hour minus DST delta.
  const earlier = dt;
  const laterCandidate = dt.plus({ hours: 1 });

  // If the zone offset (in minutes) for earlier and laterCandidate are different AND
  // the wall times are still plausible, we're straddling the overlap
  return earlier.offset !== laterCandidate.offset && earlier.toFormat('yyyy-LL-dd HH:mm') === dt.toFormat('yyyy-LL-dd HH:mm');
}

