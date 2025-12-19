import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { computeAnnualKwhForEsiid, estimateOfferFromOfferId, getTdspApplied } from "@/app/api/plan-engine/_shared/estimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail: detail ?? null }, { status });
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json_body");
  }

  const offerId = String(body?.offerId ?? "").trim();
  const homeId = String(body?.homeId ?? "").trim();
  const monthsCountRaw = Number(body?.monthsCount ?? 12);
  const monthsCount = Math.max(1, Math.min(12, Number.isFinite(monthsCountRaw) ? Math.floor(monthsCountRaw) : 12));
  const backfill = body?.backfill === true;

  if (!offerId) return jsonError(400, "missing_offerId");
  if (!homeId) return jsonError(400, "missing_homeId");

  const house = await prisma.houseAddress.findUnique({
    where: { id: homeId } as any,
    select: { id: true, esiid: true, tdspSlug: true },
  });
  if (!house) return jsonError(404, "home_not_found");

  const tdspSlug = String(house.tdspSlug ?? "").trim().toLowerCase() || null;
  const esiid = house.esiid ? String(house.esiid) : null;

  const annualKwh = await computeAnnualKwhForEsiid(esiid);
  if (annualKwh == null) return jsonError(409, "missing_usage_totals", { esiid });

  const tdspApplied = await getTdspApplied(tdspSlug);

  const res = await estimateOfferFromOfferId({
    offerId,
    monthsCount,
    backfill,
    homeId: house.id,
    esiid,
    tdspSlug,
    tdsp: tdspApplied,
    annualKwh,
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error ?? "estimate_failed", offerId }, { status: res.httpStatus ?? 500 });
  }

  return NextResponse.json({
    ok: true,
    offerId,
    homeId,
    tdspSlug,
    esiid,
    monthsCount: res.monthsCount,
    annualKwh: res.annualKwh,
    usageBucketsByMonthIncluded: res.usageBucketsByMonthIncluded,
    backfill: res.backfill,
    detected: res.detected,
    monthsIncluded: res.monthsIncluded,
    ratePlan: res.ratePlan ?? null,
    estimate: res.estimate,
  });
}

