import crypto from "node:crypto";
import { extractDeterministicTouSchedule } from "@/lib/plan-engine/touPeriods";

export type TrueCostEstimateStatus = "OK" | "NOT_COMPUTABLE" | "NOT_IMPLEMENTED";

export type TrueCostConfidence = "HIGH" | "MEDIUM" | "LOW";

export type TrueCostEstimate = {
  status: TrueCostEstimateStatus;
  reason?: string;

  annualCostDollars?: number;
  monthlyCostDollars?: number;
  confidence?: TrueCostConfidence;

  components?: {
    energyOnlyDollars: number; // REP energy only
    deliveryDollars: number; // TDSP per-kWh
    baseFeesDollars: number; // TDSP fixed + REP fixed (if known)
    totalDollars: number;
  };

  componentsV2?: {
    rep: { energyDollars: number; fixedDollars: number; totalDollars: number };
    tdsp: { deliveryDollars: number; fixedDollars: number; totalDollars: number };
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
    // IMPORTANT: Preserve current v1 behavior for existing call sites.
    // Only attempt TOU math when explicit bucket totals are provided (future wiring).
    if (!args.usageBucketsByMonth) {
      return { status: "NOT_COMPUTABLE", reason: "Unsupported rateStructure (no single fixed REP energy rate)" };
    }

    const tou2 = extractDeterministicTouSchedule(args.rateStructure);
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

      let repEnergyDollars = 0;
      let totalKwh = 0;
      const missing: string[] = [];
      const mismatched: string[] = [];
      const debugPeriodsByMonth: any[] = [];

      for (const ym of months) {
        const m = byMonth[ym];
        if (!m || typeof m !== "object") continue;

        const monthTotalKwh = sumMonthBucketKwh(m, "kwh.m.all.total");
        if (monthTotalKwh == null) missing.push(`${ym}:kwh.m.all.total`);

        let sumPeriodsKwh = 0;
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
          const repCost = kwh * (p.repEnergyCentsPerKwh / 100);
          repEnergyDollars += repCost;
          dbg.push({ bucketKey: k, kwh, repCentsPerKwh: p.repEnergyCentsPerKwh, repCostDollars: round2(repCost), label: p.label ?? null, dayType: p.dayType, startHHMM: p.startHHMM, endHHMM: p.endHHMM });
        }

        if (monthTotalKwh != null) {
          if (Math.abs(sumPeriodsKwh - monthTotalKwh) > 0.001) {
            mismatched.push(`${ym}:sum(periods)=${sumPeriodsKwh.toFixed(3)} total=${monthTotalKwh.toFixed(3)}`);
            continue;
          }
          totalKwh += monthTotalKwh;
        }

        debugPeriodsByMonth.push({ yearMonth: ym, periods: dbg, requiredKeys });
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

      const repFixedDollars = months.length * repFixedMonthly;
      const tdspDeliveryDollars = totalKwh * (tdspPerKwhCents / 100);
      const tdspFixedDollars = months.length * tdspMonthly;

      const repTotal = repEnergyDollars + repFixedDollars;
      const tdspTotal = tdspDeliveryDollars + tdspFixedDollars;
      const total = repTotal + tdspTotal;

      notes.push(`TOU Phase-2 (windows): months=${months.length} periods=${schedule.periods.length}`);
      if (repFixedMonthly > 0) notes.push("Includes REP fixed monthly charge (from template)");
      else notes.push("REP fixed monthly charge not found (assumed $0)");
      if (tdspPerKwhCents > 0 || tdspMonthly > 0) notes.push("Includes TDSP delivery (total-based)");
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
          totalDollars: round2(total),
        },
        componentsV2: {
          rep: { energyDollars: round2(repEnergyDollars), fixedDollars: round2(repFixedDollars), totalDollars: round2(repTotal) },
          tdsp: { deliveryDollars: round2(tdspDeliveryDollars), fixedDollars: round2(tdspFixedDollars), totalDollars: round2(tdspTotal) },
          totalDollars: round2(total),
        },
        notes,
        debug: { touPhase2: { requiredKeys, months, periodsByMonth: debugPeriodsByMonth } },
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

    let repEnergyDollars = 0;
    let totalKwh = 0;
    const missing: string[] = [];
    const mismatched: string[] = [];

    for (const ym of months) {
      const m = byMonth[ym];
      if (!m || typeof m !== "object") continue;

      const totalKey = "kwh.m.all.total";
      const monthTotalKwh = sumMonthBucketKwh(m, totalKey);

      if (tou.kind === "DAY_NIGHT_ALL_DAYS") {
        const nightKey = "kwh.m.all.2000-0700";
        const dayKey = "kwh.m.all.0700-2000";
        const nightKwh = sumMonthBucketKwh(m, nightKey);
        const dayKwh = sumMonthBucketKwh(m, dayKey);

        if (monthTotalKwh == null) missing.push(`${ym}:${totalKey}`);
        if (nightKwh == null) missing.push(`${ym}:${nightKey}`);
        if (dayKwh == null) missing.push(`${ym}:${dayKey}`);
        if (monthTotalKwh == null || nightKwh == null || dayKwh == null) continue;

        const sum = nightKwh + dayKwh;
        // Safety: if buckets disagree, do NOT attempt to normalize/adjust.
        if (Math.abs(sum - monthTotalKwh) > 0.01) {
          mismatched.push(`${ym}:sum(day+night)=${sum.toFixed(3)} total=${monthTotalKwh.toFixed(3)}`);
          continue;
        }

        repEnergyDollars +=
          (nightKwh * (tou.nightRateCentsPerKwh / 100)) + (dayKwh * (tou.dayRateCentsPerKwh / 100));
        totalKwh += monthTotalKwh;
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
        // If total exists, enforce strict equality; otherwise we can still compute TDSP off sum.
        if (monthTotalKwh != null && Math.abs(sum - monthTotalKwh) > 0.01) {
          mismatched.push(`${ym}:sum(weekday+weekend)=${sum.toFixed(3)} total=${monthTotalKwh.toFixed(3)}`);
          continue;
        }

        repEnergyDollars +=
          (weekdayKwh * (tou.weekdayRateCentsPerKwh / 100)) + (weekendKwh * (tou.weekendRateCentsPerKwh / 100));
        totalKwh += monthTotalKwh != null ? monthTotalKwh : sum;
      }
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

    const repFixedDollars = months.length * repFixedMonthly;
    const tdspDeliveryDollars = totalKwh * (tdspPerKwhCents / 100);
    const tdspFixedDollars = months.length * tdspMonthly;

    const repTotal = repEnergyDollars + repFixedDollars;
    const tdspTotal = tdspDeliveryDollars + tdspFixedDollars;
    const total = repTotal + tdspTotal;

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

    return {
      status: "OK",
      annualCostDollars: round2(total),
      monthlyCostDollars: round2(total / months.length),
      confidence: "MEDIUM",
      components: {
        energyOnlyDollars: round2(repEnergyDollars),
        deliveryDollars: round2(tdspDeliveryDollars),
        baseFeesDollars: round2(repFixedDollars + tdspFixedDollars),
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
        totalDollars: round2(total),
      },
      notes,
    };
  }

  const repFixedMonthly = extractRepFixedMonthlyChargeDollars(args.rateStructure) ?? 0;

  const tdspPerKwhCents = safeNum(args.tdsp?.perKwhDeliveryChargeCents) ?? 0;
  const tdspMonthly = safeNum(args.tdsp?.monthlyCustomerChargeDollars) ?? 0;

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
      totalDollars: round2(total),
    },
    notes,
  };
}

export function stableQuarantineSha256(seed: string) {
  return crypto.createHash("sha256").update(seed).digest("hex");
}