import type { MonthlyOverlayResult, UsageScenarioEvent } from "@/modules/usageScenario/types";
import { isYearMonth } from "@/modules/usageScenario/types";

function finiteNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
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
    if (!eventId) continue;

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

