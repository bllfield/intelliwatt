import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";
import { normalizeEmail } from "@/lib/utils/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLiveEntryStatus(s: any): boolean {
  return s === "ACTIVE" || s === "EXPIRING_SOON";
}

export async function GET(_req: NextRequest) {
  try {
    const cookieStore = cookies();
    const rawEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!rawEmail) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(rawEmail) },
      select: { id: true, email: true },
    });
    if (!user) return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });

    // House context (match compare route):
    // prefer ACTIVE usage entry's houseId, then newest usage entry, then newest house.
    const usageEntries = await prisma.entry.findMany({
      where: { userId: user.id, type: "smart_meter_connect" },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true, status: true, houseId: true },
    });
    const usageEntry = usageEntries.find((e) => isLiveEntryStatus(e.status)) ?? usageEntries[0] ?? null;
    let houseId = (usageEntry?.houseId as string | null) ?? null;
    if (!houseId) {
      const bestHouse = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null },
        orderBy: [{ updatedAt: "desc" }],
        select: { id: true },
      });
      houseId = bestHouse?.id ?? null;
    }
    if (!houseId) return NextResponse.json({ ok: true, hasCurrentPlan: false, houseId: null, source: null });

    const houses = await prisma.houseAddress.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true, esiid: true },
    });
    const house = houses.find((row) => String(row.id) === String(houseId)) ?? houses[0] ?? null;
    if (!house) return NextResponse.json({ ok: true, hasCurrentPlan: false, houseId, source: null });
    const knownHouseIds = Array.from(new Set(houses.map((row) => String(row.id)).filter(Boolean)));
    const knownEsiids = Array.from(
      new Set(
        houses
          .map((row) => (typeof row.esiid === "string" && row.esiid.trim().length > 0 ? row.esiid.trim() : null))
          .filter((value): value is string => Boolean(value))
      )
    );
    const houseEsiid = typeof house.esiid === "string" && house.esiid.trim().length > 0 ? house.esiid.trim() : null;

    const currentPlanPrisma = getCurrentPlanPrisma();
    const manualDelegate = (currentPlanPrisma as any).currentPlanManualEntry as any;
    const parsedDelegate = (currentPlanPrisma as any).parsedCurrentPlan as any;
    const manualHouseWhere =
      knownEsiids.length > 0
        ? {
            OR: [
              ...(knownHouseIds.length > 0 ? [{ houseId: { in: knownHouseIds } }] : []),
              { houseId: null, esiId: { in: knownEsiids } },
            ],
          }
        : knownHouseIds.length > 0
          ? { houseId: { in: knownHouseIds } }
          : { houseId };
    const parsedHouseWhere =
      knownEsiids.length > 0
        ? {
            OR: [
              ...(knownHouseIds.length > 0 ? [{ houseId: { in: knownHouseIds } }] : []),
              { houseId: null, OR: [{ esiId: { in: knownEsiids } }, { esiid: { in: knownEsiids } }] },
            ],
          }
        : knownHouseIds.length > 0
          ? { houseId: { in: knownHouseIds } }
          : { houseId };

    const latestManual = await manualDelegate.findFirst({
      where: {
        userId: user.id,
        ...manualHouseWhere,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, houseId: true, lastConfirmedAt: true, notes: true, esiId: true },
    });

    const isAutoImportedFromBill = (m: any): boolean => {
      const notes = typeof m?.notes === "string" ? m.notes : "";
      const confirmed = m?.lastConfirmedAt instanceof Date;
      return !confirmed && /imported\s+from\s+uploaded\s+bill/i.test(notes);
    };

    const hasManual = Boolean(latestManual && !isAutoImportedFromBill(latestManual));

    // Parsed (EFL or bill) is acceptable as "has current plan" for compare gating.
    // (Compare route itself will still apply its own precedence rules.)
    const latestParsed = await parsedDelegate.findFirst({
      where: {
        userId: user.id,
        uploadId: { not: null },
        ...parsedHouseWhere,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, houseId: true, esiId: true, esiid: true },
    });
    const hasParsed = Boolean(latestParsed);

    const hasCurrentPlan = hasManual || hasParsed;
    const source = hasManual ? "MANUAL" : hasParsed ? "PARSED" : null;
    const matchedHouseId =
      (latestManual?.houseId ? String(latestManual.houseId) : null) ??
      (latestParsed?.houseId ? String(latestParsed.houseId) : null) ??
      houseId;

    return NextResponse.json({ ok: true, hasCurrentPlan, houseId: matchedHouseId, source });
  } catch (error) {
    console.error("Error checking current plan status:", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

