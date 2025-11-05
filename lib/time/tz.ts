import { DateTime } from 'luxon';

export type AmbiguousPolicy = 'earlier' | 'later';

export function parseInZoneToUTC(
  s: string,
  zone: string = 'America/Chicago',
  ambiguous: AmbiguousPolicy = 'earlier'
): Date | null {
  if (!s) return null;

  const isoish = s.includes('T') ? s : s.replace(' ', 'T');

  // Trust explicit offsets
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(isoish) || /Z$/.test(isoish);
  if (hasOffset) {
    const d = DateTime.fromISO(isoish, { setZone: true });
    return d.isValid ? new Date(d.toUTC().toISO()!) : null;
  }

  // Parse components so we can handle non-existent times explicitly
  const m = isoish.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/
  );
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

  // Build the local wall time in zone.
  let dt = DateTime.fromObject(base, { zone });

  if (!dt.isValid) {
    // SPRING-FORWARD: America/Chicago skips 02:00:00 → 02:59:59
    // If the wall clock hour is 02 and it's invalid, snap to 03:00:00 local.
    if (base.hour === 2) {
      dt = DateTime.fromObject(
        { ...base, hour: 3, minute: 0, second: 0, millisecond: 0 },
        { zone }
      );
      if (!dt.isValid) return null;
    } else {
      // Fallback: advance minute-by-minute from the requested wall time until valid (cap at 120 minutes)
      let tries = 0;
      let probe: DateTime | null = null;
      while (tries < 120) {
        const next = {
          ...base,
          minute: base.minute + tries,
        };
        // Handle minute overflow
        if (next.minute >= 60) {
          next.hour = next.hour + Math.floor(next.minute / 60);
          next.minute = next.minute % 60;
        }
        probe = DateTime.fromObject(next, { zone });
        if (probe.isValid) break;
        tries++;
      }
      if (!probe || !probe.isValid) return null;
      dt = probe;
    }
  } else {
    // FALL-BACK ambiguous resolution
    if (ambiguous === 'later') {
      const later = dt.plus({ hours: 1 });
      if (later.offset !== dt.offset) {
        // Recreate the same wall clock using the later offset instance
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
