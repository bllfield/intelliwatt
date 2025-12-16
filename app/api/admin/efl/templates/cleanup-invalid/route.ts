import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type Body = {
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

    const where: any = {
      isUtilityTariff: false,
      rateStructure: { not: null },
      OR: [
        { supplier: null },
        { planName: null },
        { termMonths: null },
        { eflVersionCode: null },
      ],
    };

    const total = await (prisma as any).ratePlan.count({ where });

    if (body.dryRun === true) {
      return NextResponse.json({ ok: true, dryRun: true, wouldInvalidate: total });
    }

    const issue = [
      {
        code: "TEMPLATE_INVALIDATED_MISSING_FIELDS",
        severity: "ERROR",
        message:
          "Template invalidated automatically: missing supplier/planName/termMonths/eflVersionCode.",
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
      matched: total,
      invalidated: Number(updated?.count ?? 0) || 0,
    });
  } catch (e) {
    return jsonError(500, "Unexpected error cleaning up invalid templates", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}


