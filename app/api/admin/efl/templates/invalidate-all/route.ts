import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type Body = {
  confirm?: string | null;
  supplierContains?: string | null;
  dryRun?: boolean | null;
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
      body = {};
    }

    const supplierContains = String(body.supplierContains ?? "").trim();
    const where: any = {
      isUtilityTariff: false,
      rateStructure: { not: null },
      ...(supplierContains
        ? { supplier: { contains: supplierContains, mode: "insensitive" } }
        : {}),
    };

    const matched = await (prisma as any).ratePlan.count({ where });

    if (body.dryRun === true) {
      return NextResponse.json({ ok: true, dryRun: true, matched });
    }

    const confirm = String(body.confirm ?? "").trim();
    if (confirm !== "INVALIDATE_ALL_TEMPLATES") {
      return jsonError(
        400,
        'Missing/invalid confirm. To proceed, set confirm="INVALIDATE_ALL_TEMPLATES".',
        { matched },
      );
    }

    const issue = [
      {
        code: "TEMPLATE_INVALIDATED_BULK",
        severity: "ERROR",
        message: "Template invalidated in bulk by admin (rateStructure cleared).",
      },
    ];

    const updated = await (prisma as any).ratePlan.updateMany({
      where,
      data: {
        rateStructure: null,
        eflRequiresManualReview: true,
        eflValidationIssues: issue,
      },
    });

    return NextResponse.json({
      ok: true,
      dryRun: false,
      matched,
      invalidated: Number(updated?.count ?? 0) || 0,
      supplierContains: supplierContains || null,
    });
  } catch (e) {
    return jsonError(500, "Unexpected error invalidating templates (bulk)", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}


