import crypto from "node:crypto";

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
}): TrueCostEstimate {
  const notes: string[] = [];

  const annualKwh = safeNum(args.annualKwh);
  if (annualKwh === null || annualKwh <= 0) {
    return { status: "NOT_IMPLEMENTED", reason: "Missing or invalid annual kWh" };
  }

  const repEnergyCents = extractFixedRepEnergyCentsPerKwh(args.rateStructure);
  if (repEnergyCents === null) {
    return { status: "NOT_COMPUTABLE", reason: "Unsupported rateStructure (no single fixed REP energy rate)" };
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