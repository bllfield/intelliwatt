import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { hasSmtIntervalsInCanonicalWindow } from "@/lib/usage/smtCanonicalAvailability";
import { getOnePathLabTestHomeLink } from "@/modules/usageSimulator/labTestHome";

const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

/** Removes persisted Green Button usage for a house (intervals, raw, uploads). */
export async function clearGreenButtonUsageForHouse(houseId: string): Promise<void> {
  const id = String(houseId ?? "").trim();
  if (!id) return;

  if (USAGE_DB_ENABLED) {
    await (usagePrisma as any).greenButtonInterval?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).rawGreenButton?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).homeMonthlyUsageBucket?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
    await (usagePrisma as any).homeDailyUsageBucket?.deleteMany?.({ where: { homeId: id } }).catch(() => null);
  }
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
      select: { userId: true },
    })
    .catch(() => null);
  const ownerUserId = String(house?.userId ?? "").trim();
  if (!ownerUserId) return false;
  const link = await getOnePathLabTestHomeLink(ownerUserId).catch(() => null);
  return typeof link?.testHomeHouseId === "string" && link.testHomeHouseId.trim() === id;
}

/**
 * When canonical-window SMT exists for a home, Green Button is superseded and removed so reads cannot fall back to it.
 * Skips the global One Path lab test home (admin GB scenarios).
 */
export async function clearGreenButtonSupersededBySmtForHouse(args: {
  houseId: string;
  esiid?: string | null;
}): Promise<boolean> {
  const houseId = String(args.houseId ?? "").trim();
  const esiid = String(args.esiid ?? "").trim();
  if (!houseId || !esiid) return false;
  if (await isOnePathLabTestHomeHouse(houseId)) return false;
  if (!(await hasSmtIntervalsInCanonicalWindow(esiid))) return false;
  await clearGreenButtonUsageForHouse(houseId);
  return true;
}
