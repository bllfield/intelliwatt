import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeGoogleAddress, type GooglePlaceDetails } from "@/lib/normalizeGoogleAddress";
import { normalizeEmail } from "@/lib/utils/email";
import { resolveAddressToEsiid } from "@/lib/resolver/addressToEsiid";
import { wattbuyEsiidDisabled } from "@/lib/flags";
import { extractWattbuyEsiid, cleanEsiid } from "@/lib/smt/esiid";
import { queueMeterInfoForHouse } from "@/lib/smt/meterInfo";
import { archiveAuthorizationsForHouse, setPrimaryHouse } from "@/lib/house/promote";

let userProfileAttentionColumnsAvailable: boolean | null = null;
let houseAddressUserEmailColumnAvailable: boolean | null = null;
let houseAddressIsRenterColumnAvailable: boolean | null = null;

async function ensureUserProfileAttentionColumns(): Promise<boolean> {
  if (userProfileAttentionColumnsAvailable !== null) {
    return userProfileAttentionColumnsAvailable;
  }

  try {
    const result = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS "count"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'UserProfile'
        AND column_name IN ('esiidAttentionRequired', 'esiidAttentionCode', 'esiidAttentionAt')
    `;

    const count = result[0]?.count ?? 0;
    userProfileAttentionColumnsAvailable = count === 3;
  } catch (err) {
    console.warn("[address/save] attention columns probe failed", err);
    userProfileAttentionColumnsAvailable = false;
  }

  if (!userProfileAttentionColumnsAvailable) {
    console.warn(
      "[address/save] ESIID attention columns missing; run `npx prisma migrate deploy` to add them.",
    );
  }

  return userProfileAttentionColumnsAvailable;
}

async function ensureHouseAddressUserEmailColumn(): Promise<boolean> {
  if (houseAddressUserEmailColumnAvailable !== null) {
    return houseAddressUserEmailColumnAvailable;
  }

  try {
    const result = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'HouseAddress'
          AND column_name = 'userEmail'
      ) AS "exists"
    `;

    houseAddressUserEmailColumnAvailable = Boolean(result[0]?.exists);
  } catch (err) {
    console.warn("[address/save] userEmail column probe failed", err);
    houseAddressUserEmailColumnAvailable = false;
  }

  if (!houseAddressUserEmailColumnAvailable) {
    console.warn(
      "[address/save] HouseAddress.userEmail column missing; run migration 20251119053000_add_houseaddress_user_email.",
    );
  }

  return houseAddressUserEmailColumnAvailable;
}

async function ensureHouseAddressIsRenterColumn(): Promise<boolean> {
  if (houseAddressIsRenterColumnAvailable !== null) {
    return houseAddressIsRenterColumnAvailable;
  }

  try {
    const result = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'HouseAddress'
          AND column_name = 'isRenter'
      ) AS "exists"
    `;
    houseAddressIsRenterColumnAvailable = Boolean(result[0]?.exists);
  } catch (err) {
    console.warn("[address/save] isRenter column probe failed", err);
    houseAddressIsRenterColumnAvailable = false;
  }

  if (!houseAddressIsRenterColumnAvailable) {
    console.warn(
      "[address/save] HouseAddress.isRenter column missing; run prisma migrate deploy for 20260112200000_add_houseaddress_isrenter.",
    );
  }

  return houseAddressIsRenterColumnAvailable;
}

export const dynamic = "force-dynamic";

type SaveAddressBody = {
  userId: string;
  houseId?: string | null;
  googlePlaceDetails: GooglePlaceDetails;
  unitNumber?: string;
  wattbuyJson?: unknown;
  keepOtherHouses?: boolean;
  isRenter?: boolean | null;
  utilityHints?: {
    esiid?: string | null;
    tdspSlug?: string | null;
    utilityName?: string | null;
    utilityPhone?: string | null;
  } | null;
  smartMeterConsent?: boolean;
  smartMeterConsentDate?: string | null;
};

const toOptionalString = (value: any): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? toOptionalString(value[0]) : null;
  }

  if (value !== null && value !== undefined && typeof value !== "object") {
    return String(value);
  }

  return null;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SaveAddressBody;
    console.log("API received body:", JSON.stringify(body, null, 2));

    if (!body?.googlePlaceDetails) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }

    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

    let userIdentifier = body.userId ?? sessionEmail ?? null;
    if (!userIdentifier) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    let userId = userIdentifier;
    let resolvedUserEmail: string | null = null;
    if (userIdentifier.includes("@")) {
      const normalizedEmail = normalizeEmail(userIdentifier);
      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (!user) {
        return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
      }
      userId = user.id;
      resolvedUserEmail = normalizedEmail;
      console.log(`Converted email ${normalizedEmail} to user ID ${userId}`);
    } else {
      const user = await prisma.user.findUnique({ where: { id: userIdentifier } });
      if (!user) {
        return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
      }
      resolvedUserEmail = normalizeEmail(user.email);
    }

    if (!resolvedUserEmail) {
      return NextResponse.json({ ok: false, error: "User email unavailable" }, { status: 500 });
    }

    const houseAddressEmailAvailable = await ensureHouseAddressUserEmailColumn();
    const houseAddressIsRenterAvailable = await ensureHouseAddressIsRenterColumn();
    const keepOtherHouses = body.keepOtherHouses === true;

    const selectFields: any = {
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
      placeId: true,
      lat: true,
      lng: true,
      addressValidated: true,
      esiid: true,
      tdspSlug: true,
      utilityName: true,
      utilityPhone: true,
      createdAt: true,
      updatedAt: true,
  isPrimary: true,
  archivedAt: true,
      ...(houseAddressEmailAvailable ? { userEmail: true } : {}),
      ...(houseAddressIsRenterAvailable ? { isRenter: true } : {}),
    };

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

    let existingAddress: any = await prisma.houseAddress.findFirst({
      where: { userId, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: selectFields,
    });

    if (!existingAddress) {
      existingAddress = await prisma.houseAddress.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: selectFields,
      });
    }

    const existingLine1Lower = String(existingAddress?.addressLine1 ?? "").trim().toLowerCase();
    const existingLine2Lower = String(existingAddress?.addressLine2 ?? "").trim().toLowerCase();
    const existingCityLower = String(existingAddress?.addressCity ?? "").trim().toLowerCase();
    const existingStateLower = String(existingAddress?.addressState ?? "").trim().toLowerCase();
    const existingZip = String(existingAddress?.addressZip5 ?? "").trim();
    const normalizedLine2Lower = String(normalized.addressLine2 ?? "").trim().toLowerCase();
    const existingPlaceId = String(existingAddress?.placeId ?? "").trim();
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
    const wattbuyEsiid = extractWattbuyEsiid(body.wattbuyJson);
    const cleanedHintEsiid = cleanEsiid(body.utilityHints?.esiid ?? null);
    const existingCleanEsiid = cleanEsiid(existingAddress?.esiid ?? null);

    const esiidForWrite: string | null | undefined = addressChanged
      ? (wattbuyEsiid ?? null)
      : cleanedHintEsiid ?? existingCleanEsiid ?? wattbuyEsiid ?? undefined;

    const addressData: any = {
      userId,
      houseId: body.houseId ?? null,
      ...(houseAddressEmailAvailable ? { userEmail: resolvedUserEmail } : {}),
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
      esiid: esiidForWrite,
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
      isPrimary: true,
      archivedAt: null,
    };

    // Persist renter flag only if column exists. If caller omitted isRenter, keep existing value.
    if (houseAddressIsRenterAvailable) {
      if (typeof body.isRenter === "boolean") {
        addressData.isRenter = body.isRenter;
      } else if (existingAddress && typeof (existingAddress as any).isRenter === "boolean") {
        addressData.isRenter = (existingAddress as any).isRenter;
      } else {
        addressData.isRenter = false;
      }
    }

    let record: any = existingAddress
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
      const attentionColumnsAvailable = await ensureUserProfileAttentionColumns();
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
          const conflicting = await prisma.houseAddress.findFirst({
            where: { esiid: lookup.esiid },
            select: selectFields,
          });

          if (conflicting && conflicting.id !== record.id) {
            if (conflicting.userId && conflicting.userId !== record.userId) {
              console.warn("[address/save] esiid conflict transfer", {
                lookupEsiid: lookup.esiid,
                conflictingUserId: conflicting.userId,
                currentUserId: record.userId,
              });

              record = await prisma.$transaction(async (tx) => {
                await (tx as any).houseAddress.update({
                  where: { id: conflicting.id },
                  data: {
                    esiid: null,
                    tdspSlug: null,
                    utilityName: null,
                    utilityPhone: null,
                  } as any,
                });

                if (attentionColumnsAvailable) {
                  await tx.$executeRawUnsafe(
                    'UPDATE "UserProfile" SET "esiidAttentionRequired" = TRUE, "esiidAttentionCode" = $1, "esiidAttentionAt" = NOW() WHERE "userId" = $2',
                    lookup.esiid,
                    conflicting.userId,
                  );
                } else {
                  console.warn(
                    "[address/save] Skipping attention flag set; columns unavailable (run prisma migrate deploy).",
                  );
                }

                const nextUtilityName =
                  toOptionalString(lookup.utility) ?? toOptionalString(record.utilityName) ?? null;
                const nextTdspSlug =
                  toOptionalString(lookup.territory) ?? toOptionalString(record.tdspSlug) ?? null;
                const takeoverUpdate: any = {
                  esiid: lookup.esiid,
                  utilityName: nextUtilityName,
                  tdspSlug: nextTdspSlug,
                  ...(houseAddressEmailAvailable ? { userEmail: resolvedUserEmail } : {}),
                };

                const updatedRecord = await (tx as any).houseAddress.update({
                  where: { id: record.id },
                  data: takeoverUpdate,
                  select: selectFields,
                });

                return updatedRecord;
              });
            } else {
              const recordIdToDelete = record.id;
              const sameUserUpdate: any = {
                addressLine1: normalized.addressLine1,
                addressLine2: normalized.addressLine2 ?? null,
                addressCity: normalized.addressCity,
                addressState: normalized.addressState,
                addressZip5: normalized.addressZip5,
                addressZip4: normalized.addressZip4 ?? null,
                addressCountry: normalized.addressCountry,
                placeId: normalized.placeId ?? null,
                lat: normalized.lat ?? null,
                lng: normalized.lng ?? null,
                addressValidated: normalized.addressValidated,
                validationSource: validationSource as "GOOGLE" | "USER" | "NONE" | "OTHER",
                esiid: lookup.esiid,
                utilityName:
                  toOptionalString(lookup.utility) ??
                  toOptionalString(conflicting.utilityName) ??
                  null,
                tdspSlug:
                  toOptionalString(lookup.territory) ??
                  toOptionalString(conflicting.tdspSlug) ??
                  null,
                rawGoogleJson: body.googlePlaceDetails as any,
                rawWattbuyJson: body.wattbuyJson as any,
                ...(houseAddressEmailAvailable ? { userEmail: resolvedUserEmail } : {}),
              };

              record = await (prisma as any).houseAddress.update({
                where: { id: conflicting.id },
                data: sameUserUpdate,
                select: selectFields,
              });

              if (recordIdToDelete && recordIdToDelete !== conflicting.id) {
                try {
                  await prisma.houseAddress.delete({ where: { id: recordIdToDelete } });
                } catch (deleteErr) {
                  console.warn("[address/save] cleanup delete failed", deleteErr);
                }
              }
            }
          } else {
            const nextUtilityName =
              toOptionalString(lookup.utility) ?? toOptionalString(record.utilityName) ?? null;
            const nextTdspSlug =
              toOptionalString(lookup.territory) ?? toOptionalString(record.tdspSlug) ?? null;
            const standardUpdate: any = {
              esiid: lookup.esiid,
              utilityName: nextUtilityName,
              tdspSlug: nextTdspSlug,
              ...(houseAddressEmailAvailable ? { userEmail: resolvedUserEmail } : {}),
            };

            record = await (prisma as any).houseAddress.update({
              where: { id: record.id },
              data: standardUpdate,
              select: selectFields,
            });

            try {
              await prisma.userProfile.update({
                where: { userId },
                data: {
                  esiid: lookup.esiid,
                },
              });
              if (attentionColumnsAvailable) {
                await prisma.$executeRawUnsafe(
                  'UPDATE "UserProfile" SET "esiidAttentionRequired" = FALSE, "esiidAttentionCode" = NULL, "esiidAttentionAt" = NULL WHERE "userId" = $1',
                  userId,
                );
              } else {
                console.warn(
                  "[address/save] Skipping attention flag reset; columns unavailable (run prisma migrate deploy).",
                );
              }
            } catch (profileErr) {
              if (process.env.NODE_ENV === "development") {
                console.warn("[address/save] userProfile update skipped", profileErr);
              }
            }
          }
        }
      } catch (resolveErr) {
        console.warn("[address/save] resolveAddressToEsiid failed", resolveErr);
      }
    }

    const archivedOnThisHouse =
      addressChanged && record?.id ? await archiveAuthorizationsForHouse(record.id, "address_replaced") : 0;

    const promotion = await setPrimaryHouse(userId, record.id, {
      keepOthers: keepOtherHouses,
    });

    const refreshedRecord = (await prisma.houseAddress.findUnique({
      where: { id: record.id },
      select: selectFields,
    })) as any;

    if (refreshedRecord) {
      record = refreshedRecord;
    }

    if (promotion.archivedHouseIds.length > 0) {
      await prisma.houseAddress.deleteMany({
        where: {
          id: { in: promotion.archivedHouseIds },
          archivedAt: { not: null },
          smtAuthorizations: { none: {} },
        } as any,
      });
    }

    const previousAuthorizationArchived =
      archivedOnThisHouse > 0 || promotion.archivedHouseIds.length > 0;

    if (record.houseId && record.esiid) {
      queueMeterInfoForHouse({ houseId: record.houseId, esiid: record.esiid }).catch((err) => {
        console.error("[address/save] queueMeterInfoForHouse failed", { houseId: record.houseId, esiid: record.esiid, err });
      });
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
          });
        }
      } catch {
        // noop - never block user flow
      }
    })();

    const responseUserEmail =
      houseAddressEmailAvailable && "userEmail" in record
        ? ((record as { userEmail?: string | null }).userEmail ?? resolvedUserEmail)
        : resolvedUserEmail;

    return NextResponse.json({
      ok: true,
      address: {
        id: record.id,
        userId: record.userId,
        houseId: record.houseId,
        userEmail: responseUserEmail,
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
        isPrimary: Boolean(record?.isPrimary),
        archivedAt: record.archivedAt,
      },
      meta: {
        previousAuthorizationArchived,
        warning: previousAuthorizationArchived
          ? "Your previous Smart Meter Texas authorization was archived. Submit a new authorization for this address to resume data sync."
          : null,
      },
    });
  } catch (err: any) {
    console.error("address/save error:", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
