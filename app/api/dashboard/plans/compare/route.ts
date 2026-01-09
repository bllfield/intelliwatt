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
import { requiredBucketsForRateStructure } from "@/lib/plan-engine/requiredBucketsForPlan";
import { bucketDefsFromBucketKeys } from "@/lib/plan-engine/usageBuckets";
import { getOrComputeMaterializedPlanEstimate } from "@/lib/plan-engine/getOrComputeMaterializedPlanEstimate";
import {
  extractFixedRepEnergyCentsPerKwh,
  extractRepFixedMonthlyChargeDollars,
} from "@/lib/plan-engine/calculatePlanCostForUsage";
import { extractDeterministicTouSchedule } from "@/lib/plan-engine/touPeriods";
import { extractDeterministicTierSchedule, computeRepEnergyCostForMonthlyKwhTiered } from "@/lib/plan-engine/tieredPricing";
import { extractDeterministicBillCredits, applyBillCreditsToMonth } from "@/lib/plan-engine/billCredits";
import { extractDeterministicMinimumRules, applyMinimumRulesToMonth } from "@/lib/plan-engine/minimumRules";
import { computeMonthsRemainingOnContract } from "@/lib/current-plan/contractTerm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const MATERIALIZED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

function monthKwh(m: Record<string, number> | null | undefined, key: string): number | null {
  if (!m) return null;
  const v = (m as any)[key];
  if (v == null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
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
          select: {
            id: true,
            rateStructure: true,
            planName: true,
            supplier: true,
            termMonths: true,
            planCalcStatus: true,
            planCalcReasonCode: true,
            requiredBucketKeys: true,
          },
        })
      : null;
    const offerRateStructure = ratePlanRow?.rateStructure ?? null;
    const offerRsPresent = isRateStructurePresent(offerRateStructure);

    // TDSP for this home (current tariffs).
    // IMPORTANT: Some early onboarding flows can have usage but a missing tdspSlug on the home row.
    // Fall back to the WattBuy offer payload (it includes tdsp for the address).
    const tdspSlug =
      String(house.tdspSlug ?? "").trim().toLowerCase() ||
      String((offer as any)?.tdsp ?? "").trim().toLowerCase();

    // Use the usage window end as the "as of" date so we align with the user's most recent tariff context.
    const tdspAsOf = windowEnd ?? now;
    const tdspRates = tdspSlug ? await getTdspDeliveryRates({ tdspSlug, asOf: tdspAsOf }).catch(() => null) : null;
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

    // Merge manual + parsed so we don't lose contract end date (or other details) when the user has both.
    const mergedCurrent: any = {
      ...(latestParsed ?? {}),
      ...(latestManual ?? {}),
      // Explicit picks: prefer manual overrides, but fall back to parsed if manual is blank.
      contractEndDate: (latestManual as any)?.contractEndDate ?? (latestParsed as any)?.contractEndDate ?? null,
      earlyTerminationFee: (latestManual as any)?.earlyTerminationFee ?? (latestParsed as any)?.earlyTerminationFee ?? null,
      earlyTerminationFeeCents: (latestManual as any)?.earlyTerminationFeeCents ?? (latestParsed as any)?.earlyTerminationFeeCents ?? null,
      rateStructure: (latestManual as any)?.rateStructure ?? (latestParsed as any)?.rateStructure ?? null,
      providerName: (latestManual as any)?.providerName ?? (latestParsed as any)?.providerName ?? null,
      planName: (latestManual as any)?.planName ?? (latestParsed as any)?.planName ?? null,
    };

    const currentRateStructure = mergedCurrent?.rateStructure ?? null;
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
    const keysToLoad = Array.isArray((bucketBuild as any).keysToLoad) ? ((bucketBuild as any).keysToLoad as string[]) : requiredKeys;
    const usageBucketsByMonth = bucketBuild.usageBucketsByMonth;
    const annualKwh =
      typeof bucketBuild.annualKwh === "number" && Number.isFinite(bucketBuild.annualKwh) ? bucketBuild.annualKwh : null;
    const avgMonthlyKwh = typeof annualKwh === "number" && Number.isFinite(annualKwh) ? annualKwh / 12 : null;

    const bucketDefs = bucketDefsFromBucketKeys(keysToLoad).map((b) => ({ key: b.key, label: b.label }));
    const bucketTable = yearMonths.map((ym) => {
      const m = usageBucketsByMonth?.[ym] ?? {};
      const row: any = { yearMonth: ym };
      for (const k of keysToLoad) {
        row[k] = typeof (m as any)[k] === "number" ? (m as any)[k] : null;
      }
      return row;
    });

    const usageSnapshot = {
      source: usageSource,
      annualKwh,
      avgMonthlyKwh,
      windowEnd: windowEnd.toISOString(),
      cutoff: cutoff.toISOString(),
      yearMonths,
      requiredBucketKeys: requiredKeys,
      bucketDefs,
      bucketTable,
    };

    const contractEndDateIso = mergedCurrent?.contractEndDate
      ? new Date(mergedCurrent.contractEndDate).toISOString()
      : null;
    const etfDollars =
      decimalToNumber(mergedCurrent?.earlyTerminationFee) ??
      (typeof mergedCurrent?.earlyTerminationFeeCents === "number"
        ? Number(mergedCurrent.earlyTerminationFeeCents) / 100
        : null);
    const etfCents = typeof etfDollars === "number" && Number.isFinite(etfDollars) ? Math.round(etfDollars * 100) : 0;

    const isInContract =
      contractEndDateIso && Number.isFinite(new Date(contractEndDateIso).getTime())
        ? new Date(contractEndDateIso).getTime() > now.getTime()
        : null;

    const contractAsOfIso = windowEnd ? windowEnd.toISOString() : now.toISOString();
    const monthsRemainingOnContract = computeMonthsRemainingOnContract({
      contractEndDate: contractEndDateIso,
      asOf: windowEnd ?? now,
    });

    // Offer estimate (from cache or compute).
    const offerEstimate = await (async () => {
      if (!annualKwh || !offerRsPresent || !tdspApplied || !ratePlanId) {
        return { status: "NOT_IMPLEMENTED", reason: "Missing inputs or offer template unavailable" };
      }
      const monthsCount = 12;
      const estimateMode =
        String((ratePlanRow as any)?.planCalcReasonCode ?? "").trim() === "INDEXED_APPROXIMATE_OK"
          ? ("INDEXED_EFL_ANCHOR_APPROX" as const)
          : ("DEFAULT" as const);
      const tdspPer = Number(tdspApplied.perKwhDeliveryChargeCents ?? 0) || 0;
      const tdspMonthly = Number(tdspApplied.monthlyCustomerChargeDollars ?? 0) || 0;
      const tdspEff = tdspApplied.effectiveDate ?? null;

      const { payload } = await getOrComputeMaterializedPlanEstimate({
        houseAddressId: house.id,
        ratePlanId: String(ratePlanId),
        monthsCount,
        annualKwh,
        tdsp: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
        rateStructure: offerRateStructure,
        yearMonths,
        requiredBucketKeys: requiredKeys,
        usageBucketsByMonth,
        estimateMode,
        expiresAt: new Date(Date.now() + MATERIALIZED_TTL_MS),
      });
      return payload as any;
    })();

    // Current-plan estimate (cache + compute).
    const currentEstimate = await (async () => {
      if (!annualKwh || !currentRsPresent || !tdspApplied) {
        return { status: "NOT_IMPLEMENTED", reason: "Missing inputs or current plan not computable" };
      }
      const monthsCount = 12;
      const estimateMode =
        String((currentRateStructure as any)?.type ?? "").trim().toUpperCase() === "VARIABLE" ||
        String((currentRateStructure as any)?.type ?? "").trim().toUpperCase() === "INDEXED"
          ? ("INDEXED_EFL_ANCHOR_APPROX" as const)
          : ("DEFAULT" as const);
      const syntheticRatePlanId = `current_plan:${String((currentEntry as any)?.id ?? "latest")}`;
      const tdspPer = Number(tdspApplied.perKwhDeliveryChargeCents ?? 0) || 0;
      const tdspMonthly = Number(tdspApplied.monthlyCustomerChargeDollars ?? 0) || 0;
      const tdspEff = tdspApplied.effectiveDate ?? null;

      const { payload } = await getOrComputeMaterializedPlanEstimate({
        houseAddressId: house.id,
        ratePlanId: syntheticRatePlanId,
        monthsCount,
        annualKwh,
        tdsp: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
        rateStructure: currentRateStructure,
        yearMonths,
        requiredBucketKeys: requiredKeys,
        usageBucketsByMonth,
        estimateMode,
        expiresAt: new Date(Date.now() + MATERIALIZED_TTL_MS),
      });
      return payload as any;
    })();

    const buildVariablesList = (args: {
      rateStructure: any;
      tdspApplied: any | null;
    }): Array<{ key: string; label: string; value: string }> => {
      const out: Array<{ key: string; label: string; value: string }> = [];
      const rs = args.rateStructure;
      const rsPresent = isRateStructurePresent(rs);

      const rt = String(rs?.type ?? "").trim().toUpperCase();
      const repEnergyFixed = rsPresent ? extractFixedRepEnergyCentsPerKwh(rs) : null;
      const repFixedMonthly = rsPresent ? extractRepFixedMonthlyChargeDollars(rs) : null;

      if (rsPresent) {
        const creditsMaybe = extractDeterministicBillCredits(rs);
        const minimumMaybe = extractDeterministicMinimumRules({ rateStructure: rs });
        const tieredMaybe = extractDeterministicTierSchedule(rs);
        const touMaybe = extractDeterministicTouSchedule(rs);

        if (touMaybe?.schedule?.periods?.length) {
          out.push({ key: "rep.tou_periods", label: "REP time-of-use periods", value: String(touMaybe.schedule.periods.length) });
        } else if (rt === "TIME_OF_USE" && Array.isArray(rs?.tiers)) {
          out.push({ key: "rep.tou_tiers", label: "REP time-of-use tiers", value: String(rs.tiers.length) });
        } else if (tieredMaybe?.ok) {
          out.push({ key: "rep.tiered", label: "REP tiered pricing", value: "Yes" });
        } else if (rt === "VARIABLE") {
          const cents = typeof rs?.currentBillEnergyRateCents === "number" ? rs.currentBillEnergyRateCents : null;
          out.push({ key: "rep.energy", label: "REP energy (current bill)", value: cents != null ? `${Number(cents).toFixed(4)}¢/kWh` : "—" });
        } else if (typeof repEnergyFixed === "number" && Number.isFinite(repEnergyFixed)) {
          out.push({ key: "rep.energy", label: "REP energy", value: `${repEnergyFixed.toFixed(4)}¢/kWh` });
        } else {
          out.push({ key: "rep.energy", label: "REP energy", value: "—" });
        }

        out.push({
          key: "rep.fixed",
          label: "REP fixed",
          value: typeof repFixedMonthly === "number" && Number.isFinite(repFixedMonthly) ? `$${repFixedMonthly.toFixed(2)}/mo` : "—/mo",
        });

        if (creditsMaybe?.ok && Array.isArray((creditsMaybe as any).credits) && (creditsMaybe as any).credits.length > 0) {
          out.push({ key: "rep.credits", label: "Bill credits", value: `${(creditsMaybe as any).credits.length} rule(s)` });
        }
        if (minimumMaybe?.ok) {
          out.push({ key: "rep.minimums", label: "Minimum bill rules", value: "Yes" });
        }
      }

      // TDSP variables (or delivery included flag).
      out.push({
        key: "tdsp.included",
        label: "TDSP delivery included in REP rate",
        value: rs?.tdspDeliveryIncludedInEnergyCharge === true ? "Yes" : "No",
      });

      if (args.tdspApplied && rs?.tdspDeliveryIncludedInEnergyCharge !== true) {
        out.push({
          key: "tdsp.delivery",
          label: "TDSP delivery",
          value: `${Number(args.tdspApplied.perKwhDeliveryChargeCents ?? 0).toFixed(4)}¢/kWh`,
        });
        out.push({
          key: "tdsp.customer",
          label: "TDSP customer",
          value: `$${Number(args.tdspApplied.monthlyCustomerChargeDollars ?? 0).toFixed(2)}/mo`,
        });
        if (args.tdspApplied.effectiveDate) {
          out.push({ key: "tdsp.effective", label: "TDSP effective", value: String(args.tdspApplied.effectiveDate).slice(0, 10) });
        }
      }

      return out;
    };

    const buildMonthlyBreakdown = (args: {
      rateStructure: any;
      tdspApplied: any | null;
      usageBucketsByMonth: Record<string, Record<string, number>>;
      yearMonths: string[];
      trueCostEstimate: any;
    }): any | null => {
      const rs = args.rateStructure;
      const rsPresent = isRateStructurePresent(rs);
      if (!rsPresent || !args.tdspApplied) return null;
      if (String(args.trueCostEstimate?.status ?? "") !== "OK") return null;

      const byMonth = args.usageBucketsByMonth ?? {};
      const monthsAll = args.yearMonths?.slice?.() ?? Object.keys(byMonth).sort();
      const months = monthsAll.slice(-12);
      if (months.length <= 0) return null;

      const tdspPerKwhCents = Number(args.tdspApplied.perKwhDeliveryChargeCents ?? 0) || 0;
      const tdspMonthly = Number(args.tdspApplied.monthlyCustomerChargeDollars ?? 0) || 0;
      const repFixedMonthly = extractRepFixedMonthlyChargeDollars(rs) ?? 0;

      const creditsMaybe = extractDeterministicBillCredits(rs);
      const minimumMaybe = extractDeterministicMinimumRules({ rateStructure: rs });
      const tieredMaybe = extractDeterministicTierSchedule(rs);
      const touMaybe = extractDeterministicTouSchedule(rs);
      const repFixedEnergyCents = extractFixedRepEnergyCentsPerKwh(rs);

      const repBuckets: Array<{ bucketKey: string; label: string }> = (() => {
        if (touMaybe?.schedule?.periods?.length) {
          const uniq = new Map<string, { bucketKey: string; label: string }>();
          for (const p of touMaybe.schedule.periods) {
            const dayType = String((p as any)?.dayType ?? "").trim();
            const startHHMM = String((p as any)?.startHHMM ?? "").trim();
            const endHHMM = String((p as any)?.endHHMM ?? "").trim();
            if (!dayType || !startHHMM || !endHHMM) continue;
            const bucketKey =
              startHHMM === "0000" && endHHMM === "2400"
                ? `kwh.m.${dayType}.total`
                : `kwh.m.${dayType}.${startHHMM}-${endHHMM}`;
            const labelRaw = (p as any)?.label ?? null;
            const label =
              typeof labelRaw === "string" && labelRaw.trim()
                ? labelRaw.trim()
                : `${dayType.toUpperCase()} ${startHHMM}-${endHHMM}`;
            if (!uniq.has(bucketKey)) uniq.set(bucketKey, { bucketKey, label });
          }
          return Array.from(uniq.values());
        }
        return [{ bucketKey: "kwh.m.all.total", label: "ALL 00:00-24:00" }];
      })();

      const rows: any[] = months.map((ym) => {
        const m = byMonth[ym] ?? {};
        const totalKwh = monthKwh(m, "kwh.m.all.total") ?? 0;

        const tdspDeliveryCents =
          rs?.tdspDeliveryIncludedInEnergyCharge === true ? 0 : totalKwh * tdspPerKwhCents;
        const tdspFixedCents = rs?.tdspDeliveryIncludedInEnergyCharge === true ? 0 : tdspMonthly * 100;
        const repFixedCents = repFixedMonthly * 100;

        const repBucketLines = repBuckets.map((b) => {
          const kwh = monthKwh(m, b.bucketKey) ?? 0;
          let repCentsPerKwh: number | null = null;
          let repCostCents: number | null = null;
          let notes: string[] = [];

          if (tieredMaybe?.ok) {
            const tiered = computeRepEnergyCostForMonthlyKwhTiered({
              monthlyKwh: totalKwh,
              schedule: tieredMaybe.schedule,
            });
            repCostCents = tiered.repEnergyCentsTotal;
            repCentsPerKwh = totalKwh > 0 ? repCostCents / totalKwh : null;
            notes = ["tiered"];
          } else if (touMaybe?.schedule?.periods?.length) {
            const p = (touMaybe as any).schedule.periods.find((pp: any) => {
              const dayType = String(pp?.dayType ?? "").trim();
              const startHHMM = String(pp?.startHHMM ?? "").trim();
              const endHHMM = String(pp?.endHHMM ?? "").trim();
              const key =
                startHHMM === "0000" && endHHMM === "2400"
                  ? `kwh.m.${dayType}.total`
                  : `kwh.m.${dayType}.${startHHMM}-${endHHMM}`;
              return key === b.bucketKey;
            });
            const cents =
              typeof p?.repEnergyCentsPerKwh === "number" ? p.repEnergyCentsPerKwh : null;
            repCentsPerKwh = cents;
            repCostCents = kwh * (cents ?? 0);
          } else if (typeof repFixedEnergyCents === "number") {
            repCentsPerKwh = repFixedEnergyCents;
            repCostCents = kwh * repFixedEnergyCents;
          }

          const repCostDollars = repCostCents != null ? round2(repCostCents / 100) : null;

          return {
            bucketKey: b.bucketKey,
            label: b.label,
            kwh,
            repCentsPerKwh,
            repCostDollars,
            notes: notes.length ? notes : null,
          };
        });

        const repEnergyCents = repBucketLines.reduce(
          (acc, x: any) => acc + (typeof x?.repCostDollars === "number" ? x.repCostDollars * 100 : 0),
          0,
        );

        const creditsApplied =
          creditsMaybe?.ok && totalKwh != null ? applyBillCreditsToMonth({ monthlyKwh: totalKwh, credits: creditsMaybe.credits }) : null;
        const creditsCents = creditsApplied ? creditsApplied.creditCentsTotal : 0;

        const subtotalCentsRaw =
          (repEnergyCents || 0) +
          repFixedCents +
          tdspFixedCents +
          (tdspDeliveryCents ?? 0) +
          creditsCents;

        let minUsageFeeCents = 0;
        let minBillTopUpCents = 0;
        let finalCents = Math.max(0, Math.round(subtotalCentsRaw));
        if (minimumMaybe?.ok && totalKwh != null) {
          const appliedMin = applyMinimumRulesToMonth({
            monthlyKwh: totalKwh,
            minimum: minimumMaybe.minimum,
            subtotalCents: Math.round(subtotalCentsRaw),
          });
          minUsageFeeCents = appliedMin.minUsageFeeCents;
          minBillTopUpCents = appliedMin.minimumBillTopUpCents;
          finalCents = appliedMin.totalCentsAfter;
        }

        return {
          yearMonth: ym,
          bucketTotalKwh: totalKwh,
          repBuckets: repBucketLines,
          tdsp: {
            perKwhDeliveryChargeCents: rs?.tdspDeliveryIncludedInEnergyCharge === true ? 0 : tdspPerKwhCents,
            deliveryDollars: tdspDeliveryCents != null ? round2(tdspDeliveryCents / 100) : null,
            monthlyCustomerChargeDollars: round2(tdspMonthly),
          },
          repFixedMonthlyChargeDollars: round2(repFixedMonthly),
          creditsDollars: creditsApplied ? round2(creditsCents / 100) : null,
          minimumUsageFeeDollars: minimumMaybe?.ok ? round2(minUsageFeeCents / 100) : null,
          minimumBillTopUpDollars: minimumMaybe?.ok ? round2(minBillTopUpCents / 100) : null,
          totalDollars: round2(finalCents / 100),
        };
      });

      const totals = (() => {
        const annualCents = rows.reduce((acc: number, r: any) => acc + (typeof r?.totalDollars === "number" ? Math.round(r.totalDollars * 100) : 0), 0);
        const annualFromRows = round2(annualCents / 100);
        const expectedAnnual = typeof (args.trueCostEstimate as any)?.annualCostDollars === "number" ? (args.trueCostEstimate as any).annualCostDollars : null;
        const expectedAnnualCents =
          typeof expectedAnnual === "number" && Number.isFinite(expectedAnnual) ? Math.round(expectedAnnual * 100) : null;
        const deltaCents =
          expectedAnnualCents != null ? (annualCents - expectedAnnualCents) : null;
        return { annualFromRows, expectedAnnual, deltaCents };
      })();

      return {
        monthsCount: months.length,
        repBuckets,
        rows,
        totals,
      };
    };

    const buildDetailForPlan = (args: {
      label: "current" | "offer";
      rateStructure: any;
      trueCostEstimate: any;
      requiredBucketKeys: string[];
      template: any | null;
    }) => {
      const variablesList = buildVariablesList({ rateStructure: args.rateStructure, tdspApplied });
      const effectiveCentsPerKwh =
        (String(args.trueCostEstimate?.status ?? "") === "OK" || String(args.trueCostEstimate?.status ?? "") === "APPROXIMATE") &&
        typeof args.trueCostEstimate?.annualCostDollars === "number" &&
        annualKwh &&
        annualKwh > 0
          ? (Number(args.trueCostEstimate.annualCostDollars) / annualKwh) * 100
          : null;

      const math = {
        status: String(args.trueCostEstimate?.status ?? ""),
        reason: (args.trueCostEstimate as any)?.reason ?? null,
        requiredBucketKeys: args.requiredBucketKeys,
        componentsV2: (args.trueCostEstimate as any)?.componentsV2 ?? null,
        components: (args.trueCostEstimate as any)?.components ?? null,
      };

      const monthlyBreakdown = buildMonthlyBreakdown({
        rateStructure: args.rateStructure,
        tdspApplied,
        usageBucketsByMonth,
        yearMonths,
        trueCostEstimate: args.trueCostEstimate,
      });

      return {
        template: args.template,
        variablesList,
        variables: {
          rep: {
            energyCentsPerKwh: extractFixedRepEnergyCentsPerKwh(args.rateStructure),
            fixedMonthlyChargeDollars: extractRepFixedMonthlyChargeDollars(args.rateStructure),
          },
          tdsp: tdspApplied,
        },
        outputs: {
          trueCostEstimate: args.trueCostEstimate,
          effectiveCentsPerKwh,
        },
        math,
        monthlyBreakdown,
      };
    };

    const offerRequiredBucketKeys =
      Array.isArray((ratePlanRow as any)?.requiredBucketKeys) && (ratePlanRow as any).requiredBucketKeys.length
        ? ((ratePlanRow as any).requiredBucketKeys as any[]).map(String)
        : (requiredBucketsForRateStructure({ rateStructure: offerRateStructure }) ?? []).map((r: any) => String(r?.key ?? "")).filter(Boolean);
    const currentRequiredBucketKeys =
      (requiredBucketsForRateStructure({ rateStructure: currentRateStructure }) ?? []).map((r: any) => String(r?.key ?? "")).filter(Boolean);

    const offerDetail = buildDetailForPlan({
      label: "offer",
      rateStructure: offerRateStructure,
      trueCostEstimate: offerEstimate,
      requiredBucketKeys: offerRequiredBucketKeys,
      template: ratePlanRow
        ? {
            ratePlanId: String(ratePlanRow.id),
            planCalcStatus: String((ratePlanRow as any)?.planCalcStatus ?? ""),
            planCalcReasonCode: String((ratePlanRow as any)?.planCalcReasonCode ?? ""),
          }
        : null,
    });
    const currentDetail = buildDetailForPlan({
      label: "current",
      rateStructure: currentRateStructure,
      trueCostEstimate: currentEstimate,
      requiredBucketKeys: currentRequiredBucketKeys,
      template: {
        ratePlanId: `current_plan:${String((currentEntry as any)?.id ?? "latest")}`,
        planCalcStatus: "CURRENT_PLAN",
        planCalcReasonCode: currentSource ?? null,
      },
    });

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
          providerName: mergedCurrent?.providerName ?? (currentEntry as any)?.providerName ?? (currentEntry as any)?.supplierName ?? null,
          planName: mergedCurrent?.planName ?? (currentEntry as any)?.planName ?? null,
          contractEndDate: contractEndDateIso,
          earlyTerminationFeeCents: etfCents,
          isInContract,
          contractAsOf: contractAsOfIso,
          monthsRemainingOnContract,
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
        detail: {
          usage: usageSnapshot,
          current: currentDetail,
          offer: offerDetail,
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


