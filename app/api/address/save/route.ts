import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeGoogleAddress, type GooglePlaceDetails } from "@/lib/normalizeGoogleAddress";

type SaveAddressBody = {
  userId: string;
  houseId?: string | null;
  googlePlaceDetails: GooglePlaceDetails;
  wattbuyJson?: unknown; // optional: if you already fetched it client-side
  utilityHints?: {
    esiid?: string | null;
    tdspSlug?: string | null;
    utilityName?: string | null;
    utilityPhone?: string | null;
  } | null;
  smartMeterConsent?: boolean;
  smartMeterConsentDate?: string | null; // ISO timestamp
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SaveAddressBody;
    console.log("API received body:", JSON.stringify(body, null, 2));
    
    if (!body?.userId || !body?.googlePlaceDetails) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }

    console.log("Google Place Details:", JSON.stringify(body.googlePlaceDetails, null, 2));
    const normalized = normalizeGoogleAddress(body.googlePlaceDetails);
    console.log("Normalized address:", normalized);

    const record = await prisma.houseAddress.create({
      data: {
        userId: body.userId,
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
        validationSource: "GOOGLE",

        // Optional utility hints (e.g., from WattBuy or your own resolver)
        esiid: body.utilityHints?.esiid ?? undefined,
        tdspSlug: body.utilityHints?.tdspSlug ?? undefined,
        utilityName: body.utilityHints?.utilityName ?? undefined,
        utilityPhone: body.utilityHints?.utilityPhone ?? undefined,

        smartMeterConsent: body.smartMeterConsent ?? false,
        smartMeterConsentDate: body.smartMeterConsentDate
          ? new Date(body.smartMeterConsentDate)
          : undefined,

        rawGoogleJson: body.googlePlaceDetails as any,
        rawWattbuyJson: body.wattbuyJson as any,
      },
      select: {
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
      },
    });

    // Stable UI-facing shape
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
