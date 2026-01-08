import { prisma } from "@/lib/db";

export type MaterializedEstimateStatus =
  | "OK"
  | "APPROXIMATE"
  | "MISSING_USAGE"
  | "MISSING_TEMPLATE"
  | "NOT_COMPUTABLE"
  | "NOT_IMPLEMENTED";

export type MaterializedEstimatePayload = {
  status: MaterializedEstimateStatus;
  reason?: string | null;
  annualCostDollars?: number | null;
  monthlyCostDollars?: number | null;
  effectiveCentsPerKwh?: number | null;
  confidence?: "LOW" | "MEDIUM" | null;
  componentsV2?: any;
  tdspRatesApplied?: any;
};

export async function getMaterializedPlanEstimate(args: {
  houseAddressId: string;
  ratePlanId: string;
  inputsSha256: string;
}): Promise<MaterializedEstimatePayload | null> {
  const houseAddressId = String(args.houseAddressId ?? "").trim();
  const ratePlanId = String(args.ratePlanId ?? "").trim();
  const inputsSha256 = String(args.inputsSha256 ?? "").trim();
  if (!houseAddressId || !ratePlanId || !inputsSha256) return null;

  try {
    const row = await (prisma as any).planEstimateMaterialized.findFirst({
      where: { houseAddressId, ratePlanId, inputsSha256 },
      orderBy: { updatedAt: "desc" },
      select: {
        status: true,
        reason: true,
        annualCostDollars: true,
        monthlyCostDollars: true,
        effectiveCentsPerKwh: true,
        confidence: true,
        componentsV2: true,
        tdspRatesApplied: true,
      },
    });
    if (!row) return null;
    return {
      status: String(row.status) as MaterializedEstimateStatus,
      reason: row.reason ?? null,
      annualCostDollars: typeof row.annualCostDollars === "number" ? row.annualCostDollars : null,
      monthlyCostDollars: typeof row.monthlyCostDollars === "number" ? row.monthlyCostDollars : null,
      effectiveCentsPerKwh: typeof row.effectiveCentsPerKwh === "number" ? row.effectiveCentsPerKwh : null,
      confidence: (row.confidence as any) ?? null,
      componentsV2: (row as any).componentsV2 ?? null,
      tdspRatesApplied: (row as any).tdspRatesApplied ?? null,
    };
  } catch {
    return null;
  }
}

export async function upsertMaterializedPlanEstimate(args: {
  houseAddressId: string;
  ratePlanId: string;
  inputsSha256: string;
  monthsCount: number;
  payload: MaterializedEstimatePayload;
  computedAt?: Date;
  expiresAt?: Date | null;
}): Promise<void> {
  const houseAddressId = String(args.houseAddressId ?? "").trim();
  const ratePlanId = String(args.ratePlanId ?? "").trim();
  const inputsSha256 = String(args.inputsSha256 ?? "").trim();
  const monthsCount = Math.max(1, Math.floor(Number(args.monthsCount ?? 12) || 12));
  if (!houseAddressId || !ratePlanId || !inputsSha256) return;

  const computedAt = args.computedAt instanceof Date ? args.computedAt : new Date();
  const expiresAt = args.expiresAt === null ? null : args.expiresAt instanceof Date ? args.expiresAt : null;
  const p = args.payload ?? ({ status: "NOT_IMPLEMENTED" } as any);

  try {
    await (prisma as any).planEstimateMaterialized.upsert({
      where: { houseAddressId_ratePlanId_inputsSha256: { houseAddressId, ratePlanId, inputsSha256 } },
      create: {
        houseAddressId,
        ratePlanId,
        inputsSha256,
        monthsCount,
        status: String(p.status),
        reason: p.reason ?? null,
        annualCostDollars: p.annualCostDollars ?? null,
        monthlyCostDollars: p.monthlyCostDollars ?? null,
        effectiveCentsPerKwh: p.effectiveCentsPerKwh ?? null,
        confidence: p.confidence ?? null,
        componentsV2: p.componentsV2 ?? null,
        tdspRatesApplied: p.tdspRatesApplied ?? null,
        computedAt,
        expiresAt,
      },
      update: {
        monthsCount,
        status: String(p.status),
        reason: p.reason ?? null,
        annualCostDollars: p.annualCostDollars ?? null,
        monthlyCostDollars: p.monthlyCostDollars ?? null,
        effectiveCentsPerKwh: p.effectiveCentsPerKwh ?? null,
        confidence: p.confidence ?? null,
        componentsV2: p.componentsV2 ?? null,
        tdspRatesApplied: p.tdspRatesApplied ?? null,
        computedAt,
        expiresAt,
      },
    });
  } catch {
    // best-effort: never break callers
  }
}

