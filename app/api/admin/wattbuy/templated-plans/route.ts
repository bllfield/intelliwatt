import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers } from "@/lib/wattbuy/normalize";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type TdspDelivery = { monthlyFeeCents: number; deliveryCentsPerKwh: number };
type TdspSnapshotMeta = TdspDelivery & { tdspCode: string; snapshotAt: string };

function mapUtilityIdToTdspCode(utilityId: string | null | undefined): string | null {
  const u = String(utilityId ?? "").trim();
  if (!u) return null;
  const upper = u.toUpperCase();
  // Already normalized TdspCode (manual loader tends to write these).
  if (["ONCOR", "CENTERPOINT", "AEP_NORTH", "AEP_CENTRAL", "TNMP"].includes(upper)) return upper;
  // WattBuy utilityIDs (EIDs) we see in practice.
  const byWattbuyId: Record<string, string> = {
    "44372": "ONCOR",
    "8901": "CENTERPOINT",
    "20404": "AEP_NORTH",
    "3278": "AEP_CENTRAL",
    "40051": "TNMP",
  };
  return byWattbuyId[u] ?? null;
}

function inferTermMonths(planName: string | null | undefined): number | null {
  if (!planName) return null;
  const s = String(planName);
  // Strongest: explicit "mo/month" tokens
  const m1 = s.match(/\b(\d{1,2})\s*(?:mo|mos|month|months)\b/i);
  if (m1) {
    const n = Number(m1[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
  }

  // Next: trailing number (e.g., "Solarize 15")
  const m2 = s.match(/\b(\d{1,2})\b\s*$/);
  if (m2) {
    const n = Number(m2[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
  }

  // Next: "-12" suffix pattern (avoid big IDs by limiting to 1-2 digits)
  const m3 = s.match(/-(\d{1,2})\b/);
  if (m3) {
    const n = Number(m3[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
  }

  return null;
}

function toNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function computeAvgCentsPerKwhFromRateStructure(
  rateStructure: any,
  usageKwh: number,
): number | null {
  if (!rateStructure || typeof rateStructure !== "object") return null;
  if (!Number.isFinite(usageKwh) || usageKwh <= 0) return null;

  const type = String(rateStructure.type ?? "").toUpperCase();
  const baseFee = toNum(rateStructure.baseMonthlyFeeCents) ?? 0;

  const usageTiers: any[] | null = Array.isArray(rateStructure.usageTiers)
    ? rateStructure.usageTiers
    : null;

  const computeTieredEnergyCents = (): number | null => {
    if (!usageTiers || usageTiers.length === 0) return null;
    const tiers = usageTiers
      .map((t) => ({
        // Support multiple historical tier field variants.
        // Canonical: { minKWh, maxKWh, centsPerKWh }
        // Legacy/admin: { minimumUsageKWh, maximumUsageKwh, energyChargeCentsPerkWh }
        minKWh:
          toNum(
            (t as any).minKWh ??
              (t as any).minKwh ??
              (t as any).minimumUsageKWh ??
              (t as any).minimumUsageKwh ??
              (t as any).tierMinKWh ??
              (t as any).tierMinKwh ??
              0,
          ) ?? 0,
        maxKWh: toNum(
          (t as any).maxKWh ??
            (t as any).maxKwh ??
            (t as any).maximumUsageKWh ??
            (t as any).maximumUsageKwh ??
            (t as any).tierMaxKWh ??
            (t as any).tierMaxKwh ??
            null,
        ),
        centsPerKWh: toNum(
          (t as any).centsPerKWh ??
            (t as any).priceCents ??
            (t as any).rateCentsPerKwh ??
            (t as any).energyChargeCentsPerkWh ??
            (t as any).energyChargeCentsPerKwh,
        ),
      }))
      .filter((t) => Number.isFinite(t.minKWh) && typeof t.centsPerKWh === "number")
      .sort((a, b) => a.minKWh - b.minKWh);

    if (tiers.length === 0) return null;

    let remaining = usageKwh;
    let energyCents = 0;

    for (let i = 0; i < tiers.length && remaining > 0; i++) {
      const t = tiers[i];
      const nextMin = tiers[i + 1]?.minKWh ?? null;
      const upper =
        typeof t.maxKWh === "number"
          ? t.maxKWh
          : typeof nextMin === "number"
            ? nextMin
            : null;
      const span = upper != null ? Math.max(0, upper - t.minKWh) : remaining;
      const kwhInTier = Math.min(remaining, span);
      if (kwhInTier <= 0) continue;
      energyCents += kwhInTier * (t.centsPerKWh as number);
      remaining -= kwhInTier;
    }

    // If there is remaining usage beyond the last tier, bill it at the last tier's rate.
    if (remaining > 0) {
      const last = tiers[tiers.length - 1];
      if (typeof last?.centsPerKWh === "number") {
        energyCents += remaining * last.centsPerKWh;
      }
    }

    return energyCents;
  };

  const computeFlatEnergyCents = (centsPerKwh: number | null): number | null => {
    if (typeof centsPerKwh !== "number") return null;
    return usageKwh * centsPerKwh;
  };

  let energyCents: number | null = null;
  if (usageTiers && usageTiers.length > 0) {
    energyCents = computeTieredEnergyCents();
  }

  if (energyCents == null) {
    if (type === "FIXED") {
      // Some stored shapes use defaultRateCentsPerKwh rather than energyRateCents.
      energyCents = computeFlatEnergyCents(
        toNum(rateStructure.energyRateCents) ?? toNum(rateStructure.defaultRateCentsPerKwh),
      );
    } else if (type === "VARIABLE") {
      energyCents = computeFlatEnergyCents(toNum(rateStructure.currentBillEnergyRateCents));
    } else {
      // TIME_OF_USE requires usage distribution; we don't guess.
      return null;
    }
  }

  const credits = rateStructure.billCredits;
  let billCreditCents = 0;
  if (credits && credits.hasBillCredit && Array.isArray(credits.rules)) {
    for (const r of credits.rules) {
      const credit = toNum((r as any).creditAmountCents);
      const min = toNum((r as any).minUsageKWh) ?? 0;
      const max = toNum((r as any).maxUsageKWh ?? null);
      if (typeof credit !== "number" || credit <= 0) continue;
      const okMin = usageKwh >= min;
      const okMax = max == null ? true : usageKwh <= max;
      if (okMin && okMax) {
        billCreditCents += credit;
      }
    }
  }

  const totalCents = (energyCents ?? 0) + baseFee - billCreditCents;
  return totalCents / usageKwh;
}

function computeAllInAvgCentsPerKwhFromRateStructure(
  rateStructure: any,
  usageKwh: number,
  tdsp: TdspDelivery | null,
): number | null {
  const supplyAvg = computeAvgCentsPerKwhFromRateStructure(rateStructure, usageKwh);
  if (supplyAvg == null) return null;
  // If the REP rate already includes TDSP delivery, do NOT add utility delivery charges.
  if (rateStructure?.tdspDeliveryIncludedInEnergyCharge === true) return supplyAvg;
  // "All-in model" requires a known TDSP tariff snapshot; otherwise we don't show a misleading value.
  if (!tdsp) return null;
  const tdspMonthly = toNum(tdsp.monthlyFeeCents) ?? 0;
  const tdspPerKwh = toNum(tdsp.deliveryCentsPerKwh) ?? 0;
  const totalCents = supplyAvg * usageKwh + tdspMonthly + tdspPerKwh * usageKwh;
  return totalCents / usageKwh;
}

type Row = {
  id: string;
  utilityId: string;
  state: string;
  supplier: string | null;
  planName: string | null;
  termMonths: number | null;
  rate500: number | null;
  rate1000: number | null;
  rate2000: number | null;
  modeledRate500: number | null;
  modeledRate1000: number | null;
  modeledRate2000: number | null;
  modeledTdspCode: string | null;
  modeledTdspSnapshotAt: string | null;
  modeledSource?: "DB_VALIDATION" | "COMPUTED_TDSP_SNAPSHOT" | "NONE";
  validationStatus?: "PASS" | "FAIL" | "SKIP" | null;
  passStrength?: "STRONG" | "WEAK" | "INVALID" | null;
  cancelFee: string | null;
  eflUrl: string | null;
  eflPdfSha256: string | null;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  eflRequiresManualReview: boolean;
  updatedAt: string;
  lastSeenAt: string;
  rateStructure: unknown;
};

type Ok = {
  ok: true;
  count: number;
  totalCount: number;
  limit: number;
  rows: Row[];
  offerCount?: number;
  mappedOfferCount?: number;
};

type Err = { ok: false; error: string; details?: unknown };

function jsonError(status: number, error: string, details?: unknown) {
  const body: Err = { ok: false, error, ...(details ? { details } : {}) };
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "200");
    const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 200));

    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const address = (req.nextUrl.searchParams.get("address") ?? "").trim();
    const city = (req.nextUrl.searchParams.get("city") ?? "").trim();
    const state = (req.nextUrl.searchParams.get("state") ?? "").trim();
    const zip = (req.nextUrl.searchParams.get("zip") ?? "").trim();

    const hasAddressFilter = Boolean(address && city && state && zip);

    const where: any = {
      // “Templated” means we already have a usable engine structure persisted.
      rateStructure: { not: null },
      eflRequiresManualReview: false,
      isUtilityTariff: false,
      ...(q
        ? {
            OR: [
              { supplier: { contains: q, mode: "insensitive" } },
              { planName: { contains: q, mode: "insensitive" } },
              { eflVersionCode: { contains: q, mode: "insensitive" } },
              { repPuctCertificate: { contains: q, mode: "insensitive" } },
              { eflPdfSha256: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    let offerCount: number | undefined = undefined;
    let mappedOfferCount: number | undefined = undefined;

    if (hasAddressFilter) {
      // Filter templates to only those linked to offers currently available for the requested home.
      // This uses OfferIdRatePlanMap (canonical offer_id → RatePlan.id mapping).
      const rawOffers = await wattbuy.offers({ address, city, state, zip });
      const normalized = normalizeOffers(rawOffers ?? {});
      const offerIds = normalized.offers.map((o) => o.offer_id).filter(Boolean);
      offerCount = offerIds.length;

      if (offerIds.length === 0) {
        const body: Ok = { ok: true, count: 0, totalCount: 0, limit, rows: [], offerCount: 0, mappedOfferCount: 0 };
        return NextResponse.json(body);
      }

      const maps = await (prisma as any).offerIdRatePlanMap.findMany({
        where: { offerId: { in: offerIds }, ratePlanId: { not: null } },
        select: { offerId: true, ratePlanId: true },
      });

      const ratePlanIds = Array.from(
        new Set(
          (maps as Array<{ ratePlanId: string | null }>).map((m) => m.ratePlanId).filter(Boolean) as string[],
        ),
      );
      mappedOfferCount = ratePlanIds.length;

      // If WattBuy offers exist but none are mapped to templates yet, return empty.
      if (ratePlanIds.length === 0) {
        const body: Ok = {
          ok: true,
          count: 0,
          totalCount: 0,
          limit,
          rows: [],
          offerCount,
          mappedOfferCount: 0,
        };
        return NextResponse.json(body);
      }

      where.id = { in: ratePlanIds };
    }

    const plans = await (prisma as any).ratePlan.findMany({
      where,
      select: {
        id: true,
        utilityId: true,
        state: true,
        supplier: true,
        planName: true,
        termMonths: true,
        rate500: true,
        rate1000: true,
        rate2000: true,
        modeledRate500: true,
        modeledRate1000: true,
        modeledRate2000: true,
        modeledEflAvgPriceValidation: true,
        modeledComputedAt: true,
        cancelFee: true,
        eflUrl: true,
        eflPdfSha256: true,
        repPuctCertificate: true,
        eflVersionCode: true,
        eflRequiresManualReview: true,
        isUtilityTariff: true,
        updatedAt: true,
        lastSeenAt: true,
        rateStructure: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
    });

    const totalCount = await (prisma as any).ratePlan.count({ where });

    const tdspCache = new Map<string, Promise<TdspSnapshotMeta | null>>();
    const getTdsp = async (utilId: string): Promise<TdspSnapshotMeta | null> => {
      const code = mapUtilityIdToTdspCode(utilId);
      if (!code) return null;
      const cached = tdspCache.get(code);
      if (cached) return cached;
      const p = (async () => {
        const at = new Date();
        const row =
          (await (prisma as any).tdspRateSnapshot.findFirst({
            where: { tdsp: code, effectiveAt: { lte: at } },
            orderBy: { effectiveAt: "desc" },
          })) ||
          (await (prisma as any).tdspRateSnapshot.findFirst({
            where: { tdsp: code },
            orderBy: { createdAt: "desc" },
          }));
        if (!row) return null;
        const payload: any = row.payload ?? {};
        const snapAt = (row.effectiveAt ?? row.createdAt) as Date;
        return {
          tdspCode: code,
          snapshotAt: new Date(snapAt).toISOString(),
          monthlyFeeCents: Number(payload?.monthlyFeeCents || 0),
          deliveryCentsPerKwh: Number(payload?.deliveryCentsPerKwh || 0),
        } satisfies TdspSnapshotMeta;
      })();
      tdspCache.set(code, p);
      return p;
    };

    const rows: Row[] = await Promise.all(
      (plans as any[]).map(async (p) => {
        const rsObj: any = p.rateStructure && typeof p.rateStructure === "object" ? p.rateStructure : null;
        const v = rsObj?.__eflAvgPriceValidation ?? null;
        const embeddedStrength =
          (rsObj?.__eflAvgPriceEvidence?.passStrength as any) ?? null;
        const embeddedStatus = (v?.status as any) ?? null;
        const points: any[] = Array.isArray(v?.points) ? v.points : [];
        const modeledFromDb = (kwh: number): number | null => {
          const hit = points.find(
            (x: any) => Number(x?.usageKwh ?? x?.kwh ?? x?.usage) === kwh,
          );
          const n = Number(
            hit?.modeledAvgCentsPerKwh ??
              hit?.modeledAvgPriceCentsPerKwh ??
              hit?.modeledCentsPerKwh,
          );
          return Number.isFinite(n) ? n : null;
        };
        const modeledDb500 = modeledFromDb(500);
        const modeledDb1000 = modeledFromDb(1000);
        const modeledDb2000 = modeledFromDb(2000);

        // Prefer the explicit modeled columns (evidence at persistence/backfill time),
        // but fall back to embedded RateStructure proof for older rows.
        const modeledCol500 = typeof p.modeledRate500 === "number" ? p.modeledRate500 : null;
        const modeledCol1000 = typeof p.modeledRate1000 === "number" ? p.modeledRate1000 : null;
        const modeledCol2000 = typeof p.modeledRate2000 === "number" ? p.modeledRate2000 : null;

        const effectiveDb500 = modeledCol500 ?? modeledDb500;
        const effectiveDb1000 = modeledCol1000 ?? modeledDb1000;
        const effectiveDb2000 = modeledCol2000 ?? modeledDb2000;

        const tdsp = await getTdsp(p.utilityId);
        const modeledSource: Row["modeledSource"] =
          typeof effectiveDb500 === "number" || typeof effectiveDb1000 === "number" || typeof effectiveDb2000 === "number"
            ? "DB_VALIDATION"
            : tdsp
              ? "COMPUTED_TDSP_SNAPSHOT"
              : "NONE";
        return {
          id: p.id,
          utilityId: p.utilityId,
          state: p.state,
          supplier: p.supplier ?? null,
          planName: p.planName ?? null,
          termMonths:
            typeof p.termMonths === "number"
              ? p.termMonths
              : inferTermMonths(p.planName ?? null),
          rate500:
            typeof p.rate500 === "number"
              ? p.rate500
              : computeAvgCentsPerKwhFromRateStructure(p.rateStructure, 500),
          rate1000:
            typeof p.rate1000 === "number"
              ? p.rate1000
              : computeAvgCentsPerKwhFromRateStructure(p.rateStructure, 1000),
          rate2000:
            typeof p.rate2000 === "number"
              ? p.rate2000
              : computeAvgCentsPerKwhFromRateStructure(p.rateStructure, 2000),
          modeledRate500:
            typeof effectiveDb500 === "number"
              ? effectiveDb500
              : computeAllInAvgCentsPerKwhFromRateStructure(p.rateStructure, 500, tdsp),
          modeledRate1000:
            typeof effectiveDb1000 === "number"
              ? effectiveDb1000
              : computeAllInAvgCentsPerKwhFromRateStructure(p.rateStructure, 1000, tdsp),
          modeledRate2000:
            typeof effectiveDb2000 === "number"
              ? effectiveDb2000
              : computeAllInAvgCentsPerKwhFromRateStructure(p.rateStructure, 2000, tdsp),
          modeledTdspCode: tdsp?.tdspCode ?? null,
          modeledTdspSnapshotAt: tdsp?.snapshotAt ?? null,
          modeledSource,
          validationStatus:
            embeddedStatus === "PASS" || embeddedStatus === "FAIL" || embeddedStatus === "SKIP"
              ? embeddedStatus
              : null,
          passStrength:
            embeddedStrength === "STRONG" || embeddedStrength === "WEAK" || embeddedStrength === "INVALID"
              ? embeddedStrength
              : null,
          cancelFee: p.cancelFee ?? null,
          eflUrl: p.eflUrl ?? null,
          eflPdfSha256: p.eflPdfSha256 ?? null,
          repPuctCertificate: p.repPuctCertificate ?? null,
          eflVersionCode: p.eflVersionCode ?? null,
          eflRequiresManualReview: Boolean(p.eflRequiresManualReview),
          updatedAt: new Date(p.updatedAt).toISOString(),
          lastSeenAt: new Date(p.lastSeenAt).toISOString(),
          rateStructure: p.rateStructure ?? null,
        };
      }),
    );

    const body: Ok = { ok: true, count: rows.length, totalCount, limit, rows, offerCount, mappedOfferCount };
    return NextResponse.json(body);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_WATTBUY_TEMPLATED_PLANS] error:", err);
    return jsonError(500, "Internal error while listing templated plans", err?.message);
  }
}


