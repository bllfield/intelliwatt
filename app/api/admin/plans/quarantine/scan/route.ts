import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";
import { isPlanCalcQuarantineWorthyReasonCode } from "@/lib/plan-engine/planCalcQuarantine";
import { estimateTrueCost } from "@/lib/plan-engine/estimateTrueCost";
import { buildUsageBucketsForEstimate } from "@/lib/usage/buildUsageBucketsForEstimate";
import { sha256Hex } from "@/lib/plan-engine/planPipelineJob";
import { normalizeEmail } from "@/lib/utils/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

async function resolveHomeIdFromEmail(emailRaw: string): Promise<string | null> {
  const email = normalizeEmail(emailRaw);
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return null;
  const house =
    (await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })) ??
    (await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null } as any,
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }));
  return house?.id ?? null;
}

function uniqStrings(xs: string[]): string[] {
  return Array.from(new Set(xs.map((x) => String(x ?? "").trim()).filter(Boolean)));
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

  const homeIdRaw = String(body?.homeId ?? "").trim();
  const email = String(body?.email ?? "").trim();
  const offerIdsRaw = Array.isArray(body?.offerIds) ? body.offerIds : [];
  const offerIds = uniqStrings(offerIdsRaw);

  const homeId = homeIdRaw || (email ? await resolveHomeIdFromEmail(email) : null);
  if (!homeId) return jsonError(400, "missing_homeId_or_email");
  if (!offerIds.length) return jsonError(400, "missing_offerIds");

  const house = await prisma.houseAddress.findUnique({
    where: { id: homeId } as any,
    select: { id: true, esiid: true, tdspSlug: true },
  });
  if (!house?.id) return jsonError(404, "home_not_found");
  const esiid = house.esiid ? String(house.esiid) : null;
  if (!esiid) return jsonError(409, "missing_esiid_for_home", { homeId });

  // Canonical window end: latest SMT interval timestamp.
  const latest = await prisma.smtInterval.findFirst({
    where: { esiid },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });
  const windowEnd = latest?.ts ?? new Date();
  const cutoff = new Date(windowEnd.getTime() - 365 * DAY_MS);

  // Pull templates via canonical OfferIdRatePlanMap (offerId -> RatePlan.id).
  const maps = await (prisma as any).offerIdRatePlanMap.findMany({
    where: { offerId: { in: offerIds }, ratePlanId: { not: null } },
    select: { offerId: true, ratePlanId: true },
  });
  const mapByOffer = new Map((maps as any[]).map((m: any) => [String(m.offerId), String(m.ratePlanId)]));
  const mappedRatePlanIds = uniqStrings((maps as any[]).map((m: any) => String(m.ratePlanId ?? "")));

  const mappedPlans = mappedRatePlanIds.length
    ? await prisma.ratePlan.findMany({
        where: { id: { in: mappedRatePlanIds } },
        select: { id: true, rateStructure: true } as any,
      })
    : [];
  const mappedById = new Map(mappedPlans.map((r: any) => [String(r.id), r]));

  const resolved: Array<{
    offerId: string;
    ratePlanId: string | null;
    requiredBucketKeys: string[];
  }> = [];

  for (const offerId of offerIds) {
    const ratePlanId = mapByOffer.get(offerId) ?? null;
    const plan = (ratePlanId ? mappedById.get(ratePlanId) : null) ?? null;
    const rateStructure = plan?.rateStructure ?? null;
    const derived = derivePlanCalcRequirementsFromTemplate({ rateStructure });
    const requiredBucketKeys = uniqStrings(Array.isArray(derived?.requiredBucketKeys) ? derived.requiredBucketKeys : []);
    resolved.push({ offerId, ratePlanId, requiredBucketKeys });
  }

  const unionKeys = uniqStrings(resolved.flatMap((r) => r.requiredBucketKeys).concat(["kwh.m.all.total"]));

  // Build stitched buckets once for all required keys.
  const bucketBuild = await buildUsageBucketsForEstimate({
    homeId,
    usageSource: "SMT",
    esiid,
    windowEnd,
    cutoff,
    requiredBucketKeys: unionKeys,
    monthsCount: 12,
    stitchMode: "DAILY_ONLY",
    maxStepDays: 2,
  });

  const annualKwh = bucketBuild.annualKwh;
  if (annualKwh == null) return jsonError(409, "missing_annual_kwh", { homeId, esiid });

  // TDSP rates: the dashboard pipeline already computes these, but admin scan can be conservative and just queue
  // the mismatch/non-deterministic failures without needing TDSP. For completeness we still try to load TDSP.
  const tdspSlug = String(house.tdspSlug ?? "").trim().toLowerCase() || null;
  let tdspRates: any = null;
  try {
    // Lazy import to avoid bundling if not needed in some environments.
    const mod = await import("@/lib/plan-engine/getTdspDeliveryRates");
    tdspRates = tdspSlug ? await mod.getTdspDeliveryRates({ tdspSlug, asOf: windowEnd }).catch(() => null) : null;
  } catch {
    tdspRates = null;
  }

  const results: any[] = [];
  for (const r of resolved) {
    const offerId = r.offerId;
    const ratePlanId = r.ratePlanId;
    const plan = (ratePlanId ? mappedById.get(ratePlanId) : null) ?? null;
    const rateStructure = plan?.rateStructure ?? null;

    const derived = derivePlanCalcRequirementsFromTemplate({ rateStructure });
    const requiredBucketKeys = uniqStrings(Array.isArray(derived?.requiredBucketKeys) ? derived.requiredBucketKeys : []);

    // Fast-path: if this is VARIABLE/INDEXED style, enqueue directly.
    const rsType = String((rateStructure as any)?.type ?? "").trim().toUpperCase();
    const suspectNonDet =
      rsType === "VARIABLE" || rsType === "INDEXED" || rsType === "REAL_TIME" || rsType === "TIME_VARYING";

    let est: any =
      suspectNonDet
        ? { status: "NOT_COMPUTABLE", reason: "NON_DETERMINISTIC_PRICING_INDEXED", notes: [`rateStructure.type=${rsType || "UNKNOWN"}`] }
        : null;

    if (!est) {
      // If TDSP rates are missing, we can still run estimateTrueCost; it will include TDSP=0 and may not match dashboard,
      // but for bucket-sum mismatch detection it's sufficient.
      const tdspApplied = tdspRates
        ? {
            perKwhDeliveryChargeCents: Number(tdspRates.perKwhDeliveryChargeCents ?? 0) || 0,
            monthlyCustomerChargeDollars: Number(tdspRates.monthlyCustomerChargeDollars ?? 0) || 0,
            effectiveDate: tdspRates.effectiveDate ?? null,
          }
        : { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0, effectiveDate: null };

      est = estimateTrueCost({
        annualKwh,
        monthsCount: 12,
        rateStructure,
        usageBucketsByMonth: bucketBuild.usageBucketsByMonth,
        tdspRates: tdspApplied,
      });
    }

    const estStatus = String(est?.status ?? "").trim();
    const estReason = String(est?.reason ?? "").trim();
    const quarantineReasonCode = estReason || estStatus;
    const shouldQueue = estStatus === "NOT_COMPUTABLE" && isPlanCalcQuarantineWorthyReasonCode(quarantineReasonCode);

    if (shouldQueue) {
      const queueReasonPayload = {
        type: "PLAN_CALC_QUARANTINE",
        source: "admin_plans_quarantine_scan",
        estimateStatus: estStatus,
        estimateReason: estReason || null,
        requiredBucketKeys,
        ratePlanId,
        offerId,
      };

      await (prisma as any).eflParseReviewQueue.upsert({
        where: { kind_dedupeKey: { kind: "PLAN_CALC_QUARANTINE", dedupeKey: offerId } },
        create: {
          source: "admin_plans_quarantine_scan",
          kind: "PLAN_CALC_QUARANTINE",
          dedupeKey: offerId,
          eflPdfSha256: sha256Hex(["admin_plans_quarantine_scan", "PLAN_CALC_QUARANTINE", offerId].join("|")),
          offerId,
          supplier: null,
          planName: null,
          eflUrl: null,
          tdspName: tdspSlug,
          termMonths: null,
          ratePlanId,
          rawText: null,
          planRules: null,
          rateStructure: null,
          validation: null,
          derivedForValidation: { requiredBucketKeys, estimate: est },
          finalStatus: "OPEN",
          queueReason: JSON.stringify(queueReasonPayload),
          solverApplied: [],
          resolvedAt: null,
          resolvedBy: null,
          resolutionNotes: estReason || "NOT_COMPUTABLE",
        },
        update: {
          ratePlanId,
          derivedForValidation: { requiredBucketKeys, estimate: est },
          finalStatus: "OPEN",
          queueReason: JSON.stringify(queueReasonPayload),
          resolutionNotes: estReason || "NOT_COMPUTABLE",
        },
      });
    }

    results.push({
      offerId,
      ratePlanId,
      requiredBucketKeys,
      queued: shouldQueue,
      estimate: est,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      homeId,
      esiid,
      windowEnd: windowEnd.toISOString(),
      cutoff: cutoff.toISOString(),
      annualKwh,
      unionRequiredBucketKeys: unionKeys,
      results,
    },
    { status: 200 },
  );
}


