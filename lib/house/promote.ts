import { prisma } from "@/lib/db";

export async function setPrimaryHouse(
  userId: string,
  houseId: string,
  opts: { keepOthers?: boolean } = {},
) {
  const now = new Date();

  const client = prisma as any;

  return client.$transaction(async (tx: any) => {
    const otherHouses = await tx.houseAddress.findMany({
      where: {
        userId,
        archivedAt: null,
        id: { not: houseId },
      },
      select: { id: true },
    });

    const otherIds = otherHouses.map((house: any) => house.id);
    let archivedHouseIds: string[] = [];

    if (otherIds.length > 0) {
      if (opts.keepOthers) {
        await tx.houseAddress.updateMany({
          where: { id: { in: otherIds } },
          data: { isPrimary: false },
        });
      } else {
        await tx.houseAddress.updateMany({
          where: { id: { in: otherIds } },
          data: { isPrimary: false, archivedAt: now },
        });

        await tx.smtAuthorization.updateMany({
          where: { houseAddressId: { in: otherIds }, archivedAt: null },
          data: {
            archivedAt: now,
            smtStatus: "archived",
            smtStatusMessage: "Superseded by new address",
            revokedReason: "address_replaced",
          },
        });

        archivedHouseIds = otherIds;
      }
    }

    await tx.houseAddress.update({
      where: { id: houseId },
      data: { isPrimary: true, archivedAt: null },
    });

    return { archivedHouseIds };
  });
}

export async function archiveAuthorizationsForHouse(houseId: string, reason: string) {
  const now = new Date();

  const result = await (prisma as any).smtAuthorization.updateMany({
    where: { houseAddressId: houseId, archivedAt: null },
    data: {
      archivedAt: now,
      smtStatus: reason === "conflict_replaced" ? "revoked_conflict" : "archived",
      smtStatusMessage:
        reason === "address_replaced"
          ? "Superseded by new address"
          : "Authorization archived",
      revokedReason: reason,
    },
  });

  return result.count ?? 0;
}

type ArchiveConflictParams = {
  newAuthorizationId: string;
  newHouseId: string;
  userId: string;
  esiid: string;
  meterNumber?: string | null;
};

export async function archiveConflictingAuthorizations({
  newAuthorizationId,
  newHouseId,
  userId,
  esiid,
  meterNumber,
}: ArchiveConflictParams) {
  const now = new Date();

  const client = prisma as any;

  return client.$transaction(async (tx: any) => {
    const orClauses = [
      { esiid },
      meterNumber && meterNumber.trim().length > 0 ? { meterNumber } : null,
    ].filter(Boolean) as { esiid?: string; meterNumber?: string }[];

    if (!orClauses.length) {
      return { archivedAuthorizationIds: [] as string[], displacedUserIds: [] as string[] };
    }

    const conflicts = await tx.smtAuthorization.findMany({
      where: {
        archivedAt: null,
        id: { not: newAuthorizationId },
        OR: orClauses,
      },
      select: { id: true, userId: true, houseAddressId: true },
    });

    if (!conflicts.length) {
      return { archivedAuthorizationIds: [] as string[], displacedUserIds: [] as string[] };
    }

    const archivedAuthorizationIds: string[] = [];
    const displacedUserIds = new Set<string>();

    for (const auth of conflicts) {
      archivedAuthorizationIds.push(auth.id);

      await tx.smtAuthorization.update({
        where: { id: auth.id },
        data: {
          archivedAt: now,
          smtStatus: "revoked_conflict",
          smtStatusMessage: `Superseded by authorization ${newAuthorizationId}`,
          revokedReason: "conflict_replaced",
        },
      });

      if (auth.houseAddressId) {
        await tx.houseAddress.update({
          where: { id: auth.houseAddressId },
          data: { archivedAt: now, isPrimary: false },
        });
      }

      const displacedEntries = await tx.entry.findMany({
        where: {
          userId: auth.userId,
          type: "smart_meter_connect",
          houseId: auth.houseAddressId ?? null,
        },
        select: { id: true, status: true },
      });

      for (const entry of displacedEntries) {
        await tx.entry.update({
          where: { id: entry.id },
          data: {
            status: "EXPIRED",
            expiresAt: now,
            expirationReason: "Smart Meter Texas authorization replaced by another IntelliWatt household",
            lastValidated: now,
          },
        });

        await tx.entryStatusLog.create({
          data: {
            entryId: entry.id,
            previous: entry.status,
            next: "EXPIRED",
            reason: "smt_replaced",
          },
        });
      }

      if (auth.userId !== userId) {
        displacedUserIds.add(auth.userId);
      }
    }

    if (displacedUserIds.size > 0) {
      const displaced = Array.from(displacedUserIds);
      try {
        await tx.userProfile.updateMany({
          where: { userId: { in: displaced } },
          data: {
            esiidAttentionRequired: true,
            esiidAttentionCode: "smt_replaced",
            esiidAttentionAt: now,
          },
        });
      } catch (err) {
        console.warn(
          "[archiveConflictingAuthorizations] Failed to set attention flags; run prisma migrate deploy?",
          err,
        );
      }
    }

    return {
      archivedAuthorizationIds,
      displacedUserIds: Array.from(displacedUserIds),
    };
  });
}

