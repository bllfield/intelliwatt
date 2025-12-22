import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers, type OfferNormalized } from "@/lib/wattbuy/normalize";
import { getTrueCostStatus } from "@/lib/plan-engine/trueCostStatus";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { usagePrisma } from "@/lib/db/usageClient";
import { ensureCoreMonthlyBuckets } from "@/lib/usage/aggregateMonthlyBuckets";
import crypto from "node:crypto";
import { canComputePlanFromBuckets, derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";
import { isPlanCalcQuarantineWorthyReasonCode } from "@/lib/plan-engine/planCalcQuarantine";
import { bucketDefsFromBucketKeys } from "@/lib/plan-engine/usageBuckets";
import {
  extractFixedRepEnergyCentsPerKwh,
  extractRepFixedMonthlyChargeDollars,
} from "@/lib/plan-engine/calculatePlanCostForUsage";

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

const DAY_MS = 24 * 60 * 60 * 1000;

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function canonicalUrlKey(u: string): string | null {
  try {
    const url = new URL(u);
    // Ignore query/hash to tolerate WattBuy tracking params and redirects.
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

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
        // Align with /api/user/usage behavior: strict last 365 days ending at latest interval timestamp.
        const latest = await prisma.smtInterval.findFirst({
          where: { esiid: house.esiid },
          orderBy: { ts: "desc" },
          select: { ts: true },
        });
        const rangeEnd = latest?.ts ?? new Date();
        const rangeStart = new Date(rangeEnd.getTime() - 365 * DAY_MS);
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

    // Convenience: pull the strict last-365-days total kWh from usageSummary (if present).
    // Must be declared before any downstream usage-window / display logic uses it.
    const usageSummaryTotalKwh = numOrNull((usageSummary as any)?.totalKwh);

    // Best-effort: on-demand ensure CORE bucket totals exist for recent months (never break offers).
    // This is a lazy backfill path in case ingest hooks were skipped or buckets were never computed.
    let recentYearMonths: string[] = [];
    let bucketPresenceByKey: Map<string, Set<string>> = new Map();
    let usageBucketsByMonthForCalc: Record<string, Record<string, number>> = {};
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

        const yearMonths = prev ? [ym0, prev] : [ym0];
        recentYearMonths = yearMonths.slice();

        // Ensure CORE bucket totals exist (best-effort) for recent months.
        // NOTE: plan-specific requiredBucketKeys are derived later after OfferIdRatePlanMap + RatePlan lookups.
        // This early backfill keeps fixed-rate costs working even before we know plan-specific keys.
        try {
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
        } catch {
          // ignore (never break dashboard)
        }

        // Build a small "presence map" for recent months so we can check requiredBucketKeys per plan
        // without doing per-offer DB queries.
        try {
          const rows = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
            where: { homeId: house.id, yearMonth: { in: yearMonths } },
            select: { bucketKey: true, yearMonth: true },
          });
          const map = new Map<string, Set<string>>();
          for (const r of rows ?? []) {
            const k = String((r as any)?.bucketKey ?? "");
            const ym = String((r as any)?.yearMonth ?? "");
            if (!k || !ym) continue;
            if (!map.has(k)) map.set(k, new Set());
            map.get(k)!.add(ym);
          }
          bucketPresenceByKey = map;
        } catch {
          bucketPresenceByKey = new Map();
        }

        // Load last-12-months bucket totals by month for calculation (TOU needs this).
        try {
          const yearMonths12 = lastNYearMonthsChicago(12);
          const keysArr = ["kwh.m.all.total"];
          if (yearMonths12.length > 0 && keysArr.length > 0) {
            const rows12 = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
              where: { homeId: house.id, yearMonth: { in: yearMonths12 }, bucketKey: { in: keysArr } },
              select: { yearMonth: true, bucketKey: true, kwhTotal: true },
            });
            const byMonth: Record<string, Record<string, number>> = {};
            for (const r of rows12 ?? []) {
              const ym = String((r as any)?.yearMonth ?? "").trim();
              const key = String((r as any)?.bucketKey ?? "").trim();
              const kwh = decimalToNumber((r as any)?.kwhTotal);
              if (!ym || !key || kwh == null) continue;
              if (!byMonth[ym]) byMonth[ym] = {};
              byMonth[ym][key] = kwh;
            }
            usageBucketsByMonthForCalc = byMonth;
          }
        } catch {
          usageBucketsByMonthForCalc = {};
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

    // Average monthly usage (kWh/mo) based on the same bucket data used for true-cost.
    const avgMonthlyKwhFromBuckets: number | null =
      typeof annualKwhFromBuckets === "number" && Number.isFinite(annualKwhFromBuckets) && annualKwhFromBuckets > 0
        ? annualKwhFromBuckets / 12
        : null;

    // Prefer usageSummary totals for display + math consistency (matches Usage page and Plan Details page),
    // but keep bucket-derived values as best-effort fallback.
    const annualKwhFromUsageSummary: number | null =
      typeof usageSummaryTotalKwh === "number" && Number.isFinite(usageSummaryTotalKwh) && usageSummaryTotalKwh > 0
        ? usageSummaryTotalKwh
        : null;
    const avgMonthlyKwhFromUsageSummary: number | null =
      annualKwhFromUsageSummary != null ? annualKwhFromUsageSummary / 12 : null;

    const annualKwhForCalc: number | null = annualKwhFromUsageSummary ?? annualKwhFromBuckets ?? null;
    const avgMonthlyKwhForDisplay: number | null =
      avgMonthlyKwhFromUsageSummary ?? (typeof avgMonthlyKwhFromBuckets === "number" ? avgMonthlyKwhFromBuckets : null);

    const hasRecentBucket = (bucketKey: string): boolean => {
      if (!bucketKey) return false;
      if (!recentYearMonths || recentYearMonths.length === 0) return false;
      const s = bucketPresenceByKey.get(bucketKey);
      if (!s) return false;
      return recentYearMonths.every((ym) => s.has(ym));
    };

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

    // Precompute computability for mapped templates (best-effort).
    // Semantics: statusLabel=AVAILABLE means "computable by current engine", not just "mapped".
    const mappedRatePlanIds = Array.from(
      new Set(
        offerIds
          .map((offerId) => mapByOfferId.get(offerId) ?? null)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );

    const isRateStructurePresent = (v: any): boolean => {
      if (v == null) return false;
      // Prisma JSON null sentinels can surface as objects; treat them as absent.
      if (typeof v === "object" && (v as any)?.toJSON?.() === null) return false;
      if (typeof v !== "object") return false;
      try {
        return Object.keys(v).length > 0;
      } catch {
        return false;
      }
    };

    const planCalcByRatePlanId = new Map<
      string,
      {
        planCalcStatus: "COMPUTABLE" | "NOT_COMPUTABLE" | "UNKNOWN";
        planCalcReasonCode: string;
        rateStructurePresent: boolean;
        rateStructure?: any | null;
        requiredBucketKeys?: string[] | null;
      }
    >();

    if (mappedRatePlanIds.length) {
      try {
        const rows = await (prisma as any).ratePlan.findMany({
          where: { id: { in: mappedRatePlanIds } },
          select: {
            id: true,
            rateStructure: true,
            planCalcStatus: true,
            planCalcReasonCode: true,
            requiredBucketKeys: true,
          },
        });

        for (const rp of rows as any[]) {
          const id = String(rp.id);
          const rsPresent = isRateStructurePresent(rp.rateStructure);
          const storedStatus =
            typeof rp?.planCalcStatus === "string" ? (String(rp.planCalcStatus) as any) : null;
          const storedReason =
            typeof rp?.planCalcReasonCode === "string" ? String(rp.planCalcReasonCode) : null;

          if (storedStatus === "COMPUTABLE" || storedStatus === "NOT_COMPUTABLE") {
            planCalcByRatePlanId.set(id, {
              planCalcStatus: storedStatus,
              planCalcReasonCode: storedReason ?? "UNKNOWN",
              rateStructurePresent: rsPresent,
              rateStructure: rsPresent ? rp.rateStructure : null,
              requiredBucketKeys: Array.isArray((rp as any)?.requiredBucketKeys)
                ? ((rp as any).requiredBucketKeys as any[]).map((k) => String(k))
                : null,
            });
            continue;
          }

          // Fall back to deriving from rateStructure (if present); otherwise treat as unknown.
          const derived = derivePlanCalcRequirementsFromTemplate({
            rateStructure: rsPresent ? rp.rateStructure : null,
          });
          planCalcByRatePlanId.set(id, {
            planCalcStatus: derived.planCalcStatus,
            planCalcReasonCode: derived.planCalcReasonCode,
            rateStructurePresent: rsPresent,
            rateStructure: rsPresent ? rp.rateStructure : null,
            requiredBucketKeys: derived.requiredBucketKeys,
          });
        }
      } catch {
        // Best-effort only; absence means we won't refine status labels server-side.
      }
    }

    // Now that RatePlan rows are loaded, we can do a bounded, best-effort "ensure required buckets"
    // and load per-month bucket totals for calculation (TOU / bucket-gated plans).
    try {
      if (hasUsage && house.id && house.esiid && mappedRatePlanIds.length > 0) {
        const unionKeys = new Set<string>(["kwh.m.all.total"]);
        planCalcByRatePlanId.forEach((v: any) => {
          const keys = Array.isArray(v?.requiredBucketKeys) ? (v.requiredBucketKeys as string[]) : [];
          for (const k of keys) {
            const kk = String(k ?? "").trim();
            if (kk) unionKeys.add(kk);
          }
        });

        // Ensure buckets exist (bounded) and then reload the last-12-months bucket totals map.
        const rangeEnd = new Date();
        const rangeStart = new Date(rangeEnd.getTime() - 365 * 24 * 60 * 60 * 1000);
        try {
          const defs = bucketDefsFromBucketKeys(Array.from(unionKeys));
          await ensureCoreMonthlyBuckets({
            homeId: house.id,
            esiid: house.esiid,
            rangeStart,
            rangeEnd,
            source: "SMT",
            intervalSource: "SMT",
            bucketDefs: defs,
          });
        } catch {
          // ignore (never break dashboard)
        }

        try {
          const yearMonths12 = lastNYearMonthsChicago(12);
          const keysArr = Array.from(unionKeys);
          if (yearMonths12.length > 0 && keysArr.length > 0) {
            const rows12 = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
              where: { homeId: house.id, yearMonth: { in: yearMonths12 }, bucketKey: { in: keysArr } },
              select: { yearMonth: true, bucketKey: true, kwhTotal: true },
            });
            const byMonth: Record<string, Record<string, number>> = {};
            for (const r of rows12 ?? []) {
              const ym = String((r as any)?.yearMonth ?? "").trim();
              const key = String((r as any)?.bucketKey ?? "").trim();
              const kwh = decimalToNumber((r as any)?.kwhTotal);
              if (!ym || !key || kwh == null) continue;
              if (!byMonth[ym]) byMonth[ym] = {};
              byMonth[ym][key] = kwh;
            }
            usageBucketsByMonthForCalc = byMonth;
          }
        } catch {
          // keep previous best-effort map
        }

        // IMPORTANT: refresh the bucket presence map AFTER ensureCoreMonthlyBuckets() ran.
        // Otherwise `hasRecentBucket()` (and therefore missingBucketKeys/statusLabel) can be computed
        // against a stale snapshot and incorrectly mark everything as missing/QUEUED.
        try {
          const recent = Array.isArray(recentYearMonths) ? recentYearMonths : [];
          const keysArr = Array.from(unionKeys);
          if (recent.length > 0 && keysArr.length > 0) {
            const rowsRecent = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
              where: { homeId: house.id, yearMonth: { in: recent }, bucketKey: { in: keysArr } },
              select: { bucketKey: true, yearMonth: true },
            });
            const map = new Map<string, Set<string>>();
            for (const r of rowsRecent ?? []) {
              const k = String((r as any)?.bucketKey ?? "");
              const ym = String((r as any)?.yearMonth ?? "");
              if (!k || !ym) continue;
              if (!map.has(k)) map.set(k, new Set());
              map.get(k)!.add(ym);
            }
            bucketPresenceByKey = map;
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // swallow (never break dashboard)
    }

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
        const calc = planCalcByRatePlanId.get(ratePlanId) ?? null;
        // "available" means computable templates only (not just mapped).
        if (!calc || calc.planCalcStatus !== "COMPUTABLE") return false;
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

    // Ensure that any offer we mark as "QUEUED" is actually present in the admin review queue.
    //
    // Why this exists:
    // - The dashboard historically used a heuristic: "no template yet + has eflUrl => queued".
    // - If background prefetch didn't run (or ran out of budget), the admin queue could be empty,
    //   which is confusing and blocks ops.
    //
    // Behavior:
    // - If an offer has an EFL URL but no template mapping, create/refresh an OPEN EFL_PARSE row.
    // - If an offer is mapped to a non-computable template, create/refresh a PLAN_CALC_QUARANTINE row.
    //
    // Best-effort: failures must never break dashboard.
    try {
      // (1) If a template already exists for this EFL URL, auto-link offerId -> RatePlan
      // so the dashboard stops showing "QUEUED" purely due to missing OfferIdRatePlanMap rows.
      const unmappedWithEfl = (pageSlice as any[])
        .map((o) => {
          const offerId = String(o?.offer_id ?? "").trim();
          const eflUrl = String(o?.docs?.efl ?? "").trim();
          if (!offerId || !eflUrl) return null;
          const mapped = mapByOfferId.get(offerId) ?? null;
          if (mapped) return null;
          return { offerId, eflUrl };
        })
        .filter(Boolean) as Array<{ offerId: string; eflUrl: string }>;

      if (unmappedWithEfl.length) {
        const urls = Array.from(new Set(unmappedWithEfl.map((x) => x.eflUrl)));
        const canonicalUrls = Array.from(
          new Set(
            urls
              .map((u) => canonicalUrlKey(u))
              .filter((v): v is string => typeof v === "string" && v.length > 0),
          ),
        );
        const plans = await prisma.ratePlan.findMany({
          where: {
            rateStructure: { not: null },
            eflRequiresManualReview: false,
            OR: [
              { eflUrl: { in: urls } },
              { eflSourceUrl: { in: urls } },
              // tolerate query-param differences by prefix matching origin+pathname
              ...canonicalUrls.flatMap((c) => [{ eflUrl: { startsWith: c } }, { eflSourceUrl: { startsWith: c } }]),
            ],
          } as any,
          select: {
            id: true,
            eflUrl: true,
            eflSourceUrl: true,
            rateStructure: true,
            planCalcStatus: true,
            planCalcReasonCode: true,
          } as any,
        });

        const planByUrl = new Map<string, any>();
        for (const p of plans as any[]) {
          const id = String(p?.id ?? "").trim();
          if (!id) continue;
          const u1 = String(p?.eflUrl ?? "").trim();
          const u2 = String(p?.eflSourceUrl ?? "").trim();
          if (u1) {
            planByUrl.set(u1, p);
            const k = canonicalUrlKey(u1);
            if (k) planByUrl.set(k, p);
          }
          if (u2) {
            planByUrl.set(u2, p);
            const k = canonicalUrlKey(u2);
            if (k) planByUrl.set(k, p);
          }
        }

        const now = new Date();
        const linkWrites: Array<Promise<any>> = [];
        for (const x of unmappedWithEfl) {
          const p = planByUrl.get(x.eflUrl) ?? planByUrl.get(canonicalUrlKey(x.eflUrl) ?? "") ?? null;
          const ratePlanId = p?.id ? String(p.id) : null;
          if (!ratePlanId) continue;

          linkWrites.push(
            (prisma as any).offerIdRatePlanMap
              .upsert({
                where: { offerId: x.offerId },
                create: {
                  offerId: x.offerId,
                  ratePlanId,
                  lastLinkedAt: now,
                  linkedBy: "dashboard_plans_auto_link",
                },
                update: {
                  ratePlanId,
                  lastLinkedAt: now,
                  linkedBy: "dashboard_plans_auto_link",
                },
                select: { ratePlanId: true },
              })
              .then(() => {
                // Keep local computations consistent in this request.
                mapByOfferId.set(x.offerId, ratePlanId);

                if (!planCalcByRatePlanId.has(ratePlanId)) {
                  const rsPresent = isRateStructurePresent(p?.rateStructure);
                  const storedStatus =
                    typeof p?.planCalcStatus === "string" ? (String(p.planCalcStatus) as any) : null;
                  const storedReason =
                    typeof p?.planCalcReasonCode === "string" ? String(p.planCalcReasonCode) : null;
                  const storedKeys = Array.isArray((p as any)?.requiredBucketKeys) ? ((p as any).requiredBucketKeys as any[]).map((k) => String(k)) : null;

                  if (storedStatus === "COMPUTABLE" || storedStatus === "NOT_COMPUTABLE") {
                    planCalcByRatePlanId.set(ratePlanId, {
                      planCalcStatus: storedStatus,
                      planCalcReasonCode: storedReason ?? "UNKNOWN",
                      rateStructurePresent: rsPresent,
                      rateStructure: rsPresent ? p.rateStructure : null,
                      requiredBucketKeys: storedKeys,
                    });
                  } else {
                    const derived = derivePlanCalcRequirementsFromTemplate({
                      rateStructure: rsPresent ? p.rateStructure : null,
                    });
                    planCalcByRatePlanId.set(ratePlanId, {
                      planCalcStatus: derived.planCalcStatus,
                      planCalcReasonCode: derived.planCalcReasonCode,
                      rateStructurePresent: rsPresent,
                      rateStructure: rsPresent ? p.rateStructure : null,
                      requiredBucketKeys: derived.requiredBucketKeys,
                    });
                  }
                }
              })
              .catch(() => {}),
          );
        }
        if (linkWrites.length) await Promise.all(linkWrites);
      }

      // (2) Ensure "QUEUED" offers are visible in admin review queue.
      const queuedWrites: Array<Promise<any>> = [];
      for (const o of pageSlice as any[]) {
        const offerId = String(o?.offer_id ?? "").trim();
        if (!offerId) continue;
        const eflUrl = String(o?.docs?.efl ?? "").trim() || null;
        const supplier = o?.supplier_name ?? null;
        const planName = o?.plan_name ?? null;
        const termMonths = typeof o?.term_months === "number" ? o.term_months : null;
        const tdspName = o?.distributor_name ?? null;

        const ratePlanId = mapByOfferId.get(offerId) ?? null;
        const calc = ratePlanId ? (planCalcByRatePlanId.get(ratePlanId) ?? null) : null;

        // Case A: queued because we have an EFL URL but no template mapping yet.
        if (!ratePlanId && eflUrl) {
          const syntheticSha = sha256Hex(["dashboard_plans", "EFL_PARSE", offerId, eflUrl].join("|"));
          queuedWrites.push(
            (prisma as any).eflParseReviewQueue
              .upsert({
                where: { eflPdfSha256: syntheticSha },
                create: {
                  source: "dashboard_plans",
                  kind: "EFL_PARSE",
                  dedupeKey: syntheticSha,
                  eflPdfSha256: syntheticSha,
                  offerId,
                  supplier,
                  planName,
                  eflUrl,
                  tdspName,
                  termMonths,
                  finalStatus: "NEEDS_REVIEW",
                  queueReason: "DASHBOARD_QUEUED: offer has EFL URL but no template mapping yet.",
                  resolvedAt: null,
                  resolvedBy: null,
                  resolutionNotes: null,
                },
                update: {
                  updatedAt: new Date(),
                  kind: "EFL_PARSE",
                  dedupeKey: syntheticSha,
                  offerId,
                  supplier,
                  planName,
                  eflUrl,
                  tdspName,
                  termMonths,
                  finalStatus: "NEEDS_REVIEW",
                  queueReason: "DASHBOARD_QUEUED: offer has EFL URL but no template mapping yet.",
                  resolvedAt: null,
                  resolvedBy: null,
                  resolutionNotes: null,
                },
              })
              .catch((e: any) => {
                // eslint-disable-next-line no-console
                console.error("[dashboard_plans] failed to upsert EFL_PARSE queue row", {
                  offerId,
                  eflUrl,
                  message: e?.message ?? String(e),
                });
              }),
          );
          continue;
        }

        // Case B: queued because the template exists but is not computable (or we couldn't determine computability).
        // IMPORTANT: UI statusLabel marks mapped offers as QUEUED when calc is missing, so we must also enqueue them.
        if (ratePlanId && (!calc || calc.planCalcStatus !== "COMPUTABLE")) {
          const planCalcStatus = calc?.planCalcStatus ?? "UNKNOWN";
          const reasonCode = String(calc?.planCalcReasonCode ?? "PLAN_CALC_MISSING");

          // If calc is present, only create PLAN_CALC_QUARANTINE for true template defects.
          // Do not create review noise for dashboard/bucket gating (credits/tiered/TOU/minimum rules).
          //
          // If calc is missing, we *do* enqueue to match the UI's QUEUED statusLabel behavior.
          if (calc && !isPlanCalcQuarantineWorthyReasonCode(reasonCode)) continue;

          const queueReasonPayload = {
            type: "PLAN_CALC_QUARANTINE",
            planCalcStatus,
            planCalcReasonCode: reasonCode,
            ratePlanId,
            offerId,
          };
          queuedWrites.push(
            (prisma as any).eflParseReviewQueue
              .upsert({
                where: { kind_dedupeKey: { kind: "PLAN_CALC_QUARANTINE", dedupeKey: offerId } },
                create: {
                  source: "dashboard_plans",
                  kind: "PLAN_CALC_QUARANTINE",
                  dedupeKey: offerId,
                  // Required NOT NULL unique field; for quarantines we use a synthetic stable value.
                  eflPdfSha256: sha256Hex(["dashboard_plans", "PLAN_CALC_QUARANTINE", offerId].join("|")),
                  offerId,
                  supplier,
                  planName,
                  eflUrl,
                  tdspName,
                  termMonths,
                  ratePlanId,
                  rawText: null,
                  planRules: null,
                  rateStructure: calc?.rateStructurePresent ? (calc.rateStructure ?? null) : null,
                  validation: null,
                  derivedForValidation: queueReasonPayload,
                  finalStatus: "OPEN",
                  queueReason: JSON.stringify(queueReasonPayload),
                  solverApplied: [],
                  resolvedAt: null,
                  resolvedBy: null,
                  resolutionNotes: reasonCode,
                },
                update: {
                  supplier,
                  planName,
                  eflUrl,
                  tdspName,
                  termMonths,
                  ratePlanId,
                  derivedForValidation: queueReasonPayload,
                  finalStatus: "OPEN",
                  queueReason: JSON.stringify(queueReasonPayload),
                  resolvedAt: null,
                  resolvedBy: null,
                  resolutionNotes: reasonCode,
                },
              })
              .catch((e: any) => {
                // eslint-disable-next-line no-console
                console.error("[dashboard_plans] failed to upsert PLAN_CALC_QUARANTINE queue row", {
                  offerId,
                  ratePlanId,
                  message: e?.message ?? String(e),
                });
              }),
          );
        }

        // Case C: queued because required usage buckets are still missing for this home (after auto-ensure).
        // This must be visible in admin queue, otherwise the customer dashboard can show QUEUED with no ops surface.
        if (hasUsage && ratePlanId && calc && calc.planCalcStatus === "COMPUTABLE") {
          const req = Array.isArray((calc as any)?.requiredBucketKeys) ? ((calc as any).requiredBucketKeys as string[]) : [];
          const missing = req.filter((k) => !hasRecentBucket(String(k)));
          if (missing.length > 0) {
            const reasonCode = "MISSING_REQUIRED_BUCKETS";
            const queueReasonPayload = {
              type: "PLAN_CALC_QUARANTINE",
              planCalcStatus: "COMPUTABLE",
              planCalcReasonCode: reasonCode,
              requiredBucketKeys: req,
              missingBucketKeys: missing,
              ratePlanId,
              offerId,
            };
            queuedWrites.push(
              (prisma as any).eflParseReviewQueue
                .upsert({
                  where: { kind_dedupeKey: { kind: "PLAN_CALC_QUARANTINE", dedupeKey: offerId } },
                  create: {
                    source: "dashboard_plans",
                    kind: "PLAN_CALC_QUARANTINE",
                    dedupeKey: offerId,
                    eflPdfSha256: sha256Hex(["dashboard_plans", "PLAN_CALC_QUARANTINE", offerId].join("|")),
                    offerId,
                    supplier,
                    planName,
                    eflUrl,
                    tdspName,
                    termMonths,
                    ratePlanId,
                    rawText: null,
                    planRules: null,
                    rateStructure: calc?.rateStructurePresent ? (calc.rateStructure ?? null) : null,
                    validation: null,
                    derivedForValidation: queueReasonPayload,
                    finalStatus: "OPEN",
                    queueReason: JSON.stringify(queueReasonPayload),
                    solverApplied: [],
                    resolvedAt: null,
                    resolvedBy: null,
                    resolutionNotes: `Missing required buckets: ${missing.join(", ")}`,
                  },
                  update: {
                    supplier,
                    planName,
                    eflUrl,
                    tdspName,
                    termMonths,
                    ratePlanId,
                    derivedForValidation: queueReasonPayload,
                    finalStatus: "OPEN",
                    queueReason: JSON.stringify(queueReasonPayload),
                    resolvedAt: null,
                    resolvedBy: null,
                    resolutionNotes: `Missing required buckets: ${missing.join(", ")}`,
                  },
                })
                .catch(() => {}),
            );
          }
        }
      }
      if (queuedWrites.length) await Promise.all(queuedWrites);
    } catch {
      // Best-effort only.
    }

    const shapeOfferBase = (o: any) => {
      const ratePlanId = mapByOfferId.get(o.offer_id) ?? null;
      const templateAvailable = ratePlanId != null;
      const eflUrl = o.docs?.efl ?? null;
      const statusLabel = (() => {
        if (!ratePlanId) return eflUrl ? "QUEUED" : "UNAVAILABLE";
        const calc = planCalcByRatePlanId.get(ratePlanId) ?? null;
        if (calc && calc.planCalcStatus === "COMPUTABLE") return "AVAILABLE";
        // Mapped but not computable (yet) => queued for calc review / next engine version.
        return "QUEUED";
      })();

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
          usageKwhPerMonth:
            typeof avgMonthlyKwhForDisplay === "number" && Number.isFinite(avgMonthlyKwhForDisplay)
              ? avgMonthlyKwhForDisplay
              : undefined,
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

      // Best-effort RatePlan/template probe (includes persisted plan-calc requirements).
      // Guardrail: only treat as missing when we're sure the row is missing (no throw).
      let templateOk = ratePlanId != null;
      let ratePlanRow: any | null = null;
      let didThrowTemplateProbe = false;
      if (ratePlanId) {
        try {
          ratePlanRow = await (prisma as any).ratePlan.findUnique({
            where: { id: ratePlanId },
            select: {
              id: true,
              rateStructure: true,
              planCalcVersion: true,
              planCalcStatus: true,
              planCalcReasonCode: true,
              requiredBucketKeys: true,
              supportedFeatures: true,
              planCalcDerivedAt: true,
            },
          });
          if (!ratePlanRow) templateOk = false;
        } catch {
          didThrowTemplateProbe = true;
          // do not downgrade templateOk on transient errors
          ratePlanRow = null;
        }
      }

      const template = ratePlanRow ? { rateStructure: ratePlanRow.rateStructure ?? null } : null;

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

      // Persisted plan-calc requirements (preferred), with lazy backfill for older RatePlans.
      // Also compute planComputability for UI + quarantine logic without breaking offers.
      let planComputability: any | null = null;
      let requiredBucketKeys: string[] = [];
      let planCalcStatus: string | null = null;
      let planCalcReasonCode: string | null = null;
      let planCalcInputs: any | null = null;
      let missingBucketKeys: string[] = [];
      const isComputableOverride = () =>
        String(planCalcReasonCode ?? "").trim() === "ADMIN_OVERRIDE_COMPUTABLE" &&
        String(planCalcStatus ?? "").trim() === "COMPUTABLE";

      if (hasUsage && (base as any)?.intelliwatt?.templateAvailable && templateOk) {
        const offerId = String((base as any).offerId ?? "");
        const templateAvailable = Boolean((base as any)?.intelliwatt?.templateAvailable);
        const effectiveRatePlanId = templateOk ? ratePlanId : null;

        // Prefer stored fields on RatePlan when present.
        const storedKeys = Array.isArray(ratePlanRow?.requiredBucketKeys) ? (ratePlanRow.requiredBucketKeys as any[]) : [];
        const storedStatus = typeof ratePlanRow?.planCalcStatus === "string" ? String(ratePlanRow.planCalcStatus) : null;
        const storedReason = typeof ratePlanRow?.planCalcReasonCode === "string" ? String(ratePlanRow.planCalcReasonCode) : null;

        if (storedKeys.length > 0 && storedStatus) {
          requiredBucketKeys = storedKeys.map((k) => String(k));
          planCalcStatus = storedStatus;
          planCalcReasonCode = storedReason ?? "UNKNOWN";
        } else {
          const derived = derivePlanCalcRequirementsFromTemplate({ rateStructure: template?.rateStructure });
          requiredBucketKeys = derived.requiredBucketKeys;
          planCalcStatus = derived.planCalcStatus;
          planCalcReasonCode = derived.planCalcReasonCode;

          // Lazy backfill so older RatePlans self-heal (best-effort; never breaks offers).
          if (effectiveRatePlanId) {
            try {
              (prisma as any).ratePlan
                .update({
                  where: { id: effectiveRatePlanId },
                  data: {
                    planCalcVersion: derived.planCalcVersion,
                    planCalcStatus: derived.planCalcStatus,
                    planCalcReasonCode: derived.planCalcReasonCode,
                    requiredBucketKeys: derived.requiredBucketKeys,
                    supportedFeatures: derived.supportedFeatures as any,
                    planCalcDerivedAt: new Date(),
                  },
                })
                .catch(() => {});
            } catch {
              // swallow
            }
          }
        }

        planComputability = canComputePlanFromBuckets({
          offerId,
          ratePlanId: effectiveRatePlanId,
          templateAvailable: templateAvailable && templateOk,
          template: templateOk ? (template ? { rateStructure: template.rateStructure } : null) : null,
        });

        // Expose the actual variables we used (or would use) for plan-cost calcs.
        // Keep it minimal and only populate when we have the template.
        try {
          const rs = template?.rateStructure ?? null;
          const repEnergyCentsPerKwh = rs ? extractFixedRepEnergyCentsPerKwh(rs) : null;
          const repFixedMonthlyChargeDollars = rs ? extractRepFixedMonthlyChargeDollars(rs) : null;
          planCalcInputs = {
            annualKwh: annualKwhForCalc ?? null,
            monthlyKwh: avgMonthlyKwhForDisplay ?? null,
            tdsp: tdspRates
              ? {
                  perKwhDeliveryChargeCents: Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0,
                  monthlyCustomerChargeDollars: Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0,
                  effectiveDate: tdspRates?.effectiveDate ?? null,
                }
              : null,
            rep: {
              energyCentsPerKwh: repEnergyCentsPerKwh,
              fixedMonthlyChargeDollars: repFixedMonthlyChargeDollars,
            },
          };
        } catch {
          planCalcInputs = null;
        }

        // Bucket presence check (uses requiredBucketKeys rather than hardcoding total).
        // v1: mostly ["kwh.m.all.total"], but this makes TOU/tier expansion deterministic.
        missingBucketKeys = (requiredBucketKeys ?? []).filter((k) => !hasRecentBucket(String(k)));

        // Quarantine best-effort ONLY for plan-defect reasons (unsupported/non-deterministic/etc.).
        // Missing buckets is an availability/inputs issue and should NOT create review noise.
        const quarantineReasonCode = String(
          planCalcReasonCode ?? (planComputability as any)?.reasonCode ?? "",
        ).trim();
        const shouldQuarantine =
          (planCalcStatus === "NOT_COMPUTABLE" || planComputability?.status === "NOT_COMPUTABLE") &&
          Boolean(quarantineReasonCode) &&
          isPlanCalcQuarantineWorthyReasonCode(quarantineReasonCode);

        if (shouldQuarantine && offerId) {
          const queueReasonPayload = {
            type: "PLAN_CALC_QUARANTINE",
            planCalcStatus: planCalcStatus ?? null,
            planCalcReasonCode: quarantineReasonCode || null,
            requiredBucketKeys: requiredBucketKeys ?? null,
            missingBucketKeys: missingBucketKeys.length > 0 ? missingBucketKeys : null,
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
                  // Legacy NOT NULL unique field (EFL queue origin). For quarantine we do not use it as identity.
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
                  derivedForValidation: { ...(planComputability as any)?.details, missingBucketKeys },
                  finalStatus: "OPEN",
                  queueReason: JSON.stringify(queueReasonPayload),
                  solverApplied: [],
                  resolvedAt: null,
                  resolvedBy: null,
                  resolutionNotes:
                    (planComputability?.reason ?? planCalcReasonCode ?? quarantineReasonCode ?? "Not computable"),
                },
                update: {
                  supplier: (base as any)?.supplierName ?? null,
                  planName: (base as any)?.planName ?? null,
                  eflUrl: (base as any)?.efl?.eflUrl ?? null,
                  tdspName: (base as any)?.utility?.utilityName ?? null,
                  termMonths: (base as any)?.termMonths ?? null,
                  ratePlanId: effectiveRatePlanId,
                  derivedForValidation: { ...(planComputability as any)?.details, missingBucketKeys },
                  finalStatus: "OPEN",
                  queueReason: JSON.stringify(queueReasonPayload),
                  resolutionNotes:
                    (planComputability?.reason ?? planCalcReasonCode ?? quarantineReasonCode ?? "Not computable"),
                },
              })
              .catch(() => {});
          } catch {
            // swallow
          }
        }
      }

      const trueCostEstimate: any = (() => {
        if (!hasUsage) return { status: "NOT_IMPLEMENTED", reason: "No usage available" };
        if (annualKwhForCalc == null) {
          return { status: "NOT_IMPLEMENTED", reason: "Missing usage totals for annual kWh" };
        }
        if (!templateOk || !template?.rateStructure) {
          return { status: "NOT_IMPLEMENTED", reason: "Missing template rateStructure" };
        }
        if (!tdspRates) {
          return { status: "NOT_IMPLEMENTED", reason: "Missing TDSP delivery rates" };
        }
        // Manual override: when ops explicitly forces COMPUTABLE, do not block on template-derived planComputability.
        if (!isComputableOverride() && planComputability && planComputability.status === "NOT_COMPUTABLE") {
          return { status: "NOT_COMPUTABLE", reason: planComputability.reason ?? "Plan not computable" };
        }
        const tdspApplied = {
          perKwhDeliveryChargeCents: Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0,
          monthlyCustomerChargeDollars: Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0,
          effectiveDate: tdspRates?.effectiveDate ?? undefined,
        };
        const est = calculatePlanCostForUsage({
          annualKwh: annualKwhForCalc,
          monthsCount: 12,
          tdsp: tdspApplied,
          rateStructure: template.rateStructure,
          usageBucketsByMonth: usageBucketsByMonthForCalc,
        });
        if (
          est &&
          (est as any).status === "OK" &&
          typeof (est as any).annualCostDollars === "number" &&
          Number.isFinite((est as any).annualCostDollars) &&
          typeof annualKwhForCalc === "number" &&
          Number.isFinite(annualKwhForCalc) &&
          annualKwhForCalc > 0
        ) {
          const eff = (((est as any).annualCostDollars as number) / annualKwhForCalc) * 100;
          return { ...(est as any), effectiveCentsPerKwh: eff };
        }
        return est;
      })();

      const statusLabelFinal = (() => {
        const current = String((base as any)?.intelliwatt?.statusLabel ?? "").trim() || "UNAVAILABLE";
        if (!hasUsage) return current;
        // If the template isn't even computable/mapped, keep the existing label.
        if (current !== "AVAILABLE") return current;
        // Fail-closed: if required buckets are missing, or estimator can't compute, treat as QUEUED.
        if (missingBucketKeys.length > 0) return "QUEUED";
        if (!isComputableOverride() && planComputability && planComputability.status === "NOT_COMPUTABLE") return "QUEUED";
        const s = String(trueCostEstimate?.status ?? "").toUpperCase();
        if (s && s !== "OK" && s !== "APPROXIMATE") return "QUEUED";
        return current;
      })();

      return {
        ...base,
        intelliwatt: {
          ...(base as any).intelliwatt,
          statusLabel: statusLabelFinal,
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
          ...(planCalcInputs ? { planCalcInputs } : {}),
          trueCostEstimate,
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

        // Compute "all-in" best offers by scoring the ENTIRE offer set (not the proxy bestOffers or current page slice).
        // Score = trueCostEstimate.monthlyCostDollars for computable plans only (fail-closed).
        // Then shape only the top 5 to keep response bounded.
        const allInTdspCache = new Map<string, any | null>();
        const scoreOfferAllIn = async (o: any): Promise<number> => {
          if (annualKwhForCalc == null) return Number.POSITIVE_INFINITY;
          const offerId = String(o?.offer_id ?? "");
          if (!offerId) return Number.POSITIVE_INFINITY;

          const ratePlanId = mapByOfferId.get(offerId) ?? null;
          if (!ratePlanId) return Number.POSITIVE_INFINITY;

          const calc = planCalcByRatePlanId.get(ratePlanId) ?? null;
          if (!calc || calc.planCalcStatus !== "COMPUTABLE" || !calc.rateStructurePresent || !calc.rateStructure) {
            return Number.POSITIVE_INFINITY;
          }

          const tdspSlugRaw = (shapeOfferBase(o) as any)?.utility?.tdspSlug ?? null;
          const tdspSlug = typeof tdspSlugRaw === "string" ? tdspSlugRaw.trim().toLowerCase() : "";
          let tdspRates: any | null = null;
          if (tdspSlug) {
            if (allInTdspCache.has(tdspSlug)) {
              tdspRates = allInTdspCache.get(tdspSlug) ?? null;
            } else {
              try {
                tdspRates = await getTdspDeliveryRates({ tdspSlug: tdspSlug, asOf: new Date() });
              } catch {
                tdspRates = null;
              }
              allInTdspCache.set(tdspSlug, tdspRates);
            }
          }

          const est = calculatePlanCostForUsage({
            annualKwh: annualKwhForCalc,
            monthsCount: 12,
            tdsp: {
              perKwhDeliveryChargeCents: Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0,
              monthlyCustomerChargeDollars: Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0,
              effectiveDate: tdspRates?.effectiveDate ?? undefined,
            },
            rateStructure: calc.rateStructure,
            usageBucketsByMonth: usageBucketsByMonthForCalc,
          });

          if (est?.status !== "OK") return Number.POSITIVE_INFINITY;
          const v = Number((est as any)?.monthlyCostDollars);
          return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
        };

        const scored = await Promise.all(
          offers.map(async (o: any) => ({ o, v: await scoreOfferAllIn(o) })),
        );

        const topAllInRaw = scored
          .filter((x) => x.v !== Number.POSITIVE_INFINITY)
          .sort((a, b) => a.v - b.v)
          .slice(0, 5)
          .map((x) => x.o);

        bestOffersAllIn = await Promise.all(topAllInRaw.map(shapeOffer));
        if (bestOffersAllIn.length > 0) {
          bestOffersAllInBasis = "proxy_allin_monthly_trueCostEstimate";
          bestOffersAllInDisclaimer =
            "Includes TDSP delivery. Ranked by IntelliWatt all-in estimate using your usage buckets (excludes non-deterministic/indexed/unsupported plans).";
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
        avgMonthlyKwh: avgMonthlyKwhForDisplay ?? undefined,
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


