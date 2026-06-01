import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { commitHouseUsageSource, readHouseCommittedUsageSource } from "@/lib/usage/commitHouseUsageSource";
import { normalizeEmail } from "@/lib/utils/email";

export const dynamic = "force-dynamic";

type CommittedSourceBody = {
  homeId?: string;
  source?: "SMT" | "GREEN_BUTTON";
};

export async function GET(request: Request) {
  try {
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

    const url = new URL(request.url);
    const homeId = String(url.searchParams.get("homeId") ?? "").trim();
    if (!homeId) {
      return NextResponse.json({ ok: false, error: "home_id_required" }, { status: 400 });
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: homeId, userId: user.id, archivedAt: null },
      select: { id: true, esiid: true },
    });
    if (!house) {
      return NextResponse.json({ ok: false, error: "home_not_found" }, { status: 404 });
    }

    const source = await readHouseCommittedUsageSource(house.id);
    let committedUsageSourceAt: string | null = null;
    try {
      const atRow = await prisma.houseAddress.findFirst({
        where: { id: house.id },
        select: { committedUsageSourceAt: true },
      });
      committedUsageSourceAt = atRow?.committedUsageSourceAt?.toISOString() ?? null;
    } catch {
      committedUsageSourceAt = null;
    }

    return NextResponse.json({
      ok: true,
      homeId: house.id,
      source,
      committedUsageSourceAt,
    });
  } catch (error) {
    console.error("[user/usage/committed-source] GET failed", error);
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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

    let body: CommittedSourceBody = {};
    try {
      body = (await request.json()) as CommittedSourceBody;
    } catch {
      body = {};
    }

    const homeId = String(body.homeId ?? "").trim();
    const source = body.source;
    if (!homeId) {
      return NextResponse.json({ ok: false, error: "home_id_required" }, { status: 400 });
    }
    if (source !== "SMT" && source !== "GREEN_BUTTON") {
      return NextResponse.json({ ok: false, error: "invalid_source" }, { status: 400 });
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: homeId, userId: user.id, archivedAt: null },
      select: { id: true, esiid: true },
    });
    if (!house) {
      return NextResponse.json({ ok: false, error: "home_not_found" }, { status: 404 });
    }

    await commitHouseUsageSource({
      userId: user.id,
      houseId: house.id,
      source,
      esiid: house.esiid ?? null,
    });

    return NextResponse.json({
      ok: true,
      homeId: house.id,
      source,
      message:
        source === "SMT"
          ? "Smart Meter Texas is now your active usage source. Previous Green Button interval data was removed."
          : "Green Button is now your active usage source. Previous SMT interval data and authorization for this home were removed.",
    });
  } catch (error) {
    console.error("[user/usage/committed-source] POST failed", error);
    return NextResponse.json({ ok: false, error: "commit_failed" }, { status: 500 });
  }
}
