import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const profiles = await prisma.userProfile.findMany({
      where: {
        esiidAttentionRequired: true,
        esiidAttentionCode: "smt_replaced",
      },
      select: {
        userId: true,
        esiid: true,
        esiidAttentionAt: true,
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
        const houses = (await prismaAny.houseAddress.findMany({
          where: {
            userId: profile.userId,
            archivedAt: { not: null },
          },
          orderBy: {
            archivedAt: "desc",
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

        return {
          userId: profile.userId,
          email: profile.user?.email ?? null,
          esiid: profile.esiid ?? null,
          attentionAt: profile.esiidAttentionAt?.toISOString() ?? null,
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
        };
      }),
    );

    return NextResponse.json(flagged);
  } catch (error) {
    console.error("[admin/houses/flagged] Failed to load flagged houses", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

