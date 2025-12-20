import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { computeAnnualKwhForEsiid, estimateOfferFromOfferId, getTdspApplied } from "@/app/api/plan-engine/_shared/estimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail: detail ?? null }, { status });
}

function inferTdspSlugFromUtilityId(utilityId: unknown): string | null {
  const u = String(utilityId ?? "").trim().toUpperCase();
  if (!u) return null;
  if (u === "ONCOR") return "oncor";
  if (u === "CENTERPOINT") return "centerpoint";
  if (u === "TNMP") return "tnmp";
  if (u === "AEP_NORTH") return "aep_north";
  if (u === "AEP_CENTRAL") return "aep_central";
  return null;
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
  const backfillField = body?.backfill;
  const backfill =
    backfillField == null ? true : backfillField === true || String(backfillField ?? "").trim().toLowerCase() === "true" || String(backfillField ?? "").trim() === "1";
  const estimateModeParam = String(body?.estimateMode ?? "").trim().toUpperCase();
  const estimateMode =
    estimateModeParam === "INDEXED_EFL_ANCHOR_APPROX" ? ("INDEXED_EFL_ANCHOR_APPROX" as const) : ("DEFAULT" as const);

  if (!offerId) return jsonError(400, "missing_offerId");
  if (!homeId) return jsonError(400, "missing_homeId");

  const house = await prisma.houseAddress.findUnique({
    where: { id: homeId } as any,
    select: { id: true, esiid: true, tdspSlug: true },
  });
  if (!house) return jsonError(404, "home_not_found");

  // TDSP slug is required to apply delivery charges; home records can be missing it.
  // Fallback to the plan's utilityId territory when needed.
  const tdspSlugFromHome = String(house.tdspSlug ?? "").trim().toLowerCase() || null;
  const esiid = house.esiid ? String(house.esiid) : null;

  const annualKwh = await computeAnnualKwhForEsiid(esiid);
  if (annualKwh == null) return jsonError(409, "missing_usage_totals", { esiid });

  // Best-effort: derive TDSP from the offer's RatePlan when home tdspSlug is missing.
  const planTdsp = await prisma.offerIdRatePlanMap.findUnique({
    where: { offerId },
    include: {
      ratePlan: {
        select: {
          utilityId: true,
          modeledEflAvgPriceValidation: true,
        } as any,
      },
    },
  });
  const tdspSlug =
    tdspSlugFromHome ??
    inferTdspSlugFromUtilityId((planTdsp as any)?.ratePlan?.utilityId ?? null) ??
    null;

  let tdspApplied = await getTdspApplied(tdspSlug);

  // If tariff tables aren't populated (or lookup fails), avoid a misleading $0 TDSP by falling back
  // to the EFL-derived TDSP assumption used during modeled validation (when available).
  const isZeroTdsp =
    !tdspApplied ||
    (Number(tdspApplied.perKwhDeliveryChargeCents) === 0 && Number(tdspApplied.monthlyCustomerChargeDollars) === 0);
  if (isZeroTdsp) {
    const assumptions = (planTdsp as any)?.ratePlan?.modeledEflAvgPriceValidation?.assumptionsUsed ?? null;
    const eflTdsp = assumptions?.tdspFromEfl ?? null;
    const perKwhCents = typeof eflTdsp?.perKwhCents === "number" ? eflTdsp.perKwhCents : null;
    const monthlyCents = typeof eflTdsp?.monthlyCents === "number" ? eflTdsp.monthlyCents : null;
    if (perKwhCents != null && monthlyCents != null) {
      tdspApplied = {
        perKwhDeliveryChargeCents: perKwhCents,
        monthlyCustomerChargeDollars: Number((monthlyCents / 100).toFixed(2)),
        effectiveDate: tdspApplied?.effectiveDate,
      };
    }
  }

  const res = await estimateOfferFromOfferId({
    offerId,
    monthsCount,
    autoEnsureBuckets: backfill,
    estimateMode,
    homeId: house.id,
    esiid,
    tdspSlug,
    tdsp: tdspApplied,
    annualKwh,
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error ?? "estimate_failed", offerId }, { status: res.httpStatus ?? 500 });
  }

  // If estimation is blocked for a plan-defect reason, queue for admin review (PLAN_CALC_QUARANTINE).
  // Availability gates (missing intervals/buckets) should NOT create review noise.
  const estStatus = String(res?.estimate?.status ?? "");
  const estReason = String(res?.estimate?.reason ?? "").trim();
  const isBlocked = estStatus && estStatus !== "OK" && estStatus !== "APPROXIMATE";
  const needsReview =
    isBlocked &&
    (estReason.startsWith("UNSUPPORTED_") ||
      estReason.startsWith("NON_DETERMINISTIC_") ||
      estReason === "UNSUPPORTED_BUCKET_KEY");

  try {
    const reason = estReason;
    if (needsReview && res?.ratePlan?.id) {
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
    tdspApplied,
    monthsCount: res.monthsCount,
    annualKwh: res.annualKwh,
    usageBucketsByMonthIncluded: res.usageBucketsByMonthIncluded,
    backfill: res.backfill,
    bucketEnsure: (res as any).bucketEnsure ?? null,
    needsReview,
    detected: res.detected,
    monthsIncluded: res.monthsIncluded,
    ratePlan: res.ratePlan ?? null,
    estimate: res.estimate,
  });
}

