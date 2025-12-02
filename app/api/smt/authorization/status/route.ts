import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { refreshSmtAuthorizationStatus } from "@/lib/smt/agreements";

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

async function findLatestAuthorization(homeId: string) {
  return prisma.smtAuthorization.findFirst({
    where: {
      houseId: homeId,
      archivedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
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
    const auth = await findLatestAuthorization(homeId);
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
    const auth = await findLatestAuthorization(homeId);

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

    const refreshResult = await refreshSmtAuthorizationStatus(auth.id);

    if (!refreshResult.ok) {
      if (refreshResult.reason === "network-error") {
        const updatedAuth = await prisma.smtAuthorization.findUnique({
          where: { id: auth.id },
        });

        return NextResponse.json(
          {
            ok: true,
            authorization: serializeAuthorization(updatedAuth),
            warning:
              refreshResult.message ??
              "We’ll keep monitoring your Smart Meter Texas status. The SMT proxy did not respond to the latest check.",
          },
          { status: 200 },
        );
      }

      return NextResponse.json(
        {
          ok: false,
          error: refreshResult.reason ?? "status-refresh-failed",
          message:
            refreshResult.message ??
            "Failed to refresh SMT authorization status",
        },
        { status: 502 },
      );
    }

    const updated =
      refreshResult.authorization ??
      (await prisma.smtAuthorization.findUnique({
        where: { id: auth.id },
      }));

    return NextResponse.json(
      {
        ok: true,
        authorization: serializeAuthorization(updated),
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

