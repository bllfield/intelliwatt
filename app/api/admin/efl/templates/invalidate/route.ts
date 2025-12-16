import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type Body = {
  id?: string | null;
  reason?: string | null;
};

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error, ...(details ? { details } : {}) },
    { status },
  );
}

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const id = String(body.id ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    if (!id) return jsonError(400, "Missing required field: id");

    const existing = await (prisma as any).ratePlan.findUnique({
      where: { id },
      select: {
        id: true,
        isUtilityTariff: true,
        rateStructure: true,
        eflValidationIssues: true,
      },
    });
    if (!existing) return jsonError(404, "RatePlan not found");
    if (existing.isUtilityTariff) {
      return jsonError(400, "Refusing to invalidate utility tariff RatePlan rows.");
    }

    const issues: any[] = Array.isArray(existing.eflValidationIssues)
      ? [...existing.eflValidationIssues]
      : [];
    issues.push({
      code: "TEMPLATE_INVALIDATED_BY_ADMIN",
      severity: "ERROR",
      message: `Template invalidated by admin${reason ? `: ${reason}` : ""}`,
    });

    const updated = await (prisma as any).ratePlan.update({
      where: { id },
      data: {
        rateStructure: null,
        eflRequiresManualReview: true,
        eflValidationIssues: issues,
      },
      select: {
        id: true,
        supplier: true,
        planName: true,
        termMonths: true,
        repPuctCertificate: true,
        eflVersionCode: true,
        eflPdfSha256: true,
        eflRequiresManualReview: true,
        rateStructure: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, ratePlan: updated });
  } catch (e) {
    return jsonError(500, "Unexpected error invalidating template", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}


