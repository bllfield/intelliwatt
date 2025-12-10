import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

  if (!sessionEmail) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const normalizedEmail = normalizeEmail(sessionEmail);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requestedHomeId =
    typeof body?.homeId === "string" && body.homeId.trim().length > 0
      ? body.homeId.trim()
      : null;

  if (!requestedHomeId) {
    return NextResponse.json(
      { ok: false, error: "home_id_required", message: "homeId is required." },
      { status: 400 },
    );
  }

  const house = await prisma.houseAddress.findFirst({
    where: { id: requestedHomeId, userId: user.id, archivedAt: null },
    select: { id: true, esiid: true },
  });

  if (!house) {
    return NextResponse.json(
      { ok: false, error: "home_not_found", message: "Home not found for this user." },
      { status: 404 },
    );
  }

  if (!house.esiid) {
    return NextResponse.json(
      {
        ok: true,
        status: "no_esiid",
        ready: false,
        message: "No ESIID is linked to this home yet.",
      },
      { status: 200 },
    );
  }

  // Check whether any SMT intervals exist for this ESIID.
  const intervalCount = await prisma.smtInterval.count({
    where: { esiid: house.esiid },
  });

  // Also report whether any raw SMT files have landed for visibility.
  const rawCount = await prisma.rawSmtFile.count({
    where: {
      OR: [
        { filename: { contains: house.esiid } },
        { storage_path: { contains: house.esiid } },
      ],
    },
  });

  const ready = intervalCount > 0;
  const phase =
    ready ? "ready" : rawCount > 0 ? "processing" : "pending";

  return NextResponse.json({
    ok: true,
    status: phase,
    ready,
    intervals: intervalCount,
    rawFiles: rawCount,
  });
}


