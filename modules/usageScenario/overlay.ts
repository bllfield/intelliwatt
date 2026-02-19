import type {
  LedgerOverlayEntry,
  MonthlyOverlayResult,
  UsageScenarioEvent,
} from "@/modules/usageScenario/types";
import { isYearMonth } from "@/modules/usageScenario/types";

function finiteNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/** YYYY-MM to YYYY-MM comparison (string compare is valid for ISO months). */
function monthInRange(ym: string, start: string, end: string): boolean {
  return ym >= start && ym <= end;
}

/** Resolve per-month delta for one entry: monthly wins over annual; annual distributed by baseline share. */
function resolveMonthlyDeltas(
  entry: LedgerOverlayEntry,
  impactedMonths: string[],
  baselineMonthlyKwhByMonth: Record<string, number> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  const { delta } = entry;
  const monthly = delta.monthlyDeltaKwh != null && Number.isFinite(delta.monthlyDeltaKwh) ? delta.monthlyDeltaKwh : null;
  const annual = delta.annualDeltaKwh != null && Number.isFinite(delta.annualDeltaKwh) ? delta.annualDeltaKwh : null;

  if (impactedMonths.length === 0) return out;

  if (monthly != null) {
    for (const ym of impactedMonths) out[ym] = monthly;
    return out;
  }
  if (annual != null && baselineMonthlyKwhByMonth) {
    let totalBaseline = 0;
    for (const ym of impactedMonths) totalBaseline += baselineMonthlyKwhByMonth[ym] ?? 0;
    if (totalBaseline > 0) {
      for (const ym of impactedMonths) {
        const share = (baselineMonthlyKwhByMonth[ym] ?? 0) / totalBaseline;
        out[ym] = annual * share;
      }
    } else {
      const perMonth = annual / impactedMonths.length;
      for (const ym of impactedMonths) out[ym] = perMonth;
    }
    return out;
  }
  if (annual != null) {
    const perMonth = annual / impactedMonths.length;
    for (const ym of impactedMonths) out[ym] = perMonth;
  }
  return out;
}

export function computeMonthlyOverlay(args: {
  canonicalMonths: string[];
  events: UsageScenarioEvent[];
}): MonthlyOverlayResult {
  const monthSet = new Set(args.canonicalMonths);
  const monthlyMultipliersByMonth: Record<string, number> = {};
  const monthlyAddersKwhByMonth: Record<string, number> = {};

  for (const ym of args.canonicalMonths) {
    monthlyMultipliersByMonth[ym] = 1;
    monthlyAddersKwhByMonth[ym] = 0;
  }

  const inactiveEventIds: string[] = [];
  const warnings: Array<{ eventId: string; reason: string }> = [];

  // Deterministic application order: caller should provide ordered events; we still keep this loop stable.
  for (let i = 0; i < args.events.length; i++) {
    const e = args.events[i];
    const eventId = String(e?.id ?? "");
    const ym = String(e?.effectiveMonth ?? "");
    const kind = String((e as any)?.kind ?? "");
    if (!eventId) continue;

    // V1 overlay supports monthly adjustments only.
    // Other event kinds (e.g. travel/day exclusions) are handled elsewhere.
    if (kind && kind !== "MONTHLY_ADJUSTMENT") continue;

    if (!isYearMonth(ym)) {
      inactiveEventIds.push(eventId);
      warnings.push({ eventId, reason: "effectiveMonth_invalid" });
      continue;
    }
    if (!monthSet.has(ym)) {
      inactiveEventIds.push(eventId);
      warnings.push({ eventId, reason: "effectiveMonth_outside_canonical_window" });
      continue;
    }

    // V1: a single kind that can apply multiplier and/or adder to that month.
    const p = (e as any)?.payloadJson ?? {};
    const mult = finiteNumber(p?.multiplier);
    const adder = finiteNumber(p?.adderKwh);

    if (mult == null && adder == null) {
      inactiveEventIds.push(eventId);
      warnings.push({ eventId, reason: "payload_missing_multiplier_and_adder" });
      continue;
    }

    if (mult != null) {
      if (mult < 0) {
        warnings.push({ eventId, reason: "multiplier_negative_clamped_to_0" });
      }
      monthlyMultipliersByMonth[ym] = (monthlyMultipliersByMonth[ym] ?? 1) * Math.max(0, mult);
    }
    if (adder != null) {
      monthlyAddersKwhByMonth[ym] = (monthlyAddersKwhByMonth[ym] ?? 0) + adder;
    }
  }

  return { monthlyMultipliersByMonth, monthlyAddersKwhByMonth, inactiveEventIds, warnings };
}

/**
 * Past overlay: V1 delta kWh only (additive). Source of truth = UpgradeLedger; entries ordered by scenario events.
 * Permanent (no effectiveEndDate) → apply to all 12 canonical months. Temporary → apply only in [effectiveMonth, effectiveEndDate] (Option 1).
 */
export function computePastOverlay(args: {
  canonicalMonths: string[];
  entries: LedgerOverlayEntry[];
  baselineMonthlyKwhByMonth?: Record<string, number>;
}): MonthlyOverlayResult {
  const monthSet = new Set(args.canonicalMonths);
  const monthlyMultipliersByMonth: Record<string, number> = {};
  const monthlyAddersKwhByMonth: Record<string, number> = {};
  for (const ym of args.canonicalMonths) {
    monthlyMultipliersByMonth[ym] = 1;
    monthlyAddersKwhByMonth[ym] = 0;
  }

  for (const entry of args.entries) {
    const start = entry.effectiveMonth;
    const end = entry.effectiveEndDate != null && String(entry.effectiveEndDate).trim() !== ""
      ? String(entry.effectiveEndDate).trim().slice(0, 7)
      : null;
    const impactedMonths =
      end == null
        ? args.canonicalMonths.filter((ym) => monthSet.has(ym))
        : args.canonicalMonths.filter((ym) => monthSet.has(ym) && monthInRange(ym, start, end));
    const deltas = resolveMonthlyDeltas(entry, impactedMonths, args.baselineMonthlyKwhByMonth);
    for (const [ym, d] of Object.entries(deltas)) {
      if (monthSet.has(ym)) monthlyAddersKwhByMonth[ym] = (monthlyAddersKwhByMonth[ym] ?? 0) + d;
    }
  }

  return {
    monthlyMultipliersByMonth,
    monthlyAddersKwhByMonth,
    inactiveEventIds: [],
    warnings: [],
  };
}

/**
 * Future overlay: V1 delta kWh only (additive). Apply from effectiveMonth through end of canonical window (or effectiveEndDate if set).
 */
export function computeFutureOverlay(args: {
  canonicalMonths: string[];
  entries: LedgerOverlayEntry[];
  baselineMonthlyKwhByMonth?: Record<string, number>;
}): MonthlyOverlayResult {
  const monthSet = new Set(args.canonicalMonths);
  const monthlyMultipliersByMonth: Record<string, number> = {};
  const monthlyAddersKwhByMonth: Record<string, number> = {};
  for (const ym of args.canonicalMonths) {
    monthlyMultipliersByMonth[ym] = 1;
    monthlyAddersKwhByMonth[ym] = 0;
  }

  for (const entry of args.entries) {
    const start = entry.effectiveMonth;
    const end = entry.effectiveEndDate != null && String(entry.effectiveEndDate).trim() !== ""
      ? String(entry.effectiveEndDate).trim().slice(0, 7)
      : null;
    const impactedMonths = end == null
      ? args.canonicalMonths.filter((ym) => monthSet.has(ym) && ym >= start)
      : args.canonicalMonths.filter((ym) => monthSet.has(ym) && ym >= start && monthInRange(ym, start, end));
    const deltas = resolveMonthlyDeltas(entry, impactedMonths, args.baselineMonthlyKwhByMonth);
    for (const [ym, d] of Object.entries(deltas)) {
      if (monthSet.has(ym)) monthlyAddersKwhByMonth[ym] = (monthlyAddersKwhByMonth[ym] ?? 0) + d;
    }
  }

  return {
    monthlyMultipliersByMonth,
    monthlyAddersKwhByMonth,
    inactiveEventIds: [],
    warnings: [],
  };
}

