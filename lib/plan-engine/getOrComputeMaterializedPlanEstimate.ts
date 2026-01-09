import { makePlanEstimateInputsSha256 } from "@/lib/plan-engine/estimateInputsKey";
import {
  getMaterializedPlanEstimate,
  upsertMaterializedPlanEstimate,
  type MaterializedEstimatePayload,
} from "@/lib/plan-engine/materializedEstimateStore";
import { estimateTrueCost } from "@/lib/plan-engine/estimateTrueCost";

function toMaterializedPayload(est: any): MaterializedEstimatePayload {
  const statusRaw = String(est?.status ?? "NOT_IMPLEMENTED").trim().toUpperCase();
  const status =
    statusRaw === "OK" ||
    statusRaw === "APPROXIMATE" ||
    statusRaw === "MISSING_USAGE" ||
    statusRaw === "MISSING_TEMPLATE" ||
    statusRaw === "NOT_COMPUTABLE" ||
    statusRaw === "NOT_IMPLEMENTED"
      ? (statusRaw as any)
      : ("NOT_IMPLEMENTED" as const);

  return {
    status,
    reason: typeof est?.reason === "string" ? est.reason : null,
    annualCostDollars: typeof est?.annualCostDollars === "number" && Number.isFinite(est.annualCostDollars) ? est.annualCostDollars : null,
    monthlyCostDollars:
      typeof est?.monthlyCostDollars === "number" && Number.isFinite(est.monthlyCostDollars) ? est.monthlyCostDollars : null,
    effectiveCentsPerKwh:
      typeof est?.effectiveCentsPerKwh === "number" && Number.isFinite(est.effectiveCentsPerKwh) ? est.effectiveCentsPerKwh : null,
    confidence: (est?.confidence as any) ?? null,
    componentsV2: (est as any)?.componentsV2 ?? null,
    tdspRatesApplied: (est as any)?.tdspRatesApplied ?? null,
  };
}

/**
 * Canonical get-or-compute wrapper for customer-facing estimate calls.
 *
 * - Reads `PlanEstimateMaterialized` first (single source of truth)
 * - If missing, computes using `estimateTrueCost()` and upserts the materialized row (best-effort)
 */
export async function getOrComputeMaterializedPlanEstimate(args: {
  houseAddressId: string;
  ratePlanId: string;
  monthsCount: number;
  annualKwh: number;
  tdsp: { perKwhDeliveryChargeCents: number; monthlyCustomerChargeDollars: number; effectiveDate: string | null };
  rateStructure: any;
  yearMonths: string[];
  requiredBucketKeys: string[];
  usageBucketsByMonth: Record<string, Record<string, number>>;
  estimateMode: "DEFAULT" | "INDEXED_EFL_ANCHOR_APPROX";
  // Optional caching policy (pipeline uses 30d; customer detail/compare can reuse that).
  expiresAt?: Date | null;
}): Promise<{ inputsSha256: string; payload: MaterializedEstimatePayload; source: "MATERIALIZED" | "COMPUTED" }> {
  const monthsCount = Math.max(1, Math.floor(Number(args.monthsCount ?? 12) || 12));
  const { inputsSha256 } = makePlanEstimateInputsSha256({
    monthsCount,
    annualKwh: args.annualKwh,
    tdsp: args.tdsp,
    rateStructure: args.rateStructure,
    yearMonths: args.yearMonths,
    requiredBucketKeys: Array.isArray(args.requiredBucketKeys) ? args.requiredBucketKeys : [],
    usageBucketsByMonth: args.usageBucketsByMonth ?? {},
    estimateMode: args.estimateMode,
  });

  const existing = await getMaterializedPlanEstimate({
    houseAddressId: args.houseAddressId,
    ratePlanId: args.ratePlanId,
    inputsSha256,
  });
  if (existing) return { inputsSha256, payload: existing, source: "MATERIALIZED" };

  const est = estimateTrueCost({
    annualKwh: args.annualKwh,
    monthsCount,
    tdspRates: {
      perKwhDeliveryChargeCents: args.tdsp.perKwhDeliveryChargeCents,
      monthlyCustomerChargeDollars: args.tdsp.monthlyCustomerChargeDollars,
      effectiveDate: args.tdsp.effectiveDate,
    },
    rateStructure: args.rateStructure,
    usageBucketsByMonth: args.usageBucketsByMonth,
    estimateMode: args.estimateMode,
  });

  const payload = toMaterializedPayload(est);
  // Best-effort write: never fail the request if DB is temporarily unavailable.
  await upsertMaterializedPlanEstimate({
    houseAddressId: args.houseAddressId,
    ratePlanId: args.ratePlanId,
    inputsSha256,
    monthsCount,
    computedAt: new Date(),
    expiresAt: args.expiresAt ?? null,
    payload,
  });

  return { inputsSha256, payload, source: "COMPUTED" };
}

