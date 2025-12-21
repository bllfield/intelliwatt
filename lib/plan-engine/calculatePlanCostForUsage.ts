import crypto from "node:crypto";
import { extractDeterministicTouSchedule } from "@/lib/plan-engine/touPeriods";
import { detectIndexedOrVariable, extractEflAveragePriceAnchors, chooseEffectiveCentsPerKwhFromAnchors } from "@/lib/plan-engine/indexedPricing";
import { computeRepEnergyCostForMonthlyKwhTiered, extractDeterministicTierSchedule } from "@/lib/plan-engine/tieredPricing";
import { applyBillCreditsToMonth, extractDeterministicBillCredits } from "@/lib/plan-engine/billCredits";
import { applyMinimumRulesToMonth, extractDeterministicMinimumRules } from "@/lib/plan-engine/minimumRules";

export type TrueCostEstimateStatus = "OK" | "APPROXIMATE" | "NOT_COMPUTABLE" | "NOT_IMPLEMENTED";

export type TrueCostConfidence = "HIGH" | "MEDIUM" | "LOW";

export type TrueCostEstimate = {
  status: TrueCostEstimateStatus;
  reason?: string;
  estimateMode?: "DEFAULT" | "INDEXED_EFL_ANCHOR_APPROX";

  annualCostDollars?: number;
  monthlyCostDollars?: number;
  confidence?: TrueCostConfidence;

  components?: {
    energyOnlyDollars: number; // REP energy only
    deliveryDollars: number; // TDSP per-kWh
    baseFeesDollars: number; // TDSP fixed + REP fixed (if known)
    creditsDollars?: number; // bill credits (negative dollars)
    minimumUsageFeeDollars?: number; // min usage fee (positive dollars)
    minimumBillTopUpDollars?: number; // min bill clamp top-up (positive dollars)
    totalDollars: number;
  };

  componentsV2?: {
    rep: { energyDollars: number; fixedDollars: number; totalDollars: number };
    tdsp: { deliveryDollars: number; fixedDollars: number; totalDollars: number };
    creditsDollars?: number; // negative dollars
    minimumUsageFeeDollars?: number; // positive dollars
    minimumBillTopUpDollars?: number; // positive dollars
    totalDollars: number;
  };

  notes?: string[];

  // Optional debug payload for non-dashboard tooling (admin lab / non-dashboard endpoints).
  // Safe to omit; do not depend on this in dashboard gating.
  debug?: any;
};

export type TdspRatesApplied = {
  perKwhDeliveryChargeCents: number;
  monthlyCustomerChargeDollars: number;
  effectiveDate?: string | Date;
};

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function safeNum(n: unknown): number | null {
  const x = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  return Number.isFinite(x) ? x : null;
}

type UsageBucketsByMonth = Record<string /* YYYY-MM */, Record<string /* bucketKey */, number /* kWh */>>;
type HHMM = string; // "0000".."2400" (validated at runtime in callers/parsers)

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

function roundCents(n: number): number {
  return Math.round(n);
}

function parseHHMMishToHHMM(v: unknown): HHMM | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // Accept "HH:MM" and "HHMM"
  const m1 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m1?.[1] && m1?.[2]) {
    const hh = Number(m1[1]);
    const mm = Number(m1[2]);
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
    if (hh === 24 && mm === 0) return "2400" as HHMM;
    if (hh < 0 || hh > 23) return null;
    if (mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}` as HHMM;
  }
  const m2 = s.match(/^(\d{4})$/);
  if (m2?.[1]) {
    const hh = Number(s.slice(0, 2));
    const mm = Number(s.slice(2, 4));
    if (hh === 24 && mm === 0) return "2400" as HHMM;
    if (!Number.isInteger(hh) || hh < 0 || hh > 23) return null;
    if (!Number.isInteger(mm) || mm < 0 || mm > 59) return null;
    return s as HHMM;
  }
  return null;
}

function weekdayStringToIndex(s: string): number | null {
  const v = String(s ?? "").trim().toLowerCase();
  if (v === "sun" || v === "sunday") return 0;
  if (v === "mon" || v === "monday") return 1;
  if (v === "tue" || v === "tues" || v === "tuesday") return 2;
  if (v === "wed" || v === "wednesday") return 3;
  if (v === "thu" || v === "thur" || v === "thurs" || v === "thursday") return 4;
  if (v === "fri" || v === "friday") return 5;
  if (v === "sat" || v === "saturday") return 6;
  return null;
}

function extractTouPhase1Rates(rateStructure: any): null | (
  | { kind: "DAY_NIGHT_ALL_DAYS"; dayRateCentsPerKwh: number; nightRateCentsPerKwh: number }
  | { kind: "WEEKDAY_WEEKEND_ALL_DAY"; weekdayRateCentsPerKwh: number; weekendRateCentsPerKwh: number }
) {
  if (!rateStructure || !isObject(rateStructure)) return null;
  const rs: any = rateStructure;

  // Prefer "periods" (canonical numeric-hour representation from EFL pipeline)
  const periods: any[] = Array.isArray(rs.timeOfUsePeriods)
    ? rs.timeOfUsePeriods
    : Array.isArray(rs.planRules?.timeOfUsePeriods)
      ? rs.planRules.timeOfUsePeriods
      : [];

  if (periods.length > 0) {
    // Weekday/weekend all-day
    const weekday = periods.find((p) => {
      const rate = numOrNull(p?.rateCentsPerKwh);
      const startHour = numOrNull(p?.startHour);
      const endHour = numOrNull(p?.endHour);
      const days = Array.isArray(p?.daysOfWeek) ? (p.daysOfWeek as number[]) : null;
      return (
        rate != null &&
        startHour === 0 &&
        endHour === 24 &&
        Array.isArray(days) &&
        days.length === 5 &&
        days.every((d) => d === 1 || d === 2 || d === 3 || d === 4 || d === 5)
      );
    });
    const weekend = periods.find((p) => {
      const rate = numOrNull(p?.rateCentsPerKwh);
      const startHour = numOrNull(p?.startHour);
      const endHour = numOrNull(p?.endHour);
      const days = Array.isArray(p?.daysOfWeek) ? (p.daysOfWeek as number[]) : null;
      return (
        rate != null &&
        startHour === 0 &&
        endHour === 24 &&
        Array.isArray(days) &&
        days.length === 2 &&
        days.includes(0) &&
        days.includes(6)
      );
    });
    if (weekday && weekend) {
      const weekdayRate = numOrNull((weekday as any).rateCentsPerKwh);
      const weekendRate = numOrNull((weekend as any).rateCentsPerKwh);
      if (weekdayRate != null && weekendRate != null) {
        return { kind: "WEEKDAY_WEEKEND_ALL_DAY", weekdayRateCentsPerKwh: weekdayRate, weekendRateCentsPerKwh: weekendRate };
      }
    }

    // Day/night all-days (canonical 07:00-20:00, 20:00-07:00)
    const night = periods.find((p) => {
      const rate = numOrNull(p?.rateCentsPerKwh);
      const startHour = numOrNull(p?.startHour);
      const endHour = numOrNull(p?.endHour);
      const days = p?.daysOfWeek;
      return rate != null && startHour === 20 && endHour === 7 && (!Array.isArray(days) || days.length === 0);
    });
    const day = periods.find((p) => {
      const rate = numOrNull(p?.rateCentsPerKwh);
      const startHour = numOrNull(p?.startHour);
      const endHour = numOrNull(p?.endHour);
      const days = p?.daysOfWeek;
      return rate != null && startHour === 7 && endHour === 20 && (!Array.isArray(days) || days.length === 0);
    });
    if (day && night) {
      const dayRate = numOrNull((day as any).rateCentsPerKwh);
      const nightRate = numOrNull((night as any).rateCentsPerKwh);
      if (dayRate != null && nightRate != null) {
        return { kind: "DAY_NIGHT_ALL_DAYS", dayRateCentsPerKwh: dayRate, nightRateCentsPerKwh: nightRate };
      }
    }
  }

  // Fallback: "tiers" (current-plan style time-of-use tiers)
  const tiers: any[] = rs?.type === "TIME_OF_USE" && Array.isArray(rs?.tiers) ? rs.tiers : Array.isArray(rs?.timeOfUseTiers) ? rs.timeOfUseTiers : [];
  if (tiers.length > 0) {
    const normTier = (t: any) => {
      const price = numOrNull(t?.priceCents);
      const startHHMM = parseHHMMishToHHMM(t?.startTime);
      const endHHMM = parseHHMMishToHHMM(t?.endTime);
      const daysRaw = t?.daysOfWeek;
      const days =
        Array.isArray(daysRaw)
          ? (daysRaw.map((d: any) => weekdayStringToIndex(String(d))).filter((x: any) => x != null) as number[])
          : typeof daysRaw === "string" && String(daysRaw).toUpperCase() === "ALL"
            ? null
            : null;
      return { price, startHHMM, endHHMM, days };
    };

    const normalized = tiers.map(normTier);

    // Day/night all-days
    const night = normalized.find((t) => t.price != null && t.startHHMM === "2000" && t.endHHMM === "0700" && !t.days);
    const day = normalized.find((t) => t.price != null && t.startHHMM === "0700" && t.endHHMM === "2000" && !t.days);
    if (day && night) {
      return { kind: "DAY_NIGHT_ALL_DAYS", dayRateCentsPerKwh: day.price!, nightRateCentsPerKwh: night.price! };
    }

    // Weekday/weekend all-day (00:00-24:00)
    const wk = normalized.find(
      (t) =>
        t.price != null &&
        t.startHHMM === "0000" &&
        t.endHHMM === "2400" &&
        Array.isArray(t.days) &&
        t.days.length === 5 &&
        t.days.every((d) => d >= 1 && d <= 5),
    );
    const we = normalized.find(
      (t) =>
        t.price != null &&
        t.startHHMM === "0000" &&
        t.endHHMM === "2400" &&
        Array.isArray(t.days) &&
        t.days.length === 2 &&
        t.days.includes(0) &&
        t.days.includes(6),
    );
    if (wk && we) {
      return { kind: "WEEKDAY_WEEKEND_ALL_DAY", weekdayRateCentsPerKwh: wk.price!, weekendRateCentsPerKwh: we.price! };
    }
  }

  return null;
}

function sumMonthBucketKwh(month: Record<string, number> | null | undefined, key: string): number | null {
  const v = month ? (month as any)[key] : undefined;
  // Fail-closed: treat null/undefined/blank as missing (do NOT allow Number(null) => 0).
  if (v == null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Conservative extractor: tries common shapes to find a single fixed energy rate (cents/kWh).
 * Fail-closed: returns null unless we find exactly one confident number.
 */
export function extractFixedRepEnergyCentsPerKwh(rateStructure: any): number | null {
  if (!rateStructure || typeof rateStructure !== "object") return null;

  // IMPORTANT:
  // If this structure is TOU-like, do NOT treat any single energyRateCents/defaultRate as a fixed-rate plan.
  // Many TOU templates store an "energyRateCents" convenience value (often Off-Peak) which must not
  // short-circuit TOU pricing paths.
  const rsAny: any = rateStructure as any;
  const hasTouSignals =
    rsAny?.type === "TIME_OF_USE" ||
    rsAny?.planType === "tou" ||
    (Array.isArray(rsAny?.timeOfUsePeriods) && rsAny.timeOfUsePeriods.length > 0) ||
    (Array.isArray(rsAny?.planRules?.timeOfUsePeriods) && rsAny.planRules.timeOfUsePeriods.length > 0) ||
    (Array.isArray(rsAny?.timeOfUseTiers) && rsAny.timeOfUseTiers.length > 0) ||
    (rsAny?.type === "TIME_OF_USE" && Array.isArray(rsAny?.tiers) && rsAny.tiers.length > 0) ||
    (Array.isArray(rsAny?.tiers) && rsAny.tiers.length > 0);
  if (hasTouSignals) return null;

  const candidates: unknown[] = [];

  // direct keys
  candidates.push(rateStructure?.repEnergyCentsPerKwh);
  candidates.push(rateStructure?.energyCentsPerKwh);
  candidates.push(rateStructure?.fixedEnergyCentsPerKwh);
  candidates.push(rateStructure?.rateCentsPerKwh);
  candidates.push(rateStructure?.baseRateCentsPerKwh);

  // common persisted keys from our current template pipeline
  candidates.push(rateStructure?.energyRateCents);
  candidates.push(rateStructure?.energyChargeCentsPerKwh);
  candidates.push(rateStructure?.defaultRateCentsPerKwh);

  // nested shapes
  candidates.push(rateStructure?.charges?.energy?.centsPerKwh);
  candidates.push(rateStructure?.charges?.rep?.energyCentsPerKwh);
  candidates.push(rateStructure?.energy?.centsPerKwh);

  // If your EFL template stores a single "pricePerKwh" in dollars, allow conversion ONLY if it looks like < 1.
  const maybeDollars = safeNum(rateStructure?.charges?.energy?.dollarsPerKwh);
  if (maybeDollars !== null && maybeDollars > 0 && maybeDollars < 1) {
    return maybeDollars * 100;
  }

  const nums = candidates
    .map(safeNum)
    .filter((x): x is number => x !== null)
    .filter((x) => x > 0 && x < 200); // cents/kWh sanity

  const uniq = Array.from(new Set(nums.map((n) => round2(n))));
  if (uniq.length !== 1) return null;
  return uniq[0];
}

/**
 * Conservative extractor: REP fixed monthly charge (dollars).
 * Return null unless we find a single confident value.
 */
export function extractRepFixedMonthlyChargeDollars(rateStructure: any): number | null {
  if (!rateStructure || typeof rateStructure !== "object") return null;

  const candidates: unknown[] = [];
  candidates.push(rateStructure?.repMonthlyChargeDollars);
  candidates.push(rateStructure?.monthlyBaseChargeDollars);
  candidates.push(rateStructure?.baseChargeDollars);
  candidates.push(rateStructure?.charges?.rep?.fixedMonthlyDollars);
  candidates.push(rateStructure?.charges?.fixed?.monthlyDollars);

  // Allow cents fields if present (convert to dollars).
  const cents = safeNum(rateStructure?.baseMonthlyFeeCents);
  if (cents !== null && cents >= 0 && cents < 50_000) {
    candidates.push(cents / 100);
  }

  const nums = candidates
    .map(safeNum)
    .filter((x): x is number => x !== null)
    .filter((x) => x >= 0 && x < 200); // dollars sanity

  const uniq = Array.from(new Set(nums.map((n) => round2(n))));
  if (uniq.length !== 1) return null;
  return uniq[0];
}

export function calculatePlanCostForUsage(args: {
  annualKwh: number;
  monthsCount: number; // typically 12
  tdsp: TdspRatesApplied;
  rateStructure: any;
  estimateMode?: "DEFAULT" | "INDEXED_EFL_ANCHOR_APPROX";
  // Optional Phase-1: bucket totals by month for TOU math paths (no call sites use this yet).
  usageBucketsByMonth?: UsageBucketsByMonth;
}): TrueCostEstimate {
  const notes: string[] = [];

  const annualKwh = safeNum(args.annualKwh);
  if (annualKwh === null || annualKwh <= 0) {
    return { status: "NOT_IMPLEMENTED", reason: "Missing or invalid annual kWh" };
  }

  const repEnergyCents = extractFixedRepEnergyCentsPerKwh(args.rateStructure);
  if (repEnergyCents === null) {
    // IMPORTANT: Preserve current v1 fixed-rate behavior. For non-fixed plans:
    // - If we have buckets, attempt TOU computations.
    // - If we don't have buckets, still try to classify the structure to return a precise fail-closed reason.
    const tou2Maybe = extractDeterministicTouSchedule(args.rateStructure);
    const indexed = detectIndexedOrVariable(args.rateStructure);

    // Indexed/variable pricing: fail-closed by default. Allow explicit approximation using EFL-modeled average price anchors.
    if (indexed.isIndexed && !tou2Maybe.schedule && !extractTouPhase1Rates(args.rateStructure)) {
      if (String(args.estimateMode ?? "DEFAULT") !== "INDEXED_EFL_ANCHOR_APPROX") {
        return { status: "NOT_COMPUTABLE", reason: "NON_DETERMINISTIC_PRICING_INDEXED", notes: [...notes, ...(indexed.notes ?? [])] };
      }

      const anchors = extractEflAveragePriceAnchors(args.rateStructure);
      const chosen = chooseEffectiveCentsPerKwhFromAnchors({ annualKwh, anchors });
      if (!chosen.ok) {
        return { status: "NOT_COMPUTABLE", reason: "MISSING_EFL_ANCHORS", notes: [...notes, ...(indexed.notes ?? []), ...(chosen.notes ?? [])] };
      }

      const repFixedMonthly = extractRepFixedMonthlyChargeDollars(args.rateStructure) ?? 0;
      const tdspPerKwhCents = safeNum(args.tdsp?.perKwhDeliveryChargeCents) ?? 0;
      const tdspMonthly = safeNum(args.tdsp?.monthlyCustomerChargeDollars) ?? 0;

      const repEnergyDollars = annualKwh * (chosen.centsPerKwh / 100);
      const tdspDeliveryDollars = annualKwh * (tdspPerKwhCents / 100);

      const months = Math.max(1, Math.floor(safeNum(args.monthsCount) ?? 12));
      const repFixedDollars = months * repFixedMonthly;
      const tdspFixedDollars = months * tdspMonthly;

      const repTotal = repEnergyDollars + repFixedDollars;
      const tdspTotal = tdspDeliveryDollars + tdspFixedDollars;
      const total = repTotal + tdspTotal;

      notes.push("APPROXIMATE: indexed/variable plan using EFL modeled average price anchors (500/1000/2000 kWh).");
      notes.push(`anchorMethod=${chosen.method}`);
      notes.push(...(chosen.notes ?? []));
      if (repFixedMonthly > 0) notes.push("Includes REP fixed monthly charge (from template)");
      else notes.push("REP fixed monthly charge not found (assumed $0)");
      if (tdspPerKwhCents > 0 || tdspMonthly > 0) notes.push("Includes TDSP delivery");
      else notes.push("TDSP delivery missing/zero (check tdspRatesApplied)");

      return {
        status: "APPROXIMATE",
        estimateMode: "INDEXED_EFL_ANCHOR_APPROX",
        annualCostDollars: round2(total),
        monthlyCostDollars: round2(total / months),
        confidence: "LOW",
        components: {
          energyOnlyDollars: round2(repEnergyDollars),
          deliveryDollars: round2(tdspDeliveryDollars),
          baseFeesDollars: round2(repFixedDollars + tdspFixedDollars),
          totalDollars: round2(total),
        },
        componentsV2: {
          rep: { energyDollars: round2(repEnergyDollars), fixedDollars: round2(repFixedDollars), totalDollars: round2(repTotal) },
          tdsp: { deliveryDollars: round2(tdspDeliveryDollars), fixedDollars: round2(tdspFixedDollars), totalDollars: round2(tdspTotal) },
          totalDollars: round2(total),
        },
        notes,
        debug: {
          indexedApprox: {
            kind: indexed.kind,
            anchors,
            chosen,
            repEnergyCentsPerKwhEffective: chosen.centsPerKwh,
          },
        },
      };
    }

    const creditsMaybe = extractDeterministicBillCredits(args.rateStructure);
    if (!creditsMaybe.ok && creditsMaybe.reason !== "NO_CREDITS") {
      return { status: "NOT_COMPUTABLE", reason: creditsMaybe.reason, notes: [...notes, ...(creditsMaybe.notes ?? [])] };
    }

    const minimumMaybe = extractDeterministicMinimumRules({ rateStructure: args.rateStructure });
    if (!minimumMaybe.ok && minimumMaybe.reason !== "NO_MIN_RULES") {
      return { status: "NOT_COMPUTABLE", reason: minimumMaybe.reason, notes: [...notes, ...(minimumMaybe.notes ?? [])] };
    }

    // Tiered pricing (kWh blocks): requires monthly total bucket(s).
    const tieredMaybe = extractDeterministicTierSchedule(args.rateStructure);
    if (tieredMaybe.ok) {
      if (!args.usageBucketsByMonth) {
        if (creditsMaybe.ok) return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS", notes: ["bill_credits_require_monthly_totals"] };
        if (minimumMaybe.ok) return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS", notes: ["minimum_rules_require_monthly_totals"] };
        return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS", notes: ["tiered_pricing_requires_monthly_totals"] };
      }

      const byMonth = args.usageBucketsByMonth;
      const allMonths = Object.keys(byMonth ?? {}).sort();
      if (allMonths.length === 0) {
        return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS (no months present)" };
      }

      const wantMonths = Math.max(1, Math.floor(safeNum(args.monthsCount) ?? 12));
      if (allMonths.length < wantMonths) {
        return { status: "NOT_COMPUTABLE", reason: `MISSING_USAGE_BUCKETS (need ${wantMonths} months, have ${allMonths.length})` };
      }
      const months = allMonths.slice(-wantMonths);

      const tdspPerKwhCents = safeNum(args.tdsp?.perKwhDeliveryChargeCents) ?? 0;
      const tdspMonthly = safeNum(args.tdsp?.monthlyCustomerChargeDollars) ?? 0;
      const repFixedMonthly = extractRepFixedMonthlyChargeDollars(args.rateStructure) ?? 0;

      let repEnergyCentsTotal = 0;
      let repFixedCentsTotal = 0;
      let tdspDeliveryCentsTotal = 0;
      let tdspFixedCentsTotal = 0;
      let creditsCentsTotal = 0;
      let minUsageFeeCentsTotal = 0;
      let minimumBillTopUpCentsTotal = 0;
      let totalCentsTotal = 0;
      const missing: string[] = [];
      const debugByMonth: any[] = [];

      for (const ym of months) {
        const m = byMonth[ym];
        if (!m || typeof m !== "object") continue;

        const monthTotalKwh = sumMonthBucketKwh(m, "kwh.m.all.total");
        if (monthTotalKwh == null) {
          missing.push(`${ym}:kwh.m.all.total`);
          continue;
        }

        const tiered = computeRepEnergyCostForMonthlyKwhTiered({
          monthlyKwh: monthTotalKwh,
          schedule: tieredMaybe.schedule,
        });
        const monthRepEnergyCents = tiered.repEnergyCentsTotal;
        const monthRepFixedCents = repFixedMonthly * 100;
        const monthTdspFixedCents = tdspMonthly * 100;
        const monthTdspDeliveryCents = monthTotalKwh * tdspPerKwhCents;

        const appliedCredits = creditsMaybe.ok ? applyBillCreditsToMonth({ monthlyKwh: monthTotalKwh, credits: creditsMaybe.credits }) : null;
        const monthCreditsCents = appliedCredits ? appliedCredits.creditCentsTotal : 0;

        const subtotalCents = monthRepEnergyCents + monthRepFixedCents + monthTdspFixedCents + monthTdspDeliveryCents + monthCreditsCents;
        let finalCents = clampNonNegative(roundCents(subtotalCents));
        let minApplied: any[] | null = null;
        let monthMinUsageFeeCents = 0;
        let monthMinimumBillTopUpCents = 0;
        if (minimumMaybe.ok) {
          const appliedMin = applyMinimumRulesToMonth({
            monthlyKwh: monthTotalKwh,
            minimum: minimumMaybe.minimum,
            subtotalCents: roundCents(subtotalCents),
          });
          minUsageFeeCentsTotal += appliedMin.minUsageFeeCents;
          minimumBillTopUpCentsTotal += appliedMin.minimumBillTopUpCents;
          monthMinUsageFeeCents = appliedMin.minUsageFeeCents;
          monthMinimumBillTopUpCents = appliedMin.minimumBillTopUpCents;
          finalCents = appliedMin.totalCentsAfter;
          minApplied = appliedMin.applied;
        }

        repEnergyCentsTotal += roundCents(monthRepEnergyCents);
        repFixedCentsTotal += roundCents(monthRepFixedCents);
        tdspDeliveryCentsTotal += roundCents(monthTdspDeliveryCents);
        tdspFixedCentsTotal += roundCents(monthTdspFixedCents);
        creditsCentsTotal += roundCents(monthCreditsCents);
        totalCentsTotal += finalCents;

        debugByMonth.push({
          ym,
          monthTotalKwh,
          repEnergyTieredCents: roundCents(monthRepEnergyCents),
          tierBreakdown: tiered.tierBreakdown,
          creditsAppliedCents: roundCents(monthCreditsCents),
          minimumUsageFeeCents: monthMinUsageFeeCents,
          minimumBillTopUpCents: monthMinimumBillTopUpCents,
          monthTotalCents: finalCents,
          minApplied,
          subtotalCents: roundCents(subtotalCents),
          finalCents,
        });
      }

      if (missing.length > 0) {
        return { status: "NOT_COMPUTABLE", reason: `MISSING_USAGE_BUCKETS (${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", ..." : ""})` };
      }

      const repEnergyDollars = repEnergyCentsTotal / 100;
      const repFixedDollars = repFixedCentsTotal / 100;
      const tdspDeliveryDollars = tdspDeliveryCentsTotal / 100;
      const tdspFixedDollars = tdspFixedCentsTotal / 100;
      const creditsDollars = creditsCentsTotal / 100;
      const minUsageFeeDollars = minUsageFeeCentsTotal / 100;
      const minimumBillTopUpDollars = minimumBillTopUpCentsTotal / 100;

      const repTotal = repEnergyDollars + repFixedDollars;
      const tdspTotal = tdspDeliveryDollars + tdspFixedDollars;
      const total = totalCentsTotal / 100;

      const tierNotes: string[] = [];
      tierNotes.push("Computed from kwh.m.all.total + tiered REP energy + TDSP delivery");
      tierNotes.push("Tiered pricing: kWh blocks applied per month (REP energy only)");
      if (repFixedMonthly > 0) tierNotes.push("Includes REP fixed monthly charge (from template)");
      else tierNotes.push("REP fixed monthly charge not found (assumed $0)");
      if (tdspPerKwhCents > 0 || tdspMonthly > 0) tierNotes.push("Includes TDSP delivery");
      else tierNotes.push("TDSP delivery missing/zero (check tdspRatesApplied)");
      if (creditsMaybe.ok) tierNotes.push("Includes deterministic bill credits (Phase 1)");
      if (minimumMaybe.ok) tierNotes.push("Includes deterministic minimum rules (Phase 1)");

      return {
        status: "OK",
        annualCostDollars: round2(total),
        monthlyCostDollars: round2(total / months.length),
        confidence: "MEDIUM",
        components: {
          energyOnlyDollars: round2(repEnergyDollars),
          deliveryDollars: round2(tdspDeliveryDollars),
          baseFeesDollars: round2(repFixedDollars + tdspFixedDollars),
          ...(creditsMaybe.ok ? { creditsDollars: round2(creditsDollars) } : {}),
          ...(minimumMaybe.ok ? { minimumUsageFeeDollars: round2(minUsageFeeDollars) } : {}),
          ...(minimumMaybe.ok ? { minimumBillTopUpDollars: round2(minimumBillTopUpDollars) } : {}),
          totalDollars: round2(total),
        },
        componentsV2: {
          rep: { energyDollars: round2(repEnergyDollars), fixedDollars: round2(repFixedDollars), totalDollars: round2(repTotal) },
          tdsp: { deliveryDollars: round2(tdspDeliveryDollars), fixedDollars: round2(tdspFixedDollars), totalDollars: round2(tdspTotal) },
          ...(creditsMaybe.ok ? { creditsDollars: round2(creditsDollars) } : {}),
          ...(minimumMaybe.ok ? { minimumUsageFeeDollars: round2(minUsageFeeDollars) } : {}),
          ...(minimumMaybe.ok ? { minimumBillTopUpDollars: round2(minimumBillTopUpDollars) } : {}),
          totalDollars: round2(total),
        },
        notes: tierNotes,
        debug: { tieredByMonth: debugByMonth, schedule: tieredMaybe.schedule },
      };
    }

    if (!args.usageBucketsByMonth) {
      if (tou2Maybe.schedule) {
        return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS" };
      }
      const tou1Maybe = extractTouPhase1Rates(args.rateStructure);
      if (tou1Maybe) {
        return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS" };
      }
      const reasonCode = (tou2Maybe as any)?.reasonCode ? String((tou2Maybe as any).reasonCode) : "UNSUPPORTED_RATE_STRUCTURE";
      return { status: "NOT_COMPUTABLE", reason: reasonCode };
    }

    const tou2 = tou2Maybe;
    if (tou2.schedule) {
      const schedule = tou2.schedule;
      const byMonth = args.usageBucketsByMonth;
      const allMonths = Object.keys(byMonth ?? {}).sort();
      if (allMonths.length === 0) {
        return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS (no months present)" };
      }

      const wantMonths = Math.max(1, Math.floor(safeNum(args.monthsCount) ?? 12));
      if (allMonths.length < wantMonths) {
        return { status: "NOT_COMPUTABLE", reason: `MISSING_USAGE_BUCKETS (need ${wantMonths} months, have ${allMonths.length})` };
      }
      const months = allMonths.slice(-wantMonths);

      const tdspPerKwhCents = safeNum(args.tdsp?.perKwhDeliveryChargeCents) ?? 0;
      const tdspMonthly = safeNum(args.tdsp?.monthlyCustomerChargeDollars) ?? 0;
      const repFixedMonthly = extractRepFixedMonthlyChargeDollars(args.rateStructure) ?? 0;

      const requiredKeys = Array.from(
        new Set<string>(["kwh.m.all.total", ...schedule.periods.map((p) => {
          if (p.startHHMM === "0000" && p.endHHMM === "2400") return `kwh.m.${p.dayType}.total`;
          return `kwh.m.${p.dayType}.${p.startHHMM}-${p.endHHMM}`;
        })]),
      );

      let repEnergyCentsTotal = 0;
      let repFixedCentsTotal = 0;
      let tdspDeliveryCentsTotal = 0;
      let tdspFixedCentsTotal = 0;
      let creditsCentsTotal = 0;
      let minUsageFeeCentsTotal = 0;
      let minimumBillTopUpCentsTotal = 0;
      let totalCentsTotal = 0;
      const missing: string[] = [];
      const mismatched: string[] = [];
      const debugPeriodsByMonth: any[] = [];
      const creditsDebug: any[] = [];
      const minRulesDebug: any[] = [];

      for (const ym of months) {
        const m = byMonth[ym];
        if (!m || typeof m !== "object") continue;

        const monthTotalKwh = sumMonthBucketKwh(m, "kwh.m.all.total");
        if (monthTotalKwh == null) missing.push(`${ym}:kwh.m.all.total`);

        let sumPeriodsKwh = 0;
        let monthRepEnergyCents = 0;
        const dbg: any[] = [];
        for (const p of schedule.periods) {
          const k = p.startHHMM === "0000" && p.endHHMM === "2400"
            ? `kwh.m.${p.dayType}.total`
            : `kwh.m.${p.dayType}.${p.startHHMM}-${p.endHHMM}`;
          const kwh = sumMonthBucketKwh(m, k);
          if (kwh == null) {
            missing.push(`${ym}:${k}`);
            continue;
          }
          sumPeriodsKwh += kwh;
          const repCostCents = kwh * p.repEnergyCentsPerKwh;
          monthRepEnergyCents += repCostCents;
          dbg.push({ bucketKey: k, kwh, repCentsPerKwh: p.repEnergyCentsPerKwh, repCostDollars: round2(repCostCents / 100), label: p.label ?? null, dayType: p.dayType, startHHMM: p.startHHMM, endHHMM: p.endHHMM });
        }

        let monthCreditsCents = 0;
        let monthMinUsageFeeCents = 0;
        let monthMinimumBillTopUpCents = 0;
        let monthFinalCents: number | null = null;

        if (monthTotalKwh != null) {
          if (Math.abs(sumPeriodsKwh - monthTotalKwh) > 0.001) {
            mismatched.push(`${ym}:sum(periods)=${sumPeriodsKwh.toFixed(3)} total=${monthTotalKwh.toFixed(3)}`);
            continue;
          }

          const monthRepFixedCents = repFixedMonthly * 100;
          const monthTdspFixedCents = tdspMonthly * 100;
          const monthTdspDeliveryCents = monthTotalKwh * tdspPerKwhCents;

          const appliedCredits = creditsMaybe.ok ? applyBillCreditsToMonth({ monthlyKwh: monthTotalKwh, credits: creditsMaybe.credits }) : null;
          monthCreditsCents = appliedCredits ? appliedCredits.creditCentsTotal : 0;
          if (appliedCredits) creditsDebug.push({ ym, monthTotalKwh, applied: appliedCredits.applied, creditCentsTotal: monthCreditsCents });

          const subtotalCents = monthRepEnergyCents + monthRepFixedCents + monthTdspFixedCents + monthTdspDeliveryCents + monthCreditsCents;
          let finalCents = clampNonNegative(roundCents(subtotalCents));
          if (minimumMaybe.ok) {
            const appliedMin = applyMinimumRulesToMonth({
              monthlyKwh: monthTotalKwh,
              minimum: minimumMaybe.minimum,
              subtotalCents: roundCents(subtotalCents),
            });
            minUsageFeeCentsTotal += appliedMin.minUsageFeeCents;
            minimumBillTopUpCentsTotal += appliedMin.minimumBillTopUpCents;
            monthMinUsageFeeCents = appliedMin.minUsageFeeCents;
            monthMinimumBillTopUpCents = appliedMin.minimumBillTopUpCents;
            finalCents = appliedMin.totalCentsAfter;
            minRulesDebug.push({ ym, monthTotalKwh, subtotalCents: roundCents(subtotalCents), applied: appliedMin.applied });
          }
          monthFinalCents = finalCents;

          repEnergyCentsTotal += roundCents(monthRepEnergyCents);
          repFixedCentsTotal += roundCents(monthRepFixedCents);
          tdspDeliveryCentsTotal += roundCents(monthTdspDeliveryCents);
          tdspFixedCentsTotal += roundCents(monthTdspFixedCents);
          creditsCentsTotal += roundCents(monthCreditsCents);
          totalCentsTotal += finalCents;
        }

        debugPeriodsByMonth.push({
          yearMonth: ym,
          periods: dbg,
          requiredKeys,
          repEnergyTouCents: roundCents(monthRepEnergyCents),
          creditsAppliedCents: roundCents(monthCreditsCents),
          minimumUsageFeeCents: monthMinUsageFeeCents,
          minimumBillTopUpCents: monthMinimumBillTopUpCents,
          monthTotalCents: monthFinalCents,
        });
      }

      if (missing.length > 0) {
        return { status: "NOT_COMPUTABLE", reason: `MISSING_USAGE_BUCKETS: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}` };
      }
      if (mismatched.length > 0) {
        return {
          status: "NOT_COMPUTABLE",
          reason: `USAGE_BUCKET_SUM_MISMATCH: ${mismatched.slice(0, 6).join(", ")}${mismatched.length > 6 ? "…" : ""}`,
        };
      }

      const repEnergyDollars = repEnergyCentsTotal / 100;
      const repFixedDollars = repFixedCentsTotal / 100;
      const tdspDeliveryDollars = tdspDeliveryCentsTotal / 100;
      const tdspFixedDollars = tdspFixedCentsTotal / 100;
      const creditsDollars = creditsCentsTotal / 100;
      const minUsageFeeDollars = minUsageFeeCentsTotal / 100;
      const minimumBillTopUpDollars = minimumBillTopUpCentsTotal / 100;

      const repTotal = repEnergyDollars + repFixedDollars;
      const tdspTotal = tdspDeliveryDollars + tdspFixedDollars;
      const total = totalCentsTotal / 100;

      notes.push(`TOU Phase-2 (windows): months=${months.length} periods=${schedule.periods.length}`);
      if (repFixedMonthly > 0) notes.push("Includes REP fixed monthly charge (from template)");
      else notes.push("REP fixed monthly charge not found (assumed $0)");
      if (tdspPerKwhCents > 0 || tdspMonthly > 0) notes.push("Includes TDSP delivery (total-based)");
      else notes.push("TDSP delivery missing/zero (check tdspRatesApplied)");
      if (creditsMaybe.ok) notes.push("Includes deterministic bill credits (Phase 1)");
      if (minimumMaybe.ok) notes.push("Includes deterministic minimum rules (Phase 1)");

      return {
        status: "OK",
        annualCostDollars: round2(total),
        monthlyCostDollars: round2(total / months.length),
        confidence: "MEDIUM",
        components: {
          energyOnlyDollars: round2(repEnergyDollars),
          deliveryDollars: round2(tdspDeliveryDollars),
          baseFeesDollars: round2(repFixedDollars + tdspFixedDollars),
          ...(creditsMaybe.ok ? { creditsDollars: round2(creditsDollars) } : {}),
          ...(minimumMaybe.ok ? { minimumUsageFeeDollars: round2(minUsageFeeDollars) } : {}),
          ...(minimumMaybe.ok ? { minimumBillTopUpDollars: round2(minimumBillTopUpDollars) } : {}),
          totalDollars: round2(total),
        },
        componentsV2: {
          rep: { energyDollars: round2(repEnergyDollars), fixedDollars: round2(repFixedDollars), totalDollars: round2(repTotal) },
          tdsp: { deliveryDollars: round2(tdspDeliveryDollars), fixedDollars: round2(tdspFixedDollars), totalDollars: round2(tdspTotal) },
          ...(creditsMaybe.ok ? { creditsDollars: round2(creditsDollars) } : {}),
          ...(minimumMaybe.ok ? { minimumUsageFeeDollars: round2(minUsageFeeDollars) } : {}),
          ...(minimumMaybe.ok ? { minimumBillTopUpDollars: round2(minimumBillTopUpDollars) } : {}),
          totalDollars: round2(total),
        },
        notes,
        debug: {
          touPhase2: { requiredKeys, months, periodsByMonth: debugPeriodsByMonth },
          ...(creditsMaybe.ok ? { billCreditsByMonth: creditsDebug } : {}),
          ...(minimumMaybe.ok ? { minimumRulesByMonth: minRulesDebug } : {}),
        },
      };
    }

    const tou = extractTouPhase1Rates(args.rateStructure);
    if (!tou) {
      const reasonCode = (tou2 as any)?.reasonCode ? String((tou2 as any).reasonCode) : "TOU_RATE_EXTRACTION_UNSUPPORTED";
      return { status: "NOT_COMPUTABLE", reason: reasonCode };
    }

    const byMonth = args.usageBucketsByMonth;
    const allMonths = Object.keys(byMonth ?? {}).sort();
    if (allMonths.length === 0) {
      return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS (no months present)" };
    }

    const wantMonths = Math.max(1, Math.floor(safeNum(args.monthsCount) ?? 12));
    if (allMonths.length < wantMonths) {
      return { status: "NOT_COMPUTABLE", reason: `MISSING_USAGE_BUCKETS (need ${wantMonths} months, have ${allMonths.length})` };
    }
    const months = allMonths.slice(-wantMonths);

    const tdspPerKwhCents = safeNum(args.tdsp?.perKwhDeliveryChargeCents) ?? 0;
    const tdspMonthly = safeNum(args.tdsp?.monthlyCustomerChargeDollars) ?? 0;
    const repFixedMonthly = extractRepFixedMonthlyChargeDollars(args.rateStructure) ?? 0;

    let repEnergyCentsTotal = 0;
    let repFixedCentsTotal = 0;
    let tdspDeliveryCentsTotal = 0;
    let tdspFixedCentsTotal = 0;
    let creditsCentsTotal = 0;
    let minUsageFeeCentsTotal = 0;
    let minimumBillTopUpCentsTotal = 0;
    let totalCentsTotal = 0;
    const missing: string[] = [];
    const mismatched: string[] = [];
    const creditsDebug: any[] = [];
    const minRulesDebug: any[] = [];

    for (const ym of months) {
      const m = byMonth[ym];
      if (!m || typeof m !== "object") continue;

      const totalKey = "kwh.m.all.total";
      const monthTotalKwh = sumMonthBucketKwh(m, totalKey);
      if (monthTotalKwh == null) {
        missing.push(`${ym}:${totalKey}`);
        continue;
      }

      let monthRepEnergyCents = 0;
      if (tou.kind === "DAY_NIGHT_ALL_DAYS") {
        const nightKey = "kwh.m.all.2000-0700";
        const dayKey = "kwh.m.all.0700-2000";
        const nightKwh = sumMonthBucketKwh(m, nightKey);
        const dayKwh = sumMonthBucketKwh(m, dayKey);

        if (nightKwh == null) missing.push(`${ym}:${nightKey}`);
        if (dayKwh == null) missing.push(`${ym}:${dayKey}`);
        if (nightKwh == null || dayKwh == null) continue;

        const sum = nightKwh + dayKwh;
        // Safety: if buckets disagree, do NOT attempt to normalize/adjust.
        if (Math.abs(sum - monthTotalKwh) > 0.01) {
          mismatched.push(`${ym}:sum(day+night)=${sum.toFixed(3)} total=${monthTotalKwh.toFixed(3)}`);
          continue;
        }

        monthRepEnergyCents =
          (nightKwh * tou.nightRateCentsPerKwh) + (dayKwh * tou.dayRateCentsPerKwh);
      } else {
        // Free Weekends (weekday vs weekend all-day)
        const wkKey = "kwh.m.weekday.total";
        const weKey = "kwh.m.weekend.total";
        const weekdayKwh = sumMonthBucketKwh(m, wkKey);
        const weekendKwh = sumMonthBucketKwh(m, weKey);

        if (weekdayKwh == null) missing.push(`${ym}:${wkKey}`);
        if (weekendKwh == null) missing.push(`${ym}:${weKey}`);
        if (weekdayKwh == null || weekendKwh == null) continue;

        const sum = weekdayKwh + weekendKwh;
        // Enforce strict equality with total.
        if (Math.abs(sum - monthTotalKwh) > 0.01) {
          mismatched.push(`${ym}:sum(weekday+weekend)=${sum.toFixed(3)} total=${monthTotalKwh.toFixed(3)}`);
          continue;
        }

        monthRepEnergyCents =
          (weekdayKwh * tou.weekdayRateCentsPerKwh) + (weekendKwh * tou.weekendRateCentsPerKwh);
      }

      const monthRepFixedCents = repFixedMonthly * 100;
      const monthTdspFixedCents = tdspMonthly * 100;
      const monthTdspDeliveryCents = monthTotalKwh * tdspPerKwhCents;

      const appliedCredits = creditsMaybe.ok ? applyBillCreditsToMonth({ monthlyKwh: monthTotalKwh, credits: creditsMaybe.credits }) : null;
      const monthCreditsCents = appliedCredits ? appliedCredits.creditCentsTotal : 0;
      if (appliedCredits) creditsDebug.push({ ym, monthTotalKwh, applied: appliedCredits.applied, creditCentsTotal: monthCreditsCents });

      const subtotalCents = monthRepEnergyCents + monthRepFixedCents + monthTdspFixedCents + monthTdspDeliveryCents + monthCreditsCents;
      let finalCents = clampNonNegative(roundCents(subtotalCents));
      if (minimumMaybe.ok) {
        const appliedMin = applyMinimumRulesToMonth({
          monthlyKwh: monthTotalKwh,
          minimum: minimumMaybe.minimum,
          subtotalCents: roundCents(subtotalCents),
        });
        minUsageFeeCentsTotal += appliedMin.minUsageFeeCents;
        minimumBillTopUpCentsTotal += appliedMin.minimumBillTopUpCents;
        finalCents = appliedMin.totalCentsAfter;
        minRulesDebug.push({ ym, monthTotalKwh, subtotalCents: roundCents(subtotalCents), applied: appliedMin.applied });
      }

      repEnergyCentsTotal += roundCents(monthRepEnergyCents);
      repFixedCentsTotal += roundCents(monthRepFixedCents);
      tdspDeliveryCentsTotal += roundCents(monthTdspDeliveryCents);
      tdspFixedCentsTotal += roundCents(monthTdspFixedCents);
      creditsCentsTotal += roundCents(monthCreditsCents);
      totalCentsTotal += finalCents;
    }

    if (missing.length > 0) {
      return { status: "NOT_COMPUTABLE", reason: `MISSING_USAGE_BUCKETS: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}` };
    }
    if (mismatched.length > 0) {
      return {
        status: "NOT_COMPUTABLE",
        reason: `USAGE_BUCKET_SUM_MISMATCH: ${mismatched.slice(0, 6).join(", ")}${mismatched.length > 6 ? "…" : ""}`,
      };
    }

    const repEnergyDollars = repEnergyCentsTotal / 100;
    const repFixedDollars = repFixedCentsTotal / 100;
    const tdspDeliveryDollars = tdspDeliveryCentsTotal / 100;
    const tdspFixedDollars = tdspFixedCentsTotal / 100;
    const creditsDollars = creditsCentsTotal / 100;
    const minUsageFeeDollars = minUsageFeeCentsTotal / 100;
    const minimumBillTopUpDollars = minimumBillTopUpCentsTotal / 100;

    const repTotal = repEnergyDollars + repFixedDollars;
    const tdspTotal = tdspDeliveryDollars + tdspFixedDollars;
    const total = totalCentsTotal / 100;

    if (tou.kind === "DAY_NIGHT_ALL_DAYS") {
      notes.push(`TOU Phase-1 (day/night): months=${months.length}`);
      notes.push("TOU buckets: kwh.m.all.total + kwh.m.all.2000-0700 + kwh.m.all.0700-2000");
    } else {
      notes.push(`Free Weekends (weekday/weekend): months=${months.length}`);
      notes.push("Buckets: kwh.m.weekday.total + kwh.m.weekend.total (+ optional kwh.m.all.total sanity)");
    }
    if (repFixedMonthly > 0) notes.push("Includes REP fixed monthly charge (from template)");
    else notes.push("REP fixed monthly charge not found (assumed $0)");
    if (tdspPerKwhCents > 0 || tdspMonthly > 0) notes.push("Includes TDSP delivery");
    else notes.push("TDSP delivery missing/zero (check tdspRatesApplied)");
    if (creditsMaybe.ok) notes.push("Includes deterministic bill credits (Phase 1)");
    if (minimumMaybe.ok) notes.push("Includes deterministic minimum rules (Phase 1)");

    return {
      status: "OK",
      annualCostDollars: round2(total),
      monthlyCostDollars: round2(total / months.length),
      confidence: "MEDIUM",
      components: {
        energyOnlyDollars: round2(repEnergyDollars),
        deliveryDollars: round2(tdspDeliveryDollars),
        baseFeesDollars: round2(repFixedDollars + tdspFixedDollars),
        ...(creditsMaybe.ok ? { creditsDollars: round2(creditsDollars) } : {}),
        ...(minimumMaybe.ok ? { minimumUsageFeeDollars: round2(minUsageFeeDollars) } : {}),
        ...(minimumMaybe.ok ? { minimumBillTopUpDollars: round2(minimumBillTopUpDollars) } : {}),
        totalDollars: round2(total),
      },
      componentsV2: {
        rep: {
          energyDollars: round2(repEnergyDollars),
          fixedDollars: round2(repFixedDollars),
          totalDollars: round2(repTotal),
        },
        tdsp: {
          deliveryDollars: round2(tdspDeliveryDollars),
          fixedDollars: round2(tdspFixedDollars),
          totalDollars: round2(tdspTotal),
        },
        ...(creditsMaybe.ok ? { creditsDollars: round2(creditsDollars) } : {}),
        ...(minimumMaybe.ok ? { minimumUsageFeeDollars: round2(minUsageFeeDollars) } : {}),
        ...(minimumMaybe.ok ? { minimumBillTopUpDollars: round2(minimumBillTopUpDollars) } : {}),
        totalDollars: round2(total),
      },
      notes,
      debug: {
        ...(creditsMaybe.ok ? { billCreditsByMonth: creditsDebug } : {}),
        ...(minimumMaybe.ok ? { minimumRulesByMonth: minRulesDebug } : {}),
      },
    };
  }

  const repFixedMonthly = extractRepFixedMonthlyChargeDollars(args.rateStructure) ?? 0;

  const tdspPerKwhCents = safeNum(args.tdsp?.perKwhDeliveryChargeCents) ?? 0;
  const tdspMonthly = safeNum(args.tdsp?.monthlyCustomerChargeDollars) ?? 0;

  const creditsMaybe = extractDeterministicBillCredits(args.rateStructure);
  if (!creditsMaybe.ok && creditsMaybe.reason !== "NO_CREDITS") {
    return { status: "NOT_COMPUTABLE", reason: creditsMaybe.reason, notes: [...notes, ...(creditsMaybe.notes ?? [])] };
  }

  const minimumMaybe = extractDeterministicMinimumRules({ rateStructure: args.rateStructure });
  if (!minimumMaybe.ok && minimumMaybe.reason !== "NO_MIN_RULES") {
    return { status: "NOT_COMPUTABLE", reason: minimumMaybe.reason, notes: [...notes, ...(minimumMaybe.notes ?? [])] };
  }

  // If deterministic bill credits exist, we must use monthly totals (fail-closed without buckets).
  if (creditsMaybe.ok) {
    if (!args.usageBucketsByMonth) {
      return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS", notes: ["bill_credits_require_monthly_totals"] };
    }

    const byMonth = args.usageBucketsByMonth;
    const allMonths = Object.keys(byMonth ?? {}).sort();
    if (allMonths.length === 0) {
      return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS (no months present)" };
    }

    const wantMonths = Math.max(1, Math.floor(safeNum(args.monthsCount) ?? 12));
    if (allMonths.length < wantMonths) {
      return { status: "NOT_COMPUTABLE", reason: `MISSING_USAGE_BUCKETS (need ${wantMonths} months, have ${allMonths.length})` };
    }
    const months = allMonths.slice(-wantMonths);

    let repEnergyCentsTotal = 0;
    let repFixedCentsTotal = 0;
    let tdspDeliveryCentsTotal = 0;
    let tdspFixedCentsTotal = 0;
    let creditsCentsTotal = 0; // negative
    let minUsageFeeCentsTotal = 0; // positive
    let minimumBillTopUpCentsTotal = 0; // positive
    let totalCentsTotal = 0;

    const missing: string[] = [];
    const creditsDebug: any[] = [];
    const minRulesDebug: any[] = [];

    for (const ym of months) {
      const m = byMonth[ym];
      const monthTotalKwh = m ? sumMonthBucketKwh(m, "kwh.m.all.total") : null;
      if (monthTotalKwh == null) {
        missing.push(`${ym}:kwh.m.all.total`);
        continue;
      }

      const monthEnergyCents = monthTotalKwh * repEnergyCents;
      const monthRepFixedCents = repFixedMonthly * 100;
      const monthTdspFixedCents = tdspMonthly * 100;
      const monthTdspDeliveryCents = monthTotalKwh * tdspPerKwhCents;

      const appliedCredits = applyBillCreditsToMonth({ monthlyKwh: monthTotalKwh, credits: creditsMaybe.credits });
      const monthCreditsCents = appliedCredits.creditCentsTotal; // negative
      creditsDebug.push({ ym, monthTotalKwh, applied: appliedCredits.applied, creditCentsTotal: monthCreditsCents });

      const subtotalCents = monthEnergyCents + monthRepFixedCents + monthTdspFixedCents + monthTdspDeliveryCents + monthCreditsCents;

      let finalCents = clampNonNegative(roundCents(subtotalCents));
      if (minimumMaybe.ok) {
        const appliedMin = applyMinimumRulesToMonth({
          monthlyKwh: monthTotalKwh,
          minimum: minimumMaybe.minimum,
          subtotalCents: roundCents(subtotalCents),
        });
        minUsageFeeCentsTotal += appliedMin.minUsageFeeCents;
        minimumBillTopUpCentsTotal += appliedMin.minimumBillTopUpCents;
        finalCents = appliedMin.totalCentsAfter;
        minRulesDebug.push({ ym, monthTotalKwh, subtotalCents: roundCents(subtotalCents), applied: appliedMin.applied });
      }

      repEnergyCentsTotal += roundCents(monthEnergyCents);
      repFixedCentsTotal += roundCents(monthRepFixedCents);
      tdspDeliveryCentsTotal += roundCents(monthTdspDeliveryCents);
      tdspFixedCentsTotal += roundCents(monthTdspFixedCents);
      creditsCentsTotal += roundCents(monthCreditsCents);
      totalCentsTotal += finalCents;
    }

    if (missing.length > 0) {
      return { status: "NOT_COMPUTABLE", reason: `MISSING_USAGE_BUCKETS: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}` };
    }

    const repEnergyDollars = repEnergyCentsTotal / 100;
    const repFixedDollars = repFixedCentsTotal / 100;
    const tdspDeliveryDollars = tdspDeliveryCentsTotal / 100;
    const tdspFixedDollars = tdspFixedCentsTotal / 100;
    const creditsDollars = creditsCentsTotal / 100;
    const minUsageFeeDollars = minUsageFeeCentsTotal / 100;
    const minimumBillTopUpDollars = minimumBillTopUpCentsTotal / 100;

    const repTotal = repEnergyDollars + repFixedDollars;
    const tdspTotal = tdspDeliveryDollars + tdspFixedDollars;
    const total = totalCentsTotal / 100;

    notes.push("Computed from kwh.m.all.total (monthly) + TDSP delivery + bill credits");
    notes.push("Includes deterministic bill credits (Phase 1)");
    if (minimumMaybe.ok) notes.push("Includes deterministic minimum rules (Phase 1)");
    if (repFixedMonthly > 0) notes.push("Includes REP fixed monthly charge (from template)");
    else notes.push("REP fixed monthly charge not found (assumed $0)");
    if (tdspPerKwhCents > 0 || tdspMonthly > 0) notes.push("Includes TDSP delivery");
    else notes.push("TDSP delivery missing/zero (check tdspRatesApplied)");

    return {
      status: "OK",
      annualCostDollars: round2(total),
      monthlyCostDollars: round2(total / months.length),
      confidence: "MEDIUM",
      components: {
        energyOnlyDollars: round2(repEnergyDollars),
        deliveryDollars: round2(tdspDeliveryDollars),
        baseFeesDollars: round2(repFixedDollars + tdspFixedDollars),
        creditsDollars: round2(creditsDollars),
        ...(minimumMaybe.ok ? { minimumUsageFeeDollars: round2(minUsageFeeDollars) } : {}),
        ...(minimumMaybe.ok ? { minimumBillTopUpDollars: round2(minimumBillTopUpDollars) } : {}),
        totalDollars: round2(total),
      },
      componentsV2: {
        rep: { energyDollars: round2(repEnergyDollars), fixedDollars: round2(repFixedDollars), totalDollars: round2(repTotal) },
        tdsp: { deliveryDollars: round2(tdspDeliveryDollars), fixedDollars: round2(tdspFixedDollars), totalDollars: round2(tdspTotal) },
        creditsDollars: round2(creditsDollars),
        ...(minimumMaybe.ok ? { minimumUsageFeeDollars: round2(minUsageFeeDollars) } : {}),
        ...(minimumMaybe.ok ? { minimumBillTopUpDollars: round2(minimumBillTopUpDollars) } : {}),
        totalDollars: round2(total),
      },
      notes,
      debug: { billCreditsByMonth: creditsDebug, ...(minimumMaybe.ok ? { minimumRulesByMonth: minRulesDebug } : {}) },
    };
  }

  // No credits: if minimum rules exist, we must use monthly totals (fail-closed without buckets).
  if (minimumMaybe.ok) {
    if (!args.usageBucketsByMonth) {
      return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS", notes: ["minimum_rules_require_monthly_totals"] };
    }
    const byMonth = args.usageBucketsByMonth;
    const allMonths = Object.keys(byMonth ?? {}).sort();
    if (allMonths.length === 0) {
      return { status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS (no months present)" };
    }
    const wantMonths = Math.max(1, Math.floor(safeNum(args.monthsCount) ?? 12));
    if (allMonths.length < wantMonths) {
      return { status: "NOT_COMPUTABLE", reason: `MISSING_USAGE_BUCKETS (need ${wantMonths} months, have ${allMonths.length})` };
    }
    const months = allMonths.slice(-wantMonths);

    let repEnergyCentsTotal = 0;
    let repFixedCentsTotal = 0;
    let tdspDeliveryCentsTotal = 0;
    let tdspFixedCentsTotal = 0;
    let minUsageFeeCentsTotal = 0;
    let minimumBillTopUpCentsTotal = 0;
    let totalCentsTotal = 0;
    const missing: string[] = [];
    const minRulesDebug: any[] = [];

    for (const ym of months) {
      const m = byMonth[ym];
      const monthTotalKwh = m ? sumMonthBucketKwh(m, "kwh.m.all.total") : null;
      if (monthTotalKwh == null) {
        missing.push(`${ym}:kwh.m.all.total`);
        continue;
      }
      const monthEnergyCents = monthTotalKwh * repEnergyCents;
      const monthRepFixedCents = repFixedMonthly * 100;
      const monthTdspFixedCents = tdspMonthly * 100;
      const monthTdspDeliveryCents = monthTotalKwh * tdspPerKwhCents;

      const subtotalCents = monthEnergyCents + monthRepFixedCents + monthTdspFixedCents + monthTdspDeliveryCents;
      const appliedMin = applyMinimumRulesToMonth({
        monthlyKwh: monthTotalKwh,
        minimum: minimumMaybe.minimum,
        subtotalCents: roundCents(subtotalCents),
      });
      minUsageFeeCentsTotal += appliedMin.minUsageFeeCents;
      minimumBillTopUpCentsTotal += appliedMin.minimumBillTopUpCents;
      totalCentsTotal += appliedMin.totalCentsAfter;
      minRulesDebug.push({ ym, monthTotalKwh, subtotalCents: roundCents(subtotalCents), applied: appliedMin.applied });

      repEnergyCentsTotal += roundCents(monthEnergyCents);
      repFixedCentsTotal += roundCents(monthRepFixedCents);
      tdspDeliveryCentsTotal += roundCents(monthTdspDeliveryCents);
      tdspFixedCentsTotal += roundCents(monthTdspFixedCents);
    }

    if (missing.length > 0) {
      return { status: "NOT_COMPUTABLE", reason: `MISSING_USAGE_BUCKETS: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}` };
    }

    const repEnergyDollars = repEnergyCentsTotal / 100;
    const repFixedDollars = repFixedCentsTotal / 100;
    const tdspDeliveryDollars = tdspDeliveryCentsTotal / 100;
    const tdspFixedDollars = tdspFixedCentsTotal / 100;
    const minUsageFeeDollars = minUsageFeeCentsTotal / 100;
    const minimumBillTopUpDollars = minimumBillTopUpCentsTotal / 100;

    const repTotal = repEnergyDollars + repFixedDollars;
    const tdspTotal = tdspDeliveryDollars + tdspFixedDollars;
    const total = totalCentsTotal / 100;

    notes.push("Computed from kwh.m.all.total (monthly) + TDSP delivery + minimum rules");
    if (repFixedMonthly > 0) notes.push("Includes REP fixed monthly charge (from template)");
    else notes.push("REP fixed monthly charge not found (assumed $0)");
    if (tdspPerKwhCents > 0 || tdspMonthly > 0) notes.push("Includes TDSP delivery");
    else notes.push("TDSP delivery missing/zero (check tdspRatesApplied)");

    return {
      status: "OK",
      annualCostDollars: round2(total),
      monthlyCostDollars: round2(total / months.length),
      confidence: "MEDIUM",
      components: {
        energyOnlyDollars: round2(repEnergyDollars),
        deliveryDollars: round2(tdspDeliveryDollars),
        baseFeesDollars: round2(repFixedDollars + tdspFixedDollars),
        minimumUsageFeeDollars: round2(minUsageFeeDollars),
        minimumBillTopUpDollars: round2(minimumBillTopUpDollars),
        totalDollars: round2(total),
      },
      componentsV2: {
        rep: { energyDollars: round2(repEnergyDollars), fixedDollars: round2(repFixedDollars), totalDollars: round2(repTotal) },
        tdsp: { deliveryDollars: round2(tdspDeliveryDollars), fixedDollars: round2(tdspFixedDollars), totalDollars: round2(tdspTotal) },
        minimumUsageFeeDollars: round2(minUsageFeeDollars),
        minimumBillTopUpDollars: round2(minimumBillTopUpDollars),
        totalDollars: round2(total),
      },
      notes,
      debug: { minimumRulesByMonth: minRulesDebug },
    };
  }

  // No credits + no minimum rules: preserve v1 fixed-rate behavior (annual-kWh based).
  const repEnergyDollars = annualKwh * (repEnergyCents / 100);
  const tdspDeliveryDollars = annualKwh * (tdspPerKwhCents / 100);

  const months = Math.max(1, Math.floor(safeNum(args.monthsCount) ?? 12));
  const repFixedDollars = months * repFixedMonthly;
  const tdspFixedDollars = months * tdspMonthly;

  const repTotal = repEnergyDollars + repFixedDollars;
  const tdspTotal = tdspDeliveryDollars + tdspFixedDollars;
  const total = repTotal + tdspTotal;

  notes.push("Computed from kwh.m.all.total + TDSP delivery");
  if (repFixedMonthly > 0) notes.push("Includes REP fixed monthly charge (from template)");
  else notes.push("REP fixed monthly charge not found (assumed $0)");
  if (tdspPerKwhCents > 0 || tdspMonthly > 0) notes.push("Includes TDSP delivery");
  else notes.push("TDSP delivery missing/zero (check tdspRatesApplied)");

  return {
    status: "OK",
    annualCostDollars: round2(total),
    monthlyCostDollars: round2(total / months),
    confidence: "HIGH",
    components: {
      energyOnlyDollars: round2(repEnergyDollars),
      deliveryDollars: round2(tdspDeliveryDollars),
      baseFeesDollars: round2(repFixedDollars + tdspFixedDollars),
      totalDollars: round2(total),
    },
    componentsV2: {
      rep: { energyDollars: round2(repEnergyDollars), fixedDollars: round2(repFixedDollars), totalDollars: round2(repTotal) },
      tdsp: { deliveryDollars: round2(tdspDeliveryDollars), fixedDollars: round2(tdspFixedDollars), totalDollars: round2(tdspTotal) },
      totalDollars: round2(total),
    },
    notes,
  };
}

export function stableQuarantineSha256(seed: string) {
  return crypto.createHash("sha256").update(seed).digest("hex");
}