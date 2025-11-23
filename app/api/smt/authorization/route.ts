import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { cleanEsiid } from "@/lib/smt/esiid";
import { createAgreementAndSubscription } from "@/lib/smt/agreements";

type SmtAuthorizationBody = {
  houseAddressId: string;
  customerName: string;
  contactPhone?: string | null;
  consent: boolean;
  consentTextVersion?: string | null;
  repPuctNumber?: string | number | null;
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
    const agreementsEnabled =
      process.env.SMT_AGREEMENTS_ENABLED === "true" ||
      process.env.SMT_AGREEMENTS_ENABLED === "1";
    const prismaAny = prisma as any;

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

    const houseEsiid = cleanEsiid(house.esiid);

    if (!houseEsiid) {
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

    const existingMeterInfo = await prismaAny.smtMeterInfo.findFirst({
      where: { esiid: houseEsiid },
      orderBy: { updatedAt: "desc" },
      select: { meterNumber: true },
    });
    const resolvedMeterNumber =
      (existingMeterInfo?.meterNumber && existingMeterInfo.meterNumber.trim()) || null;

    const consentTextVersion =
      typeof rawBody.consentTextVersion === "string" && rawBody.consentTextVersion.trim().length > 0
        ? rawBody.consentTextVersion.trim()
        : "smt-poa-v1";
    const rawRepPuct = rawBody.repPuctNumber;
    let repPuctNumber: string | undefined;
    if (typeof rawRepPuct === "number" && Number.isFinite(rawRepPuct)) {
      repPuctNumber = String(Math.floor(rawRepPuct));
    } else if (typeof rawRepPuct === "string") {
      repPuctNumber = rawRepPuct.trim() || undefined;
    }
    if (!repPuctNumber) {
      return NextResponse.json(
        { ok: false, error: "Retail Electric Provider selection is required." },
        { status: 400 },
      );
    }
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.ip ?? null;
    const userAgent = req.headers.get("user-agent") ?? null;

    const now = new Date();
    const authorizationStartDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const authorizationEndDate = new Date(
      Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()),
    );

    const smtRequestorId =
      process.env.SMT_REQUESTOR_ID?.trim() || process.env.SMT_USERNAME?.trim() || "";
    if (!smtRequestorId) {
      return NextResponse.json(
        { ok: false, error: "SMT_REQUESTOR_ID (or SMT_USERNAME) must be configured." },
        { status: 500 },
      );
    }
    const smtRequestorAuthId = process.env.SMT_REQUESTOR_AUTH_ID?.trim() || "";
    if (!smtRequestorAuthId) {
      return NextResponse.json(
        { ok: false, error: "SMT_REQUESTOR_AUTH_ID must be configured." },
        { status: 500 },
      );
    }

    const created = await prismaAny.smtAuthorization.create({
      data: {
        userId: user.id,
        houseId: house.houseId ?? house.id,
        houseAddressId: house.id,
        esiid: houseEsiid,
        meterNumber: resolvedMeterNumber,
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
        consentTextVersion,
        consentIp: clientIp,
        consentUserAgent: userAgent,
        smtStatus: agreementsEnabled ? "pending" : null,
      },
    });

    let smtUpdateData: Record<string, any> = {};

    try {
      const serviceAddressParts = [
        house.addressLine1,
        house.addressLine2,
        `${house.addressCity}, ${house.addressState} ${house.addressZip5}`,
      ].filter((part) => typeof part === "string" && part.trim().length > 0);

      const smtResult = await createAgreementAndSubscription({
        esiid: houseEsiid,
        serviceAddress: serviceAddressParts.join(", "),
        customerName: trimmedCustomerName,
        customerEmail: user.email,
        customerPhone: normalizedContactPhone,
        tdspCode,
        monthsBack: 12,
        includeInterval: true,
        includeBilling: true,
        meterNumber: resolvedMeterNumber ?? undefined,
        repPuctNumber,
      });

      smtUpdateData = {
        smtAgreementId: smtResult.agreementId ?? null,
        smtSubscriptionId: smtResult.subscriptionId ?? null,
        smtStatus: smtResult.status ?? null,
        smtStatusMessage: smtResult.message ?? null,
        smtBackfillRequestedAt: smtResult.backfillRequestedAt
          ? new Date(smtResult.backfillRequestedAt)
          : null,
        smtBackfillCompletedAt: smtResult.backfillCompletedAt
          ? new Date(smtResult.backfillCompletedAt)
          : null,
        meterNumber: resolvedMeterNumber ?? null,
      };
    } catch (agreementErr: any) {
      smtUpdateData = {
        smtStatus: "error",
        smtStatusMessage: `Agreement call threw: ${
          agreementErr?.message ?? String(agreementErr)
        }`.slice(0, 500),
      };
    }

    const updatedAuthorization =
      Object.keys(smtUpdateData).length > 0
        ? await prismaAny.smtAuthorization.update({
            where: { id: created.id },
            data: smtUpdateData,
          })
        : created;

    const updatedAuthAny = updatedAuthorization as any;

    const webhookUrl = process.env.DROPLET_WEBHOOK_URL;
    const webhookSecret = process.env.DROPLET_WEBHOOK_SECRET;

    if (webhookUrl && webhookSecret) {
      const monthsBack = 12;
      const windowToDate = new Date();
      const windowFromDate = new Date(windowToDate.getTime());
      windowFromDate.setMonth(windowFromDate.getMonth() - monthsBack);
      const windowFrom = windowFromDate.toISOString();
      const windowTo = windowToDate.toISOString();
      const esiid = updatedAuthAny.esiid ?? houseEsiid;
      const meter = updatedAuthAny.meterNumber ?? "M1";
      const payloadEsiid = cleanEsiid(updatedAuthAny.esiid ?? houseEsiid) ?? houseEsiid;

      const dropletPayload = {
        reason: "smt_authorized" as const,
        ts: new Date().toISOString(),
        smtAuthorizationId: created.id,
        userId: updatedAuthAny.userId,
        houseId: updatedAuthAny.houseId,
        houseAddressId: updatedAuthAny.houseAddressId,
        esiid: payloadEsiid,
        meter,
        tdspCode: updatedAuthAny.tdspCode,
        tdspName: updatedAuthAny.tdspName,
        authorizationStartDate: updatedAuthAny.authorizationStartDate,
        authorizationEndDate: updatedAuthAny.authorizationEndDate,
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
        authorizationId: updatedAuthorization.id,
        esiid: updatedAuthAny.esiid,
        smtStatus: updatedAuthAny.smtStatus ?? null,
        smtStatusMessage: updatedAuthAny.smtStatusMessage ?? null,
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

