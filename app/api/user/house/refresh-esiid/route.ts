import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { cleanEsiid } from "@/lib/smt/esiid";
import { resolveAddressToEsiid } from "@/lib/resolver/addressToEsiid";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as { houseAddressId?: unknown } | null;
    const houseAddressId =
      body?.houseAddressId && typeof body.houseAddressId === "string" ? body.houseAddressId.trim() : "";
    if (!houseAddressId) {
      return NextResponse.json({ ok: false, error: "Missing houseAddressId" }, { status: 400 });
    }

    const email = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: houseAddressId, userId: user.id, archivedAt: null },
      select: {
        id: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
        esiid: true,
        tdspSlug: true,
        utilityName: true,
      },
    });

    if (!house) {
      return NextResponse.json({ ok: false, error: "House not found for user" }, { status: 404 });
    }

    const lookup = await resolveAddressToEsiid({
      line1: house.addressLine1,
      line2: house.addressLine2 ?? null,
      city: house.addressCity,
      state: house.addressState,
      zip: house.addressZip5,
    });

    const nextEsiid = cleanEsiid(lookup.esiid);
    const nextTdspSlug = typeof lookup.territory === "string" && lookup.territory.trim() ? lookup.territory.trim() : null;
    const nextUtilityName = typeof lookup.utility === "string" && lookup.utility.trim() ? lookup.utility.trim() : null;

    const updates: Record<string, unknown> = {
      rawWattbuyJson: lookup.raw ?? undefined,
    };
    if (nextEsiid) updates.esiid = nextEsiid;
    if (!house.tdspSlug && nextTdspSlug) updates.tdspSlug = nextTdspSlug;
    if (!house.utilityName && nextUtilityName) updates.utilityName = nextUtilityName;

    if (Object.keys(updates).length > 0) {
      await prisma.houseAddress.update({
        where: { id: house.id },
        data: updates,
      });
    }

    return NextResponse.json({
      ok: true,
      esiid: nextEsiid,
      tdspSlug: !house.tdspSlug && nextTdspSlug ? nextTdspSlug : house.tdspSlug,
      utilityName: !house.utilityName && nextUtilityName ? nextUtilityName : house.utilityName,
      message: nextEsiid ? "ESIID refreshed." : "Lookup completed but no ESIID returned.",
    });
  } catch (error) {
    console.error("[user/house/refresh-esiid] Failed to refresh ESIID", error);
    return NextResponse.json({ ok: false, error: "Failed to refresh ESIID" }, { status: 500 });
  }
}

