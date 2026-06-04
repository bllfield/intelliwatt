import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { ONE_PATH_LAB_TEST_HOME_LABEL } from "@/modules/usageSimulator/labTestHomeLabels";

const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

/** Removes interval/raw/bucket Green Button usage rows (keeps upload metadata for Utility Exports UI). */
export async function clearGreenButtonIntervalUsageForHouse(houseId: string): Promise<void> {
  const id = String(houseId ?? "").trim();
  if (!id) return;

  if (USAGE_DB_ENABLED) {
    await (usagePrisma as any).greenButtonInterval?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).rawGreenButton?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).homeMonthlyUsageBucket?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).homeDailyUsageBucket?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
  }
}

/** Removes all persisted Green Button usage for a house (intervals, raw, uploads). */
export async function clearGreenButtonUsageForHouse(houseId: string): Promise<void> {
  const id = String(houseId ?? "").trim();
  if (!id) return;

  await clearGreenButtonIntervalUsageForHouse(id);
  await prisma.greenButtonUpload.deleteMany({ where: { houseId: id } }).catch(() => null);
  await prisma.manualUsageUpload
    .deleteMany({ where: { houseId: id, source: "green_button" } })
    .catch(() => null);
}

async function isOnePathLabTestHomeHouse(houseId: string): Promise<boolean> {
  const id = String(houseId ?? "").trim();
  if (!id) return false;
  const house = await prisma.houseAddress
    .findUnique({
      where: { id },
      select: { label: true },
    })
    .catch(() => null);
  return String(house?.label ?? "").trim() === ONE_PATH_LAB_TEST_HOME_LABEL;
}

/**
 * @deprecated User homes commit usage source explicitly via `commitHouseUsageSource`.
 * Kept for admin tooling; does not run on user SMT heal anymore.
 */
export async function clearGreenButtonSupersededBySmtForHouse(args: {
  houseId: string;
  esiid?: string | null;
}): Promise<boolean> {
  const houseId = String(args.houseId ?? "").trim();
  const esiid = String(args.esiid ?? "").trim();
  if (!houseId || !esiid) return false;
  if (await isOnePathLabTestHomeHouse(houseId)) return false;
  await clearGreenButtonIntervalUsageForHouse(houseId);
  return true;
}
