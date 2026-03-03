/**
 * Admin API: ground-truth raw usage for a single month from SmtInterval (Chicago month).
 * Use ?email=... so you can look up by the same identifier you use in the dashboard (no homeId needed).
 *
 * GET /api/admin/usage/raw-month?email=silvabreg@yahoo.com&yearMonth=2026-02
 * GET /api/admin/usage/raw-month?esiid=10443720001101972&yearMonth=2026-02
 * GET /api/admin/usage/raw-month?homeId=uuid&yearMonth=2026-02
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getRawMonthKwhFromSmt } from "@/lib/usage/rawMonthFromSmt";

export const dynamic = "force-dynamic";

function cleanEsiid(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").trim();
  return digits.length >= 17 ? digits : null;
}

async function resolveHouse(identifier: string): Promise<{ homeId: string; esiid: string } | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  if (trimmed.includes("@")) {
    const email = normalizeEmailSafe(trimmed);
    if (!email) return null;
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) return null;
    const house = await (prisma as any).houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, NOT: { esiid: null } },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
      select: { id: true, esiid: true },
    });
    if (!house?.esiid) return null;
    return { homeId: house.id, esiid: String(house.esiid) };
  }

  const esiid = cleanEsiid(trimmed);
  if (esiid) {
    const house = await prisma.houseAddress.findFirst({
      where: { esiid, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, esiid: true },
    });
    if (!house?.esiid) return null;
    return { homeId: house.id, esiid: String(house.esiid) };
  }

  const house = await prisma.houseAddress.findFirst({
    where: { id: trimmed, archivedAt: null },
    select: { id: true, esiid: true },
  });
  if (!house?.esiid) return null;
  return { homeId: house.id, esiid: String(house.esiid) };
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const url = new URL(req.url);
  const email = url.searchParams.get("email")?.trim() ?? null;
  const esiidParam = url.searchParams.get("esiid")?.trim() ?? null;
  const homeIdParam = url.searchParams.get("homeId")?.trim() ?? null;
  const yearMonth = url.searchParams.get("yearMonth")?.trim() ?? "2026-02";

  const identifier = email ?? esiidParam ?? homeIdParam;
  if (!identifier) {
    return NextResponse.json(
      { ok: false, error: "email_esiid_or_homeId_required", message: "Use ?email=... or ?esiid=... or ?homeId=..." },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ ok: false, error: "invalid_yearMonth", message: "yearMonth must be YYYY-MM" }, { status: 400 });
  }

  const house = await resolveHouse(identifier);
  if (!house) {
    return NextResponse.json(
      {
        ok: false,
        error: "user_or_house_not_found",
        resolvedFrom: email ? "email" : esiidParam ? "esiid" : "homeId",
        message: "No user with that email, or no house with that esiid/homeId, or house has no esiid.",
      },
      { status: 404 }
    );
  }

  const raw = await getRawMonthKwhFromSmt({ esiid: house.esiid, yearMonth });
  if (!raw) {
    return NextResponse.json({
      ok: true,
      yearMonth,
      homeId: house.homeId,
      esiid: house.esiid,
      resolvedFrom: email ? "email" : esiidParam ? "esiid" : "homeId",
      raw: null,
      message: "No intervals for this month",
    });
  }

  return NextResponse.json({
    ok: true,
    yearMonth,
    homeId: house.homeId,
    esiid: house.esiid,
    resolvedFrom: email ? "email" : esiidParam ? "esiid" : "homeId",
    raw,
    message: `Ground truth for ${yearMonth}: netKwh = ${raw.netKwh}`,
  });
}
