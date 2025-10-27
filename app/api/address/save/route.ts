import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeGoogleAddress, type GooglePlaceDetails } from "@/lib/normalizeGoogleAddress";

type SaveAddressBody = {
  userId: string;
  houseId?: string | null;
  googlePlaceDetails: GooglePlaceDetails;
  unitNumber?: string; // Optional unit/apartment number
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

    // Convert email to user ID if needed
    let userId = body.userId;
    if (body.userId.includes('@')) {
      // It's an email, look up the user
      const user = await prisma.user.findUnique({ where: { email: body.userId } });
      if (!user) {
        return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
      }
      userId = user.id;
      console.log(`Converted email ${body.userId} to user ID ${userId}`);
    }

    console.log("Google Place Details:", JSON.stringify(body.googlePlaceDetails, null, 2));
    console.log("Address components types:", body.googlePlaceDetails.address_components?.map((c: any) => c.types));
    const normalized = normalizeGoogleAddress(body.googlePlaceDetails, body.unitNumber);
    console.log("Normalized address:", JSON.stringify(normalized, null, 2));

    // Determine validation source: if place_id is null, it's a manual entry
    const validationSource = body.googlePlaceDetails.place_id ? "GOOGLE" : "USER";

    const addressData = {
      userId: userId,
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
    };

    // Check if user already has an address
    const existingAddress = await prisma.houseAddress.findFirst({
      where: { userId: userId },
      select: { id: true },
      orderBy: { createdAt: 'desc' }
    });
    
    const record = existingAddress
      ? await prisma.houseAddress.update({
          where: { id: existingAddress.id },
          data: addressData,
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
        })
      : await prisma.houseAddress.create({
          data: addressData,
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
