import crypto from "node:crypto";

export const PLAN_ENGINE_ESTIMATE_VERSION = "estimateTrueCost_v4";

export type UsageBucketsByMonth = Record<string, Record<string, number>>;

export function sha256HexCache(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function hashUsageInputs(args: {
  yearMonths: string[];
  bucketKeys: string[];
  usageBucketsByMonth: UsageBucketsByMonth;
}): string {
  const h = crypto.createHash("sha256");
  const yearMonths = Array.isArray(args.yearMonths) ? args.yearMonths : [];
  const keys = Array.isArray(args.bucketKeys) ? args.bucketKeys.map(String).filter(Boolean).sort() : [];

  h.update("ym:");
  h.update(yearMonths.join(","));
  h.update("|keys:");
  h.update(keys.join(","));
  h.update("|vals:");
  for (const ym of yearMonths) {
    h.update(ym);
    h.update("{");
    const m = args.usageBucketsByMonth?.[ym] ?? {};
    for (const k of keys) {
      const v = (m as any)[k];
      const n = typeof v === "number" && Number.isFinite(v) ? v : null;
      h.update(k);
      h.update("=");
      h.update(n == null ? "null" : n.toFixed(6));
      h.update(";");
    }
    h.update("}");
  }
  return h.digest("hex");
}

export function makePlanEstimateInputsSha256(args: {
  monthsCount: number;
  annualKwh: number;
  tdsp: { perKwhDeliveryChargeCents: number; monthlyCustomerChargeDollars: number; effectiveDate: string | null };
  rateStructure: any;
  yearMonths: string[];
  requiredBucketKeys: string[];
  usageBucketsByMonth: UsageBucketsByMonth;
  estimateMode: "DEFAULT" | "INDEXED_EFL_ANCHOR_APPROX";
}): { inputsSha256: string; rsSha: string; usageSha: string } {
  const monthsCount = Math.max(1, Math.floor(Number(args.monthsCount ?? 12) || 12));
  const annualKwh = Number(args.annualKwh);
  const tdspPer = Number(args.tdsp?.perKwhDeliveryChargeCents ?? 0) || 0;
  const tdspMonthly = Number(args.tdsp?.monthlyCustomerChargeDollars ?? 0) || 0;
  const tdspEff = args.tdsp?.effectiveDate ?? null;
  const estimateMode = args.estimateMode === "INDEXED_EFL_ANCHOR_APPROX" ? "INDEXED_EFL_ANCHOR_APPROX" : "DEFAULT";

  const rsSha = sha256HexCache(JSON.stringify(args.rateStructure ?? null));
  const usageSha = hashUsageInputs({
    yearMonths: Array.isArray(args.yearMonths) ? args.yearMonths : [],
    bucketKeys: Array.from(new Set(["kwh.m.all.total", ...(Array.isArray(args.requiredBucketKeys) ? args.requiredBucketKeys : [])])),
    usageBucketsByMonth: args.usageBucketsByMonth ?? {},
  });

  const inputsSha256 = sha256HexCache(
    JSON.stringify({
      v: PLAN_ENGINE_ESTIMATE_VERSION,
      monthsCount,
      annualKwh: Number(Number.isFinite(annualKwh) ? annualKwh.toFixed(6) : 0),
      tdsp: { per: tdspPer, monthly: tdspMonthly, effectiveDate: tdspEff },
      rsSha,
      usageSha,
      estimateMode,
    }),
  );

  return { inputsSha256, rsSha, usageSha };
}

