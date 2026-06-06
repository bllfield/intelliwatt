import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { cleanEsiid } from "@/lib/smt/esiid";

function isEsiidUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function syncHouseIdentifiersFromAuthorization({
  houseAddressId,
  esiid,
}: {
  houseAddressId: string | null | undefined;
  esiid?: string | null;
  meterNumber?: string | null;
}) {
  if (!houseAddressId) return;

  const cleanedEsiid = cleanEsiid(esiid);
  if (!cleanedEsiid) return;

  const target = await prisma.houseAddress.findFirst({
    where: { id: houseAddressId },
    select: { id: true, userId: true, esiid: true },
  });
  if (!target) return;

  if (cleanEsiid(target.esiid) === cleanedEsiid) return;

  const conflicting = await prisma.houseAddress.findFirst({
    where: {
      esiid: cleanedEsiid,
      id: { not: houseAddressId },
    },
    select: { id: true, userId: true },
  });

  if (conflicting) {
    if (conflicting.userId && conflicting.userId === target.userId) {
      console.info("[house.syncIdentifiers] esiid already on sibling house; skipping duplicate assign", {
        houseAddressId,
        conflictingHouseId: conflicting.id,
        esiid: cleanedEsiid,
      });
      return;
    }

    console.warn("[house.syncIdentifiers] esiid owned by another house; skipping assign", {
      houseAddressId,
      conflictingHouseId: conflicting.id,
      conflictingUserId: conflicting.userId ?? null,
      esiid: cleanedEsiid,
    });
    return;
  }

  try {
    await prisma.houseAddress.update({
      where: { id: houseAddressId },
      data: { esiid: cleanedEsiid },
    });
  } catch (error) {
    if (isEsiidUniqueConstraintError(error)) {
      console.warn("[house.syncIdentifiers] esiid unique constraint; skipping assign", {
        houseAddressId,
        esiid: cleanedEsiid,
      });
      return;
    }

    console.error("[house.syncIdentifiers] failed to update house", {
      houseAddressId,
      error,
    });
  }
}
