import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { cleanEsiid } from "@/lib/smt/esiid";

export const dynamic = "force-dynamic";

function digitsOnly(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as { houseAddressId?: unknown; esiid?: unknown } | null;
    const houseAddressId =
      body?.houseAddressId && typeof body.houseAddressId === "string" ? body.houseAddressId.trim() : "";
    const rawEsiid = body?.esiid && typeof body.esiid === "string" ? body.esiid.trim() : "";
    if (!houseAddressId) {
      return NextResponse.json({ ok: false, error: "Missing houseAddressId" }, { status: 400 });
    }
    if (!rawEsiid) {
      return NextResponse.json({ ok: false, error: "Missing esiid" }, { status: 400 });
    }

    const cleaned = cleanEsiid(digitsOnly(rawEsiid));
    if (!cleaned || cleaned.length < 17 || cleaned.length > 22) {
      return NextResponse.json({ ok: false, error: "Invalid ESIID (expected ~17 digits)." }, { status: 400 });
    }

    const email = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: houseAddressId, userId: user.id, archivedAt: null },
      select: { id: true },
    });
    if (!house) {
      return NextResponse.json({ ok: false, error: "House not found for user" }, { status: 404 });
    }

    await prisma.houseAddress.update({
      where: { id: house.id },
      data: { esiid: cleaned },
    });

    return NextResponse.json({ ok: true, esiid: cleaned });
  } catch (error) {
    console.error("[user/house/set-esiid] Failed to set ESIID", error);
    return NextResponse.json({ ok: false, error: "Failed to save ESIID" }, { status: 500 });
  }
}

