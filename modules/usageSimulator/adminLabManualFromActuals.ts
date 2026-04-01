/**
 * Admin Gap-Fill lab: derive MANUAL_TOTALS payloads from source-house actual usage for the canonical window.
 * Same shared `fetchActualCanonicalMonthlyTotals` as SMT_BASELINE input building — no route-local aggregation math.
 */

import type { ApplianceProfilePayloadV1 } from "@/modules/applianceProfile/validation";
import type { HomeProfileInput } from "@/modules/homeProfile/validation";
import { fetchActualCanonicalDailyTotals, fetchActualCanonicalMonthlyTotals } from "@/modules/realUsageAdapter/actual";
import { estimateUsageForCanonicalWindow } from "@/modules/usageEstimator/estimate";
import {
  buildSourceDerivedMonthlyTargetResolution,
  type SourceDerivedMonthlyTargetResolution,
} from "@/modules/usageSimulator/monthlyTargetConstruction";
import { travelRangesToExcludeDateKeys } from "@/modules/usageSimulator/build";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import type { AdminLabTreatmentMode } from "@/modules/usageSimulator/adminLabTreatment";

function canonicalWindowEndDate(canonicalMonths: string[]): string | null {
  if (!Array.isArray(canonicalMonths) || canonicalMonths.length === 0) return null;
  const last = String(canonicalMonths[canonicalMonths.length - 1]).trim();
  if (!/^\d{4}-\d{2}$/.test(last)) return null;
  const [y, m] = last.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${last}-${String(lastDay).padStart(2, "0")}`;
}

export async function buildAdminLabSyntheticManualUsagePayload(args: {
  treatmentMode: Extract<AdminLabTreatmentMode, "manual_monthly_constrained" | "manual_annual_constrained">;
  canonicalMonths: string[];
  actualContextHouseId: string;
  esiid: string | null;
  monthlyAnchorEndDate?: string | null;
  homeProfile: HomeProfileInput;
  applianceProfile: ApplianceProfilePayloadV1;
  travelRanges?: Array<{ startDate: string; endDate: string }>;
}): Promise<{
  payload: ManualUsagePayload;
  monthlySourceDerivedResolution: SourceDerivedMonthlyTargetResolution | null;
}> {
  const excludeDateKeys = args.travelRanges?.length ? travelRangesToExcludeDateKeys(args.travelRanges) : undefined;
  const actualMonthly = await fetchActualCanonicalMonthlyTotals({
    houseId: args.actualContextHouseId,
    esiid: args.esiid,
    canonicalMonths: args.canonicalMonths,
    excludeDateKeys,
    travelRanges: args.travelRanges,
  });
  const byMonth = actualMonthly.monthlyKwhByMonth ?? {};
  const anchorEndDate =
    (typeof args.monthlyAnchorEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.monthlyAnchorEndDate)
      ? args.monthlyAnchorEndDate
      : null) ??
    canonicalWindowEndDate(args.canonicalMonths) ??
    `${args.canonicalMonths[args.canonicalMonths.length - 1]}-28`;
  if (args.treatmentMode === "manual_monthly_constrained") {
    const actualDaily = await fetchActualCanonicalDailyTotals({
      houseId: args.actualContextHouseId,
      esiid: args.esiid,
      canonicalMonths: args.canonicalMonths,
    });
    const fallbackEstimate = estimateUsageForCanonicalWindow({
      canonicalMonths: args.canonicalMonths,
      home: args.homeProfile,
      appliances: args.applianceProfile,
    });
    const fallbackMonthlyKwhByMonth: Record<string, number> = {};
    for (let index = 0; index < args.canonicalMonths.length; index += 1) {
      fallbackMonthlyKwhByMonth[args.canonicalMonths[index]!] = Number(fallbackEstimate.monthlyKwh[index] ?? 0) || 0;
    }
    const monthlySourceDerivedResolution = buildSourceDerivedMonthlyTargetResolution({
      canonicalMonths: args.canonicalMonths,
      anchorEndDate,
      dailyKwhByDateKey: actualDaily.dailyKwhByDateKey,
      travelRanges: args.travelRanges,
      fallbackMonthlyKwhByMonth,
    });
    const monthlyKwh = args.canonicalMonths.map((ym) => ({
      month: ym,
      kwh: Math.round((Number(monthlySourceDerivedResolution.monthlyKwhByMonth[ym] ?? 0) || 0) * 100) / 100,
    }));
    return {
      payload: {
        mode: "MONTHLY",
        anchorEndDate,
        monthlyKwh,
        // Source-derived totals already honored travel-aware normalization before lockbox entry.
        travelRanges: [],
      },
      monthlySourceDerivedResolution,
    };
  }

  const monthlyKwh = args.canonicalMonths.map((ym) => ({
    month: ym,
    kwh: Math.round((Number(byMonth[ym] ?? 0) || 0) * 100) / 100,
  }));
  const annualKwh = monthlyKwh.reduce((s, r) => s + (typeof r.kwh === "number" && Number.isFinite(r.kwh) ? r.kwh : 0), 0);
  return {
    payload: {
      mode: "ANNUAL",
      anchorEndDate,
      annualKwh: Math.round(Math.max(0, annualKwh) * 100) / 100,
      // Source-derived totals already honored these exclusions during the shared actual-monthly read.
      travelRanges: [],
    },
    monthlySourceDerivedResolution: null,
  };
}
