import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { cleanEsiid } from "@/lib/smt/esiid";

function isEsiidUniqueConstraintError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return true;
  }
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "P2002";
}

function esiidLookupVariants(raw: string): string[] {
  const cleaned = cleanEsiid(raw);
  if (!cleaned) return [];
  const variants = new Set<string>([cleaned, `'${cleaned}'`, `"${cleaned}"`]);
  const digitsOnly = cleaned.replace(/\D/g, "");
  if (digitsOnly) variants.add(digitsOnly);
  return Array.from(variants);
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
      esiid: { in: esiidLookupVariants(cleanedEsiid) },
      id: { not: houseAddressId },
    },
    select: { id: true, userId: true, esiid: true },
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
