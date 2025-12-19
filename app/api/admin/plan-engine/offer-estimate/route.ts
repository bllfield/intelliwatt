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

  // If estimation is blocked, queue for admin review (PLAN_CALC_QUARANTINE).
  // This is admin-only visibility; it does not change dashboard semantics.
  try {
    const estStatus = String(res?.estimate?.status ?? "");
    const reason = String(res?.estimate?.reason ?? "").trim();
    const isBlocked = estStatus && estStatus !== "OK";
    if (isBlocked && res?.ratePlan?.id) {
      const rp = await prisma.ratePlan.findUnique({
        where: { id: String(res.ratePlan.id) },
        select: {
          id: true,
          eflPdfSha256: true,
          repPuctCertificate: true,
          eflVersionCode: true,
          eflUrl: true,
          supplier: true,
          planName: true,
          termMonths: true,
          utilityId: true,
          rateStructure: true,
        } as any,
      });
      const sha = String((rp as any)?.eflPdfSha256 ?? "").trim();
      if (sha) {
        await (prisma as any).eflParseReviewQueue.upsert({
          where: { eflPdfSha256: sha },
          create: {
            source: "admin_estimate",
            kind: "PLAN_CALC_QUARANTINE",
            dedupeKey: `plan_calc:${String(rp?.id ?? "")}`,
            ratePlanId: rp?.id ?? null,
            eflPdfSha256: sha,
            repPuctCertificate: (rp as any)?.repPuctCertificate ?? null,
            eflVersionCode: (rp as any)?.eflVersionCode ?? null,
            offerId,
            supplier: (rp as any)?.supplier ?? null,
            planName: (rp as any)?.planName ?? null,
            eflUrl: (rp as any)?.eflUrl ?? null,
            tdspName: (rp as any)?.utilityId ?? null,
            termMonths: (rp as any)?.termMonths ?? null,
            planRules: null,
            rateStructure: (rp as any)?.rateStructure ?? null,
            validation: null,
            derivedForValidation: null,
            finalStatus: "NEEDS_REVIEW",
            queueReason: reason ? `ESTIMATE_BLOCKED: ${reason}` : "ESTIMATE_BLOCKED",
            solverApplied: null,
            resolvedAt: null,
            resolvedBy: null,
            resolutionNotes: null,
          },
          update: {
            kind: "PLAN_CALC_QUARANTINE",
            dedupeKey: `plan_calc:${String(rp?.id ?? "")}`,
            ratePlanId: rp?.id ?? null,
            offerId,
            supplier: (rp as any)?.supplier ?? null,
            planName: (rp as any)?.planName ?? null,
            eflUrl: (rp as any)?.eflUrl ?? null,
            tdspName: (rp as any)?.utilityId ?? null,
            termMonths: (rp as any)?.termMonths ?? null,
            rateStructure: (rp as any)?.rateStructure ?? null,
            finalStatus: "NEEDS_REVIEW",
            queueReason: reason ? `ESTIMATE_BLOCKED: ${reason}` : "ESTIMATE_BLOCKED",
            resolvedAt: null,
            resolvedBy: null,
            resolutionNotes: null,
          },
        });
      }
    }
  } catch {
    // ignore (never block admin estimate)
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

