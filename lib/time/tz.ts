import { DateTime } from 'luxon';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

export const TZ_BUILD_ID = 'snap-0300-v3';
export type AmbiguousPolicy = 'earlier' | 'later';

export function parseInZoneToUTC(
  s: string,
  zone: string = 'America/Chicago',
  ambiguous: AmbiguousPolicy = 'earlier'
): Date | null {
  if (!s) return null;

  const isoish = s.includes('T') ? s : s.replace(' ', 'T');

  // Trust explicit offsets as-is.
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(isoish) || /Z$/.test(isoish);
  if (hasOffset) {
    const d = DateTime.fromISO(isoish, { setZone: true });
    return d.isValid ? d.toUTC().toJSDate() : null;
  }

  // Parse components so we can control DST behavior.
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

  // SPRING-FORWARD hard rule:
  // If caller asked for local 02:xx (non-existent) in this zone, SNAP to 03:00:00 local deterministically.
  if (base.hour === 2) {
    const snapped = DateTime.fromObject(
      { year: base.year, month: base.month, day: base.day, hour: 3, minute: 0, second: 0, millisecond: 0 },
      { zone }
    );
    return snapped.isValid ? snapped.toUTC().toJSDate() : null;
  }

  // Otherwise, construct wall time normally.
  let dt = DateTime.fromObject(base, { zone });

  if (!dt.isValid) {
    // Rare invalids outside the 02:xx window: minute-step forward (cap 120 min).
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
  } else {
    // FALL-BACK ambiguous resolution (pick later instance if requested)
    if (ambiguous === 'later') {
      const plus1h = dt.plus({ hours: 1 });
      if (plus1h.offset !== dt.offset) {
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
