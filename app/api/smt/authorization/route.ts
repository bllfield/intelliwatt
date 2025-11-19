import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";

type SmtAuthorizationBody = {
  houseAddressId: string;
  customerName: string;
  contactPhone?: string | null;
  consent: boolean;
};

function getEnvOrDefault(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    return fallback;
  }
  return value;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = (await req.json()) as Partial<SmtAuthorizationBody> | null;

    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json(
        { ok: false, error: "Invalid request body." },
        { status: 400 },
      );
    }

    const { houseAddressId, customerName, contactPhone, consent } = rawBody;

    if (!houseAddressId || typeof houseAddressId !== "string" || !houseAddressId.trim()) {
      return NextResponse.json(
        { ok: false, error: "Missing required field: houseAddressId" },
        { status: 400 },
      );
    }

    if (!customerName || typeof customerName !== "string" || !customerName.trim()) {
      return NextResponse.json(
        { ok: false, error: "Missing required field: customerName" },
        { status: 400 },
      );
    }

    if (consent !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: "Consent checkbox must be selected to authorize SMT access.",
        },
        { status: 400 },
      );
    }

    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get("intelliwatt_user")?.value;

    if (!userEmailRaw) {
      return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    }

    const userEmail = normalizeEmail(userEmailRaw);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true, email: true },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });
    }

    const house = await prisma.houseAddress.findUnique({
      where: { id: houseAddressId.trim() },
      select: {
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
      },
    });

    if (!house) {
      return NextResponse.json(
        { ok: false, error: "House address not found for provided houseAddressId." },
        { status: 404 },
      );
    }

    if (!house.addressLine1 || !house.addressCity || !house.addressState || !house.addressZip5) {
      return NextResponse.json(
        { ok: false, error: "House address is missing required address fields." },
        { status: 400 },
      );
    }

    if (!house.esiid) {
      return NextResponse.json(
        { ok: false, error: "House address does not have an associated ESIID." },
        { status: 400 },
      );
    }

    const tdspCode = house.tdspSlug
      ? house.tdspSlug.toUpperCase()
      : house.utilityName
      ? house.utilityName.replace(/\s+/g, "_").toUpperCase()
      : null;

    const tdspName = house.utilityName ?? (house.tdspSlug ? house.tdspSlug.toUpperCase() : null);

    if (!tdspCode || !tdspName) {
      return NextResponse.json(
        { ok: false, error: "House address does not have TDSP information." },
        { status: 400 },
      );
    }

    const trimmedCustomerName = customerName.trim();
    const normalizedContactPhone =
      typeof contactPhone === "string" && contactPhone.trim().length > 0
        ? contactPhone.trim()
        : null;

    const now = new Date();
    const authorizationStartDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const authorizationEndDate = new Date(
      Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()),
    );

    const smtRequestorId = getEnvOrDefault("SMT_REQUESTOR_ID", "INTELLIWATTAPI");
    const smtRequestorAuthId = getEnvOrDefault("SMT_REQUESTOR_AUTH_ID", "INTELLIWATT_AUTH_ID");

    const created = await prisma.smtAuthorization.create({
      data: {
        userId: user.id,
        houseId: house.houseId ?? house.id,
        houseAddressId: house.id,
        esiid: house.esiid,
        meterNumber: null,
        customerName: trimmedCustomerName,
        serviceAddressLine1: house.addressLine1,
        serviceAddressLine2: house.addressLine2 ?? null,
        serviceCity: house.addressCity,
        serviceState: house.addressState,
        serviceZip: house.addressZip5,
        tdspCode,
        tdspName,
        authorizationStartDate,
        authorizationEndDate,
        allowIntervalUsage: true,
        allowHistoricalBilling: true,
        allowSubscription: true,
        contactEmail: user.email,
        contactPhone: normalizedContactPhone,
        smtRequestorId,
        smtRequestorAuthId,
      },
    });

    const webhookUrl = process.env.DROPLET_WEBHOOK_URL;
    const webhookSecret = process.env.DROPLET_WEBHOOK_SECRET;

    if (webhookUrl && webhookSecret) {
      const monthsBack = 12;
      const windowToDate = new Date();
      const windowFromDate = new Date(windowToDate.getTime());
      windowFromDate.setMonth(windowFromDate.getMonth() - monthsBack);
      const windowFrom = windowFromDate.toISOString();
      const windowTo = windowToDate.toISOString();
      const esiid = created.esiid ?? house.esiid;
      const meter = created.meterNumber ?? "M1";

      const dropletPayload = {
        reason: "smt_authorized" as const,
        ts: new Date().toISOString(),
        smtAuthorizationId: created.id,
        userId: created.userId,
        houseId: created.houseId,
        houseAddressId: created.houseAddressId,
        esiid,
        meter,
        tdspCode: created.tdspCode,
        tdspName: created.tdspName,
        authorizationStartDate: created.authorizationStartDate,
        authorizationEndDate: created.authorizationEndDate,
        includeInterval: true,
        includeBilling: true,
        monthsBack,
        windowFrom,
        windowTo,
      };

      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-droplet-webhook-secret": webhookSecret,
          },
          body: JSON.stringify(dropletPayload),
        });
      } catch (err) {
        console.error("Failed to notify SMT droplet webhook after authorization", err);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        authorizationId: created.id,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[SMT_AUTH_POST_ERROR]", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to create SMT authorization.",
      },
      { status: 500 },
    );
  }
}

