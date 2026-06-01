import { prisma } from "@/lib/db";

export type ResolvedSimulationHouse = {
  id: string;
  esiid: string | null;
};

/**
 * Selected/build house must belong to the runtime user (lab test home or user house).
 */
export async function resolveSimulationHouseForUser(args: {
  userId: string;
  houseId: string;
}): Promise<ResolvedSimulationHouse> {
  const house = await (prisma as any).houseAddress.findFirst({
    where: { id: args.houseId, userId: args.userId, archivedAt: null },
    select: { id: true, esiid: true },
  });
  if (!house) throw new Error("house_not_found");
  return {
    id: String(house.id),
    esiid: house.esiid ? String(house.esiid) : null,
  };
}

/**
 * Actual-context house: same user as the build house when owned; otherwise resolve by house id
 * (One Path lab test home reads persisted usage from the linked source house).
 */
export async function resolveActualContextHouseForSimulation(args: {
  userId: string;
  selectedHouseId: string;
  actualContextHouseId: string;
  /** When set (One Path lab), load source-house truth under the customer who owns that home. */
  actualContextUserId?: string | null;
}): Promise<{ house: ResolvedSimulationHouse; ownerUserId: string }> {
  const actualContextHouseId = String(args.actualContextHouseId ?? args.selectedHouseId).trim();
  if (!actualContextHouseId) throw new Error("house_not_found");

  const explicitContextUserId = String(args.actualContextUserId ?? "").trim();
  if (explicitContextUserId && actualContextHouseId !== args.selectedHouseId) {
    const linked = await (prisma as any).houseAddress.findFirst({
      where: { id: actualContextHouseId, userId: explicitContextUserId, archivedAt: null },
      select: { id: true, esiid: true },
    });
    if (linked) {
      return {
        house: {
          id: String(linked.id),
          esiid: linked.esiid ? String(linked.esiid) : null,
        },
        ownerUserId: explicitContextUserId,
      };
    }
  }

  if (actualContextHouseId === args.selectedHouseId) {
    const house = await resolveSimulationHouseForUser({
      userId: args.userId,
      houseId: actualContextHouseId,
    });
    return { house, ownerUserId: args.userId };
  }

  const owned = await (prisma as any).houseAddress.findFirst({
    where: { id: actualContextHouseId, userId: args.userId, archivedAt: null },
    select: { id: true, esiid: true },
  });
  if (owned) {
    return {
      house: {
        id: String(owned.id),
        esiid: owned.esiid ? String(owned.esiid) : null,
      },
      ownerUserId: args.userId,
    };
  }

  const source = await (prisma as any).houseAddress.findFirst({
    where: { id: actualContextHouseId, archivedAt: null },
    select: { id: true, esiid: true, userId: true },
  });
  if (!source) throw new Error("house_not_found");

  return {
    house: {
      id: String(source.id),
      esiid: source.esiid ? String(source.esiid) : null,
    },
    ownerUserId: String(source.userId),
  };
}
