import { prisma } from "@/lib/db";
import type { ActualUsageSource } from "@/modules/realUsageAdapter/actual";
import { clearGreenButtonUsageForHouse } from "@/lib/usage/greenButtonHouseCleanup";
import { clearSmtUsageForHouse } from "@/lib/usage/smtHouseCleanup";

export type HouseCommittedUsageSourceMode = ActualUsageSource;

/** Persist the user's active usage mode and remove the other source's stored data. */
export async function commitHouseUsageSource(args: {
  houseId: string;
  userId: string;
  source: HouseCommittedUsageSourceMode;
  esiid?: string | null;
}): Promise<void> {
  const houseId = String(args.houseId ?? "").trim();
  const userId = String(args.userId ?? "").trim();
  const source = args.source;
  if (!houseId || !userId || (source !== "SMT" && source !== "GREEN_BUTTON")) return;

  const owned = await prisma.houseAddress.findFirst({
    where: { id: houseId, userId, archivedAt: null },
    select: { id: true, esiid: true },
  });
  if (!owned) return;

  const esiid = String(args.esiid ?? owned.esiid ?? "").trim() || null;

  if (source === "GREEN_BUTTON") {
    await clearSmtUsageForHouse({ houseId, esiid });
  } else {
    await clearGreenButtonUsageForHouse(houseId);
  }

  try {
    await prisma.houseAddress.update({
      where: { id: houseId },
      data: {
        committedUsageSource: source,
        committedUsageSourceAt: new Date(),
      },
    });
  } catch (err) {
    console.error(
      "[commitHouseUsageSource] Failed to persist committedUsageSource; run prisma migrate deploy on main DB",
      err,
    );
  }
}

export async function readHouseCommittedUsageSource(
  houseId: string
): Promise<HouseCommittedUsageSourceMode | null> {
  const id = String(houseId ?? "").trim();
  if (!id) return null;
  const row = await prisma.houseAddress
    .findFirst({
      where: { id },
      select: { committedUsageSource: true },
    })
    .catch(() => null);
  const stored = row?.committedUsageSource;
  return stored === "SMT" || stored === "GREEN_BUTTON" ? stored : null;
}
