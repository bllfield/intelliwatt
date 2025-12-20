import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { computeAnnualKwhForEsiid, estimateOfferFromOfferId, getTdspApplied } from "../_shared/estimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const offerId = String(url.searchParams.get("offerId") ?? "").trim();
    if (!offerId) {
      return NextResponse.json({ ok: false, error: "missing_offerId" }, { status: 400 });
    }

    const monthsCount = (() => {
      const raw = url.searchParams.get("monthsCount");
      const n = raw ? Number(raw) : 12;
      const m = Number.isFinite(n) ? Math.floor(n) : 12;
      return Math.max(1, Math.min(12, m));
    })();
    const backfillParam = url.searchParams.get("backfill");
    const autoEnsureBuckets =
      backfillParam == null
        ? true
        : (() => {
            const s = String(backfillParam ?? "").trim().toLowerCase();
            if (s === "1" || s === "true") return true;
            if (s === "0" || s === "false") return false;
            return false;
          })();

    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(sessionEmail) },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    }

    // Select the same "primary else latest" house strategy used elsewhere.
    let house = await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: { id: true, esiid: true, tdspSlug: true },
    });
    if (!house) {
      house = await prisma.houseAddress.findFirst({
        where: { userId: user.id } as any,
        orderBy: { createdAt: "desc" },
        select: { id: true, esiid: true, tdspSlug: true },
      });
    }
    if (!house) {
      return NextResponse.json({ ok: false, error: "home_not_found" }, { status: 404 });
    }

    const tdspSlug = String(house.tdspSlug ?? "")
      .trim()
      .toLowerCase();

    const esiid = house.esiid ? String(house.esiid) : null;
    const annualKwh = await computeAnnualKwhForEsiid(esiid);
    if (annualKwh == null) {
      return NextResponse.json({ ok: false, error: "missing_usage_totals", offerId }, { status: 409 });
    }

    const tdspApplied = await getTdspApplied(tdspSlug || null);

    const res = await estimateOfferFromOfferId({
      offerId,
      monthsCount,
      autoEnsureBuckets,
      homeId: house.id,
      esiid,
      tdspSlug: tdspSlug || null,
      tdsp: tdspApplied,
      annualKwh,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error ?? "estimate_failed", offerId }, { status: res.httpStatus ?? 500 });
    }

    return NextResponse.json({
      ok: true,
      offerId,
      ratePlan: res.ratePlan ?? null,
      tdspSlug: tdspSlug || null,
      monthsCount: res.monthsCount,
      annualKwh: res.annualKwh,
      usageBucketsByMonthIncluded: res.usageBucketsByMonthIncluded,
      backfill: res.backfill,
      bucketEnsure: (res as any).bucketEnsure ?? null,
      detected: res.detected,
      monthsIncluded: res.monthsIncluded,
      estimate: res.estimate,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "internal_error", message: e?.message ?? String(e) }, { status: 500 });
  }
}

