import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import { canonicalWindow12Months } from "@/modules/usageSimulator/canonicalWindow";
import { estimateUsageForCanonicalWindow } from "@/modules/usageEstimator/estimate";
import type { HomeProfileInput } from "@/modules/homeProfile/validation";
import type { ApplianceProfilePayloadV1 } from "@/modules/applianceProfile/validation";
import {
  buildManualBillPeriodTargets,
  buildManualBillPeriodTotalsById,
  type ManualBillPeriodTarget,
} from "@/modules/manualUsage/statementRanges";
import {
  resolveManualMonthlyTargetDiagnostics,
  type ManualMonthlyInputState,
  type MonthlyTargetConstructionDiagnostic,
  type SourceDerivedMonthlyTargetResolution,
} from "@/modules/usageSimulator/monthlyTargetConstruction";
import { getGenericWeekdayShape96, getGenericWeekendShape96, normalizeShape96, type Shape96 } from "@/modules/simulatedUsage/intradayTemplates";
import { fetchActualCanonicalMonthlyTotals, fetchActualIntradayShape96 } from "@/modules/realUsageAdapter/actual";
import { reshapeMonthlyTotalsFromBaseline } from "@/modules/usageSimulator/reshape";
import { enumerateDateKeysInclusive } from "@/lib/time/chicago";

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
  monthlyTargetConstructionDiagnostics?: MonthlyTargetConstructionDiagnostic[] | null;
  sourceDerivedTrustedMonthlyTotalsKwhByMonth?: Record<string, number> | null;
  manualAnnualTotalKwh?: number | null;
  manualMonthlyInputState?: ManualMonthlyInputState | null;
  manualBillPeriods?: ManualBillPeriodTarget[];
  manualBillPeriodTotalsKwhById?: Record<string, number> | null;
  source?: {
    actualSource?: "SMT" | "GREEN_BUTTON";
    actualMonthlyAnchorsByMonth?: Record<string, number>;
    actualIntradayShape96?: number[];
    smtMonthlyAnchorsByMonth?: Record<string, number>;
    smtIntradayShape96?: number[];
  };
};

/** Expand Travel/Vacant ranges to a list of YYYY-MM-DD date keys to exclude from shape derivation. */
export function travelRangesToExcludeDateKeys(ranges: Array<{ startDate: string; endDate: string }>): string[] {
  const set = new Set<string>();
  const re = /^\d{4}-\d{2}-\d{2}$/;
  for (const r of ranges) {
    if (!re.test(String(r.startDate).trim()) || !re.test(String(r.endDate).trim())) continue;
    const dateKeys = enumerateDateKeysInclusive(String(r.startDate).trim(), String(r.endDate).trim());
    for (let i = 0; i < dateKeys.length; i += 1) set.add(dateKeys[i]!);
  }
  return Array.from(set);
}

export function buildUniformMonthlyTotalsFromAnnualWindow(args: {
  annualKwh: number;
  anchorEndDate: string;
  canonicalMonths: string[];
}): Record<string, number> {
  const annualKwh = Math.max(0, Number(args.annualKwh) || 0);
  const anchorEndDate = String(args.anchorEndDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorEndDate) || annualKwh <= 0) return {};
  const end = new Date(`${anchorEndDate}T00:00:00.000Z`);
  if (!Number.isFinite(end.getTime())) return {};
  const start = new Date(end.getTime() - 364 * 24 * 60 * 60 * 1000);
  const dateKeys = enumerateDateKeysInclusive(start.toISOString().slice(0, 10), anchorEndDate);
  if (dateKeys.length === 0) return {};
  const perDay = annualKwh / dateKeys.length;
  const out: Record<string, number> = {};
  for (const dateKey of dateKeys) {
    const month = dateKey.slice(0, 7);
    if (!args.canonicalMonths.includes(month)) continue;
    out[month] = (out[month] ?? 0) + perDay;
  }
  for (const month of Object.keys(out)) out[month] = Math.round(out[month] * 100) / 100;
  return out;
}

function manualMonthlyTotals(
  payload: ManualUsagePayload,
  canonicalMonths: string[],
  estimateMonthlyKwhByMonth: Record<string, number>,
  sourceDerivedResolution?: SourceDerivedMonthlyTargetResolution | null
): { monthly: Record<string, number>; notes: string[]; filledMonths: string[]; manualMonthlyInputState: ManualMonthlyInputState | null } {
  const notes: string[] = [];

  if ((payload as any).mode === "MONTHLY") {
    const resolved = resolveManualMonthlyTargetDiagnostics({
      payload,
      canonicalMonths,
      sourceDerivedResolution,
    });
    const monthly: Record<string, number> = {};
    const filledMonths: string[] = [];
    for (const month of canonicalMonths) {
      if (Object.prototype.hasOwnProperty.call(resolved.monthlyKwhByMonth, month)) {
        monthly[month] = resolved.monthlyKwhByMonth[month] ?? 0;
        continue;
      }
      monthly[month] = Math.max(0, Number(estimateMonthlyKwhByMonth?.[month] ?? 0) || 0);
      filledMonths.push(month);
    }
    if (filledMonths.length > 0) {
      notes.push(
        `Manual monthly Stage 2 completed ${filledMonths.length} missing bill-cycle month(s) using the shared estimation path before the shared producer run.`
      );
    }
    return {
      monthly,
      notes: [...notes, ...resolved.notes],
      filledMonths,
      manualMonthlyInputState: resolved.manualMonthlyInputState,
    };
  }

  // ANNUAL enters the shared sim as annual-only input.
  const annual = typeof (payload as any).annualKwh === "number" && Number.isFinite((payload as any).annualKwh) ? (payload as any).annualKwh : 0;
  notes.push("Annual manual total enters the simulator as annual-only input; month/day/hour division happens inside the shared simulation path.");
  return {
    monthly: {},
    notes,
    filledMonths: [],
    manualMonthlyInputState: null,
  };
}

export async function buildSimulatorInputs(args: {
  mode: BuildMode;
  manualUsagePayload: ManualUsagePayload | null;
  manualMonthlySourceDerivedResolution?: SourceDerivedMonthlyTargetResolution | null;
  homeProfile: HomeProfileInput;
  applianceProfile: ApplianceProfilePayloadV1;
  esiidForSmt?: string | null;
  houseIdForActual?: string | null;
  baselineHomeProfile?: HomeProfileInput | null;
  baselineApplianceProfile?: ApplianceProfilePayloadV1 | null;
  canonicalMonths?: string[]; // optional override (V1 determinism)
  /** Travel/Vacant ranges: dates in these ranges are excluded from actual shape derivation. */
  travelRanges?: Array<{ startDate: string; endDate: string }>;
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
    const sourceDerivedResolution = args.manualMonthlySourceDerivedResolution ?? null;
    const monthlyResolution =
      (args.manualUsagePayload as any)?.mode === "MONTHLY"
        ? resolveManualMonthlyTargetDiagnostics({
            payload: args.manualUsagePayload,
            canonicalMonths,
            sourceDerivedResolution,
          })
        : null;
    const manualFillEstimate = estimateUsageForCanonicalWindow({
      canonicalMonths,
      home: args.homeProfile,
      appliances: args.applianceProfile,
    });
    const estimateMonthlyKwhByMonth: Record<string, number> = {};
    for (let i = 0; i < canonicalMonths.length; i += 1) {
      estimateMonthlyKwhByMonth[canonicalMonths[i]] = manualFillEstimate.monthlyKwh[i] ?? 0;
    }
    const { monthly, notes, filledMonths, manualMonthlyInputState } = manualMonthlyTotals(
      args.manualUsagePayload,
      canonicalMonths,
      estimateMonthlyKwhByMonth,
      sourceDerivedResolution
    );
    const manualBillPeriods = buildManualBillPeriodTargets(args.manualUsagePayload);
    const manualBillPeriodTotalsKwhById = buildManualBillPeriodTotalsById(manualBillPeriods);
    const eligibleBillPeriodCount = manualBillPeriods.filter((period) => period.eligibleForConstraint).length;
    const excludedBillPeriodCount = manualBillPeriods.length - eligibleBillPeriodCount;
    const manualNotes = [...notes];
    if (manualBillPeriods.length > 0) {
      manualNotes.push(
        `Manual Stage 2 is constrained by ${eligibleBillPeriodCount} eligible bill period(s); ${excludedBillPeriodCount} bill period(s) are excluded from parity shaping.`
      );
    }

    return {
      baseKind: "MANUAL",
      canonicalMonths,
      monthlyTotalsKwhByMonth: monthly,
      intradayShape96: getGenericWeekdayShape96(),
      weekdayWeekendShape96: { weekday: getGenericWeekdayShape96(), weekend: getGenericWeekendShape96() },
      notes: manualNotes,
      filledMonths,
      monthlyTargetConstructionDiagnostics: monthlyResolution?.diagnostics ?? null,
      sourceDerivedTrustedMonthlyTotalsKwhByMonth:
        monthlyResolution && Object.keys(monthlyResolution.sourceDerivedTrustedMonthlyAnchorsByMonth ?? {}).length > 0
          ? monthlyResolution.sourceDerivedTrustedMonthlyAnchorsByMonth
          : null,
      manualAnnualTotalKwh:
        (args.manualUsagePayload as any)?.mode === "ANNUAL"
          ? Math.max(0, Number((args.manualUsagePayload as any)?.annualKwh ?? 0) || 0)
          : null,
      manualMonthlyInputState,
      manualBillPeriods,
      manualBillPeriodTotalsKwhById,
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
  const houseIdForActual = args.houseIdForActual ?? null;
  const esiid = args.esiidForSmt ?? null;
  if (!houseIdForActual) throw new Error("houseId_required");

  // B1: Travel/vacant — exclude these dates from shape derivation inputs. Curve fill for those days remains as-is until B2.
  const excludeDateKeys = args.travelRanges?.length ? travelRangesToExcludeDateKeys(args.travelRanges) : undefined;
  const actualMonthly = await fetchActualCanonicalMonthlyTotals({
    houseId: houseIdForActual,
    esiid,
    canonicalMonths,
    excludeDateKeys,
    travelRanges: args.travelRanges,
  });
  const actualShape = await fetchActualIntradayShape96({
    houseId: houseIdForActual,
    esiid,
    canonicalMonths,
    excludeDateKeys,
    travelRanges: args.travelRanges,
  });
  const monthlyKwhByMonth = actualMonthly.monthlyKwhByMonth ?? {};
  const shape = actualShape.shape96 ?? null;

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

  const notes = [...baselineEst.notes, ...reshaped.notes];
  const intradayShape96 = shape ? normalizeShape96(shape) : getGenericWeekdayShape96();
  if (!shape) notes.push("Actual intraday shape unavailable; using deterministic generic intraday template.");

  // Gap-fill rule: do NOT modify months that have actual anchors.
  // We only allow reshaping to affect months that were simulated (filled) or derived from non-actual inputs.
  const anchoredMonths = Object.keys(monthlyKwhByMonth ?? {});
  const monthlyTotalsKwhByMonthFinal: Record<string, number> = { ...reshaped.monthlyTotalsKwhByMonth };
  for (let i = 0; i < anchoredMonths.length; i++) {
    const ym = anchoredMonths[i];
    if (ym in monthlyTotalsKwhByMonthFinal) monthlyTotalsKwhByMonthFinal[ym] = monthlyKwhByMonth[ym] ?? 0;
  }

  return {
    baseKind: "SMT_ACTUAL_BASELINE",
    canonicalMonths,
    monthlyTotalsKwhByMonth: monthlyTotalsKwhByMonthFinal,
    intradayShape96,
    filledMonths: baselineEst.filledMonths,
    source: {
      actualSource: actualMonthly.source ?? actualShape.source ?? undefined,
      actualMonthlyAnchorsByMonth: monthlyKwhByMonth,
      actualIntradayShape96: shape ?? undefined,
      ...(actualMonthly.source === "SMT"
        ? { smtMonthlyAnchorsByMonth: monthlyKwhByMonth, smtIntradayShape96: shape ?? undefined }
        : {}),
    },
    notes,
  };
}

