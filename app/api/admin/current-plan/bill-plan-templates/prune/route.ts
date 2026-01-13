import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth/requireAdmin";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";

export const dynamic = "force-dynamic";

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function asUpper(x: unknown): string {
  return String(x ?? "").trim().toUpperCase();
}

function isValidTouTier(t: any): boolean {
  const start = typeof t?.start === "string" ? t.start.trim() : "";
  const end = typeof t?.end === "string" ? t.end.trim() : "";
  const cents = typeof t?.cents === "number" && Number.isFinite(t.cents) ? t.cents : null;
  return Boolean(start && end && cents != null);
}

function isValidEnergyTier(t: any): boolean {
  const cents = typeof t?.rateCentsPerKwh === "number" && Number.isFinite(t.rateCentsPerKwh) ? t.rateCentsPerKwh : null;
  return cents != null && cents > 0 && cents < 500;
}

/**
 * Prune "bad" BillPlanTemplate rows for the current-plan module.
 *
 * Contract:
 * - Only *computable* templates should remain (templates are meant to be reusable engine inputs).
 * - We delete only obviously non-computable templates:
 *   - TIME_OF_USE with missing/empty/invalid `timeOfUseConfigJson`
 *   - FIXED/VARIABLE with missing/empty/invalid `energyRateTiersJson`
 *   - missing providerNameKey/planNameKey
 *
 * This route is admin-gated (x-admin-token) when ADMIN_TOKEN is configured.
 */
export async function POST(req: NextRequest) {
  const unauthorized = guardAdmin(req);
  if (unauthorized) return unauthorized;

  if (!process.env.CURRENT_PLAN_DATABASE_URL) {
    return NextResponse.json({ ok: false, error: "CURRENT_PLAN_DATABASE_URL not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun !== false; // default true
  const limit = Math.max(1, Math.min(5000, Number(body?.limit) || 2000));

  const currentPlanPrisma = getCurrentPlanPrisma() as any;
  const delegate = currentPlanPrisma.billPlanTemplate as any;

  const rows = await delegate.findMany({
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  const bad = (rows ?? []).filter((t: any) => {
    const providerKey = String(t?.providerNameKey ?? "").trim();
    const planKey = String(t?.planNameKey ?? "").trim();
    if (!providerKey || !planKey) return true;

    const rt = asUpper(t?.rateType);
    if (rt === "TIME_OF_USE") {
      const tiers = Array.isArray(t?.timeOfUseConfigJson) ? t.timeOfUseConfigJson : [];
      if (tiers.length === 0) return true;
      // Must have at least one structurally-valid tier (start/end/cents).
      if (!tiers.some((x: any) => isValidTouTier(x))) return true;
      return false;
    }

    if (rt === "FIXED" || rt === "VARIABLE") {
      const tiers = Array.isArray(t?.energyRateTiersJson) ? t.energyRateTiersJson : [];
      if (tiers.length === 0) return true;
      if (!tiers.some((x: any) => isValidEnergyTier(x))) return true;
      return false;
    }

    // Unknown rate types aren't safe to reuse as templates.
    if (!isNonEmptyString(t?.rateType)) return true;
    return true;
  });

  const ids = bad.map((t: any) => String(t.id));
  const preview = bad.slice(0, 50).map((t: any) => ({
    id: String(t.id),
    providerNameKey: String(t.providerNameKey ?? ""),
    planNameKey: String(t.planNameKey ?? ""),
    providerName: (t.providerName as string | null) ?? null,
    planName: (t.planName as string | null) ?? null,
    rateType: (t.rateType as string | null) ?? null,
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : null,
  }));

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      scanned: (rows ?? []).length,
      wouldDelete: ids.length,
      preview,
    });
  }

  let deleted = 0;
  if (ids.length > 0) {
    const r = await delegate.deleteMany({ where: { id: { in: ids } } });
    deleted = typeof r?.count === "number" ? r.count : ids.length;
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    scanned: (rows ?? []).length,
    deleted,
    deletedIdsPreview: ids.slice(0, 50),
  });
}

