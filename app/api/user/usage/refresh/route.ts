import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { refreshSmtAuthorizationStatus, getRollingBackfillRange, requestSmtBackfillForAuthorization } from "@/lib/smt/agreements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // ensure Node runtime for longer executions
export const maxDuration = 300; // allow ample time for pull + normalize + backfill

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

  if (!requestedHomeId) {
    return NextResponse.json(
      { ok: false, error: "home_id_required", message: "homeId is required to refresh usage." },
      { status: 400 },
    );
  }

  const targetHouse = await prisma.houseAddress.findFirst({
    where: { id: requestedHomeId, userId: user.id, archivedAt: null },
    select: { id: true, esiid: true },
  });

  if (!targetHouse) {
    return NextResponse.json(
      { ok: false, error: "home_not_found" },
      { status: 404 },
    );
  }

  const adminToken = process.env.ADMIN_TOKEN ?? "";
  if (!adminToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "admin_token_missing",
        message: "ADMIN_TOKEN must be configured to trigger SMT pull/normalize.",
      },
      { status: 500 },
    );
  }

  const refreshed: HomeRefreshResult[] = [];
  const backfillRange = getRollingBackfillRange(12);

  const houseTasks = [targetHouse].map(async (house) => {
    const result: HomeRefreshResult = {
      homeId: house.id,
      authorizationRefreshed: false,
      pull: {
        attempted: Boolean(adminToken),
        ok: false,
      },
    };

    // Refresh authorization status (if exists)
    const latestAuth = await prisma.smtAuthorization.findFirst({
      where: { houseAddressId: house.id, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (latestAuth) {
      try {
        await refreshSmtAuthorizationStatus(latestAuth.id);
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

    // Trigger SMT pull (admin) if possible
    if (adminToken && house.esiid) {
      try {
        const baseUrl = resolveBaseUrl();
        const pullUrl = new URL("/api/admin/smt/pull", baseUrl);
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

    // Request 12-month backfill to ensure full coverage.
    // IMPORTANT: only do this once SMT confirms the authorization is ACTIVE.
    let backfillOutcome: { homeId: string; ok: boolean; message?: string } | null = null;
    try {
      const auth = await prisma.smtAuthorization.findFirst({
        where: { houseAddressId: house.id, archivedAt: null },
        select: {
          id: true,
          esiid: true,
          meterNumber: true,
          smtStatus: true,
          smtBackfillRequestedAt: true,
        },
      });

      const statusNorm = String((auth as any)?.smtStatus ?? "")
        .trim()
        .toLowerCase();
      const isActive = statusNorm === "active" || statusNorm === "already_active";

      // Only trigger backfill once ACTIVE (customer approved SMT email).
      // Also avoid duplicate requests if we've already recorded a request time.
      if (auth?.id && auth.esiid && isActive && !(auth as any)?.smtBackfillRequestedAt) {
        const res = await requestSmtBackfillForAuthorization({
          authorizationId: auth.id,
          esiid: auth.esiid,
          meterNumber: auth.meterNumber,
          startDate: backfillRange.startDate,
          endDate: backfillRange.endDate,
        });

        if (res.ok) {
          await prisma.smtAuthorization.update({
            where: { id: auth.id },
            data: { smtBackfillRequestedAt: new Date() },
          });
        }

        backfillOutcome = { homeId: house.id, ok: res.ok, message: res.message };
      } else if (auth?.id && auth.esiid && !isActive) {
        backfillOutcome = {
          homeId: house.id,
          ok: false,
          message: "backfill_skipped:not_active",
        };
      } else if (auth?.id && auth.esiid && (auth as any)?.smtBackfillRequestedAt) {
        backfillOutcome = {
          homeId: house.id,
          ok: true,
          message: "backfill_skipped:already_requested",
        };
      }
    } catch (backfillError) {
      backfillOutcome = {
        homeId: house.id,
        ok: false,
        message: backfillError instanceof Error ? backfillError.message : String(backfillError),
      };
    }

    return { result, backfillOutcome };
  });

  const houseResults = await Promise.all(houseTasks);
  const backfillResults = houseResults
    .map((hr) => hr.backfillOutcome)
    .filter((x): x is { homeId: string; ok: boolean; message?: string } => Boolean(x));
  refreshed.push(...houseResults.map((hr) => hr.result));
  let normalization = {
    attempted: Boolean(adminToken),
    ok: false,
    status: undefined as number | undefined,
    message: undefined as string | undefined,
  };

  if (adminToken) {
    try {
      const baseUrl = resolveBaseUrl();
      const normalizeUrl = new URL("/api/admin/smt/normalize", baseUrl);
      // For usage refresh we want the full 12‑month window for the target home,
      // so normalize all raw files for its ESIID rather than only the latest one.
      if (targetHouse.esiid) {
        normalizeUrl.searchParams.set("esiid", targetHouse.esiid);
      }
      normalizeUrl.searchParams.set("limit", "100000");
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
    backfill: backfillResults,
  });
}

