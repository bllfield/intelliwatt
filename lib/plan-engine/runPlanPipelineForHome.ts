import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { wattbuyOffersPrisma } from "@/lib/db/wattbuyOffersClient";
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
import { PLAN_ENGINE_ESTIMATE_VERSION, makePlanEstimateInputsSha256 } from "@/lib/plan-engine/estimateInputsKey";
import { upsertMaterializedPlanEstimate } from "@/lib/plan-engine/materializedEstimateStore";
import { isComputableOverride } from "@/lib/plan-engine/planCalcOverrides";
import { derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";
import { isPlanCalcQuarantineWorthyReasonCode } from "@/lib/plan-engine/planCalcQuarantine";
import { getLatestPlanPipelineJob, shouldStartPlanPipelineJob, writePlanPipelineJobSnapshot } from "@/lib/plan-engine/planPipelineJob";
import { Prisma } from "@prisma/client";
import { currentPlanPrisma } from "@/lib/db/currentPlanClient";
import { computeMonthsRemainingOnContract } from "@/lib/current-plan/contractTerm";

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function isMissingRateStructure(v: any): boolean {
  if (v == null) return true;
  // Prisma JSON null sentinels (defensive; different clients represent these slightly differently).
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (typeof Prisma === "object" && (v === (Prisma as any).DbNull || v === (Prisma as any).JsonNull || v === (Prisma as any).AnyNull)) {
    return true;
  }
  return false;
}

function isRateStructurePresent(v: any): boolean {
  if (v == null) return false;
  if (isMissingRateStructure(v)) return false;
  if (typeof v !== "object") return false;
  try {
    return Object.keys(v as any).length > 0;
  } catch {
    return true;
  }
}

function daysUntil(a: Date, b: Date): number | null {
  const t0 = a?.getTime?.();
  const t1 = b?.getTime?.();
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return Math.ceil((t1 - t0) / DAY_MS);
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
  const timeBudgetMsRaw = Number(args.timeBudgetMs ?? 12_000);
  const timeBudgetMs = clamp(Number.isFinite(timeBudgetMsRaw) ? timeBudgetMsRaw : 12_000, 1500, 25_000);
  const maxTemplateOffersRaw = Number(args.maxTemplateOffers ?? 4);
  const maxTemplateOffers = clamp(Number.isFinite(maxTemplateOffersRaw) ? Math.trunc(maxTemplateOffersRaw) : 4, 0, 10);
  const maxEstimatePlansRaw = Number(args.maxEstimatePlans ?? 20);
  const maxEstimatePlans = clamp(Number.isFinite(maxEstimatePlansRaw) ? Math.trunc(maxEstimatePlansRaw) : 20, 0, 200);
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
      userId: true,
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
  // Only enforce the 30-day cadence for explicit monthly refresh runs.
  // For user-facing triggers (dashboard bootstrap / plans fallback), allow repeated runs to finish mapping + cache fill.
  const enforceCadence = reason === "monthly_refresh";
  const gate = shouldStartPlanPipelineJob({
    latest: latestJob,
    now: new Date(),
    monthlyCadenceDays,
    // Vercel maxDuration is 5 minutes for our pipeline routes. If a job stays RUNNING longer than a few minutes,
    // it is almost certainly stale (killed/timeout) and should not block auto-recovery/auto-queueing.
    maxRunningMinutes: 3,
    requiredCalcVersion: PLAN_ENGINE_ESTIMATE_VERSION,
    enforceCadence,
  });
  if (!gate.okToStart) return { ok: true, started: false, reason: gate.reason, latestJob };

  const runId = crypto.randomUUID();
  const runningStartedAtIso = new Date().toISOString();

  try {
    await writePlanPipelineJobSnapshot({
      v: 1,
      homeId,
      runId,
      status: "RUNNING",
      reason,
      calcVersion: PLAN_ENGINE_ESTIMATE_VERSION,
      startedAt: runningStartedAtIso,
      cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
      lastCalcWindowEnd: latestJob?.lastCalcWindowEnd ?? null,
      counts: {},
    });

  // ---------------- Step 1: Template mapping (bounded) ----------------
  // Prefer cached offers payload in the WattBuy offers module DB; live calls can hang on cold starts.
  const raw = await (async () => {
    const OFFERS_ENDPOINT = "PLAN_PIPELINE_WATTBUY_OFFERS_V1";
    const OFFERS_TTL_MS = 15 * 60 * 1000;
    // IMPORTANT: this cache key must include any upstream flags that change the offers set.
    // We historically expect the "full" set (all=true). If the key omits that, we can
    // accidentally pin a small default subset (e.g. 7 offers) until TTL expires.
    const requestKey = `offers_by_address_v2|line1=${house.addressLine1}|city=${house.addressCity}|state=${house.addressState}|zip=${house.addressZip5}|isRenter=${String(
      isRenter,
    )}|all=true`;

    try {
      const cached = await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.findFirst({
        where: { endpoint: OFFERS_ENDPOINT, houseAddressId: house.id, requestKey },
        orderBy: { createdAt: "desc" },
        select: { payloadJson: true, fetchedAt: true },
      });
      const cachedAt = cached?.fetchedAt instanceof Date ? cached.fetchedAt : null;
      const cachedFresh =
        cachedAt != null && Date.now() - cachedAt.getTime() <= OFFERS_TTL_MS && cached?.payloadJson != null;
      if (cachedFresh) return (cached as any)?.payloadJson ?? null;
    } catch {
      // ignore cache read errors
    }

    // Live call with a hard timeout so we don't leave the job stuck RUNNING.
    const live = await Promise.race([
      wattbuy.offers({
        address: house.addressLine1,
        city: house.addressCity,
        state: house.addressState,
        zip: house.addressZip5,
        isRenter,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("wattbuy_offers_timeout")), 12_000)),
    ]);

    // Best-effort cache write.
    try {
      await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.create({
        data: {
          fetchedAt: new Date(),
          endpoint: OFFERS_ENDPOINT,
          houseAddressId: house.id,
          requestKey,
          payloadJson: (live as any) ?? { __emptyPayload: true },
          payloadSha256: sha256HexCache(JSON.stringify({ v: 1, requestKey })),
        },
      });
    } catch {
      // ignore
    }

    return live as any;
  })();
  const normalized = normalizeOffers(raw ?? {});
  const offers = Array.isArray((normalized as any)?.offers) ? ((normalized as any).offers as any[]) : [];
  const offerIds = offers.map((o) => String(o?.offer_id ?? "")).filter(Boolean);
  const offerMetaById = new Map<
    string,
    {
      supplier: string | null;
      planName: string | null;
      eflUrl: string | null;
      tdspName: string | null;
      termMonths: number | null;
      utilityId: string | null;
    }
  >();
  for (const o of offers) {
    const oid = String(o?.offer_id ?? "").trim();
    if (!oid) continue;
    offerMetaById.set(oid, {
      supplier: o?.supplier_name != null ? String(o.supplier_name) : null,
      planName: o?.plan_name != null ? String(o.plan_name) : null,
      eflUrl: o?.docs?.efl != null ? String(o.docs.efl) : null,
      tdspName: o?.distributor_name != null ? String(o.distributor_name) : null,
      termMonths: typeof o?.term_months === "number" && Number.isFinite(o.term_months) ? o.term_months : null,
      utilityId: o?.utility_id != null ? String(o.utility_id) : null,
    });
  }

  const existingMaps = await (prisma as any).offerIdRatePlanMap.findMany({
    where: { offerId: { in: offerIds }, ratePlanId: { not: null } },
    select: { offerId: true, ratePlanId: true },
  });
  const mappedOfferIds = new Set<string>((existingMaps as any[]).map((m) => String(m.offerId)));

  // Repair mode: allow templating even if mapped, when the mapped RatePlan is missing `rateStructure`.
  const mappedRatePlanIds = Array.from(
    new Set(
      (existingMaps as Array<{ ratePlanId: string | null }>)
        .map((m) => (m?.ratePlanId != null ? String(m.ratePlanId) : ""))
        .filter(Boolean),
    ),
  );
  const mappedRatePlans =
    mappedRatePlanIds.length > 0
      ? await (prisma as any).ratePlan.findMany({
          where: { id: { in: mappedRatePlanIds } },
          select: { id: true, rateStructure: true },
        })
      : [];
  const rpById = new Map<string, any>((mappedRatePlans as any[]).map((rp) => [String(rp?.id ?? ""), rp]));
  const mappedButEmptyOfferIds = new Set<string>();
  for (const m of existingMaps as any[]) {
    const offerId = String(m?.offerId ?? "").trim();
    const ratePlanId = String(m?.ratePlanId ?? "").trim();
    if (!offerId || !ratePlanId) continue;
    const rp = rpById.get(ratePlanId);
    if (!rp || isMissingRateStructure((rp as any)?.rateStructure)) {
      mappedButEmptyOfferIds.add(offerId);
    }
  }

  let templatesLinked = 0;
  let templatesQueued = 0;
  let templatesProcessed = 0;

  for (const o of offers) {
    if (templatesProcessed >= maxTemplateOffers) break;
    if (Date.now() - startedAt > timeBudgetMs) break;

    const offerId = String(o?.offer_id ?? "").trim();
    if (!offerId) continue;
    if (mappedOfferIds.has(offerId) && !mappedButEmptyOfferIds.has(offerId)) continue;
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

    let pipeline: any = null;
    try {
      pipeline = await runEflPipelineNoStore({
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
    } catch (e: any) {
      // Fail-soft: one bad/unparseable EFL should not crash the whole plan pipeline run.
      templatesQueued++;
      try {
        const supplier = o?.supplier_name ?? null;
        const planName = o?.plan_name ?? null;
        const termMonths = typeof o?.term_months === "number" ? o.term_months : null;
        const tdspName = o?.distributor_name ?? null;
        const msg = e?.message ? String(e.message) : String(e);
        const syntheticSha = sha256HexCache(["plan_pipeline", "EFL_PARSE_EXCEPTION", offerId, eflUrl].join("|"));
        await (prisma as any).eflParseReviewQueue
          .upsert({
            where: { kind_dedupeKey: { kind: "EFL_PARSE", dedupeKey: offerId } },
            create: {
              source: "plan_pipeline",
              kind: "EFL_PARSE",
              dedupeKey: offerId,
              eflPdfSha256: syntheticSha,
              offerId,
              supplier,
              planName,
              eflUrl,
              tdspName,
              termMonths,
              finalStatus: "FAIL",
              queueReason: `EFL pipeline exception: ${msg}`,
              resolvedAt: null,
              resolvedBy: null,
              resolutionNotes: null,
            },
            update: {
              updatedAt: new Date(),
              eflPdfSha256: syntheticSha,
              supplier,
              planName,
              eflUrl,
              tdspName,
              termMonths,
              finalStatus: "FAIL",
              queueReason: `EFL pipeline exception: ${msg}`,
              resolvedAt: null,
              resolvedBy: null,
              resolutionNotes: null,
            },
          })
          .catch(() => null);
      } catch {
        // ignore
      }
      continue;
    }

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

    let saved: any = null;
    try {
      saved = await upsertRatePlanFromEfl({
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
    } catch {
      templatesQueued++;
      continue;
    }

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
    mappedButEmptyOfferIds.delete(offerId);
  }

  // ---------------- Step 2: Estimate cache fill (bounded) ----------------
  // Prefer direct RatePlan.offerId linkage (authoritative for templated plans), but also support OfferIdRatePlanMap.
  const maps2 = await (prisma as any).offerIdRatePlanMap.findMany({
    where: { offerId: { in: offerIds }, ratePlanId: { not: null } },
    select: { offerId: true, ratePlanId: true },
  });
  const offerIdsByRatePlanId = new Map<string, string[]>();
  for (const m of maps2 as any[]) {
    const oid = String(m?.offerId ?? "").trim();
    const rpid = String(m?.ratePlanId ?? "").trim();
    if (!oid || !rpid) continue;
    const arr = offerIdsByRatePlanId.get(rpid) ?? [];
    arr.push(oid);
    offerIdsByRatePlanId.set(rpid, arr);
  }

  const ratePlanIds = Array.from(
    new Set(
      [
        ...(maps2 as any[]).map((m) => String(m?.ratePlanId ?? "")).filter(Boolean),
      ],
    ),
  );

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

    // IMPORTANT:
    // Always include *derived* required bucket keys from the template rateStructure, even if the RatePlan already
    // has stored `requiredBucketKeys`.
    //
    // Why: stored keys can be stale (or too minimal) after engine upgrades. If unionKeys is built only from the stored
    // keys, the later per-plan derivation can require additional keys, causing this pipeline run to skip computing the
    // estimate for that plan (and the dashboard can get stuck at "CACHE_MISS / 1 pending").
    if (rp?.rateStructure) {
      const derived = derivePlanCalcRequirementsFromTemplate({ rateStructure: rp.rateStructure }).requiredBucketKeys ?? [];
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

  // TDSP can be missing on the home row (especially early in onboarding).
  // Fall back to the offers payload, since WattBuy already knows the TDSP for the address.
  const tdspSlug =
    String(house.tdspSlug ?? "").trim().toLowerCase() ||
    String(offers.find((o: any) => String(o?.tdsp ?? "").trim())?.tdsp ?? "")
      .trim()
      .toLowerCase();

  const tdspRates = tdspSlug ? await getTdspDeliveryRates({ tdspSlug, asOf: new Date() }).catch(() => null) : null;

  const tdspPer = Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0;
  const tdspMonthly = Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0;
  const tdspEff = tdspRates?.effectiveDate ?? null;

  let estimatesComputed = 0;
  let estimatesAlreadyCached = 0;
  let estimatesConsidered = 0;
  let ratePlansLoaded = Array.isArray(ratePlans) ? (ratePlans as any[]).length : 0;
  let ratePlansMissingRateStructure = 0;
  let ratePlansDerivedNotComputable = 0;
  let ratePlansMissingRequiredKeys = 0;
  const estimateByRatePlanId = new Map<
    string,
    { status: string; reason: string | null; annualCostDollars: number | null; monthlyCostDollars: number | null }
  >();

  if (!annualKwhForCalc || !tdspRates) {
    const finished = new Date();
    await writePlanPipelineJobSnapshot({
      v: 1,
      homeId,
      runId,
      status: "ERROR",
      reason,
      calcVersion: PLAN_ENGINE_ESTIMATE_VERSION,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: finished.toISOString(),
      cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
      // Do NOT advance cadence window if we couldn't compute any estimates (prevents "stuck for 30 days").
      lastCalcWindowEnd: latestJob?.lastCalcWindowEnd ?? null,
      lastError: !annualKwhForCalc
        ? "missing_annual_kwh_from_usage_buckets"
        : !tdspRates
          ? `missing_tdsp_rates_for_slug:${tdspSlug || "unknown"}`
          : "unknown_error",
      counts: { offersTotal: offers.length, templatesProcessed, templatesLinked, templatesQueued, estimatesComputed, estimatesAlreadyCached },
    });
    return { ok: true, started: true, runId, durationMs: Date.now() - startedAt, templatesProcessed, templatesLinked, templatesQueued, estimatesConsidered: 0, estimatesComputed: 0, estimatesAlreadyCached: 0 };
  }

  // IMPORTANT: The usage bucket build step can take significant time (especially on cold starts).
  // The estimate-fill loop should get its own time budget window, otherwise we can end up doing
  // all the prep work but computing 0 estimates.
  const estimatePhaseStartedAt = Date.now();

  for (const rp of ratePlans as any[]) {
    if (estimatesComputed >= maxEstimatePlans) break;
    if (Date.now() - estimatePhaseStartedAt > timeBudgetMs) break;

    const ratePlanId = String(rp?.id ?? "").trim();
    if (!ratePlanId) continue;
    const rateStructure = rp?.rateStructure ?? null;
    if (!rateStructure) {
      ratePlansMissingRateStructure++;
      continue;
    }

    // For estimate keying we need the per-plan required bucket keys; keep it stable regardless of which branch we take.
    let requiredBucketKeysForKey: string[] = Array.isArray((rp as any)?.requiredBucketKeys)
      ? ((rp as any).requiredBucketKeys as any[]).map((k) => String(k))
      : [];

    const overridden = isComputableOverride(rp?.planCalcStatus, rp?.planCalcReasonCode);
    if (!overridden) {
      // Derive computability from the template rateStructure (authoritative).
      // IMPORTANT: Do NOT call canComputePlanFromBuckets() here; that helper is for dashboard UI and expects a different input shape.
      const derived = derivePlanCalcRequirementsFromTemplate({ rateStructure });

      // Keep the persisted planCalcStatus/Reason in sync with the authoritative derivation.
      // This prevents stale NOT_COMPUTABLE reason codes (like SUSPECT_TOU_EVIDENCE_IN_VALIDATION) from lingering after rule fixes,
      // and ensures admin tooling + pipeline agree without manual intervention.
      try {
        const curStatus = String(rp?.planCalcStatus ?? "").trim();
        const curReason = String(rp?.planCalcReasonCode ?? "").trim();
        const nextStatus = String((derived as any)?.planCalcStatus ?? "").trim();
        const nextReason = String((derived as any)?.planCalcReasonCode ?? "").trim();
        if (nextStatus && (curStatus !== nextStatus || curReason !== nextReason)) {
          await (prisma as any).ratePlan
            .update({
              where: { id: ratePlanId },
              data: {
                planCalcVersion: (derived as any)?.planCalcVersion ?? 1,
                planCalcStatus: nextStatus,
                planCalcReasonCode: nextReason || "UNKNOWN",
                requiredBucketKeys: Array.isArray((derived as any)?.requiredBucketKeys) ? (derived as any).requiredBucketKeys : [],
                supportedFeatures: (derived as any)?.supportedFeatures ?? {},
                planCalcDerivedAt: new Date(),
              },
              select: { id: true },
            })
            .catch(() => null);
        }
      } catch {
        // best-effort only
      }

      if (derived?.planCalcStatus !== "COMPUTABLE") {
        ratePlansDerivedNotComputable++;
        // Auto-enqueue true template defects / non-deterministic pricing for admin review (system-caught).
        const rc = String(derived?.planCalcReasonCode ?? "").trim();
        if (rc && isPlanCalcQuarantineWorthyReasonCode(rc)) {
          const offerIdsForPlan = Array.from(new Set(offerIdsByRatePlanId.get(ratePlanId) ?? []));
          await Promise.all(
            offerIdsForPlan.map(async (offerId) => {
              const meta = offerMetaById.get(offerId) ?? null;
              const queueReasonPayload = {
                type: "PLAN_CALC_QUARANTINE",
                source: "plan_pipeline",
                planCalcStatus: derived?.planCalcStatus ?? "NOT_COMPUTABLE",
                planCalcReasonCode: rc,
                ratePlanId,
                offerId,
                utilityId: meta?.utilityId ?? null,
              };
              try {
                await (prisma as any).eflParseReviewQueue.upsert({
                  where: { kind_dedupeKey: { kind: "PLAN_CALC_QUARANTINE", dedupeKey: offerId } },
                  create: {
                    source: "plan_pipeline",
                    kind: "PLAN_CALC_QUARANTINE",
                    dedupeKey: offerId,
                    eflPdfSha256: sha256HexCache(["plan_pipeline", "PLAN_CALC_QUARANTINE", offerId].join("|")),
                    offerId,
                    supplier: meta?.supplier ?? null,
                    planName: meta?.planName ?? null,
                    eflUrl: meta?.eflUrl ?? null,
                    tdspName: meta?.tdspName ?? null,
                    termMonths: meta?.termMonths ?? null,
                    ratePlanId,
                    rawText: null,
                    planRules: null,
                    rateStructure: null,
                    validation: null,
                    derivedForValidation: { derived, queueReasonPayload },
                    finalStatus: "OPEN",
                    queueReason: JSON.stringify(queueReasonPayload),
                    solverApplied: [],
                    resolvedAt: null,
                    resolvedBy: null,
                    resolutionNotes: rc,
                  },
                  update: {
                    supplier: meta?.supplier ?? null,
                    planName: meta?.planName ?? null,
                    eflUrl: meta?.eflUrl ?? null,
                    tdspName: meta?.tdspName ?? null,
                    termMonths: meta?.termMonths ?? null,
                    ratePlanId,
                    derivedForValidation: { derived, queueReasonPayload },
                    finalStatus: "OPEN",
                    queueReason: JSON.stringify(queueReasonPayload),
                    resolvedAt: null,
                    resolvedBy: null,
                    resolutionNotes: rc,
                  },
                });
              } catch {
                // best-effort only
              }
            }),
          );
        }
        continue;
      }

      // Ensure required buckets are present in the stitched bucket union we built above.
      const requiredKeys = Array.isArray(derived?.requiredBucketKeys) ? (derived.requiredBucketKeys as string[]) : [];
      requiredBucketKeysForKey = requiredKeys.map((k) => String(k));
      const missing = requiredKeys.filter((k) => !unionKeys.has(String(k ?? "").trim()));
      if (missing.length > 0) {
        ratePlansMissingRequiredKeys++;
        continue;
      }
    }

    const estimateMode =
      String((rp as any)?.planCalcReasonCode ?? "").trim() === "INDEXED_APPROXIMATE_OK"
        ? ("INDEXED_EFL_ANCHOR_APPROX" as const)
        : ("DEFAULT" as const);
    const { inputsSha256 } = makePlanEstimateInputsSha256({
      monthsCount: 12,
      annualKwh: annualKwhForCalc,
      tdsp: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
      rateStructure,
      yearMonths: yearMonthsForCalc,
      requiredBucketKeys: requiredBucketKeysForKey,
      usageBucketsByMonth: usageBucketsByMonthForCalc,
      estimateMode,
    });

    estimatesConsidered++;
    const cached = await getCachedPlanEstimate({ houseAddressId: homeId, ratePlanId, inputsSha256, monthsCount: 12 });
    if (cached) {
      estimatesAlreadyCached++;
      try {
        const st = String((cached as any)?.status ?? "").trim() || "UNKNOWN";
        const rsn = typeof (cached as any)?.reason === "string" ? String((cached as any).reason) : null;
        const annual = typeof (cached as any)?.annualCostDollars === "number" && Number.isFinite((cached as any).annualCostDollars)
          ? (cached as any).annualCostDollars
          : null;
        const monthly = typeof (cached as any)?.monthlyCostDollars === "number" && Number.isFinite((cached as any).monthlyCostDollars)
          ? (cached as any).monthlyCostDollars
          : null;
        estimateByRatePlanId.set(ratePlanId, { status: st, reason: rsn, annualCostDollars: annual, monthlyCostDollars: monthly });
      } catch {
        // ignore
      }

      // Migration: also ensure the new materialized store is populated (best-effort).
      try {
        const computedAt = new Date();
        await upsertMaterializedPlanEstimate({
          houseAddressId: homeId,
          ratePlanId,
          inputsSha256,
          monthsCount: 12,
          computedAt,
          expiresAt: new Date(computedAt.getTime() + monthlyCadenceDays * DAY_MS),
          payload: {
            status: String((cached as any)?.status ?? "NOT_IMPLEMENTED") as any,
            reason: typeof (cached as any)?.reason === "string" ? (cached as any).reason : null,
            annualCostDollars: typeof (cached as any)?.annualCostDollars === "number" ? (cached as any).annualCostDollars : null,
            monthlyCostDollars: typeof (cached as any)?.monthlyCostDollars === "number" ? (cached as any).monthlyCostDollars : null,
            effectiveCentsPerKwh:
              typeof (cached as any)?.effectiveCentsPerKwh === "number" ? (cached as any).effectiveCentsPerKwh : null,
            confidence: ((cached as any)?.confidence as any) ?? null,
            componentsV2: (cached as any)?.componentsV2 ?? null,
            tdspRatesApplied: (cached as any)?.tdspRatesApplied ?? null,
          },
        });
      } catch {
        // ignore
      }

      // If we previously quarantined this offer due to a transient estimate issue (e.g. bucket sum drift),
      // and the cached estimate is now OK/APPROX, auto-resolve the OPEN quarantine row so it doesn't "stick"
      // after the system self-heals.
      try {
        const estStatus = String((cached as any)?.status ?? "").trim().toUpperCase();
        if (estStatus === "OK" || estStatus === "APPROXIMATE") {
          const offerIdsForPlan = Array.from(new Set(offerIdsByRatePlanId.get(ratePlanId) ?? []));
          if (offerIdsForPlan.length > 0) {
            await (prisma as any).eflParseReviewQueue
              .updateMany({
                where: {
                  kind: "PLAN_CALC_QUARANTINE",
                  resolvedAt: null,
                  dedupeKey: { in: offerIdsForPlan },
                },
                data: {
                  resolvedAt: new Date(),
                  resolvedBy: "auto_estimate_ok_cached",
                  resolutionNotes: "AUTO_RESOLVED: estimate is OK/APPROX (cached)",
                },
              })
              .catch(() => null);
          }
        }
      } catch {
        // best-effort only
      }
      continue;
    }

    const est = estimateTrueCost({
      annualKwh: annualKwhForCalc,
      monthsCount: 12,
      tdspRates: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
      rateStructure,
      usageBucketsByMonth: usageBucketsByMonthForCalc,
      estimateMode,
    });
    try {
      const st = String((est as any)?.status ?? "").trim() || "UNKNOWN";
      const rsn = typeof (est as any)?.reason === "string" ? String((est as any).reason) : null;
      const annual = typeof (est as any)?.annualCostDollars === "number" && Number.isFinite((est as any).annualCostDollars)
        ? (est as any).annualCostDollars
        : null;
      const monthly = typeof (est as any)?.monthlyCostDollars === "number" && Number.isFinite((est as any).monthlyCostDollars)
        ? (est as any).monthlyCostDollars
        : null;
      estimateByRatePlanId.set(ratePlanId, { status: st, reason: rsn, annualCostDollars: annual, monthlyCostDollars: monthly });
    } catch {
      // ignore
    }

    await putCachedPlanEstimate({ houseAddressId: homeId, ratePlanId, esiid: house.esiid ?? null, inputsSha256, monthsCount: 12, payloadJson: est });

    // vNext single source of truth: write to materialized store (best-effort).
    try {
      const computedAt = new Date();
      await upsertMaterializedPlanEstimate({
        houseAddressId: homeId,
        ratePlanId,
        inputsSha256,
        monthsCount: 12,
        computedAt,
        expiresAt: new Date(computedAt.getTime() + monthlyCadenceDays * DAY_MS),
        payload: {
          status: String((est as any)?.status ?? "NOT_IMPLEMENTED") as any,
          reason: typeof (est as any)?.reason === "string" ? (est as any).reason : null,
          annualCostDollars: typeof (est as any)?.annualCostDollars === "number" ? (est as any).annualCostDollars : null,
          monthlyCostDollars: typeof (est as any)?.monthlyCostDollars === "number" ? (est as any).monthlyCostDollars : null,
          effectiveCentsPerKwh:
            typeof (est as any)?.effectiveCentsPerKwh === "number" ? (est as any).effectiveCentsPerKwh : null,
          confidence: ((est as any)?.confidence as any) ?? null,
          componentsV2: (est as any)?.componentsV2 ?? null,
          tdspRatesApplied: (est as any)?.tdspRatesApplied ?? null,
        },
      });
    } catch {
      // ignore
    }
    estimatesComputed++;

    // System-caught quarantines: if the engine returns NOT_COMPUTABLE for a plan we tried to compute,
    // auto-upsert into admin queue (deduped by offerId).
    try {
      const estStatus = String((est as any)?.status ?? "").trim().toUpperCase();
      const estReason = String((est as any)?.reason ?? "").trim();

      // If we fixed or avoided a prior quarantine-worthy issue, auto-resolve the OPEN queue row.
      if (estStatus === "OK" || estStatus === "APPROXIMATE") {
        const offerIdsForPlan = Array.from(new Set(offerIdsByRatePlanId.get(ratePlanId) ?? []));
        if (offerIdsForPlan.length > 0) {
          await (prisma as any).eflParseReviewQueue
            .updateMany({
              where: {
                kind: "PLAN_CALC_QUARANTINE",
                resolvedAt: null,
                dedupeKey: { in: offerIdsForPlan },
              },
              data: {
                resolvedAt: new Date(),
                resolvedBy: "auto_estimate_ok",
                resolutionNotes: "AUTO_RESOLVED: estimate is OK/APPROX",
              },
            })
            .catch(() => null);
        }
      }

      if (estStatus === "NOT_COMPUTABLE" && isPlanCalcQuarantineWorthyReasonCode(estReason || estStatus)) {
        const offerIdsForPlan = Array.from(new Set(offerIdsByRatePlanId.get(ratePlanId) ?? []));
        await Promise.all(
          offerIdsForPlan.map(async (offerId) => {
            const meta = offerMetaById.get(offerId) ?? null;
            const queueReasonPayload = {
              type: "PLAN_CALC_QUARANTINE",
              source: "plan_pipeline_trueCostEstimate",
              estimateStatus: estStatus,
              estimateReason: estReason || null,
              ratePlanId,
              offerId,
              utilityId: meta?.utilityId ?? null,
            };
            try {
              await (prisma as any).eflParseReviewQueue.upsert({
                where: { kind_dedupeKey: { kind: "PLAN_CALC_QUARANTINE", dedupeKey: offerId } },
                create: {
                  source: "plan_pipeline",
                  kind: "PLAN_CALC_QUARANTINE",
                  dedupeKey: offerId,
                  eflPdfSha256: sha256HexCache(["plan_pipeline", "PLAN_CALC_QUARANTINE", offerId].join("|")),
                  offerId,
                  supplier: meta?.supplier ?? null,
                  planName: meta?.planName ?? null,
                  eflUrl: meta?.eflUrl ?? null,
                  tdspName: meta?.tdspName ?? null,
                  termMonths: meta?.termMonths ?? null,
                  ratePlanId,
                  rawText: null,
                  planRules: null,
                  rateStructure: null,
                  validation: null,
                  derivedForValidation: { trueCostEstimate: est, queueReasonPayload },
                  finalStatus: "OPEN",
                  queueReason: JSON.stringify(queueReasonPayload),
                  solverApplied: [],
                  resolvedAt: null,
                  resolvedBy: null,
                  resolutionNotes: estReason || "NOT_COMPUTABLE",
                },
                update: {
                  supplier: meta?.supplier ?? null,
                  planName: meta?.planName ?? null,
                  eflUrl: meta?.eflUrl ?? null,
                  tdspName: meta?.tdspName ?? null,
                  termMonths: meta?.termMonths ?? null,
                  ratePlanId,
                  derivedForValidation: { trueCostEstimate: est, queueReasonPayload },
                  finalStatus: "OPEN",
                  queueReason: JSON.stringify(queueReasonPayload),
                  resolvedAt: null,
                  resolvedBy: null,
                  resolutionNotes: estReason || "NOT_COMPUTABLE",
                },
              });
            } catch {
              // ignore
            }
          }),
        );
      }
    } catch {
      // ignore
    }
  }

  // ---------------- Step 3: Persist per-home savings snapshot (best-effort) ----------------
  // This is used for admin sorting/filtering and landing-page aggregate stats.
  try {
    // Pick best offer estimate among plans that have an offerId and an OK/APPROX annual cost.
    let bestRatePlanId: string | null = null;
    let bestOfferId: string | null = null;
    let bestAnnualCostDollars: number | null = null;
    let bestTermMonths: number | null = null;

    estimateByRatePlanId.forEach((est, ratePlanId) => {
      const status = String(est.status ?? "").trim().toUpperCase();
      if (!(status === "OK" || status === "APPROXIMATE")) return;
      const annual = typeof est.annualCostDollars === "number" && Number.isFinite(est.annualCostDollars) ? est.annualCostDollars : null;
      if (annual == null) return;
      const offerIdsForPlan = Array.from(new Set(offerIdsByRatePlanId.get(ratePlanId) ?? []));
      if (offerIdsForPlan.length === 0) return;

      const offerId = String(offerIdsForPlan[0] ?? "").trim() || null;
      const meta = offerId ? offerMetaById.get(offerId) ?? null : null;
      const termMonths = typeof meta?.termMonths === "number" && Number.isFinite(meta.termMonths) ? meta.termMonths : null;

      if (bestAnnualCostDollars == null || annual < bestAnnualCostDollars) {
        bestAnnualCostDollars = annual;
        bestRatePlanId = ratePlanId;
        bestOfferId = offerId;
        bestTermMonths = termMonths;
      }
    });

    // Load current-plan details (rateStructure, contract end, ETF) from the current-plan module DB.
    const now = new Date();
    const userId = String((house as any)?.userId ?? "").trim();
    if (userId && bestAnnualCostDollars != null) {
      const latestManualRaw = await (currentPlanPrisma as any).currentPlanManualEntry.findFirst({
        where: { userId, houseId: homeId },
        orderBy: { createdAt: "desc" },
      });
      const isAutoImportedFromBill = (m: any): boolean => {
        try {
          const notes = typeof m?.notes === "string" ? m.notes : "";
          const confirmed = m?.lastConfirmedAt instanceof Date;
          return !confirmed && /imported\\s+from\\s+uploaded\\s+bill/i.test(notes);
        } catch {
          return false;
        }
      };
      const latestManual = latestManualRaw && !isAutoImportedFromBill(latestManualRaw) ? latestManualRaw : null;

      const esiid = typeof house.esiid === "string" && house.esiid.trim() ? house.esiid.trim() : null;
      const parsedHouseWhere = esiid
        ? {
            OR: [
              { houseId: homeId },
              { houseId: null, OR: [{ esiId: esiid }, { esiid }] },
            ],
          }
        : { houseId: homeId };

      const latestParsedEfl = await (currentPlanPrisma as any).parsedCurrentPlan.findFirst({
        where: {
          userId,
          uploadId: { not: null },
          ...parsedHouseWhere,
          billUpload: { filename: { startsWith: "EFL:" } },
        },
        orderBy: { createdAt: "desc" },
      });
      const latestParsedBill = await (currentPlanPrisma as any).parsedCurrentPlan.findFirst({
        where: {
          userId,
          uploadId: { not: null },
          ...parsedHouseWhere,
          billUpload: { filename: { not: { startsWith: "EFL:" } } },
        },
        orderBy: { createdAt: "desc" },
      });
      const latestParsed = latestParsedEfl ?? latestParsedBill ?? null;

      const manualRs = (latestManual as any)?.rateStructure ?? null;
      const parsedEflRs = (latestParsedEfl as any)?.rateStructure ?? null;
      const parsedBillRs = (latestParsedBill as any)?.rateStructure ?? null;
      const manualRsPresent = isRateStructurePresent(manualRs);
      const parsedEflRsPresent = isRateStructurePresent(parsedEflRs);
      const parsedBillRsPresent = isRateStructurePresent(parsedBillRs);

      // Precedence: EFL-derived (when present) > confirmed manual > bill-derived.
      const effectiveRateStructure = parsedEflRsPresent
        ? parsedEflRs
        : manualRsPresent
          ? manualRs
          : parsedBillRsPresent
            ? parsedBillRs
            : manualRs ?? parsedEflRs ?? parsedBillRs ?? null;

      const mergedCurrent: any = {
        ...(latestParsed ?? {}),
        ...(latestManual ?? {}),
        contractEndDate: (latestManual as any)?.contractEndDate ?? (latestParsed as any)?.contractEndDate ?? null,
        earlyTerminationFee: (latestManual as any)?.earlyTerminationFee ?? (latestParsed as any)?.earlyTerminationFee ?? null,
        earlyTerminationFeeCents: (latestManual as any)?.earlyTerminationFeeCents ?? (latestParsed as any)?.earlyTerminationFeeCents ?? null,
        rateStructure: effectiveRateStructure,
      };

      const contractEndDate = mergedCurrent?.contractEndDate ? new Date(mergedCurrent.contractEndDate) : null;
      const contractEndDateIso = contractEndDate && Number.isFinite(contractEndDate.getTime()) ? contractEndDate.toISOString() : null;
      const monthsRemaining = computeMonthsRemainingOnContract({ contractEndDate: contractEndDateIso, asOf: now });

      const etfDollarsRaw = mergedCurrent?.earlyTerminationFee;
      const etfDollars =
        typeof etfDollarsRaw === "number" && Number.isFinite(etfDollarsRaw)
          ? etfDollarsRaw
          : etfDollarsRaw && typeof etfDollarsRaw === "object" && typeof etfDollarsRaw.toString === "function"
            ? Number(etfDollarsRaw.toString())
            : typeof mergedCurrent?.earlyTerminationFeeCents === "number"
              ? Number(mergedCurrent.earlyTerminationFeeCents) / 100
              : null;
      const etf = typeof etfDollars === "number" && Number.isFinite(etfDollars) && etfDollars > 0 ? etfDollars : 0;

      // Texas: within 14 days (and before end) is considered ETF-free.
      const switchWithoutEtfWindowDays = 14;
      const canSwitchWithoutEtf = (() => {
        if (!contractEndDate || !Number.isFinite(contractEndDate.getTime())) return null;
        const d = daysUntil(now, contractEndDate);
        if (d == null) return null;
        return d > 0 && d <= switchWithoutEtfWindowDays;
      })();
      const isInContract = contractEndDate && Number.isFinite(contractEndDate.getTime()) ? contractEndDate.getTime() > now.getTime() : null;
      const wouldIncurEtfIfSwitchNow = (() => {
        if (etf <= 0) return false;
        if (canSwitchWithoutEtf === true) return false;
        if (canSwitchWithoutEtf === false) return isInContract === false ? false : true;
        if (typeof isInContract === "boolean") return isInContract ? null : false;
        return null;
      })();

      const currentRs = mergedCurrent?.rateStructure ?? null;
      if (isRateStructurePresent(currentRs) && annualKwhForCalc && tdspRates) {
        // Ensure the current plan's required buckets are present (may not be in unionKeys derived from templates).
        const currentReq = derivePlanCalcRequirementsFromTemplate({ rateStructure: currentRs }).requiredBucketKeys ?? [];
        const missingKeys = currentReq.filter((k) => !unionKeys.has(String(k ?? "").trim()));
        const bucketBuildForCurrent =
          missingKeys.length > 0
            ? await buildUsageBucketsForEstimate({
                homeId,
                usageSource,
                esiid: usageSource === "SMT" ? esiid : null,
                rawId: usageSource === "GREEN_BUTTON" ? gbRawId : null,
                windowEnd: usageWindowEnd,
                cutoff: usageCutoff,
                requiredBucketKeys: Array.from(new Set([...Array.from(unionKeys), ...currentReq.map((x) => String(x))])),
                monthsCount: 12,
                maxStepDays: 2,
                stitchMode: "DAILY_OR_INTERVAL",
              })
            : null;
        const yearMonthsCur = bucketBuildForCurrent?.yearMonths ?? yearMonthsForCalc;
        const bucketsCur = bucketBuildForCurrent?.usageBucketsByMonth ?? usageBucketsByMonthForCalc;

        const rt = String((currentRs as any)?.type ?? "").trim().toUpperCase();
        const estimateModeCur = rt === "VARIABLE" || rt === "INDEXED" ? ("INDEXED_EFL_ANCHOR_APPROX" as const) : ("DEFAULT" as const);
        const curEst = estimateTrueCost({
          annualKwh: annualKwhForCalc,
          monthsCount: 12,
          tdspRates: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
          rateStructure: currentRs,
          usageBucketsByMonth: bucketsCur,
          estimateMode: estimateModeCur,
        });
        const curAnnual =
          typeof (curEst as any)?.annualCostDollars === "number" && Number.isFinite((curEst as any).annualCostDollars)
            ? (curEst as any).annualCostDollars
            : null;

        if (curAnnual != null) {
          const savings12NoEtf = curAnnual - bestAnnualCostDollars;
          const endMonths = monthsRemaining == null ? null : monthsRemaining;
          const factor = endMonths == null ? null : endMonths / 12;
          const savingsToEndNoEtf = factor == null ? null : savings12NoEtf * factor;

          const shouldDeductEtf = etf > 0 && (wouldIncurEtfIfSwitchNow !== false);
          const savings12NetEtf = shouldDeductEtf ? savings12NoEtf - etf : savings12NoEtf;
          const savingsToEndNetEtf = factor == null ? null : (shouldDeductEtf ? savingsToEndNoEtf! - etf : savingsToEndNoEtf);

          await (prisma as any).homeSavingsSnapshot
            .upsert({
              where: { houseAddressId: homeId },
              create: {
                houseAddressId: homeId,
                userId,
                computedAt: new Date(),
                contractEndDate: contractEndDateIso ? new Date(contractEndDateIso) : null,
                monthsRemainingOnContract: endMonths,
                earlyTerminationFeeDollars: etf > 0 ? etf : null,
                wouldIncurEtfIfSwitchNow,
                savingsNext12MonthsNoEtf: savings12NoEtf,
                savingsUntilContractEndNoEtf: savingsToEndNoEtf,
                savingsNext12MonthsNetEtf: savings12NetEtf,
                savingsUntilContractEndNetEtf: savingsToEndNetEtf,
                currentAnnualCostDollars: curAnnual,
                bestAnnualCostDollars,
                bestRatePlanId,
                bestOfferId,
                bestTermMonths,
              },
              update: {
                computedAt: new Date(),
                contractEndDate: contractEndDateIso ? new Date(contractEndDateIso) : null,
                monthsRemainingOnContract: endMonths,
                earlyTerminationFeeDollars: etf > 0 ? etf : null,
                wouldIncurEtfIfSwitchNow,
                savingsNext12MonthsNoEtf: savings12NoEtf,
                savingsUntilContractEndNoEtf: savingsToEndNoEtf,
                savingsNext12MonthsNetEtf: savings12NetEtf,
                savingsUntilContractEndNetEtf: savingsToEndNetEtf,
                currentAnnualCostDollars: curAnnual,
                bestAnnualCostDollars,
                bestRatePlanId,
                bestOfferId,
                bestTermMonths,
              },
              select: { houseAddressId: true },
            })
            .catch(() => null);
        }

        // Silence unused vars in case of future refactors.
        void yearMonthsCur;
      }
    }
  } catch {
    // best-effort only; pipeline must not fail on snapshot persistence
  }

  const finished = new Date();
  const totalRatePlans = ratePlanIds.length;
  const computedOrCached = estimatesComputed + estimatesAlreadyCached;
  const incomplete = computedOrCached < totalRatePlans;
  // If we didn't drain the queue (bounded run), allow rapid follow-on batches.
  // This prevents the UI from getting stuck behind a long cooldown with many offers still QUEUED.
  const nextCooldownMs = incomplete ? Math.min(15_000, cooldownMs) : cooldownMs;
  await writePlanPipelineJobSnapshot({
    v: 1,
    homeId,
    runId,
    status: "DONE",
    reason,
    calcVersion: PLAN_ENGINE_ESTIMATE_VERSION,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: finished.toISOString(),
    cooldownUntil: new Date(Date.now() + nextCooldownMs).toISOString(),
    lastCalcWindowEnd: usageWindowEnd.toISOString(),
    counts: {
      offersTotal: offers.length,
      templatesProcessed,
      templatesLinked,
      templatesQueued,
      timeBudgetMs,
      maxTemplateOffers,
      maxEstimatePlans,
      ratePlanIdsCount: ratePlanIds.length,
      ratePlansLoaded,
      ratePlansMissingRateStructure,
      ratePlansDerivedNotComputable,
      ratePlansMissingRequiredKeys,
      estimatesConsidered,
      estimatesComputed,
      estimatesAlreadyCached,
    },
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
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    try {
      await writePlanPipelineJobSnapshot({
        v: 1,
        homeId,
        runId,
        status: "ERROR",
        reason,
        calcVersion: PLAN_ENGINE_ESTIMATE_VERSION,
        startedAt: runningStartedAtIso,
        finishedAt: new Date().toISOString(),
        cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
        // Do NOT advance cadence window on errors.
        lastCalcWindowEnd: latestJob?.lastCalcWindowEnd ?? null,
        lastError: msg,
        counts: {},
      });
    } catch {
      // ignore
    }
    return { ok: false, error: msg };
  }
}


