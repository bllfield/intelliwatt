/**
 * Helpers to aggregate SMT intervals for a billing window.
 * - Accepts 15-min or hourly intervals (kWh).
 * - Defensive to DST: relies on provided timestamps; no timezone math beyond Date parsing.
 */
import { Aggregation, Interval } from './types'

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10)
}
function isoHour(d: Date) {
  return d.toISOString().slice(0, 13) + ':00'
}

export function aggregateIntervals(
  intervals: Interval[],
  periodStart: Date,
  periodEnd: Date
): Aggregation {
  const byDay: Record<string, number> = {}
  const byHour: Record<string, number> = {}
  let kwhTotal = 0

  for (const it of intervals) {
    const t = new Date(it.start)
    if (!(t >= periodStart && t < periodEnd)) continue
    const k = Number(it.kwh) || 0
    kwhTotal += k
    const dKey = isoDay(t)
    byDay[dKey] = (byDay[dKey] ?? 0) + k
    const hKey = isoHour(t)
    byHour[hKey] = (byHour[hKey] ?? 0) + k
  }

  return { periodStart, periodEnd, kwhTotal, byDay, byHour }
}
