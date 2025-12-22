import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_ENGINE_ESTIMATE_VERSION = "estimateTrueCost_v1";

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function toInt(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
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

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const url = new URL(req.url);
  const reason = (url.searchParams.get("reason") ?? "plans_fallback").trim() || "plans_fallback";
  const timeBudgetMs = clamp(toInt(url.searchParams.get("timeBudgetMs"), 12_000), 1500, 25_000);
  const maxTemplateOffers = clamp(toInt(url.searchParams.get("maxTemplateOffers"), 6), 0, 10);
  const maxEstimatePlans = clamp(toInt(url.searchParams.get("maxEstimatePlans"), 20), 0, 50);
  const isRenter = parseBool(url.searchParams.get("isRenter"), false);

  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

    const userEmail = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
    if (!user) return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });

    // Primary home.
    let house = await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: { id: true, addressLine1: true, addressCity: true, addressState: true, addressZip5: true, esiid: true, tdspSlug: true, utilityName: true },
    });
    if (!house) {
      house = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null } as any,
        orderBy: { createdAt: "desc" },
        select: { id: true, addressLine1: true, addressCity: true, addressState: true, addressZip5: true, esiid: true, tdspSlug: true, utilityName: true },
      });
    }
    if (!house) return NextResponse.json({ ok: false, error: "no_home" }, { status: 400 });

    // Usage anchor: latest SMT interval timestamp (align with detail/list). If missing, do nothing.
    let usageWindowEnd: Date | null = null;
    if (house.esiid) {
      const latest = await prisma.smtInterval.findFirst({
        where: { esiid: house.esiid },
        orderBy: { ts: "desc" },
        select: { ts: true },
      });
      usageWindowEnd = latest?.ts ?? null;
    }
    if (!usageWindowEnd) {
      return NextResponse.json({ ok: true, started: false, reason: "no_usage_yet" }, { status: 200 });
    }

    const latestJob = await getLatestPlanPipelineJob(house.id);
    const gate = shouldStartPlanPipelineJob({
      latest: latestJob,
      now: new Date(),
      monthlyCadenceDays: 30,
      maxRunningMinutes: 20,
    });

    // Fallback-only behavior: if not eligible, just report.
    if (!gate.okToStart) {
      return NextResponse.json(
        { ok: true, started: false, reason: gate.reason, latestJob },
        { status: 200 },
      );
    }

    const runId = crypto.randomUUID();
    const cooldownMs = reason === "plans_fallback" ? 15 * 60 * 1000 : 5 * 60 * 1000;
    await writePlanPipelineJobSnapshot({
      v: 1,
      homeId: house.id,
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
      if (maxTemplateOffers <= 0) break;
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
    const ratePlanIds = Array.from(
      new Set((maps2 as any[]).map((m) => String(m.ratePlanId ?? "")).filter(Boolean)),
    );

    if (ratePlanIds.length === 0 || maxEstimatePlans === 0) {
      const finished = new Date();
      await writePlanPipelineJobSnapshot({
        v: 1,
        homeId: house.id,
        runId,
        status: "DONE",
        reason,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: finished.toISOString(),
        cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
        lastCalcWindowEnd: usageWindowEnd.toISOString(),
        counts: {
          offersTotal: offers.length,
          templatesProcessed,
          templatesLinked,
          templatesQueued,
          estimatesComputed: 0,
          estimatesAlreadyCached: 0,
        },
      });
      return NextResponse.json({ ok: true, started: true, runId, templatesProcessed, templatesLinked, templatesQueued, estimatesComputed: 0 }, { status: 200 });
    }

    const ratePlans = await (prisma as any).ratePlan.findMany({
      where: { id: { in: ratePlanIds } },
      select: { id: true, rateStructure: true, requiredBucketKeys: true, planCalcStatus: true, planCalcReasonCode: true },
    });

    // Union required bucket keys for all templates (so we build usage buckets once).
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
      homeId: house.id,
      usageSource: "SMT",
      esiid: house.esiid ?? null,
      rawId: null,
      windowEnd: usageWindowEnd,
      cutoff: usageCutoff,
      requiredBucketKeys: Array.from(unionKeys),
      monthsCount: 12,
      maxStepDays: 2,
      stitchMode: "DAILY_OR_INTERVAL",
    });

    const yearMonthsForCalc = bucketBuild.yearMonths.slice();
    const usageBucketsByMonthForCalc = bucketBuild.usageBucketsByMonth;
    const annualKwhForCalc = typeof bucketBuild.annualKwh === "number" && Number.isFinite(bucketBuild.annualKwh) ? bucketBuild.annualKwh : null;

    const tdspSlug = String(house.tdspSlug ?? "").trim().toLowerCase();
    const tdspRates = tdspSlug ? await getTdspDeliveryRates({ tdspSlug, asOf: new Date() }).catch(() => null) : null;
    if (!annualKwhForCalc || !tdspRates) {
      const finished = new Date();
      await writePlanPipelineJobSnapshot({
        v: 1,
        homeId: house.id,
        runId,
        status: "DONE",
        reason,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: finished.toISOString(),
        cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
        lastCalcWindowEnd: usageWindowEnd.toISOString(),
        counts: {
          offersTotal: offers.length,
          templatesProcessed,
          templatesLinked,
          templatesQueued,
          estimatesComputed: 0,
          estimatesAlreadyCached: 0,
          estimatesSkipped: 1,
        },
      });
      return NextResponse.json({ ok: true, started: true, runId, templatesProcessed, templatesLinked, templatesQueued, estimatesComputed: 0, estimatesSkipped: true }, { status: 200 });
    }

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

    for (const rp of ratePlans as any[]) {
      if (estimatesComputed >= maxEstimatePlans) break;
      if (Date.now() - startedAt > timeBudgetMs) break;

      const ratePlanId = String(rp?.id ?? "").trim();
      if (!ratePlanId) continue;
      const rateStructure = rp?.rateStructure ?? null;
      if (!rateStructure) continue;

      // Respect computability gates unless overridden (same semantics as detail/list).
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
      const cached = await getCachedPlanEstimate({
        houseAddressId: house.id,
        ratePlanId,
        inputsSha256,
        monthsCount: 12,
      });
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

      await putCachedPlanEstimate({
        houseAddressId: house.id,
        ratePlanId,
        esiid: house.esiid ?? null,
        inputsSha256,
        monthsCount: 12,
        payloadJson: est,
      });
      estimatesComputed++;
    }

    const finished = new Date();
    await writePlanPipelineJobSnapshot({
      v: 1,
      homeId: house.id,
      runId,
      status: "DONE",
      reason,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: finished.toISOString(),
      cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
      lastCalcWindowEnd: usageWindowEnd.toISOString(),
      counts: {
        offersTotal: offers.length,
        templatesProcessed,
        templatesLinked,
        templatesQueued,
        estimatesConsidered,
        estimatesComputed,
        estimatesAlreadyCached,
      },
    });

    return NextResponse.json(
      {
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
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


