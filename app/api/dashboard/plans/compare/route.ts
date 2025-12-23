import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";
import { normalizeEmail } from "@/lib/utils/email";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers } from "@/lib/wattbuy/normalize";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { buildUsageBucketsForEstimate } from "@/lib/usage/buildUsageBucketsForEstimate";
import { estimateTrueCost } from "@/lib/plan-engine/estimateTrueCost";
import { getCachedPlanEstimate, putCachedPlanEstimate, sha256Hex as sha256HexCache } from "@/lib/plan-engine/planEstimateCache";
import { requiredBucketsForRateStructure } from "@/lib/plan-engine/requiredBucketsForPlan";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLAN_ENGINE_ESTIMATE_VERSION = "estimateTrueCost_v2";
const CURRENT_PLAN_ESTIMATE_ENDPOINT = "CURRENT_PLAN_ENGINE_ESTIMATE_V1";

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function decimalToNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && typeof v.toString === "function") {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function isRateStructurePresent(rs: any): boolean {
  if (!rs || typeof rs !== "object") return false;
  const t = String((rs as any)?.type ?? "").toUpperCase();
  if (t === "FIXED") return typeof (rs as any)?.energyRateCents === "number";
  if (t === "VARIABLE") return typeof (rs as any)?.currentBillEnergyRateCents === "number";
  if (t === "TIME_OF_USE") return Array.isArray((rs as any)?.tiers) && (rs as any).tiers.length > 0;
  return false;
}

function chicagoNow(): Date {
  // Best-effort "now" used only for in-contract heuristic; contractEndDate comes from DB (UTC).
  return new Date();
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const offerId = (url.searchParams.get("offerId") ?? "").trim();
    const isRenter = parseBool(url.searchParams.get("isRenter"), false);
    if (!offerId) return NextResponse.json({ ok: false, error: "offerId_required" }, { status: 400 });

    const cookieStore = cookies();
    const rawEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!rawEmail) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(rawEmail) },
      select: { id: true, email: true },
    });
    if (!user) return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });

    // House context: prefer ACTIVE usage entry's houseId, then newest usage entry, then newest house.
    const usageEntries = await prisma.entry.findMany({
      where: { userId: user.id, type: "smart_meter_connect" },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true, status: true, houseId: true },
    });
    const isLive = (s: any) => s === "ACTIVE" || s === "EXPIRING_SOON";
    const usageEntry = usageEntries.find((e) => isLive(e.status)) ?? usageEntries[0] ?? null;
    let houseId = (usageEntry?.houseId as string | null) ?? null;
    if (!houseId) {
      const bestHouse = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null },
        orderBy: [{ updatedAt: "desc" }],
        select: { id: true },
      });
      houseId = bestHouse?.id ?? null;
    }
    if (!houseId) return NextResponse.json({ ok: false, error: "no_house_context" }, { status: 400 });

    const house = await prisma.houseAddress.findUnique({
      where: { id: houseId },
      select: {
        id: true,
        userId: true,
        archivedAt: true,
        esiid: true,
        tdspSlug: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
      },
    });
    if (!house || house.userId !== user.id || house.archivedAt) {
      return NextResponse.json({ ok: false, error: "house_not_found" }, { status: 404 });
    }

    // Determine usage source + window (SMT or Green Button).
    const esiid = typeof house.esiid === "string" && house.esiid.trim() ? house.esiid.trim() : null;
    const now = chicagoNow();

    let usageSource: "SMT" | "GREEN_BUTTON" | null = null;
    let windowEnd: Date | null = null;
    let gbRawId: string | null = null;

    if (esiid) {
      const latestSmt = await prisma.smtInterval.findFirst({
        where: { esiid },
        orderBy: { ts: "desc" },
        select: { ts: true },
      });
      if (latestSmt?.ts) {
        usageSource = "SMT";
        windowEnd = latestSmt.ts;
      }
    }
    if (!usageSource) {
      const usageClient = usagePrisma as any;
      const latestGb = await usageClient.greenButtonInterval.findFirst({
        where: { homeId: house.id },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true, rawId: true },
      });
      if (latestGb?.timestamp) {
        usageSource = "GREEN_BUTTON";
        windowEnd = latestGb.timestamp;
        gbRawId = latestGb.rawId ?? null;
      }
    }
    if (!usageSource || !windowEnd) {
      return NextResponse.json({ ok: false, error: "no_usage_window" }, { status: 400 });
    }

    // Canonical cutoff for stitched usage window: windowEnd - 365d (not "now - 365d").
    const cutoff = new Date(windowEnd.getTime() - 365 * 24 * 60 * 60 * 1000);

    // Load the offer (for enroll link + RatePlan mapping).
    const rawOffers = await wattbuy.offers({
      address: house.addressLine1,
      city: house.addressCity,
      state: house.addressState,
      zip: house.addressZip5,
      isRenter,
    });
    const normalized = normalizeOffers(rawOffers ?? {});
    const offers = Array.isArray((normalized as any)?.offers) ? (normalized as any).offers : [];
    const offer = offers.find((o: any) => String(o?.offer_id ?? "") === offerId) ?? null;
    if (!offer) return NextResponse.json({ ok: false, error: "offer_not_found", offerId }, { status: 404 });

    const enrollLink = typeof (offer as any)?.enroll_link === "string" ? String((offer as any).enroll_link) : null;

    const map = await (prisma as any).offerIdRatePlanMap.findUnique({
      where: { offerId },
      select: { ratePlanId: true },
    });
    const ratePlanId = map?.ratePlanId ? String(map.ratePlanId) : null;
    const ratePlanRow = ratePlanId
      ? await (prisma as any).ratePlan.findUnique({
          where: { id: ratePlanId },
          select: { id: true, rateStructure: true, planName: true, supplier: true, termMonths: true },
        })
      : null;
    const offerRateStructure = ratePlanRow?.rateStructure ?? null;
    const offerRsPresent = isRateStructurePresent(offerRateStructure);

    // TDSP for this home (current tariffs).
    const tdspSlug = String(house.tdspSlug ?? "").trim().toLowerCase();
    const tdspRates = tdspSlug ? await getTdspDeliveryRates({ tdspSlug, asOf: now }).catch(() => null) : null;
    const tdspApplied = tdspRates
      ? {
          perKwhDeliveryChargeCents: Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0,
          monthlyCustomerChargeDollars: Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0,
          effectiveDate: tdspRates?.effectiveDate ?? null,
        }
      : null;

    // Current plan: prefer latest manual entry for this house, else latest parsed plan for this house.
    const currentPlanPrisma = getCurrentPlanPrisma();
    const manualDelegate = (currentPlanPrisma as any).currentPlanManualEntry as any;
    const parsedDelegate = (currentPlanPrisma as any).parsedCurrentPlan as any;

    const latestManual = await manualDelegate.findFirst({
      where: { userId: user.id, houseId: house.id },
      orderBy: { updatedAt: "desc" },
    });
    const latestParsed = await parsedDelegate.findFirst({
      where: { userId: user.id, houseId: house.id },
      orderBy: { createdAt: "desc" },
    });

    const currentSource = latestManual ? "MANUAL" : latestParsed ? "PARSED" : null;
    const currentEntry = latestManual ?? latestParsed ?? null;
    if (!currentEntry) {
      return NextResponse.json({ ok: false, error: "no_current_plan" }, { status: 400 });
    }

    const currentRateStructure = (currentEntry as any)?.rateStructure ?? null;
    const currentRsPresent = isRateStructurePresent(currentRateStructure);

    // Derive required bucket keys from BOTH rate structures (authoritative).
    // This is what enables accurate FIXED + tiered + credits + TOU comparisons.
    const requiredKeys = (() => {
      const keys = new Set<string>();
      const addFrom = (rs: any) => {
        try {
          if (!rs) return;
          const reqs = requiredBucketsForRateStructure({ rateStructure: rs }) ?? [];
          for (const r of reqs) {
            const k = String((r as any)?.key ?? "").trim();
            if (k) keys.add(k);
          }
        } catch {
          // ignore
        }
      };
      addFrom(offerRateStructure);
      addFrom(currentRateStructure);
      keys.add("kwh.m.all.total");
      return Array.from(keys);
    })();

    // Canonical stitched buckets using the union keys.
    const bucketBuild = await buildUsageBucketsForEstimate({
      homeId: house.id,
      usageSource,
      esiid: usageSource === "SMT" ? esiid : null,
      rawId: usageSource === "GREEN_BUTTON" ? gbRawId : null,
      windowEnd,
      cutoff,
      requiredBucketKeys: requiredKeys,
      monthsCount: 12,
      maxStepDays: 2,
    });
    const yearMonths = bucketBuild.yearMonths;
    const usageBucketsByMonth = bucketBuild.usageBucketsByMonth;
    const annualKwh =
      typeof bucketBuild.annualKwh === "number" && Number.isFinite(bucketBuild.annualKwh) ? bucketBuild.annualKwh : null;

    const contractEndDateIso = (currentEntry as any)?.contractEndDate
      ? new Date((currentEntry as any).contractEndDate).toISOString()
      : null;
    const etfDollars =
      decimalToNumber((currentEntry as any)?.earlyTerminationFee) ??
      (typeof (currentEntry as any)?.earlyTerminationFeeCents === "number"
        ? Number((currentEntry as any).earlyTerminationFeeCents) / 100
        : null);
    const etfCents = typeof etfDollars === "number" && Number.isFinite(etfDollars) ? Math.round(etfDollars * 100) : 0;

    const isInContract =
      contractEndDateIso && Number.isFinite(new Date(contractEndDateIso).getTime())
        ? new Date(contractEndDateIso).getTime() > now.getTime()
        : null;

    // Offer estimate (from cache or compute).
    const offerEstimate = await (async () => {
      if (!annualKwh || !offerRsPresent || !tdspApplied || !ratePlanId) {
        return { status: "NOT_IMPLEMENTED", reason: "Missing inputs or offer template unavailable" };
      }
      const monthsCount = 12;
      const tdspPer = Number(tdspApplied.perKwhDeliveryChargeCents ?? 0) || 0;
      const tdspMonthly = Number(tdspApplied.monthlyCustomerChargeDollars ?? 0) || 0;
      const tdspEff = tdspApplied.effectiveDate ?? null;
      const rsSha = sha256HexCache(JSON.stringify(offerRateStructure ?? null));
      const usageSha = hashUsageInputs({
        yearMonths,
        bucketKeys: requiredKeys,
        usageBucketsByMonth,
      });
      const inputsSha256 = sha256HexCache(
        JSON.stringify({
          v: PLAN_ENGINE_ESTIMATE_VERSION,
          monthsCount,
          annualKwh: Number(annualKwh.toFixed(6)),
          tdsp: { per: tdspPer, monthly: tdspMonthly, effectiveDate: tdspEff },
          rsSha,
          usageSha,
        }),
      );
      const cached = await getCachedPlanEstimate({
        houseAddressId: house.id,
        ratePlanId: String(ratePlanId),
        inputsSha256,
        monthsCount,
      });
      if (cached) return cached;

      const est = estimateTrueCost({
        annualKwh,
        monthsCount,
        tdspRates: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
        rateStructure: offerRateStructure,
        usageBucketsByMonth,
      });

      await putCachedPlanEstimate({
        houseAddressId: house.id,
        ratePlanId: String(ratePlanId),
        esiid: usageSource === "SMT" ? esiid : null,
        inputsSha256,
        monthsCount,
        payloadJson: est,
      });
      return est;
    })();

    // Current-plan estimate (cache + compute).
    const currentEstimate = await (async () => {
      if (!annualKwh || !currentRsPresent || !tdspApplied) {
        return { status: "NOT_IMPLEMENTED", reason: "Missing inputs or current plan not computable" };
      }
      const monthsCount = 12;
      const tdspPer = Number(tdspApplied.perKwhDeliveryChargeCents ?? 0) || 0;
      const tdspMonthly = Number(tdspApplied.monthlyCustomerChargeDollars ?? 0) || 0;
      const tdspEff = tdspApplied.effectiveDate ?? null;
      const rsSha = sha256HexCache(JSON.stringify(currentRateStructure ?? null));
      const usageSha = hashUsageInputs({
        yearMonths,
        bucketKeys: requiredKeys,
        usageBucketsByMonth,
      });
      const inputsSha256 = sha256HexCache(
        JSON.stringify({
          v: PLAN_ENGINE_ESTIMATE_VERSION,
          monthsCount,
          annualKwh: Number(annualKwh.toFixed(6)),
          tdsp: { per: tdspPer, monthly: tdspMonthly, effectiveDate: tdspEff },
          rsSha,
          usageSha,
        }),
      );

      const syntheticRatePlanId = `current_plan:${String((currentEntry as any)?.id ?? "latest")}`;
      const cached = await getCachedPlanEstimate({
        houseAddressId: house.id,
        ratePlanId: syntheticRatePlanId,
        inputsSha256,
        monthsCount,
        endpoint: CURRENT_PLAN_ESTIMATE_ENDPOINT,
      });
      if (cached) return cached;

      const est = estimateTrueCost({
        annualKwh,
        monthsCount,
        tdspRates: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
        rateStructure: currentRateStructure,
        usageBucketsByMonth,
      });

      await putCachedPlanEstimate({
        houseAddressId: house.id,
        ratePlanId: syntheticRatePlanId,
        esiid: usageSource === "SMT" ? esiid : null,
        inputsSha256,
        monthsCount,
        payloadJson: est,
        endpoint: CURRENT_PLAN_ESTIMATE_ENDPOINT,
      });
      return est;
    })();

    return NextResponse.json(
      {
        ok: true,
        offer: {
          offerId,
          supplierName: (ratePlanRow?.supplier ?? (offer as any)?.supplier ?? null) as any,
          planName: (ratePlanRow?.planName ?? (offer as any)?.name ?? null) as any,
          termMonths: (ratePlanRow?.termMonths ?? (offer as any)?.term_months ?? null) as any,
          enrollLink,
        },
        currentPlan: {
          source: currentSource,
          id: String((currentEntry as any)?.id ?? ""),
          providerName: (currentEntry as any)?.providerName ?? (currentEntry as any)?.supplierName ?? null,
          planName: (currentEntry as any)?.planName ?? null,
          contractEndDate: contractEndDateIso,
          earlyTerminationFeeCents: etfCents,
          isInContract,
        },
        tdspApplied,
        usage: {
          source: usageSource,
          annualKwh,
          yearMonths,
          requiredBucketKeys: requiredKeys,
        },
        estimates: {
          current: currentEstimate,
          offer: offerEstimate,
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=300",
        },
      },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


