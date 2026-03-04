import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getActualIntervalsForRange, getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { deriveUsageShapeProfile } from "@/modules/usageShapeProfile/derive";
import { upsertUsageShapeProfile } from "@/modules/usageShapeProfile/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

const PROFILE_VERSION = "v1";

export async function POST(req: NextRequest) {
  if (!hasAdminSessionCookie(req)) {
    const gate = requireAdmin(req);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  }

  let body: { email?: string; houseId?: string; timezone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const email = normalizeEmailSafe(body?.email ?? "");
  if (!email) {
    return NextResponse.json({ ok: false, error: "email_required" }, { status: 400 });
  }

  const timezone = String(body?.timezone ?? "America/Chicago").trim() || "America/Chicago";

  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "user_not_found", message: "No user with that email." }, { status: 404 });
    }

    const houses = await prisma.houseAddress.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, esiid: true, addressLine1: true, addressCity: true, addressState: true },
    });
    if (!houses?.length) {
      return NextResponse.json({ ok: false, error: "no_houses", message: "User has no houses." }, { status: 404 });
    }

    const houseIdParam = (body?.houseId ?? "").trim();
    const house = houseIdParam
      ? houses.find((h) => h.id === houseIdParam)
      : houses[0];
    if (!house) {
      return NextResponse.json({ ok: false, error: "house_not_found", message: "House not found or not owned by user." }, { status: 404 });
    }

    const esiid = house.esiid ? String(house.esiid) : null;
    const result = await getActualUsageDatasetForHouse(house.id, esiid, { skipFullYearIntervalFetch: true });
    const summary = result?.dataset?.summary;
    if (!summary?.start || !summary?.end) {
      return NextResponse.json(
        { ok: false, error: "no_actual_data", message: "No actual interval data for baseline window." },
        { status: 400 }
      );
    }

    const startDate = summary.start.slice(0, 10);
    const endDate = summary.end.slice(0, 10);

    const actualIntervals = await getActualIntervalsForRange({
      houseId: house.id,
      esiid,
      startDate,
      endDate,
    });
    if (!actualIntervals?.length) {
      return NextResponse.json(
        { ok: false, error: "no_actual_data", message: "No actual interval data in window." },
        { status: 400 }
      );
    }

    const windowStartUtc = `${startDate}T00:00:00.000Z`;
    const windowEndUtc = `${endDate}T23:59:59.999Z`;
    const intervalsForDerive = actualIntervals.map((r) => ({ tsUtc: r.timestamp, kwh: r.kwh }));

    const profile = deriveUsageShapeProfile(intervalsForDerive, timezone, windowStartUtc, windowEndUtc);
    const { id } = await upsertUsageShapeProfile(house.id, PROFILE_VERSION, profile);

    return NextResponse.json({
      ok: true,
      profileId: id,
      houseId: house.id,
      houseLabel: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
      version: PROFILE_VERSION,
      windowStartUtc: profile.windowStartUtc,
      windowEndUtc: profile.windowEndUtc,
      intervalCount: actualIntervals.length,
      baseloadKwhPer15m: profile.baseloadKwhPer15m,
      baseloadKwhPerDay: profile.baseloadKwhPerDay,
      peakHourByMonth: profile.peakHourByMonth,
      p95KwByMonth: profile.p95KwByMonth,
      timeOfDayShares: profile.timeOfDayShares,
      configHash: profile.configHash,
      shapeAll96Preview: profile.shapeAll96.slice(0, 24),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[usage-shape-profile/rebuild]", message, err);
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message: "Rebuild failed. Try again or check server logs.",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}
