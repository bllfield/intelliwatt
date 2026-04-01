/**
 * Admin Gap-Fill lab: derive MANUAL_TOTALS payloads from source-house actual usage for the canonical window.
 * Same shared `fetchActualCanonicalMonthlyTotals` as SMT_BASELINE input building — no route-local aggregation math.
 */

import { travelRangesToExcludeDateKeys } from "@/modules/usageSimulator/build";
import { fetchActualCanonicalMonthlyTotals } from "@/modules/realUsageAdapter/actual";
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
  travelRanges?: Array<{ startDate: string; endDate: string }>;
}): Promise<ManualUsagePayload> {
  const excludeDateKeys = args.travelRanges?.length ? travelRangesToExcludeDateKeys(args.travelRanges) : undefined;
  const actualMonthly = await fetchActualCanonicalMonthlyTotals({
    houseId: args.actualContextHouseId,
    esiid: args.esiid,
    canonicalMonths: args.canonicalMonths,
    excludeDateKeys,
    travelRanges: args.travelRanges,
  });
  const byMonth = actualMonthly.monthlyKwhByMonth ?? {};
  const monthlyKwh = args.canonicalMonths.map((ym) => ({
    month: ym,
    kwh: Math.round((Number(byMonth[ym] ?? 0) || 0) * 100) / 100,
  }));
  const anchorEndDate = canonicalWindowEndDate(args.canonicalMonths) ?? `${args.canonicalMonths[args.canonicalMonths.length - 1]}-28`;
  if (args.treatmentMode === "manual_monthly_constrained") {
    return {
      mode: "MONTHLY",
      anchorEndDate,
      monthlyKwh,
      // Source-derived totals already honored these exclusions during the shared actual-monthly read.
      travelRanges: [],
    };
  }

  const annualKwh = monthlyKwh.reduce((s, r) => s + (typeof r.kwh === "number" && Number.isFinite(r.kwh) ? r.kwh : 0), 0);
  return {
    mode: "ANNUAL",
    anchorEndDate,
    annualKwh: Math.round(Math.max(0, annualKwh) * 100) / 100,
    // Source-derived totals already honored these exclusions during the shared actual-monthly read.
    travelRanges: [],
  };
}
