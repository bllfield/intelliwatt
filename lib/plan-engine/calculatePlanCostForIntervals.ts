import type { IntervalTrueCostResult, IntervalUsageRow, RatePlanTemplateInput, TdspRatesInput } from "./types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function hasNonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

function tryExtractFixedRepCentsPerKwh(rateStructure: unknown, planRules?: unknown | null): number | null {
  const candidates: number[] = [];

  // ---- rateStructure path (preferred) ----
  if (isObject(rateStructure)) {
    const rsType = typeof rateStructure.type === "string" ? String(rateStructure.type).trim().toUpperCase() : null;
    if (rsType && rsType !== "FIXED") return null; // fail closed: only fixed in v1

    // Reject obvious non-fixed complexity
    if (hasNonEmptyArray((rateStructure as any).usageTiers)) return null;
    if (hasNonEmptyArray((rateStructure as any).tiers)) return null;
    if (hasNonEmptyArray((rateStructure as any).timeOfUseTiers)) return null;

    const billCredits = (rateStructure as any).billCredits;
    if (isObject(billCredits)) {
      if ((billCredits as any).hasBillCredit === true) return null;
      if (hasNonEmptyArray((billCredits as any).rules)) return null;
    }

    const baseMonthlyFeeCents = numOrNull((rateStructure as any).baseMonthlyFeeCents);
    if (typeof baseMonthlyFeeCents === "number" && Number.isFinite(baseMonthlyFeeCents) && baseMonthlyFeeCents !== 0) {
      return null; // fail closed: REP fixed fees not handled in v1
    }

    const energyRate =
      numOrNull((rateStructure as any).energyRateCents) ??
      numOrNull((rateStructure as any).energyChargeCentsPerKwh) ??
      numOrNull((rateStructure as any).defaultRateCentsPerKwh);
    if (energyRate != null) candidates.push(energyRate);
  }

  // ---- planRules path (secondary) ----
  if (isObject(planRules)) {
    const rateType = typeof (planRules as any).rateType === "string" ? String((planRules as any).rateType).trim().toUpperCase() : null;
    if (rateType && rateType !== "FIXED") return null;

    if (hasNonEmptyArray((planRules as any).timeOfUsePeriods)) return null;
    if (hasNonEmptyArray((planRules as any).usageTiers)) return null;
    if (hasNonEmptyArray((planRules as any).billCredits)) return null;

    const baseChargePerMonthCents = numOrNull((planRules as any).baseChargePerMonthCents);
    if (
      typeof baseChargePerMonthCents === "number" &&
      Number.isFinite(baseChargePerMonthCents) &&
      baseChargePerMonthCents !== 0
    ) {
      return null; // fail closed: REP base fees not handled in v1
    }

    const prEnergy =
      numOrNull((planRules as any).defaultRateCentsPerKwh) ?? numOrNull((planRules as any).currentBillEnergyRateCents);
    if (prEnergy != null) candidates.push(prEnergy);
  }

  // De-dupe candidates, fail-closed if ambiguous.
  const uniq = Array.from(new Set(candidates.map((n) => round2(n))));
  if (uniq.length !== 1) return null;

  const only = uniq[0]!;
  if (!(only > 0)) return null;
  return only;
}

export async function calculatePlanCostForIntervals(args: {
  intervals: IntervalUsageRow[];
  template: RatePlanTemplateInput;
  tdspRates: TdspRatesInput;
}): Promise<IntervalTrueCostResult> {
  if (!args || !Array.isArray(args.intervals)) return { status: "ERROR", reason: "Invalid args.intervals" };
  if (!args.template) return { status: "ERROR", reason: "Missing template" };
  if (!args.tdspRates) return { status: "ERROR", reason: "Missing tdspRates" };

  const tdspPerKwhCents = numOrNull(args.tdspRates.perKwhDeliveryChargeCents);
  const tdspMonthlyDollars = numOrNull(args.tdspRates.monthlyCustomerChargeDollars);
  if (tdspPerKwhCents == null || tdspPerKwhCents < 0) return { status: "ERROR", reason: "Invalid tdspRates.perKwhDeliveryChargeCents" };
  if (tdspMonthlyDollars == null || tdspMonthlyDollars < 0) return { status: "ERROR", reason: "Invalid tdspRates.monthlyCustomerChargeDollars" };

  const repCentsPerKwh = tryExtractFixedRepCentsPerKwh(args.template.rateStructure, args.template.planRules ?? null);
  if (repCentsPerKwh == null) {
    return {
      status: "NOT_IMPLEMENTED",
      reason: "Only fixed-rate templates with a single unambiguous REP energy cents/kWh are supported in v1",
      notes: ["fixed-rate-only v1", "Fail-closed if template is tiered/TOU/variable/has REP base fees/credits"],
    };
  }

  let kwhPriced = 0;
  let intervalRowsPriced = 0;

  for (const row of args.intervals) {
    if (!row || !(row.ts instanceof Date) || Number.isNaN(row.ts.getTime())) {
      return { status: "ERROR", reason: "Invalid interval ts (expected Date)" };
    }
    const kwh = numOrNull((row as any).kwh);
    if (kwh == null) return { status: "ERROR", reason: "Invalid interval kwh" };
    if (kwh < 0) return { status: "ERROR", reason: "Negative interval kwh not supported" };
    if (kwh === 0) continue;
    kwhPriced += kwh;
    intervalRowsPriced += 1;
  }

  if (!(kwhPriced > 0)) {
    return { status: "ERROR", reason: "No usable interval kWh to price" };
  }

  const repEnergyDollars = round2((kwhPriced * repCentsPerKwh) / 100);
  const tdspDeliveryDollars = round2((kwhPriced * tdspPerKwhCents) / 100);
  const tdspFixedDollars = round2(tdspMonthlyDollars * 12);

  const annualCostDollars = round2(repEnergyDollars + tdspDeliveryDollars + tdspFixedDollars);

  return {
    status: "OK",
    annualCostDollars,
    repEnergyDollars,
    tdspDeliveryDollars,
    tdspFixedDollars,
    totalDollars: annualCostDollars,
    intervalRowsPriced,
    kwhPriced: round2(kwhPriced),
    notes: [
      "fixed-rate-only v1 (fail-closed)",
      `REP energy priced at ${round2(repCentsPerKwh)}¢/kWh from template`,
      "TDSP delivery priced using tdspRates.perKwhDeliveryChargeCents",
      "TDSP fixed priced as tdspRates.monthlyCustomerChargeDollars * 12",
    ],
  };
}


