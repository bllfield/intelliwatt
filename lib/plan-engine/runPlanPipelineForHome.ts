import crypto from "node:crypto";

import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers } from "@/lib/wattbuy/normalize";
import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipelineNoStore } from "@/lib/efl/runEflPipelineNoStore";
import { validatePlanRules } from "@/lib/efl/planEngine";
import { upsertRatePlanFromEfl } from "@/lib/efl/planPersistence";
import { inferTdspTerritoryFromEflText } from "@/lib/efl/eflValidator";
import { buildUsageBucketsForEstimate } from "@/lib/usage/buildUsageBucketsForEstimate";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { estimateTrueCost } from "@/lib/plan-engine/estimateTrueCost";
import { getCachedPlanEstimate, putCachedPlanEstimate, sha256Hex as sha256HexCache } from "@/lib/plan-engine/planEstimateCache";
import { isComputableOverride } from "@/lib/plan-engine/planCalcOverrides";
import { canComputePlanFromBuckets, derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";
import { getLatestPlanPipelineJob, shouldStartPlanPipelineJob, writePlanPipelineJobSnapshot } from "@/lib/plan-engine/planPipelineJob";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_ENGINE_ESTIMATE_VERSION = "estimateTrueCost_v2";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hashUsageInputs(args: {
  yearMonths: string[];
  bucketKeys: string[];
  usageBucketsByMonth: Record<string, Record<string, number>>;
}): string {
  const h = crypto.createHash("sha256");
  const yearMonths = Array.isArray(args.yearMonths) ? args.yearMonths : [];
  const keys = Array.isArray(args.bucketKeys) ? args.bucketKeys.map(String).filter(Boolean).sort() : [];

  h.update("ym:");
  h.update(yearMonths.join(","));
  h.update("|keys:");
  h.update(keys.join(","));
  h.update("|vals:");
  for (const ym of yearMonths) {
    h.update(ym);
    h.update("{");
    const m = args.usageBucketsByMonth?.[ym] ?? {};
    for (const k of keys) {
      const v = (m as any)[k];
      const n = typeof v === "number" && Number.isFinite(v) ? v : null;
      h.update(k);
      h.update("=");
      h.update(n == null ? "null" : n.toFixed(6));
      h.update(";");
    }
    h.update("}");
  }
  return h.digest("hex");
}

export type RunPlanPipelineForHomeArgs = {
  homeId: string;
  reason: string;
  isRenter?: boolean;
  timeBudgetMs?: number;
  maxTemplateOffers?: number;
  maxEstimatePlans?: number;
  monthlyCadenceDays?: number;
  fallbackCooldownMs?: number;
  proactiveCooldownMs?: number;
};

export type RunPlanPipelineForHomeResult =
  | { ok: true; started: false; reason: string; latestJob?: any }
  | {
      ok: true;
      started: true;
      runId: string;
      durationMs: number;
      templatesProcessed: number;
      templatesLinked: number;
      templatesQueued: number;
      estimatesConsidered: number;
      estimatesComputed: number;
      estimatesAlreadyCached: number;
    }
  | { ok: false; error: string };

export async function runPlanPipelineForHome(args: RunPlanPipelineForHomeArgs): Promise<RunPlanPipelineForHomeResult> {
  const startedAt = Date.now();
  const homeId = String(args.homeId ?? "").trim();
  if (!homeId) return { ok: false, error: "missing_homeId" };

  const reason = String(args.reason ?? "").trim() || "usage_present";
  const timeBudgetMs = clamp(Number(args.timeBudgetMs ?? 12_000) || 12_000, 1500, 25_000);
  const maxTemplateOffers = clamp(Number(args.maxTemplateOffers ?? 4) || 4, 0, 10);
  const maxEstimatePlans = clamp(Number(args.maxEstimatePlans ?? 20) || 20, 0, 50);
  const isRenter = Boolean(args.isRenter ?? false);
  const monthlyCadenceDays = clamp(Number(args.monthlyCadenceDays ?? 30) || 30, 1, 365);
  const cooldownMs =
    reason === "plans_fallback"
      ? clamp(Number(args.fallbackCooldownMs ?? 15 * 60 * 1000) || 15 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000)
      : clamp(Number(args.proactiveCooldownMs ?? 5 * 60 * 1000) || 5 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);

  // Home metadata (needed for WattBuy call + tdspSlug).
  const house = await prisma.houseAddress.findUnique({
    where: { id: homeId },
    select: {
      id: true,
      addressLine1: true,
      addressCity: true,
      addressState: true,
      addressZip5: true,
      esiid: true,
      tdspSlug: true,
      archivedAt: true,
    },
  });
  if (!house || house.archivedAt) return { ok: true, started: false, reason: "no_home" };
  if (
    typeof house.addressLine1 !== "string" ||
    typeof house.addressCity !== "string" ||
    typeof house.addressState !== "string" ||
    typeof house.addressZip5 !== "string" ||
    !house.addressLine1.trim() ||
    !house.addressCity.trim() ||
    !house.addressState.trim() ||
    !house.addressZip5.trim()
  ) {
    return { ok: true, started: false, reason: "missing_address_fields" };
  }

  // "Any usage being present": if we have an SMT interval at all, we consider usage present.
  // (Cadence/lock will prevent thrash.)
  let usageWindowEnd: Date | null = null;
  let usageSource: "SMT" | "GREEN_BUTTON" = "SMT";
  let gbRawId: string | null = null;
  const esiid = typeof house.esiid === "string" && house.esiid.trim() ? house.esiid.trim() : null;
  if (esiid) {
    const latest = await prisma.smtInterval.findFirst({
      where: { esiid },
      orderBy: { ts: "desc" },
      select: { ts: true },
    });
    usageWindowEnd = latest?.ts ?? null;
  }
  if (!usageWindowEnd) {
    try {
      const latestGb = await (usagePrisma as any).greenButtonInterval.findFirst({
        where: { homeId },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true, rawId: true },
      });
      if (latestGb?.timestamp) {
        usageWindowEnd = latestGb.timestamp as Date;
        usageSource = "GREEN_BUTTON";
        gbRawId = typeof latestGb?.rawId === "string" ? latestGb.rawId : null;
      }
    } catch {
      // ignore: lack of GB tables/rows should not throw
    }
  }
  if (!usageWindowEnd) return { ok: true, started: false, reason: "no_usage_yet" };

  const latestJob = await getLatestPlanPipelineJob(homeId);
  const gate = shouldStartPlanPipelineJob({
    latest: latestJob,
    now: new Date(),
    monthlyCadenceDays,
    maxRunningMinutes: 20,
  });
  if (!gate.okToStart) return { ok: true, started: false, reason: gate.reason, latestJob };

  const runId = crypto.randomUUID();
  await writePlanPipelineJobSnapshot({
    v: 1,
    homeId,
    runId,
    status: "RUNNING",
    reason,
    startedAt: new Date().toISOString(),
    cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
    lastCalcWindowEnd: latestJob?.lastCalcWindowEnd ?? null,
    counts: {},
  });

  // ---------------- Step 1: Template mapping (bounded) ----------------
  const raw = await wattbuy.offers({
    address: house.addressLine1,
    city: house.addressCity,
    state: house.addressState,
    zip: house.addressZip5,
    isRenter,
  });
  const normalized = normalizeOffers(raw ?? {});
  const offers = Array.isArray((normalized as any)?.offers) ? ((normalized as any).offers as any[]) : [];
  const offerIds = offers.map((o) => String(o?.offer_id ?? "")).filter(Boolean);

  const existingMaps = await (prisma as any).offerIdRatePlanMap.findMany({
    where: { offerId: { in: offerIds }, ratePlanId: { not: null } },
    select: { offerId: true, ratePlanId: true },
  });
  const mappedOfferIds = new Set<string>((existingMaps as any[]).map((m) => String(m.offerId)));

  let templatesLinked = 0;
  let templatesQueued = 0;
  let templatesProcessed = 0;

  for (const o of offers) {
    if (templatesProcessed >= maxTemplateOffers) break;
    if (Date.now() - startedAt > timeBudgetMs) break;

    const offerId = String(o?.offer_id ?? "").trim();
    if (!offerId) continue;
    if (mappedOfferIds.has(offerId)) continue;
    const eflUrl = String(o?.docs?.efl ?? "").trim();
    templatesProcessed++;

    if (!eflUrl) {
      templatesQueued++;
      continue;
    }

    const pdf = await fetchEflPdfFromUrl(eflUrl, { timeoutMs: 20_000 });
    if (!pdf.ok) {
      templatesQueued++;
      continue;
    }

    const pipeline = await runEflPipelineNoStore({
      pdfBytes: pdf.pdfBytes,
      source: "wattbuy",
      offerMeta: {
        supplier: o?.supplier_name ?? null,
        planName: o?.plan_name ?? null,
        termMonths: typeof o?.term_months === "number" ? o.term_months : null,
        tdspName: o?.distributor_name ?? null,
        offerId,
      },
    });

    const det = pipeline.deterministic;
    const finalValidation = pipeline.finalValidation ?? null;
    const finalStatus: string | null = finalValidation?.status ?? null;
    const passStrength = (pipeline.passStrength ?? null) as any;

    const canAutoTemplate =
      finalStatus === "PASS" &&
      passStrength === "STRONG" &&
      det.eflPdfSha256 &&
      pipeline.planRules &&
      pipeline.rateStructure;

    if (!canAutoTemplate) {
      templatesQueued++;
      continue;
    }

    const planRulesValidation = validatePlanRules(pipeline.planRules as any);
    if (planRulesValidation?.requiresManualReview === true) {
      templatesQueued++;
      continue;
    }

    const modeledAt = new Date();
    const rsWithEvidence =
      pipeline.rateStructure && typeof pipeline.rateStructure === "object"
        ? ({
            ...(pipeline.rateStructure as any),
            __eflAvgPriceValidation: finalValidation ?? null,
            __eflAvgPriceEvidence: {
              computedAt: modeledAt.toISOString(),
              source: "plan_pipeline",
              passStrength: passStrength ?? null,
              tdspAppliedMode: finalValidation?.assumptionsUsed?.tdspAppliedMode ?? null,
            },
          } as any)
        : (pipeline.rateStructure as any);

    const saved = await upsertRatePlanFromEfl({
      mode: "live",
      eflUrl: pdf.pdfUrl,
      eflSourceUrl: eflUrl,
      repPuctCertificate: det.repPuctCertificate ?? null,
      eflVersionCode: det.eflVersionCode ?? null,
      eflPdfSha256: String(det.eflPdfSha256),
      utilityId: inferTdspTerritoryFromEflText(det.rawText) ?? null,
      state: "TX",
      termMonths: typeof o?.term_months === "number" ? o.term_months : null,
      rate500: typeof o?.kwh500_cents === "number" ? o.kwh500_cents : null,
      rate1000: typeof o?.kwh1000_cents === "number" ? o.kwh1000_cents : null,
      rate2000: typeof o?.kwh2000_cents === "number" ? o.kwh2000_cents : null,
      modeledRate500: null,
      modeledRate1000: null,
      modeledRate2000: null,
      modeledEflAvgPriceValidation: finalValidation ?? null,
      modeledComputedAt: modeledAt,
      cancelFee: o?.cancel_fee_text ?? null,
      providerName: o?.supplier_name ?? null,
      planName: o?.plan_name ?? null,
      planRules: pipeline.planRules as any,
      rateStructure: rsWithEvidence as any,
      validation: planRulesValidation as any,
    });

    const ratePlanId = (saved as any)?.ratePlan?.id ? String((saved as any).ratePlan.id) : null;
    const templatePersisted = Boolean((saved as any)?.templatePersisted);
    if (!templatePersisted || !ratePlanId) {
      templatesQueued++;
      continue;
    }

    try {
      await (prisma as any).offerIdRatePlanMap.upsert({
        where: { offerId },
        create: { offerId, ratePlanId, lastLinkedAt: new Date(), linkedBy: "plan_pipeline" },
        update: { ratePlanId, lastLinkedAt: new Date(), linkedBy: "plan_pipeline" },
      });
    } catch {
      // ignore
    }

    templatesLinked++;
    mappedOfferIds.add(offerId);
  }

  // ---------------- Step 2: Estimate cache fill (bounded) ----------------
  const maps2 = await (prisma as any).offerIdRatePlanMap.findMany({
    where: { offerId: { in: offerIds }, ratePlanId: { not: null } },
    select: { offerId: true, ratePlanId: true },
  });
  const ratePlanIds = Array.from(new Set((maps2 as any[]).map((m) => String(m.ratePlanId ?? "")).filter(Boolean)));

  const ratePlans =
    ratePlanIds.length > 0
      ? await (prisma as any).ratePlan.findMany({
          where: { id: { in: ratePlanIds } },
          select: { id: true, rateStructure: true, requiredBucketKeys: true, planCalcStatus: true, planCalcReasonCode: true },
        })
      : [];

  const unionKeys = new Set<string>(["kwh.m.all.total"]);
  for (const rp of ratePlans as any[]) {
    const keys = Array.isArray(rp?.requiredBucketKeys) ? (rp.requiredBucketKeys as string[]) : [];
    for (const k of keys) {
      const kk = String(k ?? "").trim();
      if (kk) unionKeys.add(kk);
    }
    if (!Array.isArray(rp?.requiredBucketKeys) && rp?.rateStructure) {
      const derived = derivePlanCalcRequirementsFromTemplate(rp).requiredBucketKeys ?? [];
      for (const k of derived) {
        const kk = String(k ?? "").trim();
        if (kk) unionKeys.add(kk);
      }
    }
  }

  const usageCutoff = new Date(usageWindowEnd.getTime() - 365 * DAY_MS);
  const bucketBuild = await buildUsageBucketsForEstimate({
    homeId,
    usageSource,
    esiid: usageSource === "SMT" ? esiid : null,
    rawId: usageSource === "GREEN_BUTTON" ? gbRawId : null,
    windowEnd: usageWindowEnd,
    cutoff: usageCutoff,
    requiredBucketKeys: Array.from(unionKeys),
    monthsCount: 12,
    maxStepDays: 2,
    stitchMode: "DAILY_OR_INTERVAL",
  });

  const yearMonthsForCalc = bucketBuild.yearMonths.slice();
  const usageBucketsByMonthForCalc = bucketBuild.usageBucketsByMonth;
  const annualKwhForCalc =
    typeof bucketBuild.annualKwh === "number" && Number.isFinite(bucketBuild.annualKwh) ? bucketBuild.annualKwh : null;

  const tdspSlug = String(house.tdspSlug ?? "").trim().toLowerCase();
  const tdspRates = tdspSlug ? await getTdspDeliveryRates({ tdspSlug, asOf: new Date() }).catch(() => null) : null;

  const tdspPer = Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0;
  const tdspMonthly = Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0;
  const tdspEff = tdspRates?.effectiveDate ?? null;

  const usageSha = hashUsageInputs({
    yearMonths: yearMonthsForCalc,
    bucketKeys: Array.from(unionKeys),
    usageBucketsByMonth: usageBucketsByMonthForCalc,
  });

  let estimatesComputed = 0;
  let estimatesAlreadyCached = 0;
  let estimatesConsidered = 0;

  if (!annualKwhForCalc || !tdspRates) {
    const finished = new Date();
    await writePlanPipelineJobSnapshot({
      v: 1,
      homeId,
      runId,
      status: "DONE",
      reason,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: finished.toISOString(),
      cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
      lastCalcWindowEnd: usageWindowEnd.toISOString(),
      counts: { offersTotal: offers.length, templatesProcessed, templatesLinked, templatesQueued, estimatesComputed, estimatesAlreadyCached },
    });
    return { ok: true, started: true, runId, durationMs: Date.now() - startedAt, templatesProcessed, templatesLinked, templatesQueued, estimatesConsidered: 0, estimatesComputed: 0, estimatesAlreadyCached: 0 };
  }

  for (const rp of ratePlans as any[]) {
    if (estimatesComputed >= maxEstimatePlans) break;
    if (Date.now() - startedAt > timeBudgetMs) break;

    const ratePlanId = String(rp?.id ?? "").trim();
    if (!ratePlanId) continue;
    const rateStructure = rp?.rateStructure ?? null;
    if (!rateStructure) continue;

    const overridden = isComputableOverride(rp?.planCalcStatus, rp?.planCalcReasonCode);
    if (!overridden) {
      const comp = canComputePlanFromBuckets({
        rateStructure,
        requiredBucketKeys: Array.isArray(rp?.requiredBucketKeys) ? rp.requiredBucketKeys : null,
        presentBucketKeys: Array.from(unionKeys),
      } as any);
      if (comp?.status === "NOT_COMPUTABLE") continue;
    }

    const rsSha = sha256HexCache(JSON.stringify(rateStructure ?? null));
    const inputsSha256 = sha256HexCache(
      JSON.stringify({
        v: PLAN_ENGINE_ESTIMATE_VERSION,
        monthsCount: 12,
        annualKwh: Number(annualKwhForCalc.toFixed(6)),
        tdsp: { per: tdspPer, monthly: tdspMonthly, effectiveDate: tdspEff },
        rsSha,
        usageSha,
      }),
    );

    estimatesConsidered++;
    const cached = await getCachedPlanEstimate({ houseAddressId: homeId, ratePlanId, inputsSha256, monthsCount: 12 });
    if (cached) {
      estimatesAlreadyCached++;
      continue;
    }

    const est = estimateTrueCost({
      annualKwh: annualKwhForCalc,
      monthsCount: 12,
      tdspRates: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
      rateStructure,
      usageBucketsByMonth: usageBucketsByMonthForCalc,
    });

    await putCachedPlanEstimate({ houseAddressId: homeId, ratePlanId, esiid: house.esiid ?? null, inputsSha256, monthsCount: 12, payloadJson: est });
    estimatesComputed++;
  }

  const finished = new Date();
  await writePlanPipelineJobSnapshot({
    v: 1,
    homeId,
    runId,
    status: "DONE",
    reason,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: finished.toISOString(),
    cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
    lastCalcWindowEnd: usageWindowEnd.toISOString(),
    counts: { offersTotal: offers.length, templatesProcessed, templatesLinked, templatesQueued, estimatesConsidered, estimatesComputed, estimatesAlreadyCached },
  });

  return {
    ok: true,
    started: true,
    runId,
    durationMs: Date.now() - startedAt,
    templatesProcessed,
    templatesLinked,
    templatesQueued,
    estimatesConsidered,
    estimatesComputed,
    estimatesAlreadyCached,
  };
}


