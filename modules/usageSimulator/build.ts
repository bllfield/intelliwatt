import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import { canonicalWindow12Months } from "@/modules/usageSimulator/canonicalWindow";
import { estimateUsageForCanonicalWindow } from "@/modules/usageEstimator/estimate";
import type { HomeProfileInput } from "@/modules/homeProfile/validation";
import type { ApplianceProfilePayloadV1 } from "@/modules/applianceProfile/validation";
import { getGenericWeekdayShape96, getGenericWeekendShape96, normalizeShape96, type Shape96 } from "@/modules/simulatedUsage/intradayTemplates";
import { fetchSmtCanonicalMonthlyTotals, fetchSmtIntradayShape96 } from "@/modules/realUsageAdapter/smt";
import { reshapeMonthlyTotalsFromBaseline } from "@/modules/usageSimulator/reshape";

export type BuildMode = "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";
export type BaseKind = "MANUAL" | "ESTIMATED" | "SMT_ACTUAL_BASELINE";

export type BuildResult = {
  baseKind: BaseKind;
  canonicalMonths: string[];
  monthlyTotalsKwhByMonth: Record<string, number>; // YYYY-MM -> kWh (import-only)
  intradayShape96: Shape96;
  weekdayWeekendShape96?: { weekday: Shape96; weekend: Shape96 };
  notes: string[];
  filledMonths: string[];
  source?: {
    smtMonthlyAnchorsByMonth?: Record<string, number>;
    smtIntradayShape96?: number[];
  };
};

function yearMonthToMonthIndex0(ym: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return null;
  const mo = Number(m[2]);
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  return mo - 1;
}

const DEFAULT_SEASONAL_WEIGHTS_TX = [
  0.070, 0.065, 0.070, 0.075, 0.085, 0.100, 0.115, 0.110, 0.085, 0.075, 0.075, 0.075,
];

function annualToMonthlyByWeights(annualKwh: number, canonicalMonths: string[]): Record<string, number> {
  const w = canonicalMonths.map((ym) => {
    const idx = yearMonthToMonthIndex0(ym);
    return idx == null ? 1 / 12 : DEFAULT_SEASONAL_WEIGHTS_TX[idx] ?? 1 / 12;
  });
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  for (let i = 0; i < canonicalMonths.length; i++) {
    out[canonicalMonths[i]] = (annualKwh * w[i]) / sum;
  }
  return out;
}

function manualMonthlyTotals(payload: ManualUsagePayload, canonicalMonths: string[]): { monthly: Record<string, number>; notes: string[] } {
  const notes: string[] = [];

  if ((payload as any).mode === "MONTHLY") {
    const map = new Map<string, number>();
    for (const r of (payload as any).monthlyKwh || []) {
      const ym = String((r as any)?.month ?? "").trim();
      const kwh = typeof (r as any)?.kwh === "number" && Number.isFinite((r as any).kwh) ? (r as any).kwh : null;
      if (!ym) continue;
      if (kwh == null || kwh < 0) continue;
      map.set(ym, kwh);
    }
    const monthly: Record<string, number> = {};
    for (const ym of canonicalMonths) monthly[ym] = map.get(ym) ?? 0;
    return { monthly, notes };
  }

  // ANNUAL: distribute across canonical months.
  const annual = typeof (payload as any).annualKwh === "number" && Number.isFinite((payload as any).annualKwh) ? (payload as any).annualKwh : 0;
  notes.push("Annual manual total distributed across months using a deterministic seasonal profile.");
  return { monthly: annualToMonthlyByWeights(Math.max(0, annual), canonicalMonths), notes };
}

export async function buildSimulatorInputs(args: {
  mode: BuildMode;
  manualUsagePayload: ManualUsagePayload | null;
  homeProfile: HomeProfileInput;
  applianceProfile: ApplianceProfilePayloadV1;
  esiidForSmt?: string | null;
  baselineHomeProfile?: HomeProfileInput | null;
  baselineApplianceProfile?: ApplianceProfilePayloadV1 | null;
  canonicalMonths?: string[]; // optional override (V1 determinism)
  now?: Date;
}): Promise<BuildResult> {
  const canonicalMonths =
    Array.isArray(args.canonicalMonths) && args.canonicalMonths.length === 12
      ? args.canonicalMonths
      : canonicalWindow12Months(args.now ?? new Date()).months;

  if (args.mode === "MANUAL_TOTALS") {
    if (!args.manualUsagePayload) {
      throw new Error("manual_usage_required");
    }
    const { monthly, notes } = manualMonthlyTotals(args.manualUsagePayload, canonicalMonths);

    return {
      baseKind: "MANUAL",
      canonicalMonths,
      monthlyTotalsKwhByMonth: monthly,
      intradayShape96: getGenericWeekdayShape96(),
      weekdayWeekendShape96: { weekday: getGenericWeekdayShape96(), weekend: getGenericWeekendShape96() },
      notes,
      filledMonths: [],
    };
  }

  if (args.mode === "NEW_BUILD_ESTIMATE") {
    const est = estimateUsageForCanonicalWindow({
      canonicalMonths,
      home: args.homeProfile,
      appliances: args.applianceProfile,
    });
    const monthlyTotalsKwhByMonth: Record<string, number> = {};
    for (let i = 0; i < canonicalMonths.length; i++) monthlyTotalsKwhByMonth[canonicalMonths[i]] = est.monthlyKwh[i] ?? 0;

    return {
      baseKind: "ESTIMATED",
      canonicalMonths,
      monthlyTotalsKwhByMonth,
      intradayShape96: getGenericWeekdayShape96(),
      weekdayWeekendShape96: { weekday: getGenericWeekdayShape96(), weekend: getGenericWeekendShape96() },
      notes: est.notes,
      filledMonths: est.filledMonths,
    };
  }

  // SMT_BASELINE
  const esiid = args.esiidForSmt ?? null;
  if (!esiid) throw new Error("smt_esiid_missing");

  const { monthlyKwhByMonth } = await fetchSmtCanonicalMonthlyTotals({ esiid, canonicalMonths });
  const shape = await fetchSmtIntradayShape96({ esiid, canonicalMonths });
  if (!shape) throw new Error("smt_intraday_shape_missing");

  const baselineHome = args.baselineHomeProfile ?? args.homeProfile;
  const baselineAppliances = args.baselineApplianceProfile ?? args.applianceProfile;

  const baselineEst = estimateUsageForCanonicalWindow({
    canonicalMonths,
    home: baselineHome,
    appliances: baselineAppliances,
    smtMonthlyKwhByMonth: monthlyKwhByMonth,
  });

  const baselineMonthlyTotalsKwhByMonth: Record<string, number> = {};
  for (let i = 0; i < canonicalMonths.length; i++) {
    baselineMonthlyTotalsKwhByMonth[canonicalMonths[i]] = baselineEst.monthlyKwh[i] ?? 0;
  }

  const reshaped = reshapeMonthlyTotalsFromBaseline({
    canonicalMonths,
    baselineMonthlyTotalsKwhByMonth,
    baselineHome,
    baselineAppliances,
    currentHome: args.homeProfile,
    currentAppliances: args.applianceProfile,
  });

  return {
    baseKind: "SMT_ACTUAL_BASELINE",
    canonicalMonths,
    monthlyTotalsKwhByMonth: reshaped.monthlyTotalsKwhByMonth,
    intradayShape96: normalizeShape96(shape),
    notes: [...baselineEst.notes, ...reshaped.notes],
    filledMonths: baselineEst.filledMonths,
    source: {
      smtMonthlyAnchorsByMonth: monthlyKwhByMonth,
      smtIntradayShape96: shape,
    },
  };
}

