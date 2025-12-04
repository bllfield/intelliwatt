import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { refreshSmtAuthorizationStatus } from "@/lib/smt/agreements";

export const dynamic = "force-dynamic";

function resolveBaseUrl(): URL {
  const explicit =
    process.env.ADMIN_INTERNAL_BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.PROD_BASE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    "";

  if (explicit) {
    try {
      return new URL(explicit.startsWith("http") ? explicit : `https://${explicit}`);
    } catch {
      // fall through to default below
    }
  }

  return new URL("https://intelliwatt.com");
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

  if (!sessionEmail) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const normalizedEmail = normalizeEmail(sessionEmail);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json(
      { ok: false, error: "user_not_found" },
      { status: 404 },
    );
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

  const houses = await prisma.houseAddress.findMany({
    where: { userId: user.id, archivedAt: null },
    select: { id: true, esiid: true },
  });

  const targetHouses = requestedHomeId
    ? houses.filter((house) => house.id === requestedHomeId)
    : houses;

  if (targetHouses.length === 0) {
    return NextResponse.json(
      { ok: false, error: "home_not_found" },
      { status: 404 },
    );
  }

  const refreshed: Array<{
    homeId: string;
    authorizationRefreshed: boolean;
    message?: string;
  }> = [];

  for (const house of targetHouses) {
    const auth = await prisma.smtAuthorization.findFirst({
      where: { houseAddressId: house.id, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (!auth) {
      refreshed.push({
        homeId: house.id,
        authorizationRefreshed: false,
        message: "No SMT authorization found for this home.",
      });
      continue;
    }

    try {
      await refreshSmtAuthorizationStatus(auth.id);
      refreshed.push({
        homeId: house.id,
        authorizationRefreshed: true,
      });
    } catch (error) {
      refreshed.push({
        homeId: house.id,
        authorizationRefreshed: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to refresh SMT authorization status.",
      });
    }
  }

  const adminToken = process.env.ADMIN_TOKEN;
  let normalizationResult: any = null;
  let normalizationOk = false;

  if (adminToken) {
    const baseUrl = resolveBaseUrl();
    const normalizeUrl = new URL("/api/admin/smt/normalize", baseUrl);
    normalizeUrl.searchParams.set("limit", "10");

    try {
      const res = await fetch(normalizeUrl, {
        method: "POST",
        headers: {
          "x-admin-token": adminToken,
          "content-type": "application/json",
        },
        cache: "no-store",
      });
      normalizationOk = res.ok;
      try {
        normalizationResult = await res.json();
      } catch {
        normalizationResult = await res.text();
      }
    } catch (error) {
      normalizationResult =
        error instanceof Error ? error.message : String(error);
    }
  } else {
    normalizationResult = {
      warning: "ADMIN_TOKEN not configured; normalized SMT intervals were not refreshed.",
    };
  }

  return NextResponse.json({
    ok: true,
    refreshedHomes: refreshed,
    normalization: {
      attempted: Boolean(adminToken),
      ok: normalizationOk,
      result: normalizationResult,
    },
  });
}

