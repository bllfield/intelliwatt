import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";

export const dynamic = "force-dynamic";

async function resolveHouseAddressForUser(userId: string, explicitHouseId: string | null) {
  const prismaAny = prisma as any;

  if (explicitHouseId && explicitHouseId.trim().length > 0) {
    const house = await prismaAny.houseAddress.findFirst({
      where: { id: explicitHouseId.trim(), userId, archivedAt: null },
    });
    if (house) {
      return house;
    }
  }

  // Mirror the selection logic from loadUsageEntryContext:
  const select = {
    id: true,
    houseId: true,
    addressLine1: true,
    addressLine2: true,
    addressCity: true,
    addressState: true,
    addressZip5: true,
    esiid: true,
    tdspSlug: true,
    utilityName: true,
    isPrimary: true,
    archivedAt: true,
  } satisfies Record<string, boolean>;

  const primary = await prismaAny.houseAddress.findFirst({
    where: { userId, archivedAt: null, isPrimary: true },
    orderBy: { createdAt: "desc" },
    select,
  });

  if (primary) return primary;

  const fallback = await prismaAny.houseAddress.findFirst({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    select,
  });

  return fallback ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get("intelliwatt_user")?.value ?? null;

    if (!userEmailRaw) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const email = normalizeEmail(userEmailRaw);
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const houseIdParam = url.searchParams.get("houseId");

    const house = await resolveHouseAddressForUser(user.id, houseIdParam);

    if (!house) {
      return NextResponse.json(
        { ok: false, error: "No house found for SMT init." },
        { status: 400 },
      );
    }

    const houseId = house.id as string;

    const currentPlanPrisma = getCurrentPlanPrisma();
    const parsedDelegate = (currentPlanPrisma as any).parsedCurrentPlan as any;

    const parsed = await parsedDelegate.findFirst({
      where: { userId: user.id, houseId },
      orderBy: { createdAt: "desc" },
    });

    const trimOrNull = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const esiidFromParsed = trimOrNull(parsed?.esiid);
    const esiidFromHouse = trimOrNull((house as any).esiid);
    const esiid = esiidFromParsed ?? esiidFromHouse ?? null;

    const meterNumber =
      trimOrNull(parsed?.meterNumber) ??
      null;

    const providerName = trimOrNull(parsed?.providerName) ?? null;
    const tdspName =
      trimOrNull(parsed?.tdspName) ??
      trimOrNull((house as any).utilityName) ??
      trimOrNull((house as any).tdspSlug) ??
      null;

    const serviceAddress = {
      line1:
        parsed?.serviceAddressLine1 ??
        trimOrNull((house as any).addressLine1) ??
        null,
      city:
        parsed?.serviceAddressCity ??
        trimOrNull((house as any).addressCity) ??
        null,
      state:
        parsed?.serviceAddressState ??
        trimOrNull((house as any).addressState) ??
        null,
      zip:
        parsed?.serviceAddressZip ??
        trimOrNull((house as any).addressZip5) ??
        null,
    };

    return NextResponse.json({
      ok: true,
      houseId,
      esiid,
      meterNumber,
      providerName,
      tdspName,
      serviceAddress,
      hasParsedBill: !!parsed,
    });
  } catch (error) {
    console.error("[smt/init] Failed to build SMT init payload", error);
    return NextResponse.json(
      { ok: false, error: "Failed to build SMT init payload" },
      { status: 500 },
    );
  }
}


