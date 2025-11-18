import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeGoogleAddress, type GooglePlaceDetails } from "@/lib/normalizeGoogleAddress";
import { normalizeEmail } from "@/lib/utils/email";
import { resolveAddressToEsiid } from "@/lib/resolver/addressToEsiid";
import { wattbuyEsiidDisabled } from "@/lib/flags";

export const dynamic = "force-dynamic";

type SaveAddressBody = {
  userId: string;
  houseId?: string | null;
  googlePlaceDetails: GooglePlaceDetails;
  unitNumber?: string;
  wattbuyJson?: unknown;
  utilityHints?: {
    esiid?: string | null;
    tdspSlug?: string | null;
    utilityName?: string | null;
    utilityPhone?: string | null;
  } | null;
  smartMeterConsent?: boolean;
  smartMeterConsentDate?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SaveAddressBody;
    console.log("API received body:", JSON.stringify(body, null, 2));

    if (!body?.userId || !body?.googlePlaceDetails) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }

    let userId = body.userId;
    if (body.userId.includes("@")) {
      const normalizedEmail = normalizeEmail(body.userId);
      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (!user) {
        return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
      }
      userId = user.id;
      console.log(`Converted email ${normalizedEmail} to user ID ${userId}`);
    }

    console.log("Google Place Details:", JSON.stringify(body.googlePlaceDetails, null, 2));
    console.log(
      "Address components types:",
      body.googlePlaceDetails.address_components?.map((c: any) => c.types),
    );

    const normalized = normalizeGoogleAddress(body.googlePlaceDetails, body.unitNumber);
    console.log("Normalized address:", JSON.stringify(normalized, null, 2));

    const validationSource = body.googlePlaceDetails.place_id ? "GOOGLE" : "USER";

    const normalizedLine1Lower = (normalized.addressLine1 ?? "").trim().toLowerCase();
    const normalizedCityLower = (normalized.addressCity ?? "").trim().toLowerCase();
    const normalizedStateLower = (normalized.addressState ?? "").trim().toLowerCase();
    const normalizedZip = (normalized.addressZip5 ?? "").trim();

    const existingAddress = await prisma.houseAddress.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
        placeId: true,
        lat: true,
        lng: true,
        esiid: true,
        tdspSlug: true,
        utilityName: true,
        utilityPhone: true,
      },
    });

    const existingLine1Lower = existingAddress?.addressLine1?.trim().toLowerCase() ?? "";
    const existingLine2Lower = existingAddress?.addressLine2?.trim().toLowerCase() ?? "";
    const existingCityLower = existingAddress?.addressCity?.trim().toLowerCase() ?? "";
    const existingStateLower = existingAddress?.addressState?.trim().toLowerCase() ?? "";
    const existingZip = existingAddress?.addressZip5?.trim() ?? "";
    const normalizedLine2Lower = (normalized.addressLine2 ?? "").trim().toLowerCase();
    const existingPlaceId = existingAddress?.placeId?.trim() ?? "";
    const normalizedPlaceId = (normalized.placeId ?? "").trim();
    const existingLat = existingAddress?.lat ?? null;
    const existingLng = existingAddress?.lng ?? null;
    const normalizedLat = normalized.lat ?? null;
    const normalizedLng = normalized.lng ?? null;
    const latChanged = normalizedLat !== existingLat;
    const lngChanged = normalizedLng !== existingLng;

    const addressChanged =
      !existingAddress ||
      existingLine1Lower !== normalizedLine1Lower ||
      existingLine2Lower !== normalizedLine2Lower ||
      existingCityLower !== normalizedCityLower ||
      existingStateLower !== normalizedStateLower ||
      existingZip !== normalizedZip ||
      existingPlaceId !== normalizedPlaceId ||
      latChanged ||
      lngChanged;

    console.log("[address/save] address comparison", {
      addressChanged,
      existingEsiid: existingAddress?.esiid ?? null,
      incomingLine1: normalized.addressLine1,
      existingLine1: existingAddress?.addressLine1 ?? null,
      incomingLine2: normalized.addressLine2 ?? null,
      existingLine2: existingAddress?.addressLine2 ?? null,
      incomingPlaceId: normalized.placeId ?? null,
      existingPlaceId,
      incomingLat: normalizedLat,
      existingLat,
      incomingLng: normalizedLng,
      existingLng,
    });
    const addressData = {
      userId,
      houseId: body.houseId ?? null,
      addressLine1: normalized.addressLine1,
      addressLine2: normalized.addressLine2,
      addressCity: normalized.addressCity,
      addressState: normalized.addressState,
      addressZip5: normalized.addressZip5,
      addressZip4: normalized.addressZip4,
      addressCountry: normalized.addressCountry,
      placeId: normalized.placeId ?? undefined,
      lat: normalized.lat ?? undefined,
      lng: normalized.lng ?? undefined,
      addressValidated: normalized.addressValidated,
      validationSource: validationSource as "GOOGLE" | "USER" | "NONE" | "OTHER",
      esiid: addressChanged
        ? null
        : body.utilityHints?.esiid ?? existingAddress?.esiid ?? undefined,
      tdspSlug: addressChanged
        ? null
        : body.utilityHints?.tdspSlug ?? existingAddress?.tdspSlug ?? undefined,
      utilityName: addressChanged
        ? null
        : body.utilityHints?.utilityName ?? existingAddress?.utilityName ?? undefined,
      utilityPhone: addressChanged
        ? null
        : body.utilityHints?.utilityPhone ?? existingAddress?.utilityPhone ?? undefined,
      smartMeterConsent: body.smartMeterConsent ?? false,
      smartMeterConsentDate: body.smartMeterConsentDate
        ? new Date(body.smartMeterConsentDate)
        : undefined,
      rawGoogleJson: body.googlePlaceDetails as any,
      rawWattbuyJson: body.wattbuyJson as any,
    };

    const selectFields = {
      id: true,
      userId: true,
      houseId: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressState: true,
      addressZip5: true,
      addressZip4: true,
      addressCountry: true,
      lat: true,
      lng: true,
      addressValidated: true,
      esiid: true,
      tdspSlug: true,
      utilityName: true,
      utilityPhone: true,
      createdAt: true,
      updatedAt: true,
    };

    let record = existingAddress
      ? await prisma.houseAddress.update({
          where: { id: existingAddress.id },
          data: addressData,
          select: selectFields,
        })
      : await prisma.houseAddress.create({
          data: addressData,
          select: selectFields,
        });

    const shouldLookupEsiid = (!record.esiid || addressChanged) && !wattbuyEsiidDisabled;

    if (shouldLookupEsiid) {
      try {
        const lookup = await resolveAddressToEsiid({
          line1: normalized.addressLine1,
          line1Alt: normalized.addressLine1Short ?? null,
          line2: normalized.addressLine2 ?? null,
          city: normalized.addressCity,
          state: normalized.addressState,
          zip: normalized.addressZip5,
        });

        console.log("[address/save] resolveAddressToEsiid result", {
          hasEsiid: Boolean(lookup.esiid),
          utility: lookup.utility ?? null,
          territory: lookup.territory ?? null,
          addressChanged,
        });

        if (lookup.esiid) {
          record = await prisma.houseAddress.update({
            where: { id: record.id },
            data: {
              esiid: lookup.esiid,
              utilityName: lookup.utility ?? record.utilityName ?? undefined,
              tdspSlug: lookup.territory ?? record.tdspSlug ?? undefined,
            },
            select: selectFields,
          });

          try {
            await prisma.userProfile.update({
              where: { userId },
              data: { esiid: lookup.esiid },
            });
          } catch (profileErr) {
            if (process.env.NODE_ENV === "development") {
              console.warn("[address/save] userProfile update skipped", profileErr);
            }
          }
        }
      } catch (resolveErr) {
        console.warn("[address/save] resolveAddressToEsiid failed", resolveErr);
      }
    }

    (async () => {
      try {
        const url = process.env.DROPLET_WEBHOOK_URL;
        const secret = process.env.DROPLET_WEBHOOK_SECRET;
        if (url && secret) {
          await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-intelliwatt-secret": secret,
            },
            body: JSON.stringify({ reason: "address_saved", ts: Date.now() }),
            cache: "no-store",
            next: { revalidate: 0 },
          });
        }
      } catch {
        // noop - never block user flow
      }
    })();

    return NextResponse.json({
      ok: true,
      address: {
        id: record.id,
        userId: record.userId,
        houseId: record.houseId,
        line1: record.addressLine1,
        line2: record.addressLine2,
        city: record.addressCity,
        state: record.addressState,
        zip5: record.addressZip5,
        zip4: record.addressZip4,
        country: record.addressCountry,
        lat: record.lat,
        lng: record.lng,
        validated: record.addressValidated,
        esiid: record.esiid,
        tdsp: record.tdspSlug,
        utility: { name: record.utilityName, phone: record.utilityPhone },
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
    });
  } catch (err: any) {
    console.error("address/save error:", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
