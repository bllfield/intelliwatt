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

interface HomeRefreshResult {
  homeId: string;
  authorizationRefreshed: boolean;
  authorizationMessage?: string;
  pull: {
    attempted: boolean;
    ok: boolean;
    status?: number;
    message?: string;
  };
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

  const adminToken = process.env.ADMIN_TOKEN ?? "";
  const baseUrl = resolveBaseUrl();
  const pullUrl = new URL("/api/admin/smt/pull", baseUrl);
  const normalizeUrl = new URL("/api/admin/smt/normalize", baseUrl);
  normalizeUrl.searchParams.set("limit", "50");

  const refreshed: HomeRefreshResult[] = [];

  for (const house of targetHouses) {
    const result: HomeRefreshResult = {
      homeId: house.id,
      authorizationRefreshed: false,
      pull: {
        attempted: Boolean(adminToken),
        ok: false,
      },
    };

    const auth = await prisma.smtAuthorization.findFirst({
      where: { houseAddressId: house.id, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (auth) {
      try {
        await refreshSmtAuthorizationStatus(auth.id);
        result.authorizationRefreshed = true;
      } catch (error) {
        result.authorizationMessage =
          error instanceof Error
            ? error.message
            : "Failed to refresh SMT authorization status.";
      }
    } else {
      result.authorizationMessage = "No SMT authorization found for this home.";
    }

    if (adminToken && house.esiid) {
      try {
        const pullResponse = await fetch(pullUrl, {
          method: "POST",
          headers: {
            "x-admin-token": adminToken,
            "content-type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({ esiid: house.esiid, houseId: house.id }),
        });

        result.pull.status = pullResponse.status;
        let pullPayload: any = null;
        try {
          pullPayload = await pullResponse.json();
        } catch {
          pullPayload = null;
        }

        if (pullResponse.ok && pullPayload?.ok !== false) {
          result.pull.ok = true;
          result.pull.message = pullPayload?.message ?? "SMT pull triggered.";
        } else {
          result.pull.ok = false;
          result.pull.message =
            pullPayload?.error ?? pullPayload?.details ?? "SMT pull request failed.";
        }
      } catch (error) {
        result.pull.ok = false;
        result.pull.message =
          error instanceof Error
            ? error.message
            : "Failed to invoke SMT pull webhook.";
      }
    } else if (!adminToken) {
      result.pull.message = "ADMIN_TOKEN not configured; SMT pull not attempted.";
    } else {
      result.pull.message = "House is missing an ESIID; SMT pull not attempted.";
    }

    refreshed.push(result);
  }

  let normalization = {
    attempted: Boolean(adminToken),
    ok: false,
    status: undefined as number | undefined,
    message: undefined as string | undefined,
  };

  if (adminToken) {
    try {
      const normalizeRes = await fetch(normalizeUrl, {
        method: "POST",
        headers: {
          "x-admin-token": adminToken,
          "content-type": "application/json",
        },
        cache: "no-store",
      });
      normalization.status = normalizeRes.status;
      let normalizePayload: any = null;
      try {
        normalizePayload = await normalizeRes.json();
      } catch {
        normalizePayload = null;
      }

      if (normalizeRes.ok && normalizePayload?.ok !== false) {
        normalization.ok = true;
        normalization.message = normalizePayload?.filesProcessed
          ? `Normalized ${normalizePayload.filesProcessed} file(s).`
          : normalizePayload?.message ?? "Normalization triggered.";
      } else {
        normalization.ok = false;
        normalization.message =
          normalizePayload?.error ?? normalizePayload?.detail ?? "Normalization failed.";
      }
    } catch (error) {
      normalization.ok = false;
      normalization.message =
        error instanceof Error ? error.message : "Failed to invoke SMT normalization.";
    }
  } else {
    normalization.message = "ADMIN_TOKEN not configured; normalization not attempted.";
  }

  return NextResponse.json({
    ok: true,
    homes: refreshed,
    normalization,
  });
}

