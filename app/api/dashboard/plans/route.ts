import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers, type OfferNormalized } from "@/lib/wattbuy/normalize";
import { getTrueCostStatus } from "@/lib/plan-engine/trueCostStatus";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";
import { getRatePlanTemplateProbe } from "@/lib/plan-engine/getRatePlanTemplate";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { usagePrisma } from "@/lib/db/usageClient";
import { ensureCoreMonthlyBuckets } from "@/lib/usage/aggregateMonthlyBuckets";
import crypto from "node:crypto";
import { canComputePlanFromBuckets } from "@/lib/plan-engine/planComputability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SortKey =
  | "kwh1000_asc"
  | "kwh500_asc"
  | "kwh2000_asc"
  | "term_asc"
  | "renewable_desc"
  | "best_for_you_proxy";

function toInt(s: string | null, fallback: number): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function strOrNull(v: any): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

function parseBoolParam(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  if (s === "1" || s === "true" || s === "yes" || s === "y" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n" || s === "off") return false;
  return fallback;
}

type EflBucket = 500 | 1000 | 2000;

function parseApproxKwhPerMonth(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const k = Math.trunc(n);
  if (k === 500 || k === 750 || k === 1000 || k === 1250 || k === 2000) return k;
  return null;
}

function pickNearestEflBucket(kwh: number): EflBucket {
  // Nearest among 500/1000/2000; ties prefer 1000.
  const buckets: EflBucket[] = [500, 1000, 2000];
  let best: EflBucket = 1000;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const b of buckets) {
    const dist = Math.abs(kwh - b);
    if (dist < bestDist) {
      best = b;
      bestDist = dist;
      continue;
    }
    if (dist === bestDist && b === 1000) {
      best = b;
    }
  }
  return best;
}

function sortOffers(offers: OfferNormalized[], sort: SortKey): OfferNormalized[] {
  const withKey = offers.map((o, idx) => ({ o, idx }));

  const numOrInf = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;

  const numOrNegInf = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;

  const firstFiniteOrInf = (vals: Array<number | null | undefined>) => {
    for (const v of vals) {
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return Number.POSITIVE_INFINITY;
  };

  const keyFn = (o: OfferNormalized) => {
    if (sort === "kwh500_asc") return numOrInf(o.kwh500_cents);
    if (sort === "kwh2000_asc") return numOrInf(o.kwh2000_cents);
    if (sort === "term_asc") return numOrInf(o.term_months);
    if (sort === "renewable_desc") return numOrNegInf(o.green_percentage);
    // best_for_you_proxy and default: use 1000kWh average if present, else fall back to 500/2000.
    return firstFiniteOrInf([o.kwh1000_cents, o.kwh500_cents, o.kwh2000_cents]);
  };

  withKey.sort((a, b) => {
    const ka = keyFn(a.o);
    const kb = keyFn(b.o);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    const pa = (a.o.plan_name ?? "").toLowerCase();
    const pb = (b.o.plan_name ?? "").toLowerCase();
    if (pa < pb) return -1;
    if (pa > pb) return 1;
    return a.idx - b.idx;
  });

  // renewable_desc wants descending, keep tie-breakers stable.
  if (sort === "renewable_desc") {
    withKey.sort((a, b) => {
      const ka = Number.isFinite(a.o.green_percentage ?? NaN) ? (a.o.green_percentage as number) : -1;
      const kb = Number.isFinite(b.o.green_percentage ?? NaN) ? (b.o.green_percentage as number) : -1;
      if (ka > kb) return -1;
      if (ka < kb) return 1;
      const pa = (a.o.plan_name ?? "").toLowerCase();
      const pb = (b.o.plan_name ?? "").toLowerCase();
      if (pa < pb) return -1;
      if (pa > pb) return 1;
      return a.idx - b.idx;
    });
  }

  return withKey.map((x) => x.o);
}

function numOrNull(n: any): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
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

function chicagoYearMonthParts(now: Date): { year: number; month: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" });
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

export async function GET(req: NextRequest) {
  try {
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
        rawWattbuyJson: true,
        updatedAt: true,
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
          rawWattbuyJson: true,
          updatedAt: true,
        },
      });
    }

    if (!house) {
      return NextResponse.json(
        {
          ok: true,
          hasUsage: false,
          usageSummary: null,
          offers: [],
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 0,
          message: "No home saved yet. Add your address first.",
        },
        { status: 200 },
      );
    }

    const url = new URL(req.url);
    const page = Math.max(1, toInt(url.searchParams.get("page"), 1));
    const pageSize = clamp(toInt(url.searchParams.get("pageSize"), 20), 10, 50);
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const rateType = (url.searchParams.get("rateType") ?? "all").trim().toLowerCase();
    const term = (url.searchParams.get("term") ?? "all").trim().toLowerCase();
    const renewableMin = clamp(toInt(url.searchParams.get("renewableMin"), 0), 0, 100);
    const template = (url.searchParams.get("template") ?? "all").trim().toLowerCase();
    const sort = (url.searchParams.get("sort") ?? "kwh1000_asc") as SortKey;
    const isRenter = parseBoolParam(url.searchParams.get("isRenter"), false);
    const approxKwhPerMonth = parseApproxKwhPerMonth(url.searchParams.get("approxKwhPerMonth"));

    // Usage summary: cheap aggregate over the last 12 months, best-effort.
    // Must never break offers response (wrap errors).
    let hasUsage = false;
    let usageSummary:
      | {
          source: string;
          rangeStart?: string;
          rangeEnd?: string;
          totalKwh?: number;
          rows?: number;
        }
      | null = null;

    try {
      if (house.esiid) {
        const rangeEnd = new Date();
        const rangeStart = new Date(rangeEnd.getTime() - 365 * 24 * 60 * 60 * 1000);
        const aggregates = await prisma.smtInterval.aggregate({
          where: { esiid: house.esiid, ts: { gte: rangeStart, lte: rangeEnd } },
          _count: { _all: true },
          _sum: { kwh: true },
          _min: { ts: true },
          _max: { ts: true },
        });

        const rows = Number(aggregates?._count?._all ?? 0) || 0;
        const totalKwhRaw: any = aggregates?._sum?.kwh ?? 0;
        const totalKwh = (() => {
          if (typeof totalKwhRaw === "number") return totalKwhRaw;
          if (totalKwhRaw && typeof totalKwhRaw === "object" && typeof totalKwhRaw.toString === "function") {
            return Number(totalKwhRaw.toString());
          }
          return Number(totalKwhRaw);
        })();

        hasUsage = rows > 0;
        usageSummary = hasUsage
          ? {
              source: "SMT",
              rangeStart: rangeStart.toISOString(),
              rangeEnd: rangeEnd.toISOString(),
              totalKwh: Number.isFinite(totalKwh) ? Number(totalKwh.toFixed(6)) : undefined,
              rows,
            }
          : null;
      }
    } catch {
      hasUsage = false;
      usageSummary = null;
    }

    // Best-effort: on-demand ensure CORE bucket totals exist for recent months (never break offers).
    // This is a lazy backfill path in case ingest hooks were skipped or buckets were never computed.
    try {
      if (hasUsage && house.id && house.esiid) {
        const tz = "America/Chicago";
        const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit" });
        const parts = fmt.formatToParts(new Date());
        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
        const yearStr = get("year");
        const monthStr = get("month");
        const year = Number(yearStr);
        const month = Number(monthStr);
        const ym0 = `${yearStr}-${monthStr}`;
        const prev = (() => {
          if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
          const y = month === 1 ? year - 1 : year;
          const m = month === 1 ? 12 : month - 1;
          return `${String(y)}-${String(m).padStart(2, "0")}`;
        })();

        const bucketKey = "kwh.m.all.total";
        const yearMonths = prev ? [ym0, prev] : [ym0];

        const existing = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
          where: { homeId: house.id, bucketKey, yearMonth: { in: yearMonths } },
          select: { yearMonth: true },
        });
        const present = new Set<string>((existing ?? []).map((r: any) => String(r.yearMonth)));
        const missing = yearMonths.filter((ym) => !present.has(ym));

        if (missing.length > 0) {
          const rangeEnd = new Date();
          const rangeStart = new Date(rangeEnd.getTime() - 365 * 24 * 60 * 60 * 1000);
          await ensureCoreMonthlyBuckets({
            homeId: house.id,
            esiid: house.esiid,
            rangeStart,
            rangeEnd,
            source: "SMT",
            intervalSource: "SMT",
          });
        }
      }
    } catch (err) {
      console.error("[dashboard/plans] CORE bucket on-demand backfill failed (best-effort)", err);
    }

    // Load kwh.m.all.total monthly buckets (usage DB) and annualize to 12 months, best-effort.
    let annualKwhFromBuckets: number | null = null;
    let bucketMonthsCount: number = 0;
    try {
      if (hasUsage && house.id) {
        const yearMonths = lastNYearMonthsChicago(12);
        if (yearMonths.length > 0) {
          const rows = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
            where: { homeId: house.id, bucketKey: "kwh.m.all.total", yearMonth: { in: yearMonths } },
            select: { yearMonth: true, kwhTotal: true },
          });
          const byYm = new Map<string, number>();
          for (const r of rows ?? []) {
            const ym = String((r as any)?.yearMonth ?? "");
            const kwh = decimalToNumber((r as any)?.kwhTotal);
            if (!ym || kwh == null || kwh <= 0) continue;
            byYm.set(ym, (byYm.get(ym) ?? 0) + kwh);
          }
          bucketMonthsCount = byYm.size;
          if (bucketMonthsCount > 0) {
            const sumKwh = Array.from(byYm.values()).reduce((a, b) => a + b, 0);
            // Annualize to 12 months if fewer months are present.
            annualKwhFromBuckets = (sumKwh * 12) / bucketMonthsCount;
          }
        }
      }
    } catch (err) {
      console.error("[dashboard/plans] failed to load kwh.m.all.total buckets (best-effort)", err);
      annualKwhFromBuckets = null;
      bucketMonthsCount = 0;
    }

    // Prefer live offers. If the call fails (transient upstream), fall back to the last stored snapshot.
    let rawOffersResp: any = null;
    let usedFallbackSnapshot = false;
    try {
      rawOffersResp = await wattbuy.offers({
        address: house.addressLine1,
        city: house.addressCity,
        state: house.addressState,
        zip: house.addressZip5,
        isRenter,
      });
    } catch (e) {
      rawOffersResp = house.rawWattbuyJson ?? null;
      usedFallbackSnapshot = true;
    }

    const normalized = normalizeOffers(rawOffersResp ?? {});
    let offers = normalized.offers;

    // OfferIdRatePlanMap wiring: attach template availability per offerId.
    const offerIds = offers.map((o) => o.offer_id).filter(Boolean);
    const maps = await (prisma as any).offerIdRatePlanMap.findMany({
      where: { offerId: { in: offerIds } },
      select: { offerId: true, ratePlanId: true },
    });
    const mapByOfferId = new Map(
      (maps as Array<{ offerId: string; ratePlanId: string | null }>)
        .map((m: { offerId: string; ratePlanId: string | null }) => [m.offerId, m.ratePlanId ?? null]),
    );

    // Filter
    offers = offers.filter((o) => {
      if (q) {
        const hay = `${o.supplier_name ?? ""} ${o.plan_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (rateType !== "all" && rateType) {
        if (o.rate_type !== rateType) return false;
      }
      if (term !== "all" && term) {
        const tm = o.term_months ?? null;
        if (term === "0-6") {
          if (tm == null || tm > 6) return false;
        } else if (term === "7-12") {
          if (tm == null || tm < 7 || tm > 12) return false;
        } else if (term === "13-24") {
          if (tm == null || tm < 13 || tm > 24) return false;
        } else if (term === "25+") {
          if (tm == null || tm < 25) return false;
        }
      }
      if (renewableMin > 0) {
        const gp = o.green_percentage ?? 0;
        if (gp < renewableMin) return false;
      }
      if (template === "available") {
        const ratePlanId = mapByOfferId.get(o.offer_id) ?? null;
        if (!ratePlanId) return false;
      }
      return true;
    });

    // Sort
    offers = sortOffers(offers, sort);

    const total = offers.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const safePage = totalPages === 0 ? 1 : clamp(page, 1, totalPages);
    const startIdx = (safePage - 1) * pageSize;
    const pageSlice = offers.slice(startIdx, startIdx + pageSize);

    const usageSummaryTotalKwh = numOrNull((usageSummary as any)?.totalKwh);

    const shapeOfferBase = (o: any) => {
      const ratePlanId = mapByOfferId.get(o.offer_id) ?? null;
      const templateAvailable = ratePlanId != null;
      const eflUrl = o.docs?.efl ?? null;
      const statusLabel = templateAvailable ? "AVAILABLE" : eflUrl ? "QUEUED" : "UNAVAILABLE";

      // Normalize proxy pricing fields once, under offer.efl.* (single source of truth).
      const eflAvg1000 = numOrNull(o?.kwh1000_cents);
      const eflAvg500 = numOrNull(o?.kwh500_cents);
      const eflAvg2000 = numOrNull(o?.kwh2000_cents);

      const earlyTerminationFeeDollars = (() => {
        const t = strOrNull(o.cancel_fee_text);
        if (!t) return undefined;
        const m = t.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
        if (!m?.[1]) return undefined;
        const v = Number(m[1]);
        return Number.isFinite(v) ? v : undefined;
      })();

      return {
        offerId: o.offer_id,
        supplierName: o.supplier_name ?? undefined,
        planName: o.plan_name ?? undefined,
        termMonths: o.term_months ?? undefined,
        rateType: o.rate_type ?? undefined,
        renewablePercent: o.green_percentage ?? undefined,
        earlyTerminationFeeDollars,
        baseMonthlyFeeDollars: undefined, // not reliably in WattBuy offer payload today
        efl: {
          avgPriceCentsPerKwh500: eflAvg500 ?? undefined,
          avgPriceCentsPerKwh1000: eflAvg1000 ?? undefined,
          avgPriceCentsPerKwh2000: eflAvg2000 ?? undefined,
          eflUrl: eflUrl ?? undefined,
          eflPdfSha256: undefined,
          repPuctCertificate: undefined,
          eflVersionCode: undefined,
          lastSeenAt: usedFallbackSnapshot ? house.updatedAt.toISOString() : undefined,
        },
        intelliwatt: {
          templateAvailable,
          // Always return a stable shape for clients: string when mapped, else null.
          ratePlanId,
          statusLabel,
          trueCost: getTrueCostStatus({ hasUsage, ratePlanId }),
        },
        utility: {
          tdspSlug: o.tdsp ?? house.tdspSlug ?? undefined,
          utilityName: o.distributor_name ?? house.utilityName ?? undefined,
        },
      };
    };

    const tdspRatesCache = new Map<string, any | null>();

    const shapeOffer = async (o: any) => {
      const base = shapeOfferBase(o);
      const ratePlanId = base?.intelliwatt?.ratePlanId ?? null;

      // Best-effort template existence check: if we have a ratePlanId but can't load the template,
      // treat this offer as missing a template for true-cost estimate purposes.
      let templateOk = ratePlanId != null;
      let template: any | null = null;
      if (ratePlanId) {
        const probed = await getRatePlanTemplateProbe({ ratePlanId });
        // Only force "missing template" when we are sure the row is missing (null without throw).
        // If the lookup threw (transient DB issues), do NOT downgrade the estimate.
        if (!probed.didThrow && !probed.template) templateOk = false;
        // For computability, only use the template when we have it (and didn't throw).
        template = !probed.didThrow ? probed.template : null;
      }

      const avgPriceCentsPerKwh1000 = numOrNull((base as any)?.efl?.avgPriceCentsPerKwh1000);
      const tdspSlug = (base as any)?.utility?.tdspSlug ?? null;

      let tdspRates: any | null = null;
      if (typeof tdspSlug === "string" && tdspSlug.trim()) {
        const key = tdspSlug.trim().toLowerCase();
        if (tdspRatesCache.has(key)) {
          tdspRates = tdspRatesCache.get(key) ?? null;
        } else {
          try {
            tdspRates = await getTdspDeliveryRates({ tdspSlug: key, asOf: new Date() });
          } catch {
            tdspRates = null;
          }
          tdspRatesCache.set(key, tdspRates);
        }
      }

      // Plan computability (pure; best-effort) + quarantine queue (best-effort, never throws).
      let planComputability: any | null = null;
      if (hasUsage && (base as any)?.intelliwatt?.templateAvailable) {
        const offerId = String((base as any).offerId ?? "");
        const templateAvailable = Boolean((base as any)?.intelliwatt?.templateAvailable);
        const effectiveRatePlanId = templateOk ? ratePlanId : null;

        planComputability = canComputePlanFromBuckets({
          offerId,
          ratePlanId: effectiveRatePlanId,
          templateAvailable: templateAvailable && templateOk,
          template: templateOk ? (template ? { rateStructure: template.rateStructure } : null) : null,
        });

        if (planComputability?.status === "NOT_COMPUTABLE" && planComputability?.reasonCode !== "MISSING_TEMPLATE" && offerId) {
          const queueReasonPayload = {
            type: "PLAN_CALC_QUARANTINE",
            reasonCode: planComputability.reasonCode,
            requiredBucketKeys: planComputability.requiredBucketKeys ?? null,
            ratePlanId: effectiveRatePlanId,
            offerId,
          };
          try {
            (prisma as any).eflParseReviewQueue
              .upsert({
                where: { kind_dedupeKey: { kind: "PLAN_CALC_QUARANTINE", dedupeKey: offerId } },
                create: {
                  source: "dashboard_plans",
                  kind: "PLAN_CALC_QUARANTINE",
                  dedupeKey: offerId,
                  // NOTE: eflPdfSha256 is a legacy NOT NULL unique field on this table (EFL queue origin).
                  // For PLAN_CALC_QUARANTINE we do NOT use it as identity; we set it to offerId so it's stable
                  // and does not pretend to be an EFL fingerprint.
                  eflPdfSha256: offerId,
                  offerId,
                  supplier: (base as any)?.supplierName ?? null,
                  planName: (base as any)?.planName ?? null,
                  eflUrl: (base as any)?.efl?.eflUrl ?? null,
                  tdspName: (base as any)?.utility?.utilityName ?? null,
                  termMonths: (base as any)?.termMonths ?? null,
                  ratePlanId: effectiveRatePlanId,
                  rawText: null,
                  planRules: null,
                  rateStructure: null,
                  validation: null,
                  derivedForValidation: (planComputability as any).details ?? null,
                  finalStatus: "OPEN",
                  queueReason: JSON.stringify(queueReasonPayload),
                  solverApplied: [],
                  resolvedAt: null,
                  resolvedBy: null,
                  resolutionNotes: planComputability.reason,
                },
                update: {
                  supplier: (base as any)?.supplierName ?? null,
                  planName: (base as any)?.planName ?? null,
                  eflUrl: (base as any)?.efl?.eflUrl ?? null,
                  tdspName: (base as any)?.utility?.utilityName ?? null,
                  termMonths: (base as any)?.termMonths ?? null,
                  ratePlanId: effectiveRatePlanId,
                  derivedForValidation: (planComputability as any).details ?? null,
                  finalStatus: "OPEN",
                  queueReason: JSON.stringify(queueReasonPayload),
                  resolutionNotes: planComputability.reason,
                },
              })
              .catch(() => {});
          } catch {
            // swallow
          }
        }
      }

      return {
        ...base,
        intelliwatt: {
          ...(base as any).intelliwatt,
          ...(tdspRates
            ? {
                tdspRatesApplied: {
                  effectiveDate: tdspRates.effectiveDate,
                  perKwhDeliveryChargeCents: tdspRates.perKwhDeliveryChargeCents,
                  monthlyCustomerChargeDollars: tdspRates.monthlyCustomerChargeDollars,
                },
              }
            : {}),
          ...(planComputability ? { planComputability } : {}),
          trueCostEstimate: (() => {
            if (!hasUsage) return { status: "NOT_IMPLEMENTED", reason: "No usage available" };
            if (annualKwhFromBuckets == null) {
              return { status: "NOT_IMPLEMENTED", reason: "Missing kwh.m.all.total buckets for annual kWh" };
            }
            if (!templateOk || !template?.rateStructure) {
              return { status: "NOT_IMPLEMENTED", reason: "Missing template rateStructure" };
            }
            if (planComputability && planComputability.status === "NOT_COMPUTABLE") {
              return { status: "NOT_COMPUTABLE", reason: planComputability.reason ?? "Plan not computable" };
            }
            const tdspApplied = {
              perKwhDeliveryChargeCents: Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0,
              monthlyCustomerChargeDollars: Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0,
              effectiveDate: tdspRates?.effectiveDate ?? undefined,
            };
            return calculatePlanCostForUsage({
              annualKwh: annualKwhFromBuckets,
              monthsCount: 12,
              tdsp: tdspApplied,
              rateStructure: template.rateStructure,
            });
          })(),
        },
      };
    };

    const shaped = await Promise.all(pageSlice.map(shapeOffer));

    // Compute bestOffers (proxy ranking) server-side so the UI can render without an extra round-trip.
    // Must never throw; on any failure, fall back to [].
    let bestOffers: any[] = [];
    let bestOffersBasis: string | null = null;
    let bestOffersDisclaimer: string | null = null;
    let bestOffersAllIn: any[] = [];
    let bestOffersAllInBasis: string | null = null;
    let bestOffersAllInDisclaimer: string | null = null;
    try {
      if (hasUsage) {
        // Respect the UI's kWh sort selection when computing the proxy-ranked Best Plans strip.
        // If the user is sorting by 500/2000, bestOffers should match that anchor (not hardcode 1000).
        const bestBucket: EflBucket = (() => {
          if (sort === "kwh500_asc") return 500;
          if (sort === "kwh2000_asc") return 2000;
          // best_for_you_proxy, kwh1000_asc, term_asc, renewable_desc → default to 1000 anchor.
          return 1000;
        })();

        const candidates = offers
          .map((o) => ({
            o,
            metric:
              bestBucket === 500
                ? numOrNull(shapeOfferBase(o)?.efl?.avgPriceCentsPerKwh500)
                : bestBucket === 2000
                  ? numOrNull(shapeOfferBase(o)?.efl?.avgPriceCentsPerKwh2000)
                  : numOrNull(shapeOfferBase(o)?.efl?.avgPriceCentsPerKwh1000),
          }))
          .filter((x) => typeof x.metric === "number" && Number.isFinite(x.metric as number))
          .sort((a, b) => (a.metric as number) - (b.metric as number))
          .slice(0, 5)
          .map((x) => x.o);
        bestOffers = await Promise.all(candidates.map(shapeOffer));

        if (bestOffers.length > 0) {
          bestOffersBasis =
            bestBucket === 500
              ? "proxy_500kwh_efl_avgPriceCentsPerKwh500"
              : bestBucket === 2000
                ? "proxy_2000kwh_efl_avgPriceCentsPerKwh2000"
                : "proxy_1000kwh_efl_avgPriceCentsPerKwh1000";
          bestOffersDisclaimer =
            `Based on your last 12 months usage. Ranking uses provider EFL average price at ${bestBucket} kWh until IntelliWatt true-cost is enabled.`;
        }

        // Also compute a best-effort "all-in" ranking using trueCostEstimate.monthlyCostDollars (OK-only).
        // Keep this best-effort and bounded: re-rank the already-shaped bestOffers when available.
        const allInPool = Array.isArray(bestOffers) && bestOffers.length > 0 ? bestOffers : shaped;
        const scoredAllIn = (allInPool ?? [])
          .map((o: any) => {
            const tce = o?.intelliwatt?.trueCostEstimate;
            const ok = tce?.status === "OK";
            const v = ok ? Number(tce?.monthlyCostDollars) : Number.POSITIVE_INFINITY;
            return { o, v: Number.isFinite(v) ? v : Number.POSITIVE_INFINITY };
          })
          .filter((x) => x.v !== Number.POSITIVE_INFINITY)
          .sort((a, b) => a.v - b.v)
          .slice(0, 5)
          .map((x) => x.o);

        bestOffersAllIn = scoredAllIn;
        if (bestOffersAllIn.length > 0) {
          bestOffersAllInBasis = "proxy_allin_monthly_trueCostEstimate";
          bestOffersAllInDisclaimer =
            "Includes TDSP delivery. REP energy is still based on provider 1000 kWh estimate until IntelliWatt true-cost is enabled.";
        }
      } else {
        // No-usage mode: rank bestOffers by selected approximate monthly usage, mapped to nearest EFL bucket.
        const chosen = approxKwhPerMonth ?? 1000;
        const bucket = pickNearestEflBucket(chosen);
        const basis =
          bucket === 500
            ? "proxy_efl_avgPriceCentsPerKwh500"
            : bucket === 2000
              ? "proxy_efl_avgPriceCentsPerKwh2000"
              : "proxy_efl_avgPriceCentsPerKwh1000";

        const metricFn = (b: EflBucket, o: any) => {
          const e = shapeOfferBase(o)?.efl;
          if (b === 500) return numOrNull(e?.avgPriceCentsPerKwh500);
          if (b === 2000) return numOrNull(e?.avgPriceCentsPerKwh2000);
          return numOrNull(e?.avgPriceCentsPerKwh1000);
        };

        const candidates = offers
          .map((o) => ({ o, metric: metricFn(bucket, o) }))
          .filter((x) => typeof x.metric === "number" && Number.isFinite(x.metric as number))
          .sort((a, b) => (a.metric as number) - (b.metric as number))
          .slice(0, 5)
          .map((x) => x.o);

        bestOffers = await Promise.all(candidates.map(shapeOffer));
        if (bestOffers.length > 0) {
          bestOffersBasis = basis;
          bestOffersDisclaimer = `Based on your selected approx usage (${chosen} kWh/mo), ranking uses the nearest EFL average price bucket (${bucket} kWh).`;
        }
      }
    } catch {
      bestOffers = [];
      bestOffersBasis = null;
      bestOffersDisclaimer = null;
      bestOffersAllIn = [];
      bestOffersAllInBasis = null;
      bestOffersAllInDisclaimer = null;
    }

    return NextResponse.json(
      {
        ok: true,
        hasUsage,
        usageSummary,
        offers: shaped,
        bestOffers,
        bestOffersBasis,
        bestOffersDisclaimer,
        bestOffersAllIn,
        bestOffersAllInBasis,
        bestOffersAllInDisclaimer,
        page: safePage,
        pageSize,
        total,
        totalPages,
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 },
    );
  }
}


