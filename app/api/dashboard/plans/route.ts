import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers, type OfferNormalized } from "@/lib/wattbuy/normalize";

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

    const intervalCount =
      house.esiid
        ? await prisma.smtInterval.count({ where: { esiid: house.esiid } })
        : 0;
    const greenButtonCount = await prisma.greenButtonUpload.count({
      where: { houseId: house.id },
    });
    const manualUsageCount = await prisma.manualUsageUpload.count({
      where: { houseId: house.id },
    });

    const hasUsage = intervalCount > 0 || greenButtonCount > 0 || manualUsageCount > 0;
    const usageSummary =
      intervalCount > 0
        ? { source: "SMT", annualKwh: undefined, last12moKwh: undefined }
        : greenButtonCount > 0
          ? { source: "GREENBUTTON", annualKwh: undefined, last12moKwh: undefined }
          : manualUsageCount > 0
            ? { source: "MANUAL", annualKwh: undefined, last12moKwh: undefined }
            : null;

    // Prefer live offers. If the call fails (transient upstream), fall back to the last stored snapshot.
    let rawOffersResp: any = null;
    let usedFallbackSnapshot = false;
    try {
      rawOffersResp = await wattbuy.offers({
        address: house.addressLine1,
        city: house.addressCity,
        state: house.addressState,
        zip: house.addressZip5,
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

    const shaped = pageSlice.map((o) => {
      const ratePlanId = mapByOfferId.get(o.offer_id) ?? null;
      const templateAvailable = Boolean(ratePlanId);
      const eflUrl = o.docs?.efl ?? null;
      const statusLabel = templateAvailable ? "AVAILABLE" : eflUrl ? "QUEUED" : "UNAVAILABLE";

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
          avgPriceCentsPerKwh500: o.kwh500_cents ?? undefined,
          avgPriceCentsPerKwh1000: o.kwh1000_cents ?? undefined,
          avgPriceCentsPerKwh2000: o.kwh2000_cents ?? undefined,
          eflUrl: eflUrl ?? undefined,
          eflPdfSha256: undefined,
          repPuctCertificate: undefined,
          eflVersionCode: undefined,
          lastSeenAt: usedFallbackSnapshot ? house.updatedAt.toISOString() : undefined,
        },
        intelliwatt: {
          templateAvailable,
          ratePlanId: ratePlanId ?? undefined,
          statusLabel,
        },
        utility: {
          tdspSlug: o.tdsp ?? house.tdspSlug ?? undefined,
          utilityName: o.distributor_name ?? house.utilityName ?? undefined,
        },
      };
    });

    return NextResponse.json(
      {
        ok: true,
        hasUsage,
        usageSummary,
        offers: shaped,
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


