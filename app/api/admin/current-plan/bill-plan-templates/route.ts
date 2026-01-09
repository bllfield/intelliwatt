import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) return jsonError(500, "ADMIN_TOKEN not configured");

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== adminToken) return jsonError(401, "Unauthorized");

    if (!process.env.CURRENT_PLAN_DATABASE_URL) {
      return jsonError(500, "CURRENT_PLAN_DATABASE_URL is not configured");
    }

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || "100");
    const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100));
    const q = (url.searchParams.get("q") || "").trim();

    const currentPlanPrisma = getCurrentPlanPrisma() as any;
    const delegate = currentPlanPrisma.billPlanTemplate as any;

    const where: any = {};
    if (q) {
      where.OR = [
        { providerName: { contains: q, mode: "insensitive" } },
        { planName: { contains: q, mode: "insensitive" } },
        { providerNameKey: { contains: q.toUpperCase(), mode: "insensitive" } },
        { planNameKey: { contains: q.toUpperCase(), mode: "insensitive" } },
      ];
    }

    const rows = await delegate.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    const templates = (rows ?? []).map((t: any) => ({
      id: String(t.id),
      providerNameKey: String(t.providerNameKey ?? ""),
      planNameKey: String(t.planNameKey ?? ""),
      providerName: (t.providerName as string | null) ?? null,
      planName: (t.planName as string | null) ?? null,
      rateType: (t.rateType as string | null) ?? null,
      variableIndexType: (t.variableIndexType as string | null) ?? null,
      termMonths: typeof t.termMonths === "number" ? t.termMonths : null,
      earlyTerminationFeeCents: typeof t.earlyTerminationFeeCents === "number" ? t.earlyTerminationFeeCents : null,
      baseChargeCentsPerMonth: typeof t.baseChargeCentsPerMonth === "number" ? t.baseChargeCentsPerMonth : null,
      hasTimeOfUse: Boolean(t.timeOfUseConfigJson),
      hasBillCredits: Boolean(t.billCreditsJson),
      updatedAt: (t.updatedAt as Date).toISOString(),
      createdAt: (t.createdAt as Date).toISOString(),
    }));

    return NextResponse.json({ ok: true, limit, count: templates.length, templates });
  } catch (e) {
    console.error("[admin/current-plan/bill-plan-templates] Failed to load templates", e);
    return jsonError(500, "Failed to load bill plan templates");
  }
}

