import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers, type OfferNormalized } from "@/lib/wattbuy/normalize";
import { getTrueCostStatus } from "@/lib/plan-engine/trueCostStatus";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { estimateTrueCost } from "@/lib/plan-engine/estimateTrueCost";
import { getCachedPlanEstimate, putCachedPlanEstimate, sha256Hex as sha256HexCache } from "@/lib/plan-engine/planEstimateCache";
import { PLAN_ENGINE_ESTIMATE_VERSION, makePlanEstimateInputsSha256 } from "@/lib/plan-engine/estimateInputsKey";
import { getMaterializedPlanEstimate } from "@/lib/plan-engine/materializedEstimateStore";
import { wattbuyOffersPrisma } from "@/lib/db/wattbuyOffersClient";
import { usagePrisma } from "@/lib/db/usageClient";
import { buildUsageBucketsForEstimate } from "@/lib/usage/buildUsageBucketsForEstimate";
import { canComputePlanFromBuckets, derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";
import { isPlanCalcQuarantineWorthyReasonCode } from "@/lib/plan-engine/planCalcQuarantine";
import { deriveUniversalAvailability } from "@/lib/plan-engine/universalStatus";
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

    let house: any = await (prisma as any).houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      // NOTE: Prisma client types may lag behind schema deploys; keep select typed as any.
      select: {
        id: true,
        isRenter: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
        esiid: true,
        tdspSlug: true,
        utilityName: true,
        rawWattbuyJson: true,
        updatedAt: true,
      } as any,
    });

    if (!house) {
      house = await (prisma as any).houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null } as any,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          isRenter: true,
          addressLine1: true,
          addressCity: true,
          addressState: true,
          addressZip5: true,
          esiid: true,
          tdspSlug: true,
          utilityName: true,
          rawWattbuyJson: true,
          updatedAt: true,
        } as any,
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
    const datasetMode = parseBoolParam(url.searchParams.get("dataset"), false);
    const page = Math.max(1, toInt(url.searchParams.get("page"), 1));
    // Default UI paging is 10-50, but the PlansClient can request a full dataset (no refetch on sort/filter)
    // by passing dataset=1 and a larger pageSize.
    const pageSize = datasetMode
      ? clamp(toInt(url.searchParams.get("pageSize"), 2000), 50, 2000)
      : clamp(toInt(url.searchParams.get("pageSize"), 20), 10, 50);
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const rateType = (url.searchParams.get("rateType") ?? "all").trim().toLowerCase();
    const term = (url.searchParams.get("term") ?? "all").trim().toLowerCase();
    const renewableMin = clamp(toInt(url.searchParams.get("renewableMin"), 0), 0, 100);
    const template = (url.searchParams.get("template") ?? "all").trim().toLowerCase();
    const sort = (url.searchParams.get("sort") ?? "kwh1000_asc") as SortKey;
    // Renter is a persisted home attribute (address-level), not a dashboard filter.
    // We intentionally do NOT trust a query param here.
    const isRenter = Boolean((house as any)?.isRenter === true);
    const approxKwhPerMonth = parseApproxKwhPerMonth(url.searchParams.get("approxKwhPerMonth"));

    // Usage summary: cheap aggregate over the last 12 months, best-effort.
    // Must never break offers response (wrap errors).
    let hasUsage = false;
    // Canonical usage window anchor: latest SMT interval timestamp (not "now").
    // This must match the detail route so plan engine inputs hash the same everywhere.
    let usageWindowEnd: Date = new Date();
    let usageCutoff: Date = new Date(usageWindowEnd.getTime() - 365 * DAY_MS);
    let usageRowsForSummary = 0;
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
        usageWindowEnd = latest?.ts ?? new Date();
        usageCutoff = new Date(usageWindowEnd.getTime() - 365 * DAY_MS);
        const rangeEnd = usageWindowEnd;
        const rangeStart = usageCutoff;
        const aggregates = await prisma.smtInterval.aggregate({
          where: { esiid: house.esiid, ts: { gte: rangeStart, lte: rangeEnd } },
          _count: { _all: true },
          _sum: { kwh: true },
          _min: { ts: true },
          _max: { ts: true },
        });

        const rows = Number(aggregates?._count?._all ?? 0) || 0;
        usageRowsForSummary = rows;
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

    // Canonical calc buckets (stitched 12 months). We'll fill after we know requiredBucketKeys.
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

        // Leave usageBucketsByMonthForCalc empty here; we will build the stitched-month map later
        // once we know union requiredBucketKeys across mapped plans.
      }
    } catch (err) {
      console.error("[dashboard/plans] CORE bucket on-demand backfill failed (best-effort)", err);
    }

    // Prefer usageSummary totals for display + math consistency (matches Usage page and Plan Details page),
    // but keep bucket-derived values as best-effort fallback.
    const annualKwhFromUsageSummary: number | null =
      typeof usageSummaryTotalKwh === "number" && Number.isFinite(usageSummaryTotalKwh) && usageSummaryTotalKwh > 0
        ? usageSummaryTotalKwh
        : null;
    const avgMonthlyKwhFromUsageSummary: number | null =
      annualKwhFromUsageSummary != null ? annualKwhFromUsageSummary / 12 : null;

    // NOTE: annualKwhForCalc will be overridden later after we build canonical stitched buckets.
    let annualKwhForCalc: number | null = annualKwhFromUsageSummary ?? null;
    let avgMonthlyKwhForDisplay: number | null = avgMonthlyKwhFromUsageSummary ?? null;
    let yearMonthsForCalc: string[] = [];

    const hasRecentBucket = (bucketKey: string): boolean => {
      if (!bucketKey) return false;
      if (!recentYearMonths || recentYearMonths.length === 0) return false;
      const s = bucketPresenceByKey.get(bucketKey);
      if (!s) return false;
      return recentYearMonths.every((ym) => s.has(ym));
    };

    // Prefer cached offers first; WattBuy upstream can be slow (cold starts / retry backoffs).
    // Keep a short TTL and fall back to the last cached payload on upstream failures.
    let rawOffersResp: any = null;
    let usedFallbackSnapshot = false;
    let usedOffersCache = false;
    try {
      const { wattbuyOffersPrisma } = await import("@/lib/db/wattbuyOffersClient");
      const OFFERS_ENDPOINT = "DASHBOARD_WATTBUY_OFFERS_V1";
      const OFFERS_TTL_MS = 15 * 60 * 1000; // 15 min
      // IMPORTANT: keep this key in sync with the pipeline's offer snapshot key.
      // It must reflect "all=true" so we don't pin a small default subset in cache.
      const requestKey = `offers_by_address_v2|line1=${house.addressLine1}|city=${house.addressCity}|state=${house.addressState}|zip=${house.addressZip5}|isRenter=${String(
        isRenter,
      )}|all=true`;

      const cached = await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.findFirst({
        where: { endpoint: OFFERS_ENDPOINT, houseAddressId: house.id, requestKey },
        orderBy: { createdAt: "desc" },
        select: { payloadJson: true, fetchedAt: true },
      });

      const cachedAt = cached?.fetchedAt instanceof Date ? cached.fetchedAt : null;
      const cachedPayload = (cached as any)?.payloadJson ?? null;
      const cachedFresh =
        cachedAt != null && Date.now() - cachedAt.getTime() <= OFFERS_TTL_MS && cachedPayload != null;

      if (cachedFresh) {
        rawOffersResp = cachedPayload;
        usedOffersCache = true;
      } else {
        try {
          // Live refresh (bounded by WattBuy client timeout). If it fails, fall back to stale cache.
          rawOffersResp = await wattbuy.offers({
            address: house.addressLine1,
            city: house.addressCity,
            state: house.addressState,
            zip: house.addressZip5,
            isRenter,
          });
        } catch {
          rawOffersResp = cachedPayload;
          usedOffersCache = Boolean(cachedPayload);
        }
        // Best-effort cache write (never block dashboard on DB errors).
        try {
          await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.create({
            data: {
              fetchedAt: new Date(),
              endpoint: OFFERS_ENDPOINT,
              houseAddressId: house.id,
              requestKey,
              payloadJson: rawOffersResp ?? { __emptyPayload: true },
              payloadSha256: sha256HexCache(JSON.stringify({ v: 1, requestKey })),
            },
          });
        } catch {
          // ignore
        }
      }
    } catch {
      // If anything goes wrong with the cache path, fall back to live call and then to the stored house snapshot.
      try {
        rawOffersResp = await wattbuy.offers({
          address: house.addressLine1,
          city: house.addressCity,
          state: house.addressState,
          zip: house.addressZip5,
          isRenter,
        });
      } catch {
        rawOffersResp = house.rawWattbuyJson ?? null;
        usedFallbackSnapshot = true;
      }
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
          const storedKeys = Array.isArray((rp as any)?.requiredBucketKeys)
            ? ((rp as any).requiredBucketKeys as any[]).map((k) => String(k))
            : [];

          // Always compute derived requirements when rateStructure is present. We use this as the canonical
          // requiredBucketKeys for hashing (inputsSha256) so the dashboard and pipeline agree, even if the stored
          // requiredBucketKeys are stale.
          const derived = derivePlanCalcRequirementsFromTemplate({
            rateStructure: rsPresent ? rp.rateStructure : null,
          });

          const derivedKeys = Array.isArray((derived as any)?.requiredBucketKeys)
            ? ((derived as any).requiredBucketKeys as any[]).map((k) => String(k))
            : [];

          const keysEqual = (() => {
            if (storedKeys.length !== derivedKeys.length) return false;
            for (let i = 0; i < storedKeys.length; i++) {
              if (String(storedKeys[i] ?? "") !== String(derivedKeys[i] ?? "")) return false;
            }
            return true;
          })();

          if (storedStatus === "COMPUTABLE" || storedStatus === "NOT_COMPUTABLE") {
            // IMPORTANT:
            // Prefer the derived planCalc status from the current engine when we have a rateStructure,
            // otherwise a stale stored NOT_COMPUTABLE can block bucket loading and leave offers stuck as
            // "UNSUPPORTED" / pending forever even though the engine is now able to compute them.
            //
            // The only exception is an explicit admin override to COMPUTABLE.
            const isAdminOverride =
              storedStatus === "COMPUTABLE" && String(storedReason ?? "").trim() === "ADMIN_OVERRIDE_COMPUTABLE";

            const shouldPreferDerived = rsPresent && !isAdminOverride;
            const effectiveStatus = shouldPreferDerived ? derived.planCalcStatus : storedStatus;
            const effectiveReason =
              shouldPreferDerived ? (derived.planCalcReasonCode || "UNKNOWN") : (storedReason ?? "UNKNOWN");
            const effectiveKeys =
              shouldPreferDerived
                ? derivedKeys
                : (storedKeys.length ? storedKeys : derivedKeys.length ? derivedKeys : []);

            planCalcByRatePlanId.set(id, {
              planCalcStatus: effectiveStatus,
              planCalcReasonCode: effectiveReason,
              rateStructurePresent: rsPresent,
              rateStructure: rsPresent ? rp.rateStructure : null,
              requiredBucketKeys: effectiveKeys.length ? effectiveKeys : null,
            });

            // Best-effort self-heal: if stored differs from derived (and not admin override), update the RatePlan row.
            // This helps the pipeline, admin views, and future requests converge.
            if (shouldPreferDerived) {
              try {
                const storedStatusNorm = String(storedStatus ?? "").trim();
                const storedReasonNorm = String(storedReason ?? "").trim();
                const nextStatusNorm = String(derived.planCalcStatus ?? "").trim();
                const nextReasonNorm = String(derived.planCalcReasonCode ?? "").trim();
                const nextKeysNorm = derivedKeys;
                const differs =
                  (nextStatusNorm && storedStatusNorm !== nextStatusNorm) ||
                  (nextReasonNorm && storedReasonNorm !== nextReasonNorm) ||
                  (derivedKeys.length > 0 && !keysEqual);
                if (differs) {
                  (prisma as any).ratePlan
                    .update({
                      where: { id },
                      data: {
                        planCalcVersion: (derived as any)?.planCalcVersion ?? 1,
                        planCalcStatus: nextStatusNorm || storedStatusNorm || "UNKNOWN",
                        planCalcReasonCode: nextReasonNorm || storedReasonNorm || "UNKNOWN",
                        requiredBucketKeys: nextKeysNorm,
                        supportedFeatures: (derived as any)?.supportedFeatures ?? {},
                        planCalcDerivedAt: new Date(),
                      },
                      select: { id: true },
                    })
                    .catch(() => {});
                }
              } catch {
                // ignore
              }
            }
            continue;
          }

          // Fall back to deriving from rateStructure (if present); otherwise treat as unknown.
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
        // Only load bucket keys for plans that are actually COMPUTABLE by the current engine.
        // Unavailable plans (TOU/indexed/unsupported) often explode the keyset and make this endpoint slow.
        planCalcByRatePlanId.forEach((v: any) => {
          if (String(v?.planCalcStatus ?? "") !== "COMPUTABLE") return;
          const keys = Array.isArray(v?.requiredBucketKeys) ? (v.requiredBucketKeys as string[]) : [];
          for (const k of keys) {
            const kk = String(k ?? "").trim();
            if (kk) unionKeys.add(kk);
          }
        });

        // Canonical: use the exact same stitched 12-month usage buckets as the detail route.
        // This ensures the engine input hash matches and the saved WattBuy DB estimate is reused everywhere.
        try {
          const bucketBuild = await buildUsageBucketsForEstimate({
            homeId: house.id,
            usageSource: "SMT",
            esiid: house.esiid,
            rawId: null,
            windowEnd: usageWindowEnd,
            cutoff: usageCutoff,
            requiredBucketKeys: Array.from(unionKeys),
            monthsCount: 12,
            maxStepDays: 2,
            // IMPORTANT:
            // The plans list must use the same *semantic* bucket-building behavior as the engine
            // and admin tooling: period buckets must be consistent with kwh.m.all.total.
            //
            // We prefer DAILY stitching when daily buckets exist, but fall back to interval stitching
            // when DAILY coverage is incomplete (common early on, or if only totals were computed).
            //
            // This avoids false `USAGE_BUCKET_SUM_MISMATCH` failures that block TOU plans that are
            // otherwise computable (e.g. Half-price Nights).
            stitchMode: "DAILY_OR_INTERVAL",
            // Plans list must be display-only: do not compute buckets here.
            // The pipeline (or usage ingestion) is responsible for populating buckets.
            computeMissing: false,
          });

          yearMonthsForCalc = bucketBuild.yearMonths.slice();
          usageBucketsByMonthForCalc = bucketBuild.usageBucketsByMonth;

          // Guardrail:
          // Only trust bucket-derived annual kWh when we have complete month coverage for kwh.m.all.total.
          //
          // Otherwise (e.g. if bucket computation failed silently and only a couple months exist),
          // `bucketBuild.annualKwh` can be wildly low (because missing months are treated as 0),
          // which then changes the cache key + makes sorting appear to "trigger recalculation" and
          // can even show absurdly low "$/mo" based on ~1-2 months of data.
          const bucketAnnualOk = (() => {
            const months = Array.isArray(bucketBuild.yearMonths) ? bucketBuild.yearMonths : [];
            if (months.length !== 12) return false;
            for (const ym of months) {
              const v = bucketBuild.usageBucketsByMonth?.[ym]?.["kwh.m.all.total"];
              if (typeof v !== "number" || !Number.isFinite(v)) return false;
            }
            return true;
          })();

          if (
            bucketAnnualOk &&
            typeof bucketBuild.annualKwh === "number" &&
            Number.isFinite(bucketBuild.annualKwh) &&
            bucketBuild.annualKwh > 0
          ) {
            annualKwhForCalc = bucketBuild.annualKwh;
            avgMonthlyKwhForDisplay = bucketBuild.annualKwh / 12;
          }

          // Keep the response usageSummary aligned with the same calc window we used for estimates.
          if (hasUsage) {
            usageSummary = {
              source: "SMT",
              rangeStart: usageCutoff.toISOString(),
              rangeEnd: usageWindowEnd.toISOString(),
              totalKwh:
                typeof annualKwhForCalc === "number" && Number.isFinite(annualKwhForCalc)
                  ? Number(annualKwhForCalc.toFixed(6))
                  : undefined,
              rows: usageRowsForSummary || undefined,
            };
          }

          // For "missing buckets" checks, use the most recent two months in the calc window.
          const ym = bucketBuild.yearMonths ?? [];
          const last = ym.length ? ym[ym.length - 1] : null;
          const prev = ym.length >= 2 ? ym[ym.length - 2] : null;
          recentYearMonths = (prev ? [last!, prev] : last ? [last] : []).filter(Boolean) as string[];
        } catch {
          // ignore (never break dashboard)
        }

        // IMPORTANT: refresh the bucket presence map AFTER bucket auto-ensure ran.
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
    if (hasUsage && sort === "best_for_you_proxy") {
      // Best-for-you: sort by the real monthly total estimate (lowest → highest).
      // Fail-closed: plans that cannot compute for this home sort to the bottom.
      const tdspCache = new Map<string, any | null>();

      const getTdsp = async (tdspSlug: string): Promise<any | null> => {
        const key = String(tdspSlug ?? "").trim().toLowerCase();
        if (!key) return null;
        if (tdspCache.has(key)) return tdspCache.get(key) ?? null;
        let tdspRates: any | null = null;
        try {
          tdspRates = await getTdspDeliveryRates({ tdspSlug: key, asOf: new Date() });
        } catch {
          tdspRates = null;
        }
        tdspCache.set(key, tdspRates);
        return tdspRates;
      };

      // Batch-read cached estimates to avoid N-per-offer DB queries (which can timeout on Vercel).
      const ENDPOINT = "PLAN_ENGINE_ESTIMATE_V1";
      const monthsCount = 12;
      const buildRequestKey = (ratePlanId: string) => `plan_estimate|ratePlanId=${ratePlanId}|months=${monthsCount}`;
      const keyOf = (requestKey: string, payloadSha256: string) => `${requestKey}|${payloadSha256}`;

      const candidates: Array<{ idx: number; requestKey: string; inputsSha256: string }> = [];
      const candidateByIdx = new Map<number, { requestKey: string; inputsSha256: string }>();
      for (let idx = 0; idx < offers.length; idx++) {
        const o = offers[idx] as any;
        if (annualKwhForCalc == null) continue;
        const offerId = String(o?.offer_id ?? "");
        if (!offerId) continue;

        const ratePlanId = mapByOfferId.get(offerId) ?? null;
        if (!ratePlanId) continue;

        const calc = planCalcByRatePlanId.get(ratePlanId) ?? null;
        if (!calc || calc.planCalcStatus !== "COMPUTABLE" || !calc.rateStructurePresent || !calc.rateStructure) continue;

        // OfferNormalized already includes a normalized TDSP slug (oncor/centerpoint/tnmp/aep_n/aep_c).
        const tdspSlug = String((o as any)?.tdsp ?? "").trim().toLowerCase();
        if (!tdspSlug) continue;

        const tdspRates = await getTdsp(tdspSlug);
        if (!tdspRates) continue;

        const tdspPer = Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0;
        const tdspMonthly = Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0;
        const tdspEff = tdspRates?.effectiveDate ?? null;
        const estimateMode =
          String((calc as any)?.planCalcReasonCode ?? "").trim() === "INDEXED_APPROXIMATE_OK"
            ? ("INDEXED_EFL_ANCHOR_APPROX" as const)
            : ("DEFAULT" as const);
        const { inputsSha256 } = makePlanEstimateInputsSha256({
          monthsCount,
          annualKwh: annualKwhForCalc,
          tdsp: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
          rateStructure: calc.rateStructure,
          yearMonths: yearMonthsForCalc.length ? yearMonthsForCalc : lastNYearMonthsChicago(12),
          requiredBucketKeys: Array.isArray((calc as any)?.requiredBucketKeys)
            ? ((calc as any).requiredBucketKeys as any[]).map((k) => String(k))
            : [],
          usageBucketsByMonth: usageBucketsByMonthForCalc,
          estimateMode,
        });

        const requestKey = buildRequestKey(ratePlanId);
        const row = { idx, requestKey, inputsSha256 };
        candidates.push(row);
        candidateByIdx.set(idx, { requestKey, inputsSha256 });
      }

      const cacheMap = new Map<string, any>();
      try {
        const requestKeys = Array.from(new Set(candidates.map((c) => c.requestKey)));
        const payloadShas = Array.from(new Set(candidates.map((c) => c.inputsSha256)));
        // NOTE: this may return extra rows (cross-product); we de-dupe to newest by ordering desc.
        const rows = await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.findMany({
          where: {
            endpoint: ENDPOINT,
            houseAddressId: house.id,
            requestKey: { in: requestKeys },
            payloadSha256: { in: payloadShas },
          },
          orderBy: { createdAt: "desc" },
          select: { requestKey: true, payloadSha256: true, payloadJson: true },
        });
        for (const r of rows ?? []) {
          const k = keyOf(String(r?.requestKey ?? ""), String(r?.payloadSha256 ?? ""));
          if (!cacheMap.has(k)) cacheMap.set(k, r?.payloadJson ?? null);
        }
      } catch {
        // ignore; fall through with empty cacheMap
      }

      const withKey = offers.map((o, idx) => {
        // Default: fail-closed to bottom.
        let v = Number.POSITIVE_INFINITY;
        try {
          const offerId = String((o as any)?.offer_id ?? "");
          const ratePlanId = offerId ? (mapByOfferId.get(offerId) ?? null) : null;
          if (ratePlanId) {
            const calc = planCalcByRatePlanId.get(ratePlanId) ?? null;
            if (calc && calc.planCalcStatus === "COMPUTABLE" && calc.rateStructurePresent && calc.rateStructure) {
              const c = candidateByIdx.get(idx) ?? null;
              if (c) {
                const cached = cacheMap.get(keyOf(c.requestKey, c.inputsSha256)) ?? null;
                const st = String((cached as any)?.status ?? "").trim().toUpperCase();
                if (cached && (st === "OK" || st === "APPROXIMATE")) {
                  const vv = Number((cached as any)?.monthlyCostDollars);
                  v = Number.isFinite(vv) ? vv : Number.POSITIVE_INFINITY;
                }
              }
            }
          }
        } catch {
          v = Number.POSITIVE_INFINITY;
        }
        return { o, idx, v };
      });
      withKey.sort((a, b) => {
        if (a.v < b.v) return -1;
        if (a.v > b.v) return 1;
        const pa = ((a.o as any)?.plan_name ?? "").toLowerCase();
        const pb = ((b.o as any)?.plan_name ?? "").toLowerCase();
        if (pa < pb) return -1;
        if (pa > pb) return 1;
        return a.idx - b.idx;
      });
      offers = withKey.map((x) => x.o);
    } else {
      offers = sortOffers(offers, sort);
    }

    const total = offers.length;
    const totalPages = datasetMode ? (total === 0 ? 0 : 1) : total === 0 ? 0 : Math.ceil(total / pageSize);
    const safePage = datasetMode ? 1 : totalPages === 0 ? 1 : clamp(page, 1, totalPages);
    const startIdx = datasetMode ? 0 : (safePage - 1) * pageSize;
    const pageSlice = datasetMode ? offers.slice(0, pageSize) : offers.slice(startIdx, startIdx + pageSize);

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
    // NOTE: datasetMode returns a large list used for client-side sort/filter; avoid doing side-effectful
    // admin-queue writes across hundreds of offers.
    if (!datasetMode) try {
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

        // Case A: queued because there is no template mapping yet.
        // If we have an EFL URL, ops can parse it immediately.
        // If we DON'T have an EFL URL, we still queue the offer so ops can investigate why docs are missing.
        if (!ratePlanId) {
          const identity = eflUrl || "MISSING_EFL_URL";
          const syntheticSha = sha256HexCache(["dashboard_plans", "EFL_PARSE", offerId, identity].join("|"));
          const reason = eflUrl
            ? "DASHBOARD_QUEUED: offer has EFL URL but no template mapping yet."
            : "DASHBOARD_QUEUED: offer is missing EFL URL and has no template mapping yet.";
          queuedWrites.push(
            (prisma as any).eflParseReviewQueue
              .upsert({
                where: { kind_dedupeKey: { kind: "EFL_PARSE", dedupeKey: offerId } },
                create: {
                  source: "dashboard_plans",
                  kind: "EFL_PARSE",
                  dedupeKey: offerId,
                  eflPdfSha256: syntheticSha,
                  offerId,
                  supplier,
                  planName,
                  eflUrl,
                  tdspName,
                  termMonths,
                  finalStatus: "NEEDS_REVIEW",
                  queueReason: reason,
                  resolvedAt: null,
                  resolvedBy: null,
                  resolutionNotes: null,
                },
                update: {
                  updatedAt: new Date(),
                  kind: "EFL_PARSE",
                  dedupeKey: offerId,
                  offerId,
                  supplier,
                  planName,
                  eflUrl,
                  tdspName,
                  termMonths,
                  finalStatus: "NEEDS_REVIEW",
                  queueReason: reason,
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
                  eflPdfSha256: sha256HexCache(["dashboard_plans", "PLAN_CALC_QUARANTINE", offerId].join("|")),
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

        // IMPORTANT:
        // Missing required usage buckets is HOME-specific (insufficient usage history / buckets not built yet),
        // not a template defect. Do NOT enqueue it into the admin template queue.
      }
      if (queuedWrites.length) await Promise.all(queuedWrites);
    } catch {
      // Best-effort only.
    }

    // Compliance / disclosures: map supplier contact info from our PUCT REP catalog (DB),
    // so we don't depend on WattBuy providing email/phone in every offer payload.
    // Best-effort only; never block the plans page.
    const puctRepByNumber = new Map<string, { email: string | null; phone: string | null }>();
    try {
      const puctNumbers = new Set<string>();

      // 1) PUCT numbers present directly on the offer payload.
      for (const o of offers as any[]) {
        const p = strOrNull((o as any)?.supplier_puct_registration);
        if (p) puctNumbers.add(p);
      }

      // 2) PUCT numbers present on mapped templates (RatePlan.repPuctCertificate / supplierPUCT).
      if (mappedRatePlanIds.length > 0) {
        try {
          const rows = await (prisma as any).ratePlan.findMany({
            where: { id: { in: mappedRatePlanIds } },
            select: { repPuctCertificate: true, supplierPUCT: true },
          });
          for (const rp of rows ?? []) {
            const a = strOrNull((rp as any)?.repPuctCertificate);
            const b = strOrNull((rp as any)?.supplierPUCT);
            if (a) puctNumbers.add(a);
            if (b) puctNumbers.add(b);
          }
        } catch {
          // ignore
        }
      }

      const list = Array.from(puctNumbers);
      if (list.length > 0) {
        const reps = await (prisma as any).puctRep.findMany({
          where: { puctNumber: { in: list } },
          select: { puctNumber: true, email: true, phone: true },
        });
        for (const r of reps ?? []) {
          const p = strOrNull((r as any)?.puctNumber);
          if (!p) continue;
          puctRepByNumber.set(p, {
            email: strOrNull((r as any)?.email),
            phone: strOrNull((r as any)?.phone),
          });
        }
      }
    } catch {
      // ignore
    }

    const shapeOfferBase = (o: any) => {
      const ratePlanId = mapByOfferId.get(o.offer_id) ?? null;
      const templateAvailable = ratePlanId != null;
      const eflUrl = o.docs?.efl ?? null;
      const tosUrl = o.docs?.tos ?? null;
      const yracUrl = o.docs?.yrac ?? null;
      const statusLabel = (() => {
        // Dashboard semantics (restore):
        // - AVAILABLE means "a template exists for this offer" (we can attempt to calculate).
        // - QUEUED means "no template yet but we have an EFL URL (can be parsed)".
        // - (legacy) UNAVAILABLE previously meant "no template and no EFL URL", but we now expose a 2-state truth
        //   to customers: AVAILABLE vs QUEUED. Missing template is therefore always QUEUED.
        //
        // Engine support/unsupported is expressed separately via planComputability + trueCostEstimate.status.
        if (!ratePlanId) return "QUEUED";
        return "AVAILABLE";
      })();

      // Normalize proxy pricing fields once, under offer.efl.* (single source of truth).
      const eflAvg1000 = numOrNull(o?.kwh1000_cents);
      const eflAvg500 = numOrNull(o?.kwh500_cents);
      const eflAvg2000 = numOrNull(o?.kwh2000_cents);

      const cancellationFeeText = strOrNull(o?.cancel_fee_text);
      const supplierPuctRegistration = strOrNull(o?.supplier_puct_registration);
      const repFromDb = supplierPuctRegistration ? puctRepByNumber.get(supplierPuctRegistration) ?? null : null;

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
          tosUrl: tosUrl ?? undefined,
          yracUrl: yracUrl ?? undefined,
          eflPdfSha256: undefined,
          repPuctCertificate: undefined,
          eflVersionCode: undefined,
          lastSeenAt: usedFallbackSnapshot ? house.updatedAt.toISOString() : undefined,
        },
        disclosures: {
          supplierPuctRegistration: supplierPuctRegistration ?? undefined,
          supplierContactEmail:
            strOrNull(o?.supplier_contact_email) ?? repFromDb?.email ?? undefined,
          supplierContactPhone:
            strOrNull(o?.supplier_contact_phone) ?? repFromDb?.phone ?? undefined,
          cancellationFeeText: cancellationFeeText ?? undefined,
          tosUrl: tosUrl ?? undefined,
          yracUrl: yracUrl ?? undefined,
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

    // PERF/RELIABILITY:
    // Avoid N-per-offer RatePlan lookups (can trigger Postgres query_wait_timeout under load).
    // Bulk-fetch the RatePlan rows for the current page slice once, then shape offers from the in-memory map.
    const ratePlanRowsById = new Map<string, any>();
    let didThrowRatePlanBatch = false;
    try {
      const ids = Array.from(
        new Set(
          pageSlice
            .map((o: any) => {
              const offerId = String(o?.offer_id ?? "").trim();
              if (!offerId) return null;
              const ratePlanId = mapByOfferId.get(offerId) ?? null;
              return ratePlanId ? String(ratePlanId) : null;
            })
            .filter(Boolean) as string[],
        ),
      );

      if (ids.length > 0) {
        const rows = await (prisma as any).ratePlan.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            cancelFee: true,
            eflUrl: true,
            tosUrl: true,
            yracUrl: true,
            repPuctCertificate: true,
            supplierPUCT: true,
            rateStructure: true,
            planCalcVersion: true,
            planCalcStatus: true,
            planCalcReasonCode: true,
            requiredBucketKeys: true,
            supportedFeatures: true,
            planCalcDerivedAt: true,
          },
        });
        for (const r of rows ?? []) {
          const id = String((r as any)?.id ?? "").trim();
          if (!id) continue;
          ratePlanRowsById.set(id, r);
        }
      }
    } catch {
      didThrowRatePlanBatch = true;
    }

    // Guardrail: never allow this route to spam writes while shaping large datasets.
    let planCalcBackfillWrites = 0;
    const MAX_PLAN_CALC_BACKFILL_WRITES = datasetMode ? 5 : 10;

    const shapeOffer = async (o: any) => {
      const base = shapeOfferBase(o);
      const ratePlanId = base?.intelliwatt?.ratePlanId ?? null;

      // Best-effort RatePlan/template probe (includes persisted plan-calc requirements).
      // Guardrail: only treat as missing when we're sure the row is missing (no throw).
      let templateOk = ratePlanId != null;
      let ratePlanRow: any | null = null;
      let didThrowTemplateProbe = false;
      if (ratePlanId) {
        // If the batch lookup threw, treat this as a transient lookup error for ALL offers on this response.
        didThrowTemplateProbe = didThrowRatePlanBatch;
        if (!didThrowRatePlanBatch) {
          ratePlanRow = ratePlanRowsById.get(String(ratePlanId)) ?? null;
          if (!ratePlanRow) templateOk = false;
        }
      }

      const template = ratePlanRow ? { rateStructure: ratePlanRow.rateStructure ?? null } : null;

      // Prefer DB-backed template docs + PUCT certificate when available.
      // Cancellation fee should follow WattBuy's presentation (can be a schedule like "$15/month remaining"),
      // so we do NOT override offer-provided cancel_fee_text with RatePlan.cancelFee.
      const dbEflUrl = strOrNull(ratePlanRow?.eflUrl);
      const dbTosUrl = strOrNull(ratePlanRow?.tosUrl);
      const dbYracUrl = strOrNull(ratePlanRow?.yracUrl);
      const dbPuct =
        strOrNull(ratePlanRow?.repPuctCertificate) ?? strOrNull(ratePlanRow?.supplierPUCT);

      const mergedEfl = {
        ...(base as any).efl,
        ...(dbEflUrl ? { eflUrl: dbEflUrl } : {}),
        ...(dbTosUrl ? { tosUrl: dbTosUrl } : {}),
        ...(dbYracUrl ? { yracUrl: dbYracUrl } : {}),
      };
      const mergedDisclosures = {
        ...((base as any).disclosures ?? {}),
        ...(dbPuct ? { supplierPuctRegistration: dbPuct } : {}),
        ...(dbTosUrl ? { tosUrl: dbTosUrl } : {}),
        ...(dbYracUrl ? { yracUrl: dbYracUrl } : {}),
      };
      // Fill supplier contact from the PUCT REP catalog when we have a PUCT number but missing contact fields.
      const mergedPuct = strOrNull((mergedDisclosures as any)?.supplierPuctRegistration);
      const puctContact = mergedPuct ? puctRepByNumber.get(mergedPuct) ?? null : null;
      const mergedDisclosuresFinal = {
        ...mergedDisclosures,
        ...(puctContact?.email && !(mergedDisclosures as any)?.supplierContactEmail
          ? { supplierContactEmail: puctContact.email }
          : {}),
        ...(puctContact?.phone && !(mergedDisclosures as any)?.supplierContactPhone
          ? { supplierContactPhone: puctContact.phone }
          : {}),
      };

      const mergedBase = { ...(base as any), efl: mergedEfl, disclosures: mergedDisclosuresFinal };

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

      // IMPORTANT:
      // If the RatePlan/template probe threw, we must not treat it as "missing template" (that triggers
      // EFL re-parsing and can pin the UI in a "calculating" state). Instead, fail closed as a transient
      // NOT_IMPLEMENTED condition and let the next fetch succeed when DB recovers.
      if (hasUsage && (base as any)?.intelliwatt?.templateAvailable && templateOk && !didThrowTemplateProbe) {
        const offerId = String((base as any).offerId ?? "");
        const templateAvailable = Boolean((base as any)?.intelliwatt?.templateAvailable);
        const effectiveRatePlanId = templateOk ? ratePlanId : null;

        // IMPORTANT:
        // Prefer derived plan-calc requirements (status + requiredBucketKeys) from the current engine whenever we have
        // a rateStructure. Stored fields can be stale after engine upgrades and cause:
        // - offers to incorrectly show as UNSUPPORTED
        // - inputsSha256 mismatches (pipeline computes, dashboard reads different key) → stuck CACHE_MISS / pending
        //
        // The only exception is an explicit admin override to COMPUTABLE.
        const storedKeys = Array.isArray(ratePlanRow?.requiredBucketKeys)
          ? (ratePlanRow.requiredBucketKeys as any[]).map((k) => String(k))
          : [];
        const storedStatus = typeof ratePlanRow?.planCalcStatus === "string" ? String(ratePlanRow.planCalcStatus) : null;
        const storedReason =
          typeof ratePlanRow?.planCalcReasonCode === "string" ? String(ratePlanRow.planCalcReasonCode) : null;

        const derived = derivePlanCalcRequirementsFromTemplate({ rateStructure: template?.rateStructure });
        const derivedKeys = Array.isArray(derived?.requiredBucketKeys) ? derived.requiredBucketKeys.map((k) => String(k)) : [];

        const isAdminOverride =
          String(storedStatus ?? "").trim() === "COMPUTABLE" &&
          String(storedReason ?? "").trim() === "ADMIN_OVERRIDE_COMPUTABLE";

        const shouldPreferDerived = Boolean(template?.rateStructure) && !isAdminOverride;
        requiredBucketKeys = shouldPreferDerived ? derivedKeys : (storedKeys.length ? storedKeys : derivedKeys);
        planCalcStatus = shouldPreferDerived ? derived.planCalcStatus : storedStatus;
        planCalcReasonCode = shouldPreferDerived ? derived.planCalcReasonCode : (storedReason ?? "UNKNOWN");

        // Lazy backfill so older/stale RatePlans self-heal (best-effort; never breaks offers).
        if (effectiveRatePlanId && shouldPreferDerived && planCalcBackfillWrites < MAX_PLAN_CALC_BACKFILL_WRITES) {
          planCalcBackfillWrites++;
          try {
            (prisma as any).ratePlan
              .update({
                where: { id: effectiveRatePlanId },
                data: {
                  planCalcVersion: derived.planCalcVersion,
                  planCalcStatus: derived.planCalcStatus,
                  planCalcReasonCode: derived.planCalcReasonCode,
                  requiredBucketKeys: derivedKeys,
                  supportedFeatures: derived.supportedFeatures as any,
                  planCalcDerivedAt: new Date(),
                },
              })
              .catch(() => {});
          } catch {
            // swallow
          }
        }

        planComputability = canComputePlanFromBuckets({
          offerId,
          ratePlanId: effectiveRatePlanId,
          templateAvailable: templateAvailable && templateOk,
          template: templateOk ? (template ? { rateStructure: template.rateStructure } : null) : null,
        });

        // IMPORTANT: Honor persisted plan-calc status (including admin overrides).
        // `planComputability` is a best-effort derived check; if the RatePlan has been marked COMPUTABLE,
        // we must not show customer-facing "UNSUPPORTED" for the offer.
        // (Estimates already honor ADMIN_OVERRIDE_COMPUTABLE via `isComputableOverride()` below.)
        if (String(planCalcStatus ?? "").trim() === "COMPUTABLE" && String(planComputability?.status ?? "") === "NOT_COMPUTABLE") {
          planComputability = {
            status: "COMPUTABLE",
            requiredBucketKeys: Array.isArray(requiredBucketKeys) ? requiredBucketKeys : ["kwh.m.all.total"],
            notes: Array.isArray((planComputability as any)?.notes) ? (planComputability as any).notes : [],
          };
        }

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
                  eflPdfSha256: sha256HexCache(["dashboard_plans", "PLAN_CALC_QUARANTINE", offerId].join("|")),
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
                  resolvedAt: null,
                  resolvedBy: null,
                },
              })
              .catch(() => {});
          } catch {
            // swallow
          }
        }
      }

      const trueCostEstimate: any = await (async () => {
        if (!hasUsage) return { status: "MISSING_USAGE" };
        if (annualKwhForCalc == null) {
          return { status: "NOT_IMPLEMENTED", reason: "MISSING_USAGE_TOTALS" };
        }
        if (didThrowTemplateProbe) {
          return { status: "NOT_IMPLEMENTED", reason: "TEMPLATE_LOOKUP_ERROR" };
        }
        if (!templateOk || !template?.rateStructure) {
          return { status: "MISSING_TEMPLATE" };
        }
        if (!tdspRates) {
          return { status: "NOT_IMPLEMENTED", reason: "MISSING_TDSP_RATES" };
        }
        // Manual override: when ops explicitly forces COMPUTABLE, do not block on template-derived planComputability.
        if (!isComputableOverride() && planComputability && planComputability.status === "NOT_COMPUTABLE") {
          return { status: "NOT_COMPUTABLE", reason: planComputability.reason ?? "Plan not computable" };
        }
        // If required usage buckets are missing, this is not "unsupported"—it means the pipeline hasn't populated
        // the required bucket keys for the home yet.
        if (missingBucketKeys.length > 0) {
          return { status: "NOT_IMPLEMENTED", reason: "MISSING_BUCKETS" };
        }
        // Cache key: (home + ratePlan + engineVersion + tdsp + rateStructure + usageBucketsDigest)
        // This makes the engine run once per unique input-set, then reused across pages.
        // Best-effort: if cache read/write fails, fall back to computing inline.
        const monthsCount = 12;
        const tdspPer = Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0;
        const tdspMonthly = Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0;
        const tdspEff = tdspRates?.effectiveDate ?? null;
        // IMPORTANT: estimateMode must match the pipeline's cache keying.
        // Use the effective planCalcReasonCode (template-level) rather than per-home derived planComputability.
        // BUGFIX: previously read from `template.planCalcReasonCode` (not present), forcing DEFAULT and causing
        // indexed plans (e.g. Champ Saver-1) to get stuck as CACHE_MISS forever.
        const estimateMode =
          String(planCalcReasonCode ?? "").trim() === "INDEXED_APPROXIMATE_OK"
            ? ("INDEXED_EFL_ANCHOR_APPROX" as const)
            : ("DEFAULT" as const);
        const { inputsSha256 } = makePlanEstimateInputsSha256({
          monthsCount,
          annualKwh: annualKwhForCalc,
          tdsp: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
          rateStructure: template.rateStructure,
          yearMonths: yearMonthsForCalc.length ? yearMonthsForCalc : lastNYearMonthsChicago(12),
          requiredBucketKeys: Array.isArray(requiredBucketKeys) ? requiredBucketKeys : [],
          usageBucketsByMonth: usageBucketsByMonthForCalc,
          estimateMode,
        });

        const cacheRatePlanId = ratePlanId ?? "";
        // vNext: prefer the canonical materialized estimate table (single source of truth).
        const materialized = await getMaterializedPlanEstimate({
          houseAddressId: house.id,
          ratePlanId: cacheRatePlanId,
          inputsSha256,
        });
        if (materialized) return materialized as any;

        // Migration fallback: legacy snapshot cache (will be removed after backfill completes).
        const cached = await getCachedPlanEstimate({
          houseAddressId: house.id,
          ratePlanId: cacheRatePlanId,
          inputsSha256,
          monthsCount,
        });
        if (cached) return cached;

        // IMPORTANT: Plans list must be cache-only so sort/filter/pagination never triggers engine work.
        // Cache warm-up happens via `/api/dashboard/plans/pipeline` (dashboard bootstrap) or admin tooling.
        return { status: "NOT_IMPLEMENTED", reason: "CACHE_MISS" };
      })();

      // If an offer is template-mapped but the engine returns NOT_COMPUTABLE, it MUST be visible in admin review.
      // Examples: USAGE_BUCKET_SUM_MISMATCH (bucket defs/aggregation mismatch) and NON_DETERMINISTIC_PRICING_INDEXED.
      try {
        const offerIdForQueue = String((base as any)?.offerId ?? "").trim();
        const effectiveRatePlanIdForQueue = ratePlanId ?? null;
        const estStatus = String(trueCostEstimate?.status ?? "").trim();
        const estReason = String(trueCostEstimate?.reason ?? "").trim();
        const quarantineReasonCode = estReason || estStatus;

        if (
          offerIdForQueue &&
          effectiveRatePlanIdForQueue &&
          estStatus === "NOT_COMPUTABLE" &&
          isPlanCalcQuarantineWorthyReasonCode(quarantineReasonCode)
        ) {
          const queueReasonPayload = {
            type: "PLAN_CALC_QUARANTINE",
            source: "dashboard_plans_trueCostEstimate",
            estimateStatus: estStatus,
            estimateReason: estReason || null,
            requiredBucketKeys: requiredBucketKeys ?? null,
            missingBucketKeys: missingBucketKeys.length > 0 ? missingBucketKeys : null,
            ratePlanId: effectiveRatePlanIdForQueue,
            offerId: offerIdForQueue,
          };

          (prisma as any).eflParseReviewQueue
            .upsert({
              where: { kind_dedupeKey: { kind: "PLAN_CALC_QUARANTINE", dedupeKey: offerIdForQueue } },
              create: {
                source: "dashboard_plans",
                kind: "PLAN_CALC_QUARANTINE",
                dedupeKey: offerIdForQueue,
                // Legacy NOT NULL unique field (EFL queue origin). For quarantine we do not use it as identity.
                eflPdfSha256: sha256HexCache(["dashboard_plans", "PLAN_CALC_QUARANTINE", offerIdForQueue].join("|")),
                offerId: offerIdForQueue,
                supplier: (base as any)?.supplierName ?? null,
                planName: (base as any)?.planName ?? null,
                eflUrl: (base as any)?.efl?.eflUrl ?? null,
                tdspName: (base as any)?.utility?.utilityName ?? null,
                termMonths: (base as any)?.termMonths ?? null,
                ratePlanId: effectiveRatePlanIdForQueue,
                rawText: null,
                planRules: null,
                rateStructure: null,
                validation: null,
                derivedForValidation: { ...(planComputability as any)?.details, missingBucketKeys, trueCostEstimate },
                finalStatus: "OPEN",
                queueReason: JSON.stringify(queueReasonPayload),
                solverApplied: [],
                resolvedAt: null,
                resolvedBy: null,
                resolutionNotes: estReason || "NOT_COMPUTABLE",
              },
              update: {
                supplier: (base as any)?.supplierName ?? null,
                planName: (base as any)?.planName ?? null,
                eflUrl: (base as any)?.efl?.eflUrl ?? null,
                tdspName: (base as any)?.utility?.utilityName ?? null,
                termMonths: (base as any)?.termMonths ?? null,
                ratePlanId: effectiveRatePlanIdForQueue,
                derivedForValidation: { ...(planComputability as any)?.details, missingBucketKeys, trueCostEstimate },
                finalStatus: "OPEN",
                queueReason: JSON.stringify(queueReasonPayload),
                resolutionNotes: estReason || "NOT_COMPUTABLE",
                resolvedAt: null,
                resolvedBy: null,
              },
            })
            .catch(() => {});
        }
      } catch {
        // best-effort only; never block plans API
      }

      const universal = deriveUniversalAvailability(trueCostEstimate);

      return {
        ...mergedBase,
        intelliwatt: {
          ...(base as any).intelliwatt,
          // UNIVERSAL TRUTH:
          // - AVAILABLE iff plan engine produced OK/APPROXIMATE for this home+inputs
          // - QUEUED otherwise (with stable statusReason for ops/debug)
          statusLabel: universal.status,
          statusReason: universal.reason,
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
          ...(didThrowTemplateProbe ? { templateProbeDidThrow: true } : {}),
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
        // datasetMode (pageSize=2000) is used for client-side browsing/sort/filter.
        // Keep this route fast: do not run expensive "score the entire offer set" work.
        const allowComputeBestAllIn = Boolean(!datasetMode);
        // Only compute strips on page 1. They are not used on later pages and can be expensive.
        if (safePage !== 1) {
          bestOffers = [];
          bestOffersBasis = null;
          bestOffersDisclaimer = null;
          bestOffersAllIn = [];
          bestOffersAllInBasis = null;
          bestOffersAllInDisclaimer = null;
        } else {
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

        if (allowComputeBestAllIn) {
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

            // OfferNormalized already includes a normalized TDSP slug (oncor/centerpoint/tnmp/aep_n/aep_c).
            const tdspSlug = String(o?.tdsp ?? "").trim().toLowerCase();
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

            if (!tdspRates) return Number.POSITIVE_INFINITY;

            const monthsCount = 12;
            const tdspPer = Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0;
            const tdspMonthly = Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0;
            const tdspEff = tdspRates?.effectiveDate ?? null;
            const estimateMode =
              String((calc as any)?.planCalcReasonCode ?? "").trim() === "INDEXED_APPROXIMATE_OK"
                ? ("INDEXED_EFL_ANCHOR_APPROX" as const)
                : ("DEFAULT" as const);
            const { inputsSha256 } = makePlanEstimateInputsSha256({
              monthsCount,
              annualKwh: annualKwhForCalc,
              tdsp: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
              rateStructure: calc.rateStructure,
              yearMonths: yearMonthsForCalc.length ? yearMonthsForCalc : lastNYearMonthsChicago(12),
              requiredBucketKeys: Array.isArray((calc as any)?.requiredBucketKeys)
                ? ((calc as any).requiredBucketKeys as any[]).map((k) => String(k))
                : [],
              usageBucketsByMonth: usageBucketsByMonthForCalc,
              estimateMode,
            });

            const cached = await getCachedPlanEstimate({
              houseAddressId: house.id,
              ratePlanId,
              inputsSha256,
              monthsCount,
            });
            const materialized = await getMaterializedPlanEstimate({ houseAddressId: house.id, ratePlanId, inputsSha256 });
            const row = materialized ?? (cached as any);
            // Cache-only mode: never compute inline in plans list.
            const st = String((row as any)?.status ?? "").trim().toUpperCase();
            if (!row || !(st === "OK" || st === "APPROXIMATE")) return Number.POSITIVE_INFINITY;
            const v = Number((row as any)?.monthlyCostDollars);
            return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
          };

          const scored = await Promise.all(offers.map(async (o: any) => ({ o, v: await scoreOfferAllIn(o) })));
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
        }
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
      {
        status: 200,
        headers: {
          // IMPORTANT:
          // This endpoint is used for live polling while the background plan pipeline materializes estimates.
          // It must NEVER be served from browser disk cache, otherwise the UI can get stuck showing
          // "CALCULATING" even after the pipeline completes.
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 },
    );
  }
}


