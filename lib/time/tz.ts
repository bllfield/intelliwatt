// lib/time/tz.ts
import { DateTime } from 'luxon';

export const TZ_BUILD_ID = 'snap-0300-v2';
export type AmbiguousPolicy = 'earlier' | 'later';

/**
 * Parse a time string that may be:
 *  - ISO with offset (trust it)
 *  - ISO/space-separated with NO offset (treat as local wall time in `zone`)
 *
 * Returns a JS Date in UTC (or null if invalid).
 *
 * DST rules:
 *  - Non-existent local times (spring-forward): if hour===02 and invalid, SNAP to 03:00:00 local.
 *  - Ambiguous local times (fall-back): choose per `ambiguous` policy (default 'earlier').
 */
export function parseInZoneToUTC(
  s: string,
  zone: string = 'America/Chicago',
  ambiguous: AmbiguousPolicy = 'earlier'
): Date | null {
  if (!s) return null;

  // Normalize "YYYY-MM-DD HH:mm:ss" → "YYYY-MM-DDTHH:mm:ss"
  const isoish = s.includes('T') ? s : s.replace(' ', 'T');

  // If explicit offset present, trust it.
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(isoish) || /Z$/.test(isoish);
  if (hasOffset) {
    const d = DateTime.fromISO(isoish, { setZone: true });
    return d.isValid ? d.toUTC().toJSDate() : null;
  }

  // Parse components so we can handle spring-forward deterministically
  const m = isoish.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const dt = DateTime.fromISO(isoish, { zone });
    return dt.isValid ? dt.toUTC().toJSDate() : null;
  }
  const [, Y, M, D, h, mm, ss] = m;
  const base = {
    year: Number(Y),
    month: Number(M),
    day: Number(D),
    hour: Number(h),
    minute: Number(mm),
    second: Number(ss ?? '0'),
    millisecond: 0,
  };

  // Construct local wall time
  let dt = DateTime.fromObject(base, { zone });

  if (!dt.isValid) {
    // SPRING-FORWARD: if the requested local hour is 02 and it's invalid,
    // SNAP to 03:00:00 local (first valid instant after the jump).
    if (base.hour === 2) {
      dt = DateTime.fromObject(
        { year: base.year, month: base.month, day: base.day, hour: 3, minute: 0, second: 0, millisecond: 0 },
        { zone }
      );
      if (!dt.isValid) return null;
    } else {
      // Fallback for other rare invalids: advance minute-by-minute up to 120 minutes.
      // Recreate from components each loop to avoid arithmetic on invalid instances.
      let tries = 0;
      let probe = DateTime.fromObject(base, { zone });
      while (!probe.isValid && tries < 120) {
        const next = {
          year: base.year,
          month: base.month,
          day: base.day,
          hour: base.hour,
          minute: base.minute + tries + 1,
          second: base.second,
          millisecond: 0,
        };
        probe = DateTime.fromObject(next, { zone });
        tries++;
      }
      if (!probe.isValid) return null;
      dt = probe;
    }
  } else {
    // FALL-BACK ambiguous resolution (1:00–1:59 occurs twice)
    if (ambiguous === 'later') {
      // Try to recreate same wall time but prefer later offset by moving into overlap and back.
      const plus1h = dt.plus({ hours: 1 });
      if (plus1h.offset !== dt.offset) {
        // We're near the overlap; rebuild one hour later then minus 1h to preserve wall clock with later offset.
        const laterWall = DateTime.fromObject(
          { ...base, hour: base.hour + 1 },
          { zone }
        ).minus({ hours: 1 });
        if (laterWall.isValid) dt = laterWall;
      }
    }
  }

  return dt.toUTC().toJSDate();
}
