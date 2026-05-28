import { prisma } from "@/lib/db";
import { refreshUserEntryStatuses } from "@/lib/hitthejackwatt/entryLifecycle";
import { ensureSmartMeterEntry } from "@/lib/smt/ensureSmartMeterEntry";
import {
  buildVisibleHouseEntryCounts,
  filterUserVisibleHouses,
  hasEligibleSmartMeterEntryOnVisibleHomes,
  pickVisibleHouseIdForSmtEntrySync,
  visibleUserHouseIdSet,
} from "@/lib/usage/userSiteSimulationIsolation";

export type UserJackpotEntryRow = {
  id: string;
  type: string;
  amount: number;
  houseId: string | null;
  status: string;
};

type JackpotHouseRow = {
  id: string;
  label: string | null;
  addressLine1: string | null;
  archivedAt: Date | null;
  isPrimary: boolean;
};

export async function loadUserJackpotEntrySnapshot(userId: string): Promise<{
  entries: UserJackpotEntryRow[];
  total: number;
  byHouseId: Map<string, number>;
}> {
  await refreshUserEntryStatuses(userId);

  const now = new Date();
  const prismaAny = prisma as any;

  const housesRaw = (await prismaAny.houseAddress.findMany({
    where: { userId },
    select: { id: true, label: true, addressLine1: true, archivedAt: true, isPrimary: true },
  })) as JackpotHouseRow[];
  const visibleHouses = filterUserVisibleHouses(housesRaw);
  const visibleHouseIds = visibleUserHouseIdSet(housesRaw);
  const visibleHouseIdList = Array.from(visibleHouseIds);

  const smtAuthsOnVisibleHomes =
    visibleHouseIdList.length > 0
      ? await prismaAny.smtAuthorization.findMany({
          where: {
            userId,
            archivedAt: null,
            OR: [
              { houseAddressId: { in: visibleHouseIdList } },
              { houseId: { in: visibleHouseIdList } },
            ],
          },
          select: { houseAddressId: true, houseId: true, authorizationEndDate: true },
        })
      : [];

  const smtAuthorizedVisibleHouseIds: string[] = smtAuthsOnVisibleHomes
    .filter((row: { authorizationEndDate?: Date | null }) => {
      if (!row.authorizationEndDate) return true;
      return new Date(row.authorizationEndDate).getTime() > now.getTime();
    })
    .flatMap((row: { houseAddressId?: string | null; houseId?: string | null }) => {
      const ids = [row.houseAddressId, row.houseId]
        .map((id) => String(id ?? "").trim())
        .filter((id): id is string => Boolean(id) && visibleHouseIds.has(id));
      return ids;
    });
  const smtAuthorizedVisibleHouseIdSet = new Set<string>(smtAuthorizedVisibleHouseIds);
  const hasVisibleSmtAuth = smtAuthorizedVisibleHouseIdSet.size > 0;

  let entries = (await prismaAny.entry.findMany({
    where: { userId },
    select: { id: true, type: true, amount: true, houseId: true, status: true },
  })) as UserJackpotEntryRow[];

  const syncHouseId = pickVisibleHouseIdForSmtEntrySync({
    visibleHouses,
    smtAuthorizedVisibleHouseIds: Array.from(smtAuthorizedVisibleHouseIdSet),
  });
  const needsUsageEntryOnVisibleHome =
    hasVisibleSmtAuth &&
    syncHouseId &&
    !hasEligibleSmartMeterEntryOnVisibleHomes(entries, visibleHouseIds);

  if (needsUsageEntryOnVisibleHome) {
    try {
      await ensureSmartMeterEntry(userId, syncHouseId, now);
      await refreshUserEntryStatuses(userId);
      entries = (await prismaAny.entry.findMany({
        where: { userId },
        select: { id: true, type: true, amount: true, houseId: true, status: true },
      })) as UserJackpotEntryRow[];
    } catch (syncErr) {
      console.error("[loadUserJackpotEntrySnapshot] ensureSmartMeterEntry failed", syncErr);
    }
  }

  const { total, byHouseId } = buildVisibleHouseEntryCounts({
    entries,
    visibleHouses,
    visibleHouseIds,
  });

  return { entries, total, byHouseId };
}
