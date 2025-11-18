import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type CreateSmtAuthorizationBody = {
  userId: string;
  contactEmail: string;
  houseAddressId: string;
  houseId: string;
  esiid: string;
  serviceAddressLine1: string;
  serviceAddressLine2?: string | null;
  serviceCity: string;
  serviceState: string;
  serviceZip: string;
  tdspCode: string;
  tdspName: string;
  customerName: string;
  contactPhone?: string | null;
  consent: boolean;
  meterNumber?: string | null;
};

function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CreateSmtAuthorizationBody>;

    const requiredFields: (keyof CreateSmtAuthorizationBody)[] = [
      "userId",
      "contactEmail",
      "houseAddressId",
      "houseId",
      "esiid",
      "serviceAddressLine1",
      "serviceCity",
      "serviceState",
      "serviceZip",
      "tdspCode",
      "tdspName",
      "customerName",
    ];

    for (const field of requiredFields) {
      const value = body[field];
      if (value === undefined || value === null || value === "") {
        return NextResponse.json(
          {
            ok: false,
            error: `Missing required field: ${field}`,
          },
          { status: 400 },
        );
      }
    }

    if (!body.consent) {
      return NextResponse.json(
        {
          ok: false,
          error: "Consent checkbox must be selected to authorize SMT access.",
        },
        { status: 400 },
      );
    }

    const smtRequestorId = getEnvOrThrow("SMT_REQUESTOR_ID");
    const smtRequestorAuthId = getEnvOrThrow("SMT_REQUESTOR_AUTH_ID");

    const now = new Date();
    const startDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const endDate = new Date(
      Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()),
    );

    const created = await prisma.smtAuthorization.create({
      data: {
        userId: body.userId,
        houseId: body.houseId,
        houseAddressId: body.houseAddressId,
        esiid: body.esiid,
        meterNumber: body.meterNumber ?? null,
        customerName: body.customerName,
        serviceAddressLine1: body.serviceAddressLine1,
        serviceAddressLine2: body.serviceAddressLine2 ?? null,
        serviceCity: body.serviceCity,
        serviceState: body.serviceState,
        serviceZip: body.serviceZip,
        tdspCode: body.tdspCode,
        tdspName: body.tdspName,
        authorizationStartDate: startDate,
        authorizationEndDate: endDate,
        allowIntervalUsage: true,
        allowHistoricalBilling: true,
        allowSubscription: true,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone ?? null,
        smtRequestorId,
        smtRequestorAuthId,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        authorizationId: created.id,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[SMT_AUTH_POST_ERROR]", err);
    const status =
      err instanceof Error && err.message.includes("Missing required environment variable")
        ? 500
        : 500;
    const message =
      err instanceof Error && err.message.includes("Missing required environment variable")
        ? err.message
        : "Failed to create SMT authorization.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}

