import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { refreshSmtAuthorizationStatus } from "@/lib/smt/agreements";
import { pickBestSmtAuthorization } from "@/lib/smt/authorizationSelection";

export const dynamic = "force-dynamic";

type SerializedAuth = {
  id: string;
  smtAgreementId: number | null;
  smtSubscriptionId: string | null;
  smtStatus: string | null;
  smtStatusMessage: string | null;
  createdAt: Date;
};

function serializeAuthorization(auth: any | null): SerializedAuth | null {
  if (!auth) return null;
  return {
    id: auth.id,
    smtAgreementId: auth.smtAgreementId ?? null,
    smtSubscriptionId: auth.smtSubscriptionId ?? null,
    smtStatus: auth.smtStatus ?? null,
    smtStatusMessage: auth.smtStatusMessage ?? null,
    createdAt: auth.createdAt,
  };
}

async function findAuthorizationCandidates(homeId: string) {
  return prisma.smtAuthorization.findMany({
    where: {
      OR: [{ houseId: homeId }, { houseAddressId: homeId }],
      archivedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 25,
  });
}

/**
 * GET /api/smt/authorization/status?homeId=<homeId>
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const homeId = searchParams.get("homeId");

  if (!homeId) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing-home-id",
        message: "homeId is required",
      },
      { status: 400 },
    );
  }

  try {
    const rows = await findAuthorizationCandidates(homeId);
    const auth = pickBestSmtAuthorization(rows);
    return NextResponse.json(
      {
        ok: true,
        authorization: serializeAuthorization(auth),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error(
      "[SMT] GET /api/smt/authorization/status failed",
      homeId,
      error,
    );
    return NextResponse.json(
      {
        ok: false,
        error: "internal-error",
        message: "Failed to load SMT authorization status",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/smt/authorization/status
 *
 * Body: { homeId: string }
 */
export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const homeId: string | undefined = body?.homeId;

  if (!homeId) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing-home-id",
        message: "homeId is required",
      },
      { status: 400 },
    );
  }

  try {
    const rows = await findAuthorizationCandidates(homeId);
    const auth = pickBestSmtAuthorization(rows);

    if (!auth) {
      return NextResponse.json(
        {
          ok: false,
          error: "no-authorization",
          message: "No SMT authorization found for this home.",
        },
        { status: 400 },
      );
    }

    // This endpoint is user-invoked for immediate re-checks (confirmation blocker/actions),
    // so force live SMT refreshes. Try all local candidates to handle stale duplicate rows.
    const refreshCandidateIds = Array.from(new Set([auth.id, ...rows.map((r) => String((r as any).id))]));
    let refreshResult: any = null;
    let sawNetworkError = false;
    for (const candidateId of refreshCandidateIds) {
      const res = await refreshSmtAuthorizationStatus(candidateId, { force: true });
      if (!res.ok) {
        if (res.reason === "network-error") sawNetworkError = true;
        continue;
      }
      refreshResult = res;
      const statusNow = String(res.status ?? (res as any)?.authorization?.smtStatus ?? "").toUpperCase();
      if (statusNow === "ACTIVE" || statusNow === "ALREADY_ACTIVE" || statusNow === "ACT") break;
    }

    if (!refreshResult?.ok) {
      const latestRows = await findAuthorizationCandidates(homeId);
      const latestAuth = pickBestSmtAuthorization(latestRows);
      if (sawNetworkError) {
        return NextResponse.json(
          {
            ok: true,
            authorization: serializeAuthorization(latestAuth),
            warning:
              "We’ll keep monitoring your Smart Meter Texas status. The SMT proxy did not respond to the latest check.",
          },
          { status: 200 },
        );
      }

      return NextResponse.json(
        {
          ok: false,
          error: "status-refresh-failed",
          message: "Failed to refresh SMT authorization status",
        },
        { status: 502 },
      );
    }

    const latestRows = await findAuthorizationCandidates(homeId);
    const updated = pickBestSmtAuthorization(latestRows);

    return NextResponse.json(
      {
        ok: true,
        authorization: serializeAuthorization(updated),
        throttled: Boolean(refreshResult?.throttled),
        cooldownMs:
          typeof refreshResult?.cooldownMs === "number"
            ? refreshResult.cooldownMs
            : null,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error(
      "[SMT] POST /api/smt/authorization/status failed",
      homeId,
      error,
    );
    return NextResponse.json(
      {
        ok: false,
        error: "status-refresh-failed",
        message: "Failed to refresh SMT authorization status",
      },
      { status: 500 },
    );
  }
}

