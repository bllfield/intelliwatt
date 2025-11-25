import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const profiles = await prisma.userProfile.findMany({
      where: {
        esiidAttentionRequired: true,
        esiidAttentionCode: { in: ["smt_replaced", "smt_revoke_requested"] },
      },
      select: {
        userId: true,
        esiid: true,
        esiidAttentionAt: true,
        esiidAttentionCode: true,
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    const prismaAny = prisma as any;

    const flagged = await Promise.all(
      profiles.map(async (profile) => {
        const isRevocation = profile.esiidAttentionCode === "smt_revoke_requested";

        const houses = (await prismaAny.houseAddress.findMany({
          where: {
            userId: profile.userId,
            ...(isRevocation
              ? { archivedAt: null }
              : { archivedAt: { not: null } }),
          },
          orderBy: {
            createdAt: "desc",
          },
          select: {
            id: true,
            addressLine1: true,
            addressLine2: true,
            addressCity: true,
            addressState: true,
            addressZip5: true,
            archivedAt: true,
            esiid: true,
            utilityName: true,
          },
        })) as Array<{
          id: string;
          addressLine1: string;
          addressLine2: string | null;
          addressCity: string;
          addressState: string;
          addressZip5: string;
          archivedAt: Date | null;
          esiid: string | null;
          utilityName: string | null;
        }>;

        const authorizations = isRevocation
          ? ((await prismaAny.smtAuthorization.findMany({
              where: {
                userId: profile.userId,
                archivedAt: { not: null },
                revokedReason: "customer_requested",
              },
              orderBy: {
                archivedAt: "desc",
              },
              select: {
                id: true,
                meterNumber: true,
                esiid: true,
                authorizationEndDate: true,
                archivedAt: true,
                smtStatusMessage: true,
                houseAddress: {
                  select: {
                    addressLine1: true,
                    addressLine2: true,
                    addressCity: true,
                    addressState: true,
                    addressZip5: true,
                  },
                },
              },
            })) as Array<{
              id: string;
              meterNumber: string | null;
              esiid: string | null;
              authorizationEndDate: Date | null;
              archivedAt: Date | null;
              smtStatusMessage: string | null;
              houseAddress: {
                addressLine1: string | null;
                addressLine2: string | null;
                addressCity: string | null;
                addressState: string | null;
                addressZip5: string | null;
              } | null;
            }>)
          : [];

        return {
          userId: profile.userId,
          email: profile.user?.email ?? null,
          esiid: profile.esiid ?? null,
          attentionAt: profile.esiidAttentionAt?.toISOString() ?? null,
          attentionCode: profile.esiidAttentionCode ?? null,
          houses: houses.map((house) => ({
            id: house.id,
            addressLine1: house.addressLine1,
            addressLine2: house.addressLine2,
            addressCity: house.addressCity,
            addressState: house.addressState,
            addressZip5: house.addressZip5,
            archivedAt: house.archivedAt?.toISOString() ?? null,
            esiid: house.esiid ?? null,
            utilityName: house.utilityName ?? null,
          })),
          authorizations: authorizations.map((auth) => ({
            id: auth.id,
            meterNumber: auth.meterNumber ?? null,
            esiid: auth.esiid ?? null,
            archivedAt: auth.archivedAt?.toISOString() ?? null,
            authorizationEndDate: auth.authorizationEndDate?.toISOString() ?? null,
            smtStatusMessage: auth.smtStatusMessage ?? null,
            houseAddress: auth.houseAddress
              ? {
                  addressLine1: auth.houseAddress.addressLine1 ?? "",
                  addressLine2: auth.houseAddress.addressLine2 ?? null,
                  addressCity: auth.houseAddress.addressCity ?? "",
                  addressState: auth.houseAddress.addressState ?? "",
                  addressZip5: auth.houseAddress.addressZip5 ?? "",
                }
              : null,
          })),
        };
      }),
    );

    return NextResponse.json(flagged);
  } catch (error) {
    console.error("[admin/houses/flagged] Failed to load flagged houses", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

