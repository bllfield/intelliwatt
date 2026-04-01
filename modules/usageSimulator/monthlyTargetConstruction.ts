import { dateTimePartsInTimezone, enumerateDateKeysInclusive } from "@/lib/time/chicago";
import { anchorEndDateUtc } from "@/modules/manualUsage/anchor";
import { billingPeriodsEndingAt } from "@/modules/manualUsage/billingPeriods";
import type { ManualUsagePayload, TravelRange } from "@/modules/simulatedUsage/types";

export const MIN_TRUSTED_NON_TRAVEL_DAYS_PER_MONTH = 5;

export type MonthlyTargetBuildMethod =
  | "normalized_from_non_travel_days"
  | "insufficient_non_travel_days_fallback_to_pool_sim"
  | "user_manual_month_value";

export type MonthlyTargetConstructionDiagnostic = {
  month: string;
  rawMonthKwhFromSource: number | null;
  travelVacantDayCountInMonth: number;
  eligibleNonTravelDayCount: number;
  eligibleNonTravelKwhTotal: number;
  nonTravelDailyAverage: number | null;
  normalizedMonthTarget: number | null;
  monthlyTargetBuildMethod: MonthlyTargetBuildMethod;
  trustedMonthlyAnchorUsed: boolean;
};

export type SourceDerivedMonthlyTargetResolution = {
  monthlyKwhByMonth: Record<string, number>;
  trustedMonthlyAnchorsByMonth: Record<string, number>;
  diagnostics: MonthlyTargetConstructionDiagnostic[];
  notes: string[];
};

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function resolveManualMonthlyAnchorEndDateKey(payload: {
  anchorEndDate?: unknown;
  anchorEndMonth?: unknown;
  billEndDay?: unknown;
}): string | null {
  const anchorEndDate =
    typeof payload.anchorEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.anchorEndDate.trim())
      ? payload.anchorEndDate.trim()
      : null;
  if (anchorEndDate) return anchorEndDate;

  const anchorEndMonth =
    typeof payload.anchorEndMonth === "string" && /^\d{4}-\d{2}$/.test(payload.anchorEndMonth.trim())
      ? payload.anchorEndMonth.trim()
      : null;
  if (!anchorEndMonth) return null;

  const billEndDay =
    typeof payload.billEndDay === "number" && Number.isFinite(payload.billEndDay)
      ? Math.trunc(payload.billEndDay)
      : 15;
  const resolved = anchorEndDateUtc(anchorEndMonth, billEndDay);
  return dateTimePartsInTimezone(resolved ?? "", "UTC")?.dateKey ?? null;
}

function travelRangeDateKeys(ranges: TravelRange[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const range of ranges ?? []) {
    const startDate = String(range?.startDate ?? "").slice(0, 10);
    const endDate = String(range?.endDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) continue;
    for (const dateKey of enumerateDateKeysInclusive(startDate, endDate)) out.add(dateKey);
  }
  return out;
}

export function buildSourceDerivedMonthlyTargetResolution(args: {
  canonicalMonths: string[];
  anchorEndDate: string;
  dailyKwhByDateKey: Record<string, number>;
  travelRanges?: TravelRange[];
  fallbackMonthlyKwhByMonth: Record<string, number>;
}): SourceDerivedMonthlyTargetResolution {
  const travelDateKeys = travelRangeDateKeys(args.travelRanges);
  const billingPeriods = billingPeriodsEndingAt(args.anchorEndDate, args.canonicalMonths.length);
  const monthlyKwhByMonth: Record<string, number> = {};
  const trustedMonthlyAnchorsByMonth: Record<string, number> = {};
  const diagnostics: MonthlyTargetConstructionDiagnostic[] = [];
  let fallbackMonthCount = 0;

  for (const period of billingPeriods) {
    const month = period.id;
    const periodDateKeys = enumerateDateKeysInclusive(period.startDate, period.endDate);
    let rawMonthKwh = 0;
    let rawMonthDayCount = 0;
    let travelVacantDayCountInMonth = 0;
    let eligibleNonTravelDayCount = 0;
    let eligibleNonTravelKwhTotal = 0;

    for (const dateKey of periodDateKeys) {
      if (!Object.prototype.hasOwnProperty.call(args.dailyKwhByDateKey, dateKey)) continue;
      const kwh = Number(args.dailyKwhByDateKey[dateKey]);
      if (!Number.isFinite(kwh)) continue;
      rawMonthKwh += kwh;
      rawMonthDayCount += 1;
      if (travelDateKeys.has(dateKey)) {
        travelVacantDayCountInMonth += 1;
        continue;
      }
      eligibleNonTravelDayCount += 1;
      eligibleNonTravelKwhTotal += kwh;
    }

    const nonTravelDailyAverage =
      eligibleNonTravelDayCount >= MIN_TRUSTED_NON_TRAVEL_DAYS_PER_MONTH
        ? eligibleNonTravelKwhTotal / eligibleNonTravelDayCount
        : null;
    const normalizedMonthTarget =
      nonTravelDailyAverage == null ? null : nonTravelDailyAverage * periodDateKeys.length;

    if (normalizedMonthTarget != null) {
      const rounded = round2(Math.max(0, normalizedMonthTarget));
      monthlyKwhByMonth[month] = rounded;
      trustedMonthlyAnchorsByMonth[month] = rounded;
      diagnostics.push({
        month,
        rawMonthKwhFromSource: rawMonthDayCount > 0 ? round2(rawMonthKwh) : null,
        travelVacantDayCountInMonth,
        eligibleNonTravelDayCount,
        eligibleNonTravelKwhTotal: round2(eligibleNonTravelKwhTotal),
        nonTravelDailyAverage: round2(nonTravelDailyAverage),
        normalizedMonthTarget: rounded,
        monthlyTargetBuildMethod: "normalized_from_non_travel_days",
        trustedMonthlyAnchorUsed: true,
      });
      continue;
    }

    fallbackMonthCount += 1;
    monthlyKwhByMonth[month] = round2(Math.max(0, Number(args.fallbackMonthlyKwhByMonth?.[month] ?? 0) || 0));
    diagnostics.push({
      month,
      rawMonthKwhFromSource: rawMonthDayCount > 0 ? round2(rawMonthKwh) : null,
      travelVacantDayCountInMonth,
      eligibleNonTravelDayCount,
      eligibleNonTravelKwhTotal: round2(eligibleNonTravelKwhTotal),
      nonTravelDailyAverage: null,
      normalizedMonthTarget: null,
      monthlyTargetBuildMethod: "insufficient_non_travel_days_fallback_to_pool_sim",
      trustedMonthlyAnchorUsed: false,
    });
  }

  const notes =
    fallbackMonthCount > 0
      ? [
          `Monthly source-derived anchors fell back to shared pool simulation for ${fallbackMonthCount} month(s) with fewer than ${MIN_TRUSTED_NON_TRAVEL_DAYS_PER_MONTH} eligible non-travel days.`,
        ]
      : [];

  return {
    monthlyKwhByMonth,
    trustedMonthlyAnchorsByMonth,
    diagnostics,
    notes,
  };
}

export function resolveManualMonthlyTargetDiagnostics(args: {
  payload: ManualUsagePayload;
  canonicalMonths: string[];
  sourceDerivedResolution?: SourceDerivedMonthlyTargetResolution | null;
}): {
  monthlyKwhByMonth: Record<string, number>;
  diagnostics: MonthlyTargetConstructionDiagnostic[] | null;
  sourceDerivedTrustedMonthlyAnchorsByMonth: Record<string, number> | null;
  notes: string[];
} {
  if ((args.payload as any)?.mode !== "MONTHLY") {
    return {
      monthlyKwhByMonth: {},
      diagnostics: null,
      sourceDerivedTrustedMonthlyAnchorsByMonth: null,
      notes: [],
    };
  }

  if (args.sourceDerivedResolution) {
    return {
      monthlyKwhByMonth: { ...args.sourceDerivedResolution.monthlyKwhByMonth },
      diagnostics: args.sourceDerivedResolution.diagnostics.map((row) => ({ ...row })),
      sourceDerivedTrustedMonthlyAnchorsByMonth: { ...args.sourceDerivedResolution.trustedMonthlyAnchorsByMonth },
      notes: [...args.sourceDerivedResolution.notes],
    };
  }

  const enteredByMonth = new Map<string, number>();
  for (const row of (args.payload as any)?.monthlyKwh ?? []) {
    const month = String((row as any)?.month ?? "").trim();
    const kwh = Number((row as any)?.kwh);
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(kwh) || kwh < 0) continue;
    enteredByMonth.set(month, round2(kwh));
  }

  const monthlyKwhByMonth: Record<string, number> = {};
  const diagnostics: MonthlyTargetConstructionDiagnostic[] = [];
  for (const month of args.canonicalMonths) {
    const value = enteredByMonth.get(month) ?? 0;
    monthlyKwhByMonth[month] = value;
    diagnostics.push({
      month,
      rawMonthKwhFromSource: null,
      travelVacantDayCountInMonth: 0,
      eligibleNonTravelDayCount: 0,
      eligibleNonTravelKwhTotal: 0,
      nonTravelDailyAverage: null,
      normalizedMonthTarget: null,
      monthlyTargetBuildMethod: "user_manual_month_value",
      trustedMonthlyAnchorUsed: enteredByMonth.has(month),
    });
  }

  return {
    monthlyKwhByMonth,
    diagnostics,
    sourceDerivedTrustedMonthlyAnchorsByMonth: null,
    notes: [],
  };
}
