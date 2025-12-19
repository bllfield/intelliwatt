import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers } from "@/lib/wattbuy/normalize";
import { usagePrisma } from "@/lib/db/usageClient";
import { CORE_MONTHLY_BUCKETS } from "@/lib/plan-engine/usageBuckets";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import {
  calculatePlanCostForUsage,
  extractFixedRepEnergyCentsPerKwh,
  extractRepFixedMonthlyChargeDollars,
} from "@/lib/plan-engine/calculatePlanCostForUsage";
import { canComputePlanFromBuckets, derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decimalToNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && typeof v.toString === "function") {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function numOrNull(n: any): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function chicagoYearMonthParts(now: Date): { year: number; month: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
    });
    const parts = fmt.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const y = Number(get("year"));
    const m = Number(get("month"));
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
    return { year: y, month: m };
  } catch {
    return null;
  }
}

function lastNYearMonthsChicago(n: number): string[] {
  const base = chicagoYearMonthParts(new Date());
  if (!base) return [];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const idx = base.month - i;
    const y = idx >= 1 ? base.year : base.year - Math.ceil((1 - idx) / 12);
    const m0 = ((idx - 1) % 12 + 12) % 12 + 1;
    out.push(`${String(y)}-${String(m0).padStart(2, "0")}`);
  }
  return out;
}

function isRateStructurePresent(v: any): boolean {
  if (v == null) return false;
  if (typeof v === "object" && (v as any)?.toJSON?.() === null) return false;
  if (typeof v !== "object") return false;
  try {
    return Object.keys(v).length > 0;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const offerId = String(url.searchParams.get("offerId") ?? "").trim();
    const isRenter = parseBool(url.searchParams.get("isRenter"), false);
    if (!offerId) {
      return NextResponse.json({ ok: false, error: "missing_offerId" }, { status: 400 });
    }

    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    const userEmail = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true, email: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    }

    let house = await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
        esiid: true,
        tdspSlug: true,
        utilityName: true,
      },
    });
    if (!house) {
      house = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null } as any,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          addressLine1: true,
          addressCity: true,
          addressState: true,
          addressZip5: true,
          esiid: true,
          tdspSlug: true,
          utilityName: true,
        },
      });
    }
    if (!house) {
      return NextResponse.json({ ok: false, error: "no_home" }, { status: 400 });
    }

    // Load usage buckets for last 12 months (core set) and compute avg monthly usage.
    const yearMonths = lastNYearMonthsChicago(12);
    const coreKeys = CORE_MONTHLY_BUCKETS.map((b) => b.key);

    const bucketRows = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
      where: { homeId: house.id, yearMonth: { in: yearMonths }, bucketKey: { in: coreKeys } },
      select: { yearMonth: true, bucketKey: true, kwhTotal: true, computedAt: true, source: true },
    });

    const byYmKey = new Map<string, number>();
    const byYm = new Map<string, number>();
    for (const r of bucketRows ?? []) {
      const ym = String((r as any)?.yearMonth ?? "");
      const key = String((r as any)?.bucketKey ?? "");
      const kwh = decimalToNumber((r as any)?.kwhTotal);
      if (!ym || !key || kwh == null) continue;
      byYmKey.set(`${ym}||${key}`, (byYmKey.get(`${ym}||${key}`) ?? 0) + kwh);
      if (key === "kwh.m.all.total") byYm.set(ym, (byYm.get(ym) ?? 0) + kwh);
    }

    const monthsPresent = Array.from(byYm.keys()).length;
    const sumKwh = Array.from(byYm.values()).reduce((a, b) => a + b, 0);
    const avgMonthlyKwh = monthsPresent > 0 ? sumKwh / monthsPresent : null;
    const annualKwh = monthsPresent > 0 ? (sumKwh * 12) / monthsPresent : null;

    // Fetch live offers and pick the one.
    const raw = await wattbuy.offers({
      address: house.addressLine1,
      city: house.addressCity,
      state: house.addressState,
      zip: house.addressZip5,
      isRenter,
    });
    const normalized = normalizeOffers(raw ?? {});
    const offers = Array.isArray((normalized as any)?.offers) ? (normalized as any).offers : [];
    const offer = offers.find((o: any) => String(o?.offer_id ?? "") === offerId) ?? null;
    if (!offer) {
      return NextResponse.json({ ok: false, error: "offer_not_found", offerId }, { status: 404 });
    }

    // Mapping offerId -> RatePlan template
    const map = await (prisma as any).offerIdRatePlanMap.findUnique({
      where: { offerId },
      select: { offerId: true, ratePlanId: true },
    });
    const ratePlanId = map?.ratePlanId ? String(map.ratePlanId) : null;

    const ratePlanRow = ratePlanId
      ? await (prisma as any).ratePlan.findUnique({
          where: { id: ratePlanId },
          select: {
            id: true,
            planName: true,
            supplier: true,
            termMonths: true,
            repPuctCertificate: true,
            eflVersionCode: true,
            eflUrl: true,
            rateStructure: true,
            planCalcStatus: true,
            planCalcReasonCode: true,
            requiredBucketKeys: true,
            planCalcDerivedAt: true,
          },
        })
      : null;

    const rateStructure = ratePlanRow?.rateStructure ?? null;
    const rsPresent = isRateStructurePresent(rateStructure);

    // TDSP rates
    const tdspSlug = String(offer?.tdsp ?? house.tdspSlug ?? "").trim().toLowerCase();
    const tdspRates = tdspSlug ? await getTdspDeliveryRates({ tdspSlug, asOf: new Date() }).catch(() => null) : null;

    // Plan calc requirements + computability
    const derivedReq = derivePlanCalcRequirementsFromTemplate({ rateStructure: rsPresent ? rateStructure : null });
    const planCalcStatus =
      typeof ratePlanRow?.planCalcStatus === "string" ? String(ratePlanRow.planCalcStatus) : derivedReq.planCalcStatus;
    const planCalcReasonCode =
      typeof ratePlanRow?.planCalcReasonCode === "string"
        ? String(ratePlanRow.planCalcReasonCode)
        : derivedReq.planCalcReasonCode;
    const requiredBucketKeys = Array.isArray(ratePlanRow?.requiredBucketKeys) && ratePlanRow.requiredBucketKeys.length
      ? (ratePlanRow.requiredBucketKeys as any[]).map(String)
      : derivedReq.requiredBucketKeys;

    const planComputability = canComputePlanFromBuckets({
      offerId,
      ratePlanId,
      templateAvailable: Boolean(ratePlanId && rsPresent),
      template: ratePlanId && rsPresent ? { rateStructure } : null,
    });

    // Calc inputs / variables
    const repEnergyCentsPerKwh = rsPresent ? extractFixedRepEnergyCentsPerKwh(rateStructure) : null;
    const repFixedMonthlyChargeDollars = rsPresent ? extractRepFixedMonthlyChargeDollars(rateStructure) : null;
    const tdspApplied = tdspRates
      ? {
          perKwhDeliveryChargeCents: Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0,
          monthlyCustomerChargeDollars: Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0,
          effectiveDate: tdspRates?.effectiveDate ?? null,
        }
      : null;

    // True-cost estimate (if computable + inputs present)
    const trueCostEstimate =
      annualKwh && rsPresent && planComputability?.status !== "NOT_COMPUTABLE"
        ? calculatePlanCostForUsage({
            annualKwh,
            monthsCount: 12,
            tdsp: {
              perKwhDeliveryChargeCents: tdspApplied?.perKwhDeliveryChargeCents ?? 0,
              monthlyCustomerChargeDollars: tdspApplied?.monthlyCustomerChargeDollars ?? 0,
              effectiveDate: tdspApplied?.effectiveDate ?? undefined,
            },
            rateStructure,
          })
        : { status: "NOT_IMPLEMENTED", reason: "Missing inputs or plan not computable" };

    const effectiveCentsPerKwh =
      (trueCostEstimate as any)?.status === "OK" &&
      typeof (trueCostEstimate as any)?.annualCostDollars === "number" &&
      annualKwh &&
      annualKwh > 0
        ? (((trueCostEstimate as any).annualCostDollars as number) / annualKwh) * 100
        : null;

    const math =
      annualKwh && tdspApplied && typeof repEnergyCentsPerKwh === "number"
        ? {
            annualKwh,
            rep: {
              energyCentsPerKwh: repEnergyCentsPerKwh,
              energyKwhApplied: annualKwh,
              fixedMonthlyChargeDollars: repFixedMonthlyChargeDollars,
              fixedMonthsApplied: 12,
            },
            tdsp: {
              deliveryCentsPerKwh: tdspApplied.perKwhDeliveryChargeCents,
              deliveryKwhApplied: annualKwh,
              monthlyCustomerChargeDollars: tdspApplied.monthlyCustomerChargeDollars,
              fixedMonthsApplied: 12,
              effectiveDate: tdspApplied.effectiveDate,
            },
          }
        : null;

    // Buckets response (table-friendly)
    const bucketDefs = CORE_MONTHLY_BUCKETS.map((b) => ({ key: b.key, label: b.label }));
    const bucketTable = yearMonths
      .slice()
      .reverse()
      .map((ym) => {
        const row: any = { yearMonth: ym };
        for (const b of CORE_MONTHLY_BUCKETS) {
          row[b.key] = byYmKey.get(`${ym}||${b.key}`) ?? null;
        }
        return row;
      });

    return NextResponse.json(
      {
        ok: true,
        offerId,
        isRenter,
        plan: {
          supplierName: offer?.supplier_name ?? null,
          planName: offer?.plan_name ?? null,
          termMonths: typeof offer?.term_months === "number" ? offer.term_months : null,
          rateType: offer?.rate_type ?? null,
          renewablePercent: numOrNull(offer?.green_percentage),
          eflUrl: offer?.docs?.efl ?? null,
          utilityName: offer?.distributor_name ?? house.utilityName ?? null,
          tdspSlug: tdspSlug || null,
        },
        template: ratePlanRow
          ? {
              ratePlanId: ratePlanRow.id,
              repPuctCertificate: ratePlanRow.repPuctCertificate ?? null,
              eflVersionCode: ratePlanRow.eflVersionCode ?? null,
              planCalcStatus,
              planCalcReasonCode,
              requiredBucketKeys,
            }
          : null,
        usage: {
          yearMonths,
          monthsPresent,
          avgMonthlyKwh,
          annualKwh,
          bucketDefs,
          bucketTable,
        },
        variables: {
          tdsp: tdspApplied,
          rep: {
            energyCentsPerKwh: repEnergyCentsPerKwh,
            fixedMonthlyChargeDollars: repFixedMonthlyChargeDollars,
          },
        },
        math,
        outputs: {
          trueCostEstimate,
          effectiveCentsPerKwh,
        },
        notes: [
          "Bucket totals are computed in America/Chicago local time.",
          "CORE_MONTHLY_BUCKETS shown (9). More buckets will appear as plan engine v2 expands.",
        ],
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


