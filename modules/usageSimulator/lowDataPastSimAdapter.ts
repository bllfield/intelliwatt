/**
 * Shared adapters for low-data Past modes (manual totals, new-build estimate) so they can feed
 * the same canonical Past chain as SMT_BASELINE without route-local math or alternate simulators.
 */

import { dateKeyInTimezone } from "@/lib/admin/gapfillLab";
import type { SimulatorBuildInputsV1 } from "@/modules/usageSimulator/dataset";
import { generateSimulatedCurve } from "@/modules/simulatedUsage/engine";

export function buildSyntheticIntervalsForSharedPastWindow(args: {
  buildInputs: SimulatorBuildInputsV1;
  startDate: string;
  endDate: string;
  timezone?: string;
}): Array<{ timestamp: string; kwh: number }> {
  const eligibleBillPeriods = Array.isArray(args.buildInputs.manualBillPeriods)
    ? args.buildInputs.manualBillPeriods
        .filter((period) => period.eligibleForConstraint)
        .map((period) => ({
          id: period.id,
          startDate: period.startDate,
          endDate: period.endDate,
        }))
    : [];
  const curve = generateSimulatedCurve({
    canonicalMonths: args.buildInputs.canonicalMonths,
    periods: eligibleBillPeriods.length > 0 ? eligibleBillPeriods : args.buildInputs.canonicalPeriods,
    monthlyTotalsKwhByMonth:
      eligibleBillPeriods.length > 0
        ? args.buildInputs.manualBillPeriodTotalsKwhById ?? {}
        : args.buildInputs.monthlyTotalsKwhByMonth,
    intradayShape96: args.buildInputs.intradayShape96,
    weekdayWeekendShape96: args.buildInputs.weekdayWeekendShape96,
    travelRanges: args.buildInputs.travelRanges,
  });
  const tz = String(args.timezone ?? "").trim();
  const out: Array<{ timestamp: string; kwh: number }> = [];
  for (const iv of curve.intervals) {
    const ts = String(iv.timestamp ?? "");
    const dk = tz ? dateKeyInTimezone(ts, tz) : new Date(ts).toISOString().slice(0, 10);
    if (dk >= args.startDate && dk <= args.endDate) {
      out.push({ timestamp: ts, kwh: Number(iv.consumption_kwh) || 0 });
    }
  }
  return out;
}

export type LowDataUsageShapeSnap = {
  weekdayAvgByMonthKey: Record<string, number>;
  weekendAvgByMonthKey: Record<string, number>;
};

/** Uniform weekday/weekend daily average from calendar-month kWh (honest low-data fallback when DB profile is absent). */
export function buildUsageShapeSnapFromMonthlyTotalsForLowData(args: {
  canonicalMonths: string[];
  monthlyTotalsKwhByMonth: Record<string, number>;
}): LowDataUsageShapeSnap {
  const weekdayAvgByMonthKey: Record<string, number> = {};
  const weekendAvgByMonthKey: Record<string, number> = {};
  for (const ym of args.canonicalMonths) {
    const kwh = Number(args.monthlyTotalsKwhByMonth[ym]) || 0;
    const parts = String(ym).trim().split("-");
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const dim = Number.isFinite(y) && Number.isFinite(m) ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 0;
    const perDay = dim > 0 ? kwh / dim : 0;
    weekdayAvgByMonthKey[ym] = perDay;
    weekendAvgByMonthKey[ym] = perDay;
  }
  return { weekdayAvgByMonthKey, weekendAvgByMonthKey };
}
