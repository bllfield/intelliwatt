import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { computeAnnualKwhForEsiid, estimateOfferFromOfferId, getTdspApplied, type OfferEstimateResult } from "../_shared/estimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true" || v.trim() === "1";
  if (typeof v === "number") return v === 1;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const offerIdsIn = Array.isArray(body?.offerIds) ? body.offerIds : null;
    if (!offerIdsIn) {
      return NextResponse.json({ ok: false, error: "invalid_body_expected_offerIds_array" }, { status: 400 });
    }

    const monthsCount = (() => {
      const raw = body?.monthsCount;
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 12;
      const m = Number.isFinite(n) ? Math.floor(n) : 12;
      return Math.max(1, Math.min(12, m));
    })();

    const backfillRequested = toBool(body?.backfill);

    const offerIds: string[] = [];
    const seen = new Set<string>();
    for (const v of offerIdsIn) {
      const id = String(v ?? "").trim();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      offerIds.push(id);
      if (offerIds.length >= 25) break;
    }

    if (offerIds.length <= 0) {
      return NextResponse.json({ ok: false, error: "offerIds_empty" }, { status: 400 });
    }

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

    const esiid = house.esiid ? String(house.esiid) : null;
    const annualKwh = await computeAnnualKwhForEsiid(esiid);
    const tdspApplied = await getTdspApplied(house.tdspSlug ? String(house.tdspSlug) : null);

    const results: OfferEstimateResult[] = [];

    if (annualKwh == null) {
      for (const offerId of offerIds) {
        results.push({
          offerId,
          ok: false,
          error: "missing_usage_totals",
          httpStatus: 409,
          monthsCount,
          monthsIncluded: [],
          annualKwh: 0,
          usageBucketsByMonthIncluded: false,
          detected: { freeWeekends: false, dayNightTou: false },
          backfill: { requested: backfillRequested, attempted: false, ok: false, missingKeysBefore: 0, missingKeysAfter: 0 },
        });
      }

      return NextResponse.json({
        ok: true,
        monthsCount,
        backfillRequested,
        results,
      });
    }

    for (const offerId of offerIds) {
      // Sequential (safer for DB load).
      const r = await estimateOfferFromOfferId({
        offerId,
        monthsCount,
        backfill: backfillRequested,
        homeId: house.id,
        esiid,
        tdspSlug: house.tdspSlug ? String(house.tdspSlug) : null,
        tdsp: tdspApplied,
        annualKwh,
      }).catch((e: any) => ({
        offerId,
        ok: false,
        error: e?.message ? String(e.message) : "estimate_failed",
        httpStatus: 500,
        monthsCount,
        monthsIncluded: [],
        annualKwh,
        usageBucketsByMonthIncluded: false,
        detected: { freeWeekends: false, dayNightTou: false },
        backfill: { requested: backfillRequested, attempted: false, ok: false, missingKeysBefore: 0, missingKeysAfter: 0 },
      }));

      results.push(r as any);
    }

    return NextResponse.json({
      ok: true,
      monthsCount,
      backfillRequested,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "internal_error", message: e?.message ?? String(e) }, { status: 500 });
  }
}

