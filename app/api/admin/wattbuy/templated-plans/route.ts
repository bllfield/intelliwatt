import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type Row = {
  id: string;
  utilityId: string;
  state: string;
  supplier: string | null;
  planName: string | null;
  termMonths: number | null;
  rate500: number | null;
  rate1000: number | null;
  rate2000: number | null;
  cancelFee: string | null;
  eflUrl: string | null;
  eflPdfSha256: string | null;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  eflRequiresManualReview: boolean;
  updatedAt: string;
  lastSeenAt: string;
  rateStructure: unknown;
};

type Ok = {
  ok: true;
  count: number;
  rows: Row[];
};

type Err = { ok: false; error: string; details?: unknown };

function jsonError(status: number, error: string, details?: unknown) {
  const body: Err = { ok: false, error, ...(details ? { details } : {}) };
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "200");
    const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 200));

    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

    const where: any = {
      // “Templated” means we already have a usable engine structure persisted.
      rateStructure: { not: null },
      eflRequiresManualReview: false,
      isUtilityTariff: false,
      ...(q
        ? {
            OR: [
              { supplier: { contains: q, mode: "insensitive" } },
              { planName: { contains: q, mode: "insensitive" } },
              { eflVersionCode: { contains: q, mode: "insensitive" } },
              { repPuctCertificate: { contains: q, mode: "insensitive" } },
              { eflPdfSha256: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const plans = await (prisma as any).ratePlan.findMany({
      where,
      select: {
        id: true,
        utilityId: true,
        state: true,
        supplier: true,
        planName: true,
        termMonths: true,
        rate500: true,
        rate1000: true,
        rate2000: true,
        cancelFee: true,
        eflUrl: true,
        eflPdfSha256: true,
        repPuctCertificate: true,
        eflVersionCode: true,
        eflRequiresManualReview: true,
        isUtilityTariff: true,
        updatedAt: true,
        lastSeenAt: true,
        rateStructure: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
    });

    const rows: Row[] = (plans as any[]).map((p) => ({
      id: p.id,
      utilityId: p.utilityId,
      state: p.state,
      supplier: p.supplier ?? null,
      planName: p.planName ?? null,
      termMonths: p.termMonths ?? null,
      rate500: typeof p.rate500 === "number" ? p.rate500 : null,
      rate1000: typeof p.rate1000 === "number" ? p.rate1000 : null,
      rate2000: typeof p.rate2000 === "number" ? p.rate2000 : null,
      cancelFee: p.cancelFee ?? null,
      eflUrl: p.eflUrl ?? null,
      eflPdfSha256: p.eflPdfSha256 ?? null,
      repPuctCertificate: p.repPuctCertificate ?? null,
      eflVersionCode: p.eflVersionCode ?? null,
      eflRequiresManualReview: Boolean(p.eflRequiresManualReview),
      updatedAt: new Date(p.updatedAt).toISOString(),
      lastSeenAt: new Date(p.lastSeenAt).toISOString(),
      rateStructure: p.rateStructure ?? null,
    }));

    const body: Ok = { ok: true, count: rows.length, rows };
    return NextResponse.json(body);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_WATTBUY_TEMPLATED_PLANS] error:", err);
    return jsonError(500, "Internal error while listing templated plans", err?.message);
  }
}


